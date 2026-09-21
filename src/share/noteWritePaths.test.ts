// @vitest-environment jsdom
// 공유 노트 파일을 고치는 로컬 쓰기 경로(노드 링크 추가·삭제·라벨 갱신, [[위키링크]] 일괄 치환, 템플릿 삭제 연쇄, 사이드바 이름 변경, 자동저장의
// 프론트매터 저장)가 복제 매니저의 **직렬 큐 밖**에서 `readFile → 필드 교체 → save`를 하면, 그 사이 매니저가 파일에 쓴 원격 편집이 옛 본문으로
// 되돌아간다(이후 3-way 흡수가 삭제로 전파). 이 테스트는 결정적 인터리빙으로 그 경쟁을 재현한다: 파일을 처음 읽는 순간을 붙잡고(read 지연 훅),
// 그 사이에 원격 편집을 도착시킨 뒤 풀어 준다. 큐 경유(`patchNoteFile`)면 두 변경이 모두 남는다.
// 실제 복제 매니저 + 실제 store·noteLinks·metaStore를 배선하고, `window.api`는 같은 메모리 파일시스템을 보는 대역이다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNoteCodec } from '../note/collabCodec';
import { MANIFEST_KEY, noteKey } from './docKeys';
import { upsertManifestEntry } from './manifest';
import { createReplicaManager, type ReplicaManager } from './replica';
import { MemFs, appendParagraph, until } from './replicaTestKit';
import { createShareSession, type ShareSession } from './shareClient';
import { makeFakeFactories, makeFakeShareApi } from './testFakes';
import { parseNote, serializeNote } from '../io/noteFormat';
import type { NoteMeta, ShareMarker } from '../types';

const codec = createNoteCodec();
const ROOM = 'room-AAAAAAAA';
const FOLDER = '/ws/team';
const A = `${FOLDER}/a.md`;
const BODY = '# 알파\n\n알파 첫 문단입니다 [[옛 제목]]\n\n알파 둘째 문단입니다';
const LINK = { mapId: 'm1', nodeId: 'x', nodeText: '노드' };

/** 지정 경로의 **첫 읽기**를 붙잡는 파일시스템(복제 매니저·window.api가 함께 쓴다). */
class GatedFs extends MemFs {
  private gate: { path: string; open: Promise<void>; hit: () => void } | null = null;
  arm(path: string): { release: () => void; hit: Promise<void> } {
    let release!: () => void;
    let hit!: () => void;
    const open = new Promise<void>((r) => (release = r));
    const hitP = new Promise<void>((r) => (hit = r));
    this.gate = { path, open, hit };
    return { release, hit: hitP };
  }
  override async read(path: string): Promise<string | null> {
    const g = this.gate;
    if (g && g.path === path) {
      this.gate = null;
      const text = this.get(path); // 붙잡기 전에 읽은 값 — 이후 다른 쓰기가 끼어들면 낡은 값이 된다
      g.hit();
      await g.open;
      return text;
    }
    return super.read(path);
  }
}

interface Env {
  fs: GatedFs;
  manager: ReplicaManager;
  session: ShareSession;
  noteDoc: Y.Doc;
}

const cleanups: (() => Promise<void>)[] = [];
let stores: {
  useShare: typeof import('../store/shareStore').useShare;
  useWorkspace: typeof import('../store/workspaceStore').useWorkspace;
};
let linksMod: typeof import('../note/noteLinks');
let metaMod: typeof import('../store/metaStore');

