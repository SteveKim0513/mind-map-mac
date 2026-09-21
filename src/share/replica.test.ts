// @vitest-environment jsdom
// 노트 복제 매니저 단위 테스트 — 가짜 소켓·프로바이더(네트워크 없음) + 메모리 파일시스템 + 실제 코덱.
// 원격 피어는 별도 Y.Doc의 update를 문서에 직접 적용해 흉내 낸다. 실제 릴레이와의 통합은 replica.integration.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNoteCodec } from '../note/collabCodec';
import { NOTE_FRAGMENT, type NoteCodec } from '../io/noteCodec';
import { decodeNoteEnvelope, hashText } from '../io/noteEnvelope';
import { parseNote, serializeNote } from '../io/noteFormat';
import type { ShareRole } from '../types';
import { MANIFEST_KEY, noteKey } from './docKeys';
import { readManifest, upsertManifestEntry } from './manifest';
import { createReplicaManager, type ReplicaHooks, type ReplicaManager } from './replica';
import { MemFs, appendParagraph, sleep, until } from './replicaTestKit';
import { createShareSession, type ShareSession } from './shareClient';
import { makeFakeFactories, makeFakeShareApi, noteSidecarId, noteSidecarKey, type FakeProvider } from './testFakes';

const realCodec = createNoteCodec();
/** 호출 횟수를 세는 코덱 — "자기 쓰기 해시 확인이 코덱을 부르기 전에 끝나는지" 검증에 쓴다. */
const codecCalls = { canonical: 0, absorb: 0 };
const codec: NoteCodec = {
  ...realCodec,
  canonical: (md) => {
    codecCalls.canonical++;
    return realCodec.canonical(md);
  },
  applyExternalMarkdown3Way: (live, base, md) => {
    codecCalls.absorb++;
    return realCodec.applyExternalMarkdown3Way(live, base, md);
  },
};
const ROOM = 'room-AAAAAAAA';
const FOLDER = '/ws/team';

const BODY_A = '# 알파\n\n알파 첫 문단입니다\n\n알파 둘째 문단입니다';
const noteFile = (id: string, title: string, body: string) => serializeNote({ id, title, body, links: [] });
const bodyOf = (fs: MemFs, path: string) => parseNote(fs.get(path) ?? '').body;

interface Env {
  fs: MemFs;
  fake: ReturnType<typeof makeFakeShareApi>;
  session: ShareSession;
  providers: FakeProvider[];
  manager: ReplicaManager;
  manifestDoc: Y.Doc;
  hooks: ReplicaHooks & { messages: string[]; trashed: string[]; written: string[] };
  order: string[];
  noteDoc(id: string): Y.Doc | undefined;
  syncManifest(): void;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(
  role: ShareRole,
  init: (fs: MemFs) => void = () => {},
  o: { maxEagerDocs?: number; sidecars?: Map<string, Uint8Array>; writeDebounceMs?: number; deleteConfirmScans?: number } = {},
): Promise<Env> {
  const fs = new MemFs(FOLDER);
  init(fs);
  const order: string[] = [];
  fs.events = order;
  const { factories, providers } = makeFakeFactories();
  const fake = makeFakeShareApi();
  if (o.sidecars) for (const [k, v] of o.sidecars) fake.sidecars.set(k, v);
  const rawWrite = fake.api.sidecarWrite;
  fake.api.sidecarWrite = async (folder: string, id: string, data: Uint8Array) => {
    order.push(`sidecar:${id}`);
    return rawWrite(folder, id, data);
  };
  const session = createShareSession({ roomId: ROOM, wsUrl: 'ws://relay.example', getToken: async () => 't', factories });
  const manifest = session.openDoc(MANIFEST_KEY);
  const hooks: Env['hooks'] = {
    messages: [],
    trashed: [],
    written: [],
    notify: (m) => hooks.messages.push(m),
    onNoteTrashed: (p) => hooks.trashed.push(p),
    onNoteWritten: (p) => hooks.written.push(p),
  };
  const manager = createReplicaManager({
    roomId: ROOM,
    folderPath: FOLDER,
    role,
    api: fake.api,
    manifest,
    codec,
    fs,
    hooks,
    host: {
      openDoc: async (docKey, initialState) => session.openDoc(docKey, { initialState }),
      closeDoc: async (docKey) => session.closeDoc(docKey),
    },
    writeDebounceMs: o.writeDebounceMs ?? 10,
    maxEagerDocs: o.maxEagerDocs,
    deleteConfirmScans: o.deleteConfirmScans ?? 1,
    missingRecheckMs: 0,
  });
  const env: Env = {
    fs,
    fake,
    session,
    providers,
    manager,
    manifestDoc: manifest.ydoc,
    hooks,
    order,
    noteDoc: (id) => session.getDoc(noteKey(id))?.ydoc,
    syncManifest: () => providers[0].sync(),
  };
  cleanups.push(async () => {
    await manager.stop();
    session.destroy();
  });
  await manager.start();
  return env;
}

/** 원격 피어가 seed한 노트 문서 update를 만든다. */
function remoteNoteUpdate(body: string): Uint8Array {
  const d = new Y.Doc();
  codec.markdownToYDoc(body, d);
  return Y.encodeStateAsUpdate(d);
}
function remoteManifestUpdate(entries: Record<string, { path: string; title: string; seeded?: boolean }>): Uint8Array {
  const d = new Y.Doc();
  for (const [id, e] of Object.entries(entries)) upsertManifestEntry(d, id, { path: e.path, title: e.title, seeded: e.seeded ?? true });
  return Y.encodeStateAsUpdate(d);
}

describe('시드 규칙', () => {
  it('소유자는 manifest가 동기화된 뒤에만 기존 노트를 시드한다(원본 파일은 그대로)', async () => {
    const original = noteFile('n-alpha', '알파', BODY_A);
    const e = await setup('owner', (fs) => fs.put(`${FOLDER}/alpha.md`, original));
    await e.manager.idle();
    expect(readManifest(e.manifestDoc).size).toBe(0); // 아직 동기화 전 — 재시드·중복 방지
    e.syncManifest();
    await until(() => readManifest(e.manifestDoc).has('n-alpha'), 'manifest에 시드됨');
    await e.manager.idle();
    expect(readManifest(e.manifestDoc).get('n-alpha')).toMatchObject({ path: 'alpha.md', title: '알파', seeded: true });
    expect(e.noteDoc('n-alpha')!.getXmlFragment(NOTE_FRAGMENT).length).toBeGreaterThan(0);
    expect(e.fs.get(`${FOLDER}/alpha.md`)).toBe(original); // 로드/시드 시점에는 md를 파생·재작성하지 않는다
    // 사이드카 봉투: update·base·해시(원본 파일 바이트)
    const env = decodeNoteEnvelope(e.fake.sidecars.get(noteSidecarKey(FOLDER, 'n-alpha'))!);
    expect(env?.baseUpdate).not.toBeNull();
    expect(env?.mdHash).toBe(hashText(original));
  });

  it('참가자는 기존 로컬 파일을 시드하지 않는다(중복 방지) — 하지만 실행 중 새로 생긴 노트는 시드한다', async () => {
    const e = await setup('participant', (fs) => fs.put(`${FOLDER}/alpha.md`, noteFile('n-alpha', '알파', BODY_A)));
    e.syncManifest();
    await e.manager.idle();
    await e.manager.scan();
    expect(readManifest(e.manifestDoc).size).toBe(0);
    e.fs.put(`${FOLDER}/mine.md`, '# 내 노트\n\n참가자가 만든 노트');
    await e.manager.scan();
    await until(() => readManifest(e.manifestDoc).size === 1, '새 노트 시드');
    const [[id, entry]] = [...readManifest(e.manifestDoc)];
    expect(entry).toMatchObject({ path: 'mine.md', title: 'mine', seeded: true });
    // 프론트매터 id가 없던 파일은 새 id를 발급받아 파일에 기록된다
    expect(parseNote(e.fs.get(`${FOLDER}/mine.md`)!).id).toBe(id);
    expect(e.fs.get(`${FOLDER}/mine.md`)).toContain(`id: "${id}"`);
  });

  it('manifest에 seeded가 있으면 사이드카가 없어도 재시드하지 않고 원격 도착을 기다린다', async () => {
    const original = noteFile('n-alpha', '알파', BODY_A);
    const e = await setup('owner', (fs) => fs.put(`${FOLDER}/alpha.md`, original));
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-alpha': { path: 'alpha.md', title: '알파' } }));
    e.syncManifest();
    await e.manager.idle();
    const doc = e.noteDoc('n-alpha')!;
    expect(doc).toBeDefined();
    expect(doc.getXmlFragment(NOTE_FRAGMENT).length).toBe(0); // 재시드 금지
    expect(e.fs.get(`${FOLDER}/alpha.md`)).toBe(original);

    // 원격 내용이 도착(같은 내용) → 채택: 충돌 사본 없이 기준점만 잡는다
    Y.applyUpdate(doc, remoteNoteUpdate(BODY_A));
    await e.manager.idle();
    await sleep(60);
    await e.manager.idle();
    expect(e.fs.paths()).toEqual([`${FOLDER}/alpha.md`]);
    expect(count(bodyOf(e.fs, `${FOLDER}/alpha.md`), '알파 첫 문단')).toBe(1);
  });

  it('같은 id의 로컬 파일이 원격과 크게 다르면 충돌 사본으로 보존하고 원격 내용으로 되돌린다', async () => {
    const localText = noteFile('n-alpha', '알파', '로컬에만 있던 다른 내용입니다\n\n두번째 단락도 다릅니다');
    const e = await setup('participant', (fs) => fs.put(`${FOLDER}/alpha.md`, localText));
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-alpha': { path: 'alpha.md', title: '알파' } }));
    e.syncManifest();
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-alpha')!, remoteNoteUpdate(BODY_A));
    await until(() => e.fs.paths().length === 2, '충돌 사본 생성');
    await e.manager.idle();
    const copy = `${FOLDER}/alpha (충돌 사본).md`;
    expect(e.fs.has(copy)).toBe(true);
    expect(bodyOf(e.fs, copy)).toContain('로컬에만 있던 다른 내용');
    expect(parseNote(e.fs.get(copy)!).id).not.toBe('n-alpha');
    expect(bodyOf(e.fs, `${FOLDER}/alpha.md`)).toContain('알파 첫 문단');
    expect(e.hooks.messages.some((m) => m.includes('사본'))).toBe(true);
  });
});

describe('참가자 물질화·쓰기', () => {
  it('manifest 항목은 원격 문서가 도착하면 폴더 안 상대 경로에 파일로 만든다(충돌 시 접미사)', async () => {
    const e = await setup('participant', (fs) => fs.put(`${FOLDER}/sub/a.md`, noteFile('other', '다른', '다른 노트')));
    e.syncManifest();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'sub/a.md', title: '알파' } }));
    await e.manager.idle();
    // 내용이 도착하기 전에는 만들지 않는다(피어가 온라인일 때만 내려온다)
    expect(e.fs.paths()).toEqual([`${FOLDER}/sub/a.md`]);
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e.fs.paths().length === 2, '물질화');
    const created = e.fs.paths().find((p) => p !== `${FOLDER}/sub/a.md`)!;
    expect(created).toBe(`${FOLDER}/sub/a 2.md`); // 같은 이름이 있으면 접미사
    const doc = parseNote(e.fs.get(created)!);
    expect(doc.id).toBe('n-a');
    expect(doc.title).toBe('알파');
    expect(codec.canonical(doc.body)).toBe(codec.canonical(BODY_A));
    expect(e.manager.isSharedNote(created)).toBe(true);
    expect(e.manager.isSharedNote(`${FOLDER}/sub/a.md`)).toBe(false);
  });

  it('원격 편집 후 저장 순서는 사이드카 → md → base 갱신이고, 봉투는 base·해시를 갖는다', async () => {
    const e = await setup('participant');
    e.syncManifest();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e.fs.has(`${FOLDER}/a.md`), '물질화');
    await e.manager.idle();
    e.order.length = 0;
    appendParagraph(e.noteDoc('n-a')!, '원격이 추가한 문단');
    await until(() => (e.fs.get(`${FOLDER}/a.md`) ?? '').includes('원격이 추가한 문단'), 'md 갱신');
    await e.manager.idle();
    const iMd = e.order.indexOf(`md:${FOLDER}/a.md`);
    expect(iMd).toBeGreaterThan(0);
    expect(e.order[iMd - 1]).toBe(`sidecar:${noteSidecarId('n-a')}`); // md 직전에 사이드카
    expect(e.order[iMd + 1]).toBe(`sidecar:${noteSidecarId('n-a')}`); // md 직후 base 갱신
    const env = decodeNoteEnvelope(e.fake.sidecars.get(noteSidecarKey(FOLDER, 'n-a'))!)!;
    expect(env.mdHash).toBe(hashText(e.fs.get(`${FOLDER}/a.md`)!));
    expect(Array.from(env.baseUpdate!)).toEqual(Array.from(env.update)); // md와 대응하는 기준 상태
    // 프론트매터는 보존(id·title), 본문만 교체
    expect(parseNote(e.fs.get(`${FOLDER}/a.md`)!)).toMatchObject({ id: 'n-a', title: '알파' });
  });

  it('자기 쓰기는 외부 수정으로 취급하지 않는다(해시) — 문서도 파일도 그대로', async () => {
    const e = await setup('participant');
    e.syncManifest();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e.fs.has(`${FOLDER}/a.md`), '물질화');
    await e.manager.idle();
    const doc = e.noteDoc('n-a')!;
    const before = Y.encodeStateVector(doc);
    const fileBefore = e.fs.get(`${FOLDER}/a.md`);
    const callsBefore = { ...codecCalls };
    expect(await e.manager.onExternalChange(`${FOLDER}/a.md`)).toBe('ignored');
    // 해시 일치 — canonical 비교·흡수까지 가지 않고 끝난다
    expect(codecCalls).toEqual(callsBefore);
    expect(Array.from(Y.encodeStateVector(doc))).toEqual(Array.from(before));
    expect(e.fs.get(`${FOLDER}/a.md`)).toBe(fileBefore);
    expect(await e.manager.onExternalChange(`${FOLDER}/nope.md`)).toBe('not_shared');
    // 서식만 다른 저장(같은 내용) — 무시
    e.fs.put(`${FOLDER}/a.md`, fileBefore!.replace(/\n\n/g, '\n\n\n'));
    expect(await e.manager.onExternalChange(`${FOLDER}/a.md`)).toBe('ignored');
    expect(Array.from(Y.encodeStateVector(doc))).toEqual(Array.from(before));
  });
});