async function build(): Promise<Env> {
  const fs = new GatedFs(FOLDER);
  const { factories, providers } = makeFakeFactories();
  const fake = makeFakeShareApi();
  const session = createShareSession({ roomId: ROOM, wsUrl: 'ws://relay.example', getToken: async () => 't', factories });
  const manifest = session.openDoc(MANIFEST_KEY);
  const manager = createReplicaManager({
    roomId: ROOM,
    folderPath: FOLDER,
    role: 'participant',
    api: fake.api,
    manifest,
    codec,
    fs,
    host: {
      openDoc: async (k, s) => session.openDoc(k, { initialState: s }),
      closeDoc: async (k) => session.closeDoc(k),
    },
    writeDebounceMs: 3,
    deleteConfirmScans: 1,
    missingRecheckMs: 0,
  });
  cleanups.push(async () => {
    await manager.stop();
    session.destroy();
  });
  await manager.start();
  providers[0].sync();
  upsertManifestEntry(manifest.ydoc, 'n-a', { path: 'a.md', title: '알파', seeded: true });
  await manager.idle();
  const remote = new Y.Doc();
  codec.markdownToYDoc(BODY, remote);
  const noteDoc = session.getDoc(noteKey('n-a'))!.ydoc;
  Y.applyUpdate(noteDoc, Y.encodeStateAsUpdate(remote));
  await until(() => fs.has(A), '물질화');
  await manager.idle();
  // 노트에 링크·메타 블록이 있는 상태로 시작한다(프론트매터 = 이 기기 로컬 값)
  await manager.patchLocalNote(A, (n) => ({ ...n, links: [LINK], metaBlocks: [{ templateId: 't-del', values: { a: '1' } }] }));
  expect(parseNote(fs.get(A)!).links).toEqual([LINK]);

  // 스토어에 방·복제 제어 핸들을 배선한다(App.tsx의 rooms.ts 배선과 같은 모양)
  const marker: ShareMarker = { v: 1, roomId: ROOM, relayUrl: 'https://relay.example.com', role: 'participant', participantId: 'pid-AAAAAAAAAAAA', folderName: 'team', displayName: '지호' };
  stores.useShare.setState({
    rooms: {
      [ROOM]: {
        marker,
        folderPath: FOLDER,
        status: 'connected',
        error: null,
        participants: [],
        docs: {},
        notes: { [A]: 'n-a' },
        files: {},
        replica: {
          onLocalTitleChanged: (id, t) => manager.onLocalTitleChanged(id, t),
          ensureNoteDoc: async () => null,
          patchLocalNote: (p, m, h) => manager.patchLocalNote(p, m, h),
        },
      },
    },
  });
  const meta: NoteMeta = { path: A, id: 'n-a', title: '알파', links: [LINK] };
  stores.useWorkspace.setState({ noteIndex: [meta] });
  // window.api — 같은 파일시스템을 보는 대역(큐를 거치지 않는 옛 경로가 쓰는 readFile·save)
  // jsdom의 window를 통째로 바꾸면 코덱이 쓰는 DOMParser가 사라진다 — api만 얹는다.
  Object.assign(window, {
    api: {
      readFile: async (p: string) => {
        const t = await fs.read(p);
        if (t === null) throw new Error('ENOENT');
        return t;
      },
      save: async (p: string, c: string) => ((await fs.write(p, c)) ? p : null),
      attachedNotes: async () => [] as string[],
      meta: { saveTemplates: async () => undefined, getTemplates: async () => [] },
    },
  });
  return { fs, manager, session, noteDoc };
}

beforeEach(async () => {
  stores = {
    useShare: (await import('../store/shareStore')).useShare,
    useWorkspace: (await import('../store/workspaceStore')).useWorkspace,
  };
  linksMod = await import('../note/noteLinks');
  metaMod = await import('../store/metaStore');
});
afterEach(async () => {
  delete (window as unknown as { api?: unknown }).api;
  stores.useShare.setState({ rooms: {} });
  stores.useWorkspace.setState({ noteIndex: [] });
  for (const c of cleanups.splice(0)) await c();
});

/** 변경 도중(파일을 처음 읽는 순간)에 원격 편집이 도착하는 상황을 만들고, 끝난 뒤의 결과를 돌려준다. */
async function withRemoteEditDuringWrite(env: Env, run: () => Promise<unknown>, remoteText: string) {
  const gate = env.fs.arm(A);
  const running = run();
  await gate.hit; // 로컬 쓰기 경로가 파일을 읽었다(아직 쓰지 않았다)
  const writesBefore = env.fs.writeAttempts;
  appendParagraph(env.noteDoc, remoteText); // 그 사이 원격 편집이 도착 → 매니저가 파일에 쓰려 한다
  // 큐 밖 쓰기(옛 경로)라면 매니저가 그 사이에 파일을 쓴다 — 그 쓰기가 끝난 뒤에 로컬 쓰기를 풀어 줘야 "원격 편집을 옛 본문으로 덮어쓰는" 순서가
  // 재현된다. 큐 안 쓰기(새 경로)에서는 매니저의 쓰기가 로컬 쓰기 뒤로 밀리므로 잠깐(상한 60ms) 기다려도 쓰기가 일어나지 않는다.
  await Promise.race([
    until(() => env.fs.writeAttempts > writesBefore, '매니저의 쓰기', 500).catch(() => undefined),
    new Promise((r) => setTimeout(r, 60)),
  ]);
  gate.release();
  await running;
  await until(() => (env.fs.get(A) ?? '').includes(remoteText), '원격 편집이 파일에 반영');
  await env.manager.idle();
}