describe('외부 수정 흡수', () => {
  async function materialized(debounce = 10) {
    const e = await setup('participant', () => {}, { writeDebounceMs: debounce });
    e.syncManifest();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e.fs.has(`${FOLDER}/a.md`), '물질화');
    await e.manager.idle();
    return e;
  }

  it('3-way: 피어 편집이 파일에 반영되기 전에 외부 수정이 와도 둘 다 보존되고 중복이 없다', async () => {
    const e = await materialized(60_000); // 원격 편집이 파일에 쓰이기 전 상태를 유지
    const path = `${FOLDER}/a.md`;
    const diskBefore = e.fs.get(path)!;
    appendParagraph(e.noteDoc('n-a')!, '피어가 추가한 문단'); // 라이브만 바뀜(파일은 아직)
    expect(e.fs.get(path)).toBe(diskBefore);
    // 외부 에디터가 (피어 편집을 모르는) 파일의 첫 문단을 고침
    e.fs.put(path, diskBefore.replace('알파 첫 문단입니다', '알파 첫 문단을 외부에서 고쳤습니다'));
    expect(await e.manager.onExternalChange(path)).toBe('absorbed');
    await e.manager.flush();
    const body = bodyOf(e.fs, path);
    expect(body).toContain('알파 첫 문단을 외부에서 고쳤습니다');
    expect(body).toContain('피어가 추가한 문단');
    expect(count(body, '알파 둘째 문단입니다')).toBe(1);
    expect(count(body, '# 알파')).toBe(1);
    // 같은 외부 파일을 다시 확인해도 두 번 흡수되지 않는다
    e.fs.put(path, diskBefore.replace('알파 첫 문단입니다', '알파 첫 문단을 외부에서 고쳤습니다'));
    await e.manager.onExternalChange(path);
    await e.manager.flush();
    expect(count(bodyOf(e.fs, path), '알파 첫 문단을 외부에서 고쳤습니다')).toBe(1);
    expect(e.hooks.messages).toEqual([]); // 흡수는 조용히
  });

  it('흡수 직후 또 외부 수정이 와도 앞선 수정이 중복되지 않는다(nextBase)', async () => {
    const e = await materialized(60_000);
    const path = `${FOLDER}/a.md`;
    const disk = e.fs.get(path)!;
    const edit1 = disk.replace('알파 첫 문단입니다', '알파 첫 문단 1차 수정');
    e.fs.put(path, edit1);
    expect(await e.manager.onExternalChange(path)).toBe('absorbed');
    // 파일이 다시 쓰이기 전에 두 번째 외부 수정(1차 수정 포함)
    e.fs.put(path, edit1 + '\n\n외부에서 붙인 문단');
    expect(await e.manager.onExternalChange(path)).toBe('absorbed');
    await e.manager.flush();
    const body = bodyOf(e.fs, path);
    expect(count(body, '1차 수정')).toBe(1); // nextBase가 없으면 "1차 수정 1차 수정"으로 중복된다
    expect(count(body, '외부에서 붙인 문단')).toBe(1);
    expect(count(body, '알파 둘째 문단입니다')).toBe(1);
  });

  it('파일이 비워지면 충돌 사본으로 보존하고 원본은 공유 내용으로 되돌린다', async () => {
    const e = await materialized();
    const path = `${FOLDER}/a.md`;
    e.fs.put(path, '');
    expect(await e.manager.onExternalChange(path)).toBe('conflict');
    await e.manager.idle();
    // 빈 파일에는 보존할 내용이 없어 사본을 만들지 않지만 원본은 복구된다
    expect(bodyOf(e.fs, path)).toContain('알파 첫 문단');
    expect(e.hooks.messages).toEqual([]);
  });

  it('대량 교체는 충돌 사본(새 노트 id)으로 보존하고 공유된다', async () => {
    const e = await materialized();
    const path = `${FOLDER}/a.md`;
    const foreign = noteFile('n-a', '알파', '# 완전히 다른 문서\n\n어떤 내용이든 상관없는 새 글입니다\n\n다른 사람의 노트를 덮어썼습니다');
    e.fs.put(path, foreign);
    expect(await e.manager.onExternalChange(path)).toBe('conflict');
    await e.manager.idle();
    const copy = `${FOLDER}/a (충돌 사본).md`;
    expect(e.fs.has(copy)).toBe(true);
    const copyDoc = parseNote(e.fs.get(copy)!);
    expect(copyDoc.id).not.toBe('n-a');
    expect(copyDoc.title).toBe('알파 (충돌 사본)');
    expect(copyDoc.body).toContain('완전히 다른 문서');
    expect(bodyOf(e.fs, path)).toContain('알파 첫 문단입니다'); // 원본은 공유 내용으로 복구
    expect(bodyOf(e.fs, path)).not.toContain('완전히 다른 문서');
    expect(e.hooks.messages.some((m) => m.includes('충돌') || m.includes('사본'))).toBe(true);
    // 사본은 새 공유 노트
    expect(readManifest(e.manifestDoc).has(copyDoc.id)).toBe(true);
    expect(e.manager.isSharedNote(copy)).toBe(true);
  });
});

describe('로컬 변경 → 공유, 원격 삭제', () => {
  it('제목 변경은 manifest에 반영되고 원격 제목 변경은 프론트매터에 반영된다(파일명은 그대로)', async () => {
    const e = await setup('participant');
    e.syncManifest();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e.fs.has(`${FOLDER}/a.md`), '물질화');
    await e.manager.idle();
    // 원격이 제목을 바꿈
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(e.manifestDoc));
    upsertManifestEntry(remote, 'n-a', { title: '알파 개정판' });
    Y.applyUpdate(e.manifestDoc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(e.manifestDoc)));
    await until(() => parseNote(e.fs.get(`${FOLDER}/a.md`)!).title === '알파 개정판', '제목 반영');
    expect(e.fs.paths()).toEqual([`${FOLDER}/a.md`]); // 파일명은 로컬 규칙 그대로
    expect(bodyOf(e.fs, `${FOLDER}/a.md`)).toContain('알파 첫 문단'); // 본문은 그대로
    // 로컬 제목 변경(6b가 부르는 API)
    e.manager.onLocalTitleChanged('n-a', '로컬에서 바꾼 제목');
    expect(readManifest(e.manifestDoc).get('n-a')?.title).toBe('로컬에서 바꾼 제목');
    // 같은 제목·빈 제목·모르는 노트는 무시
    const rev = readManifest(e.manifestDoc).get('n-a')!.rev;
    e.manager.onLocalTitleChanged('n-a', '로컬에서 바꾼 제목');
    e.manager.onLocalTitleChanged('n-a', '   ');
    e.manager.onLocalTitleChanged('nope', 'x');
    expect(readManifest(e.manifestDoc).get('n-a')?.rev).toBe(rev);
  });

  it('원격 삭제는 휴지통으로 옮기고(영구 삭제 아님) 알린다', async () => {
    const e = await setup('participant');
    e.syncManifest();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e.fs.has(`${FOLDER}/a.md`), '물질화');
    await e.manager.idle();
    const remote = new Y.Doc();
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(e.manifestDoc));
    remote.getMap('notes').delete('n-a');
    Y.applyUpdate(e.manifestDoc, Y.encodeStateAsUpdate(remote, Y.encodeStateVector(e.manifestDoc)));
    await until(() => !e.fs.has(`${FOLDER}/a.md`), '휴지통 이동');
    expect(e.fs.trashed.map((t) => t.path)).toEqual([`${FOLDER}/a.md`]);
    expect(e.fs.trashed[0].text).toContain('알파 첫 문단'); // 내용은 휴지통에 그대로
    expect(e.hooks.trashed).toEqual([`${FOLDER}/a.md`]);
    expect(e.hooks.messages.some((m) => m.includes('휴지통'))).toBe(true);
    expect(e.session.getDoc(noteKey('n-a'))).toBeUndefined(); // 문서 detach
    expect(e.manager.isSharedNote(`${FOLDER}/a.md`)).toBe(false);
  });

  it('로컬에서 사라진 공유 노트는 manifest에서 제거한다 — 폴더를 못 읽으면 삭제로 오인하지 않는다', async () => {
    const e = await setup('owner', (fs) => {
      fs.put(`${FOLDER}/a.md`, noteFile('n-a', '알파', BODY_A));
      fs.put(`${FOLDER}/b.md`, noteFile('n-b', '베타', '# 베타\n\n베타 본문입니다 충분히 길게'));
    });
    e.syncManifest();
    await until(() => readManifest(e.manifestDoc).size === 2, '시드');
    await e.manager.idle();
    e.fs.failList = true;
    await e.manager.scan(); // 읽기 실패 — 아무 일도 없어야 한다
    expect(readManifest(e.manifestDoc).size).toBe(2);
    e.fs.failList = false;
    e.fs.remove(`${FOLDER}/a.md`);
    await e.manager.scan();
    expect(readManifest(e.manifestDoc).has('n-a')).toBe(false);
    expect(readManifest(e.manifestDoc).has('n-b')).toBe(true);
    expect(e.session.getDoc(noteKey('n-a'))).toBeUndefined();
  });

  it('삭제는 확정 스캔 횟수만큼 연속으로 안 보여야 한다(일시적 부재 방지)', async () => {
    const e = await setup('owner', (fs) => fs.put(`${FOLDER}/a.md`, noteFile('n-a', '알파', BODY_A)), { deleteConfirmScans: 2 });
    e.syncManifest();
    await until(() => readManifest(e.manifestDoc).has('n-a'), '시드');
    e.fs.remove(`${FOLDER}/a.md`);
    await e.manager.scan();
    expect(readManifest(e.manifestDoc).has('n-a')).toBe(true); // 1회 부재 — 아직
    e.fs.put(`${FOLDER}/a.md`, noteFile('n-a', '알파', BODY_A)); // 돌아옴
    await e.manager.scan();
    e.fs.remove(`${FOLDER}/a.md`);
    await e.manager.scan();
    expect(readManifest(e.manifestDoc).has('n-a')).toBe(true); // 카운터가 리셋됐다
    await e.manager.scan();
    expect(readManifest(e.manifestDoc).has('n-a')).toBe(false);
  });

  it('파일 이름 변경·이동은 id로 따라간다(삭제로 보지 않는다)', async () => {
    const e = await setup('owner', (fs) => fs.put(`${FOLDER}/a.md`, noteFile('n-a', '알파', BODY_A)));
    e.syncManifest();
    await until(() => readManifest(e.manifestDoc).has('n-a'), '시드');
    await e.manager.idle();
    const text = e.fs.get(`${FOLDER}/a.md`)!;
    e.fs.remove(`${FOLDER}/a.md`);
    e.fs.put(`${FOLDER}/renamed/알파 새이름.md`, text);
    await e.manager.scan();
    expect(readManifest(e.manifestDoc).has('n-a')).toBe(true);
    expect(e.manager.pathForNote('n-a')).toBe(`${FOLDER}/renamed/알파 새이름.md`);
    expect(e.manager.isSharedNote(`${FOLDER}/renamed/알파 새이름.md`)).toBe(true);
    expect(e.manager.isSharedNote(`${FOLDER}/a.md`)).toBe(false);
  });
});