describe('공유 노트 파일을 고치는 로컬 쓰기 경로는 복제 큐를 거친다(원격 편집을 되돌리지 않는다)', () => {
  it('노드 링크 삭제(removeLinkFromNoteFile, 닫힌 노트)', async () => {
    const env = await build();
    await withRemoteEditDuringWrite(env, () => linksMod.removeLinkFromNoteFile(A, LINK.mapId, LINK.nodeId), '링크 삭제 도중 온 원격 편집');
    const note = parseNote(env.fs.get(A)!);
    expect(note.links).toEqual([]); // 로컬 변경
    expect(note.body).toContain('링크 삭제 도중 온 원격 편집'); // 원격 편집
    expect(codec.yDocToMarkdown(env.noteDoc)).toContain('링크 삭제 도중 온 원격 편집'); // 공유 문서에서도 사라지지 않았다
  });

  it('노드 링크 추가(addLinkToNoteFile, 닫힌 노트)', async () => {
    const env = await build();
    const second = { mapId: 'm2', nodeId: 'y', nodeText: '둘째 노드' };
    await withRemoteEditDuringWrite(env, () => linksMod.addLinkToNoteFile(A, second), '링크 추가 도중 온 원격 편집');
    const note = parseNote(env.fs.get(A)!);
    expect(note.links).toEqual([LINK, second]);
    expect(note.body).toContain('링크 추가 도중 온 원격 편집');
    expect(codec.yDocToMarkdown(env.noteDoc)).toContain('링크 추가 도중 온 원격 편집');
  });

  it('링크 라벨 갱신(updateLinkLabelInNoteFile)', async () => {
    const env = await build();
    await withRemoteEditDuringWrite(env, () => linksMod.updateLinkLabelInNoteFile(A, LINK.mapId, LINK.nodeId, '새 라벨'), '라벨 갱신 도중 온 원격 편집');
    const note = parseNote(env.fs.get(A)!);
    expect(note.links).toEqual([{ ...LINK, nodeText: '새 라벨' }]);
    expect(note.body).toContain('라벨 갱신 도중 온 원격 편집');
  });

  it('[[위키링크]] 일괄 치환(renameWikiLinks) — 본문 변경도 큐 안에서 공유 문서에 흡수되고, 동시에 온 원격 편집과 함께 남는다', async () => {
    const env = await build();
    await withRemoteEditDuringWrite(env, () => linksMod.renameWikiLinks('옛 제목', '새 제목'), '치환 도중 온 원격 편집');
    await until(() => codec.yDocToMarkdown(env.noteDoc).includes('[[새 제목]]'), '치환이 공유 문서에 반영');
    const md = codec.yDocToMarkdown(env.noteDoc);
    expect(md).toContain('치환 도중 온 원격 편집');
    expect(md).not.toContain('[[옛 제목]]');
    const note = parseNote(env.fs.get(A)!);
    expect(note.body).toContain('[[새 제목]]');
    expect(note.body).toContain('치환 도중 온 원격 편집');
    expect(env.fs.paths().filter((p) => p.includes('충돌 사본'))).toEqual([]);
  });

  it('템플릿 삭제 연쇄(metaStore.removeTemplate) — 메타 블록을 지우면서도 원격 편집을 되돌리지 않는다', async () => {
    const env = await build();
    stores.useWorkspace.setState({ tree: [{ name: 'team', path: FOLDER, type: 'dir', children: [{ name: 'a.md', path: A, type: 'file' }] }] });
    await withRemoteEditDuringWrite(env, () => metaMod.useMetaStore.getState().removeTemplate('t-del'), '템플릿 삭제 도중 온 원격 편집');
    const note = parseNote(env.fs.get(A)!);
    expect(note.metaBlocks ?? []).toEqual([]);
    expect(note.body).toContain('템플릿 삭제 도중 온 원격 편집');
    stores.useWorkspace.setState({ tree: [] });
  });

  it('공유 노트가 아닌 파일은 예전 경로 그대로(read → save)로 처리된다 — 대조군', async () => {
    const env = await build();
    const other = '/ws/개인/b.md';
    env.fs.put(other, serializeNote({ id: 'n-b', title: '개인', body: '개인 본문', links: [LINK] }));
    stores.useWorkspace.setState({ noteIndex: [{ path: other, id: 'n-b', title: '개인', links: [LINK] }] });
    await linksMod.removeLinkFromNoteFile(other, LINK.mapId, LINK.nodeId);
    expect(parseNote(env.fs.get(other)!).links).toEqual([]);
    expect(parseNote(env.fs.get(other)!).body).toBe('개인 본문');
  });
});