describe('문서 상한·수명주기', () => {
  it('상한(maxEagerDocs)을 넘는 노트는 attach하지 않고, 열려는 노트만 ensureNoteDoc으로 연다', async () => {
    const e = await setup('participant', () => {}, { maxEagerDocs: 3 });
    e.syncManifest();
    const entries: Record<string, { path: string; title: string }> = {};
    for (let i = 1; i <= 5; i++) entries[`n-${i}`] = { path: `n${i}.md`, title: `노트 ${i}` };
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate(entries));
    await e.manager.idle();
    expect(e.manager.stats()).toMatchObject({ attached: 3, overLimit: 2 });
    const attachedIds = Object.keys(entries).filter((id) => e.noteDoc(id));
    expect(attachedIds).toHaveLength(3);
    const extra = Object.keys(entries).find((id) => !e.noteDoc(id))!;
    const handle = await e.manager.ensureNoteDoc(extra);
    expect(handle).not.toBeNull();
    expect(e.noteDoc(extra)).toBeDefined();
    expect(e.manager.stats().attached).toBe(4);
    expect(await e.manager.ensureNoteDoc('unknown')).toBeNull();
  });

  it('stop은 대기 중인 편집을 사이드카·md에 남긴다(flush)', async () => {
    const e = await setup('participant', () => {}, { writeDebounceMs: 60_000 });
    e.syncManifest();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e.fs.has(`${FOLDER}/a.md`), '물질화');
    await e.manager.idle();
    appendParagraph(e.noteDoc('n-a')!, '종료 직전 편집');
    expect(e.fs.get(`${FOLDER}/a.md`)).not.toContain('종료 직전 편집'); // 디바운스 대기 중
    await e.manager.stop();
    expect(e.fs.get(`${FOLDER}/a.md`)).toContain('종료 직전 편집');
    const env = decodeNoteEnvelope(e.fake.sidecars.get(noteSidecarKey(FOLDER, 'n-a'))!)!;
    const check = new Y.Doc();
    Y.applyUpdate(check, env.update);
    expect(codec.yDocToMarkdown(check)).toContain('종료 직전 편집');
  });

  it('재시작: 사이드카에서 복원하고 md를 다시 쓰지 않는다(로드 시 파생 안 함)', async () => {
    const e1 = await setup('participant');
    e1.syncManifest();
    Y.applyUpdate(e1.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e1.manager.idle();
    Y.applyUpdate(e1.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e1.fs.has(`${FOLDER}/a.md`), '물질화');
    await e1.manager.idle();
    await e1.manager.stop();
    const fileText = e1.fs.get(`${FOLDER}/a.md`)!;
    const manifestBytes = Y.encodeStateAsUpdate(e1.manifestDoc);

    // 같은 기기에서 다시 시작(새 세션·새 Y.Doc) — 사이드카와 파일을 그대로 넘긴다
    const sidecars = new Map(e1.fake.sidecars);
    const e2 = await setup('participant', (fs) => fs.put(`${FOLDER}/a.md`, fileText), { sidecars });
    Y.applyUpdate(e2.manifestDoc, manifestBytes);
    e2.syncManifest();
    await e2.manager.idle();
    await sleep(50);
    await e2.manager.idle();
    expect(e2.fs.get(`${FOLDER}/a.md`)).toBe(fileText); // 바이트 그대로
    expect(e2.fs.events.filter((x) => x.startsWith('md:'))).toEqual([]);
    expect(e2.noteDoc('n-a')!.getXmlFragment(NOTE_FRAGMENT).length).toBeGreaterThan(0);
    expect(e2.noteDoc('n-a')!.clientID).not.toBe(e1.noteDoc('n-a')?.clientID ?? -1); // clientID 재사용 금지
  });

  it('쓰기 도중 종료된 편집(사이드카엔 있고 md엔 없음)은 재시작 후 파일에 반영된다', async () => {
    const e1 = await setup('participant', () => {}, { writeDebounceMs: 60_000 });
    e1.syncManifest();
    Y.applyUpdate(e1.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e1.manager.idle();
    Y.applyUpdate(e1.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await until(() => e1.fs.has(`${FOLDER}/a.md`), '물질화');
    await e1.manager.idle();
    const fileText = e1.fs.get(`${FOLDER}/a.md`)!;
    // 사이드카에는 새 update가 있지만 base·md는 이전 상태인 상황을 재현(저장 순서 1단계 직후 중단)
    appendParagraph(e1.noteDoc('n-a')!, '중단된 쓰기의 편집');
    const env = decodeNoteEnvelope(e1.fake.sidecars.get(noteSidecarKey(FOLDER, 'n-a'))!)!;
    const crashed = new Map(e1.fake.sidecars);
    const { encodeNoteEnvelope } = await import('../io/noteEnvelope');
    crashed.set(
      noteSidecarKey(FOLDER, 'n-a'),
      encodeNoteEnvelope({ v: 1, update: Y.encodeStateAsUpdate(e1.noteDoc('n-a')!), baseUpdate: env.baseUpdate, mdHash: env.mdHash }),
    );
    await e1.manager.stop();
    e1.fs.put(`${FOLDER}/a.md`, fileText); // stop의 flush가 쓴 것을 되돌려 "md는 이전 상태"를 만든다

    const e2 = await setup('participant', (fs) => fs.put(`${FOLDER}/a.md`, fileText), { sidecars: crashed });
    Y.applyUpdate(e2.manifestDoc, Y.encodeStateAsUpdate(e1.manifestDoc));
    e2.syncManifest();
    await until(() => (e2.fs.get(`${FOLDER}/a.md`) ?? '').includes('중단된 쓰기의 편집'), '복구 쓰기');
  });
});

function count(s: string, sub: string): number {
  return s.split(sub).length - 1;
}
