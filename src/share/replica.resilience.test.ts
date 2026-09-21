// @vitest-environment jsdom
// 노트 복제 매니저의 실패 경로·경쟁 조건·입력 상한 — 정상 경로는 replica.test.ts.
//   - 사이드카/파일 쓰기 실패 → 백오프 재시도(상한)·md 갱신 유지
//   - ensureDir/create 실패, 충돌 사본 실패 시 원본 보존, 3-way 예외 → 충돌 사본, 안전하지 않은 id
//   - `patchLocalNote`(단일 쓰기 주체 큐 경유) 결정적 인터리빙
//   - 노트 크기·manifest 항목 수 상한
import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNoteCodec } from '../note/collabCodec';
import { NOTE_FRAGMENT, type NoteCodec } from '../io/noteCodec';
import { hashText } from '../io/noteEnvelope';
import { parseNote, serializeNote } from '../io/noteFormat';
import type { NoteDoc, ShareRole } from '../types';
import { MANIFEST_KEY, noteKey } from './docKeys';
import { MAX_MANIFEST_NOTES, MAX_NOTE_MARKDOWN_CHARS, MAX_NOTE_STATE_BYTES } from '../io/shareLimits';
import { getManifestMap, readManifest, upsertManifestEntry } from './manifest';
import { MAX_WRITE_RETRIES, createReplicaManager, type ReplicaHooks, type ReplicaManager } from './replica';
import { MemFs, appendParagraph, until } from './replicaTestKit';
import { createShareSession, type ShareSession } from './shareClient';
import { makeFakeFactories, makeFakeShareApi, noteSidecarKey, type FakeProvider } from './testFakes';

const realCodec = createNoteCodec();
const ROOM = 'room-AAAAAAAA';
const FOLDER = '/ws/team';
const BODY_A = '# 알파\n\n알파 첫 문단입니다\n\n알파 둘째 문단입니다';
const noteFile = (id: string, title: string, body: string) => serializeNote({ id, title, body, links: [] });

interface Env {
  fs: MemFs;
  fake: ReturnType<typeof makeFakeShareApi>;
  session: ShareSession;
  providers: FakeProvider[];
  manager: ReplicaManager;
  manifestDoc: Y.Doc;
  hooks: ReplicaHooks & { messages: string[]; logs: string[] };
  noteDoc(id: string): Y.Doc | undefined;
}

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function setup(
  role: ShareRole,
  o: { init?: (fs: MemFs) => void; codec?: NoteCodec; writeDebounceMs?: number; fsFactory?: (root: string) => MemFs } = {},
): Promise<Env> {
  const fs = o.fsFactory ? o.fsFactory(FOLDER) : new MemFs(FOLDER);
  o.init?.(fs);
  const { factories, providers } = makeFakeFactories();
  const fake = makeFakeShareApi();
  const session = createShareSession({ roomId: ROOM, wsUrl: 'ws://relay.example', getToken: async () => 't', factories });
  const manifest = session.openDoc(MANIFEST_KEY);
  const hooks: Env['hooks'] = {
    messages: [],
    logs: [],
    notify: (m) => hooks.messages.push(m),
    log: (_l, m) => hooks.logs.push(m),
  };
  const manager = createReplicaManager({
    roomId: ROOM,
    folderPath: FOLDER,
    role,
    api: fake.api,
    manifest,
    codec: o.codec ?? realCodec,
    fs,
    hooks,
    host: {
      openDoc: async (docKey, initialState) => session.openDoc(docKey, { initialState }),
      closeDoc: async (docKey) => session.closeDoc(docKey),
    },
    writeDebounceMs: o.writeDebounceMs ?? 3,
    deleteConfirmScans: 1,
    missingRecheckMs: 0,
  });
  cleanups.push(async () => {
    await manager.stop();
    session.destroy();
  });
  await manager.start();
  return { fs, fake, session, providers, manager, manifestDoc: manifest.ydoc, hooks, noteDoc: (id) => session.getDoc(noteKey(id))?.ydoc };
}

function remoteNoteUpdate(body: string, codec: NoteCodec = realCodec): Uint8Array {
  const d = new Y.Doc();
  codec.markdownToYDoc(body, d);
  return Y.encodeStateAsUpdate(d);
}
function remoteManifestUpdate(entries: Record<string, { path: string; title: string }>): Uint8Array {
  const d = new Y.Doc();
  for (const [id, e] of Object.entries(entries)) upsertManifestEntry(d, id, { path: e.path, title: e.title, seeded: true });
  return Y.encodeStateAsUpdate(d);
}

/** 참가자가 원격 노트 하나(a.md)를 받아 물질화한 상태까지 만든다. */
async function materialized(o: Parameters<typeof setup>[1] = {}, path = 'a.md'): Promise<Env> {
  const e = await setup('participant', o);
  e.providers[0].sync();
  Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path, title: '알파' } }));
  await e.manager.idle();
  Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A, o.codec));
  await until(() => e.fs.has(`${FOLDER}/${path}`), '물질화');
  await e.manager.idle();
  return e;
}
const A = `${FOLDER}/a.md`;
const bodyOf = (fs: MemFs, path: string) => parseNote(fs.get(path) ?? '').body;

// ── 쓰기 실패: 사이드카 ──────────────────────────────────────────────────────

describe('사이드카 쓰기 실패', () => {
  it('일시적 실패면 md를 쓰지 않고(사이드카 → md 순서 유지) 백오프로 다시 시도하며, 복구되면 md가 갱신된다', async () => {
    const e = await materialized();
    e.fake.switches.failSidecar = 'io';
    const before = e.fake.switches.sidecarWriteAttempts;
    appendParagraph(e.noteDoc('n-a')!, '사이드카가 막힌 동안의 편집');
    await until(() => e.fake.switches.sidecarWriteAttempts >= before + 2, '사이드카 재시도');
    expect(e.fs.get(A)).not.toContain('사이드카가 막힌 동안의 편집'); // 사이드카를 못 썼으면 md도 쓰지 않는다
    e.fake.switches.failSidecar = null;
    await until(() => (e.fs.get(A) ?? '').includes('사이드카가 막힌 동안의 편집'), '복구 뒤 md 갱신');
    await e.manager.idle();
    // 복구 뒤에는 사이드카에도 남았다
    expect(e.fake.sidecars.has(noteSidecarKey(FOLDER, 'n-a'))).toBe(true);
    expect(e.hooks.messages).toEqual([]); // 복구된 일시 오류는 사용자에게 알리지 않는다
  });

  it('계속 실패해도 무한히 재시도하지 않는다 — 재시도 상한 뒤에는 사이드카 없이 md만 갱신하고 사용자에게 한 번 알린다', async () => {
    const e = await materialized();
    e.fake.switches.failSidecar = 'io';
    const before = e.fake.switches.sidecarWriteAttempts;
    appendParagraph(e.noteDoc('n-a')!, '끝까지 막힌 사이드카');
    await until(() => (e.fs.get(A) ?? '').includes('끝까지 막힌 사이드카'), 'md는 사이드카와 무관하게 갱신');
    await e.manager.idle();
    const attempts = e.fake.switches.sidecarWriteAttempts - before;
    expect(attempts).toBeLessThanOrEqual(MAX_WRITE_RETRIES + 2);
    expect(attempts).toBeGreaterThanOrEqual(2);
    expect(e.hooks.messages.filter((m) => m.includes('공동 편집 기록을 저장하지 못했어요'))).toHaveLength(1);
    // 더 이상 스스로 다시 시도하지 않는다(양성 신호: 큐가 빈 뒤 시도 횟수가 그대로)
    const settled = e.fake.switches.sidecarWriteAttempts;
    await e.manager.idle();
    expect(e.fake.switches.sidecarWriteAttempts).toBe(settled);
  });

  it('영구 오류(용량 초과 invalid_input)는 재시도하지 않고 md를 바로 갱신한다 — 사용자 알림은 노트당 한 번', async () => {
    const e = await materialized();
    e.fake.switches.failSidecar = 'invalid_input';
    const before = e.fake.switches.sidecarWriteAttempts;
    appendParagraph(e.noteDoc('n-a')!, '용량 초과 첫 편집');
    await until(() => (e.fs.get(A) ?? '').includes('용량 초과 첫 편집'), 'md 갱신');
    await e.manager.idle();
    expect(e.fake.switches.sidecarWriteAttempts - before).toBe(1); // 한 번 시도하고 포기
    const messages = e.hooks.messages.filter((m) => m.includes('커서 이 기기에'));
    expect(messages).toHaveLength(1);
    // 다음 편집도 한 번만 시도(이미 못 쓰는 상태로 표시됨)하고 md는 계속 갱신된다 — 알림은 다시 뜨지 않는다
    appendParagraph(e.noteDoc('n-a')!, '용량 초과 둘째 편집');
    await until(() => (e.fs.get(A) ?? '').includes('용량 초과 둘째 편집'), 'md 갱신');
    await e.manager.idle();
    expect(e.fake.switches.sidecarWriteAttempts - before).toBe(2);
    expect(e.hooks.messages.filter((m) => m.includes('커서 이 기기에'))).toHaveLength(1);
  });

  it('사이드카가 다시 쓰이게 되면 정상 경로로 돌아온다(못 쓰는 상태 표시 해제)', async () => {
    const e = await materialized();
    e.fake.switches.failSidecar = 'invalid_input';
    appendParagraph(e.noteDoc('n-a')!, '막힘');
    await until(() => (e.fs.get(A) ?? '').includes('막힘'), 'md');
    await e.manager.idle();
    e.fake.switches.failSidecar = null;
    appendParagraph(e.noteDoc('n-a')!, '풀림');
    await until(() => (e.fs.get(A) ?? '').includes('풀림'), 'md');
    await e.manager.idle();
    const raw = e.fake.sidecars.get(noteSidecarKey(FOLDER, 'n-a'))!;
    expect(raw).toBeDefined();
  });
});

// ── 쓰기 실패: md ───────────────────────────────────────────────────────────

describe('md 쓰기 실패', () => {
  it('실패하면 dirty를 남기고 백오프로 다시 시도하며, 복구되면 파일이 갱신된다', async () => {
    const e = await materialized();
    e.fs.failWrite = true;
    const before = e.fs.writeAttempts;
    appendParagraph(e.noteDoc('n-a')!, '파일이 막힌 동안의 편집');
    await until(() => e.fs.writeAttempts >= before + 2, 'md 쓰기 재시도');
    e.fs.failWrite = false;
    await until(() => (e.fs.get(A) ?? '').includes('파일이 막힌 동안의 편집'), '복구 뒤 파일 갱신');
  });

  it('재시도 상한을 넘으면 스스로 멈추고 한 번 알린다 — 창 포커스 스캔이 다시 이어받는다', async () => {
    const e = await materialized();
    e.fs.failWrite = true;
    const before = e.fs.writeAttempts;
    appendParagraph(e.noteDoc('n-a')!, '계속 막힌 파일');
    await until(() => e.hooks.messages.some((m) => m.includes('파일에 쓰지 못하고 있어요')), '상한 도달 알림');
    await e.manager.idle();
    const attempts = e.fs.writeAttempts - before;
    expect(attempts).toBeLessThanOrEqual(MAX_WRITE_RETRIES + 2);
    const settled = e.fs.writeAttempts;
    await e.manager.idle();
    expect(e.fs.writeAttempts).toBe(settled); // 무한 루프 없음
    expect(e.hooks.messages.filter((m) => m.includes('파일에 쓰지 못하고 있어요'))).toHaveLength(1);

    e.fs.failWrite = false;
    await e.manager.scan(); // 창 포커스·트리 갱신 때 dirty 노트를 다시 시도한다
    await until(() => (e.fs.get(A) ?? '').includes('계속 막힌 파일'), '스캔이 재시도');
  });
});

// ── 물질화 실패 ─────────────────────────────────────────────────────────────

describe('물질화(원격 노트 → 로컬 파일) 실패', () => {
  async function pending(o: (fs: MemFs) => void) {
    const e = await setup('participant');
    o(e.fs);
    e.providers[0].sync();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'sub/a.md', title: '알파' } }));
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(BODY_A));
    await e.manager.idle();
    return e;
  }

  it('ensureDir 실패: 파일을 만들지 않고 경고를 남긴다 — 나중에 조정(reconcile)하면 만들어진다', async () => {
    const e = await pending((fs) => (fs.failEnsureDir = true));
    expect(e.fs.paths()).toEqual([]);
    expect(e.hooks.logs.some((l) => l.includes('ensureDir failed'))).toBe(true);
    e.fs.failEnsureDir = false;
    await e.manager.reconcile();
    await until(() => e.fs.has(`${FOLDER}/sub/a.md`), '재조정 뒤 물질화');
    expect(bodyOf(e.fs, `${FOLDER}/sub/a.md`)).toContain('알파 첫 문단입니다');
  });

  it('create 실패: 파일을 만들지 않고, 경로를 등록하지 않으며(공유 노트로 잡히지 않는다), 복구 뒤 만들어진다', async () => {
    const e = await pending((fs) => (fs.failCreate = true));
    expect(e.fs.paths()).toEqual([]);
    expect(e.manager.isSharedNote(`${FOLDER}/sub/a.md`)).toBe(false);
    expect(e.hooks.logs.some((l) => l.includes('create failed'))).toBe(true);
    e.fs.failCreate = false;
    await e.manager.reconcile();
    await until(() => e.fs.has(`${FOLDER}/sub/a.md`), '재조정 뒤 물질화');
    expect(e.manager.isSharedNote(`${FOLDER}/sub/a.md`)).toBe(true);
  });
});

// ── 충돌 사본 ───────────────────────────────────────────────────────────────

describe('외부 수정 충돌 처리의 실패', () => {
  const LONG = Array.from({ length: 12 }, (_, i) => `원본 문단 ${i} 입니다 충분히 긴 문장`).join('\n\n');
  const REWRITE = Array.from({ length: 12 }, (_, i) => `완전히 다른 내용 ${i}`).join('\n\n');

  async function withLongNote(codec?: NoteCodec) {
    const e = await setup('participant', { codec });
    e.providers[0].sync();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-a': { path: 'a.md', title: '알파' } }));
    await e.manager.idle();
    Y.applyUpdate(e.noteDoc('n-a')!, remoteNoteUpdate(LONG, codec));
    await until(() => e.fs.has(A), '물질화');
    await e.manager.idle();
    return e;
  }

  it('충돌 사본을 만들지 못하면 원본 파일을 덮어쓰지 않는다(사용자의 수정본 보존) — 알리고, 같은 파일을 반복 처리하지 않는다', async () => {
    const e = await withLongNote();
    const edited = noteFile('n-a', '알파', REWRITE); // 대량 교체 → 충돌 사본 경로
    e.fs.put(A, edited);
    e.fs.failCreate = true;
    const r = await e.manager.onExternalChange(A);
    expect(r).toBe('ignored'); // 사본을 못 만들어 처리하지 못했다
    expect(e.fs.get(A)).toBe(edited); // 원본 그대로 — 덮어쓰지 않았다
    expect(e.hooks.messages.some((m) => m.includes('사본을 만들지 못했어요'))).toBe(true);
    // 같은 내용을 다시 처리하려 들지 않는다(무한 알림 방지)
    const messages = e.hooks.messages.length;
    await e.manager.onExternalChange(A);
    expect(e.hooks.messages.length).toBe(messages);
    expect(e.fs.get(A)).toBe(edited);
    // 사본을 만들 수 있게 되고 파일이 다시 바뀌면 정상 처리된다
    e.fs.failCreate = false;
    const edited2 = noteFile('n-a', '알파', REWRITE + '\n\n추가');
    e.fs.put(A, edited2);
    expect(await e.manager.onExternalChange(A)).toBe('conflict');
    expect(e.fs.paths().some((p) => p.includes('충돌 사본'))).toBe(true);
  });

  it('3-way 흡수가 예외를 던지면 충돌 사본으로 보존하고 원본은 공유 상태로 되돌린다(흡수하지 않는다)', async () => {
    const throwing: NoteCodec = {
      ...realCodec,
      applyExternalMarkdown3Way: () => {
        throw new Error('diff exploded');
      },
    };
    const e = await withLongNote(throwing);
    const small = noteFile('n-a', '알파', LONG.replace('원본 문단 3 입니다', '원본 문단 3 입니다 (조금 고침)'));
    e.fs.put(A, small);
    expect(await e.manager.onExternalChange(A)).toBe('conflict');
    const copyPath = e.fs.paths().find((p) => p.includes('충돌 사본'));
    expect(copyPath).toBeDefined();
    expect(bodyOf(e.fs, copyPath!)).toContain('(조금 고침)'); // 사용자의 수정본이 사본에 있다
    expect(e.hooks.logs.some((l) => l.includes('absorb failed'))).toBe(true);
    // 원본 파일은 공유 문서에서 파생한 내용으로 돌아왔다
    expect(bodyOf(e.fs, A)).not.toContain('(조금 고침)');
    expect(bodyOf(e.fs, A)).toContain('원본 문단 3 입니다');
  });
});

// ── 안전하지 않은 id ────────────────────────────────────────────────────────

describe('shareNewNote — 공유할 수 없는 노트 id', () => {
  it('문서 id 규칙(경로 문자·공백 …)에 안 맞거나 사이드카 파일 이름 상한을 넘는 id는 공유하지 않고 파일도 고치지 않는다', async () => {
    const bad = ['../evil', 'bad id!', 'a/b', '.hidden', 'x'.repeat(101), 'y'.repeat(129)];
    const files = bad.map((id, i) => [`${FOLDER}/bad${i}.md`, noteFile(id, `나쁜 ${i}`, `본문 ${i} 충분히 긴 본문입니다`)] as const);
    const good = noteFile('n-good', '좋은', '좋은 본문입니다 충분히 긴 본문');
    const e = await setup('owner', {
      init: (fs) => {
        for (const [p, t] of files) fs.put(p, t);
        fs.put(`${FOLDER}/good.md`, good);
      },
    });
    e.providers[0].sync(); // manifest 동기화 → 소유자 시드
    await until(() => readManifest(e.manifestDoc).has('n-good'), '정상 노트는 공유');
    await e.manager.idle();
    expect([...readManifest(e.manifestDoc).keys()]).toEqual(['n-good']);
    for (const [p, t] of files) expect(e.fs.get(p), p).toBe(t); // id를 고쳐 쓰지 않는다(노트 id는 불변)
    expect(e.hooks.logs.filter((l) => l.includes('unshareable id'))).toHaveLength(bad.length);
    expect(e.fake.sidecars.size).toBeGreaterThan(0);
    for (const k of e.fake.sidecars.keys()) expect(k).toMatch(/\|(?:_manifest|n_[0-9a-f]+)$/);
  });

  it('원격 manifest가 사이드카를 만들 수 없는 긴 id를 넣어도 열지 않는다', async () => {
    const e = await setup('participant');
    e.providers[0].sync();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ ['z'.repeat(101)]: { path: 'z.md', title: '긴 id' } }));
    await e.manager.idle();
    expect(e.session.getDoc(noteKey('z'.repeat(100)))).toBeUndefined();
    expect(e.fs.paths()).toEqual([]);
    expect(e.hooks.logs.some((l) => l.includes('id too long'))).toBe(true);
  });
});

// ── patchLocalNote: 단일 쓰기 주체 큐 경유 ───────────────────────────────────

/** `read`에 게이트를 걸 수 있는 파일시스템 — 지정한 경로의 읽기를 열어 줄 때까지 붙잡아 둔다(결정적 인터리빙). */
class GatedFs extends MemFs {
  gate: { path: string; open: Promise<void>; hit: () => void; hitP: Promise<void> } | null = null;
  armGate(path: string): { release: () => void; hit: Promise<void> } {
    let release!: () => void;
    let hit!: () => void;
    const open = new Promise<void>((r) => (release = r));
    const hitP = new Promise<void>((r) => (hit = r));
    this.gate = { path, open, hit, hitP };
    return { release, hit: hitP };
  }
  override async read(path: string): Promise<string | null> {
    const g = this.gate;
    if (g && g.path === path) {
      this.gate = null; // 한 번만 붙잡는다
      const text = this.get(path); // 읽은 시점의 내용(옛 본문)을 먼저 확보한 뒤
      g.hit();
      await g.open; // 열어 줄 때까지 기다린다 — 그 사이에 다른 쓰기가 끼어들 수 있다
      return text;
    }
    return super.read(path);
  }
}

describe('patchLocalNote — 큐 밖 read→save가 원격 편집을 되돌리던 경쟁 조건', () => {
  const addLink = (n: NoteDoc): NoteDoc => ({ ...n, links: [...n.links, { mapId: 'm1', nodeId: 'x', nodeText: '노드' }] });

  it('프론트매터만 고치는 패치 도중 원격 편집이 도착해도 두 변경이 모두 남는다(원격 편집이 옛 본문으로 되돌아가지 않는다)', async () => {
    const e = await materialized({ fsFactory: (root) => new GatedFs(root) });
    const fs = e.fs as GatedFs;
    // 패치가 파일을 읽는 순간을 붙잡고, 그 사이에 원격 편집을 넣는다
    const gate = fs.armGate(A);
    const patched = e.manager.patchLocalNote(A, addLink);
    await gate.hit;
    appendParagraph(e.noteDoc('n-a')!, '패치 도중 도착한 원격 편집');
    // 매니저의 쓰기는 큐에서 패치 뒤에 온다 — 패치가 끝나기 전에는 파일에 반영되지 않는다
    expect(fs.get(A)).not.toContain('패치 도중 도착한 원격 편집');
    gate.release();
    const res = await patched;
    expect(res.status).toBe('written');
    await until(() => (fs.get(A) ?? '').includes('패치 도중 도착한 원격 편집'), '원격 편집이 파일에 반영');
    await e.manager.idle();
    const finalNote = parseNote(fs.get(A)!);
    expect(finalNote.links).toEqual([{ mapId: 'm1', nodeId: 'x', nodeText: '노드' }]); // 패치한 링크
    expect(finalNote.body).toContain('패치 도중 도착한 원격 편집'); // 원격 편집
    expect(finalNote.body).toContain('알파 첫 문단입니다');
    // 공유 문서에도 원격 편집이 그대로 있다(옛 본문으로 되돌린 뒤 3-way가 삭제로 전파하는 일이 없다)
    expect(realCodec.yDocToMarkdown(e.noteDoc('n-a')!)).toContain('패치 도중 도착한 원격 편집');
  });

  it('본문을 고치는 패치(위키링크 치환)도 같은 큐 슬롯에서 공유 문서에 흡수되고, 동시에 도착한 원격 편집과 함께 남는다', async () => {
    const e = await materialized({ fsFactory: (root) => new GatedFs(root) });
    const fs = e.fs as GatedFs;
    const gate = fs.armGate(A);
    const patched = e.manager.patchLocalNote(A, (n) => ({ ...n, body: n.body.replace('알파 첫 문단입니다', '알파 첫 문단입니다 [[새 제목]]') }));
    await gate.hit;
    appendParagraph(e.noteDoc('n-a')!, '동시에 온 원격 편집');
    gate.release();
    expect((await patched).status).toBe('written');
    await until(() => {
      const md = realCodec.yDocToMarkdown(e.noteDoc('n-a')!);
      return md.includes('[[새 제목]]') && md.includes('동시에 온 원격 편집');
    }, '공유 문서에 두 변경 모두');
    await until(() => (fs.get(A) ?? '').includes('동시에 온 원격 편집') && (fs.get(A) ?? '').includes('[[새 제목]]'), '파일에도');
    await e.manager.idle();
    expect(e.fs.paths().filter((p) => p.includes('충돌 사본'))).toEqual([]); // 소량 변경은 흡수된다(충돌 사본 아님)
  });

  it('프론트매터만 패치한 뒤에는 자기 쓰기로 인식돼 외부 수정으로 다시 흡수되지 않는다(해시·기준점 정합)', async () => {
    const e = await materialized();
    const res = await e.manager.patchLocalNote(A, addLink);
    expect(res.status).toBe('written');
    expect(await e.manager.onExternalChange(A)).toBe('ignored');
    await e.manager.scan();
    expect(parseNote(e.fs.get(A)!).links).toHaveLength(1);
    expect(realCodec.yDocToMarkdown(e.noteDoc('n-a')!)).toBe(realCodec.yDocToMarkdown(e.noteDoc('n-a')!));
    expect(e.fs.paths().filter((p) => p.includes('충돌 사본'))).toEqual([]);
    // 이후 원격 편집은 패치한 프론트매터를 보존한 채 파일에 반영된다
    appendParagraph(e.noteDoc('n-a')!, '패치 뒤 원격 편집');
    await until(() => (e.fs.get(A) ?? '').includes('패치 뒤 원격 편집'), '반영');
    expect(parseNote(e.fs.get(A)!).links).toHaveLength(1);
  });

  it('공유 노트가 아니면 not_shared(파일을 건드리지 않는다), 파일이 사라졌으면 failed(되살리지 않는다), 변경 없음은 unchanged', async () => {
    const e = await materialized();
    expect((await e.manager.patchLocalNote(`${FOLDER}/other.md`, addLink)).status).toBe('not_shared');
    const before = e.fs.get(A);
    expect((await e.manager.patchLocalNote(A, () => null)).status).toBe('unchanged');
    expect(e.fs.get(A)).toBe(before);
    e.fs.remove(A);
    expect((await e.manager.patchLocalNote(A, addLink)).status).toBe('failed');
    expect(e.fs.has(A)).toBe(false); // 삭제된 파일을 되살리지 않는다
  });

  it('mutator가 던지면 failed이고 아무것도 쓰지 않는다. 노트 id를 바꿔도 무시된다(id 불변)', async () => {
    const e = await materialized();
    const before = e.fs.get(A);
    expect((await e.manager.patchLocalNote(A, () => { throw new Error('boom'); })).status).toBe('failed');
    expect(e.fs.get(A)).toBe(before);
    const res = await e.manager.patchLocalNote(A, (n) => ({ ...addLink(n), id: 'hijacked' }));
    expect(res.status).toBe('written');
    expect(parseNote(e.fs.get(A)!).id).toBe('n-a');
  });

  it('제목 패치는 manifest 제목으로 전파된다', async () => {
    const e = await materialized();
    await e.manager.patchLocalNote(A, (n) => ({ ...n, title: '새 제목' }));
    expect(readManifest(e.manifestDoc).get('n-a')!.title).toBe('새 제목');
    expect(parseNote(e.fs.get(A)!).title).toBe('새 제목');
  });

  it('이름이 막 바뀌어 경로 색인에 아직 없는 파일도 noteId 힌트와 파일의 id로 찾는다(다른 노트의 파일이면 거부)', async () => {
    const e = await materialized();
    const moved = `${FOLDER}/renamed.md`;
    e.fs.put(moved, e.fs.get(A)!);
    e.fs.remove(A);
    expect((await e.manager.patchLocalNote(moved, addLink)).status).toBe('not_shared'); // 힌트 없음
    expect((await e.manager.patchLocalNote(moved, addLink, { noteId: 'n-a' })).status).toBe('written');
    expect(e.manager.pathForNote('n-a')).toBe(moved);
    // 힌트의 id와 파일의 id가 다르면 거부
    const other = `${FOLDER}/other.md`;
    e.fs.put(other, noteFile('n-other', '다른', '다른 노트 본문입니다 충분히 긴'));
    expect((await e.manager.patchLocalNote(other, addLink, { noteId: 'n-a' })).status).toBe('not_shared');
    expect(parseNote(e.fs.get(other)!).links).toEqual([]);
  });

  it('외부에서 고친 파일 위에서 패치하면 외부 수정을 먼저 흡수한 뒤 그 위에 적용한다(외부 수정을 덮어쓰지 않는다)', async () => {
    const e = await materialized();
    const cur = parseNote(e.fs.get(A)!);
    e.fs.put(A, serializeNote({ ...cur, body: cur.body.replace('알파 첫 문단입니다', '알파 첫 문단입니다 외부에서 추가') }));
    const res = await e.manager.patchLocalNote(A, addLink);
    expect(res.status).toBe('written');
    await e.manager.idle();
    expect(realCodec.yDocToMarkdown(e.noteDoc('n-a')!)).toContain('외부에서 추가');
    expect(parseNote(e.fs.get(A)!).links).toHaveLength(1);
  });
});

// ── 입력 상한 ───────────────────────────────────────────────────────────────

describe('원격 입력 상한', () => {
  const countingCodec = () => {
    const calls = { derive: 0 };
    const codec: NoteCodec = {
      ...realCodec,
      yDocToMarkdown: (d) => {
        calls.derive++;
        return realCodec.yDocToMarkdown(d);
      },
    };
    return { codec, calls };
  };
  /** 지정 크기 이상의 본문을 가진 노트 update. */
  function hugeNoteUpdate(chars: number): Uint8Array {
    const d = new Y.Doc();
    d.transact(() => {
      const frag = d.getXmlFragment(NOTE_FRAGMENT);
      const p = new Y.XmlElement('paragraph');
      p.insert(0, [new Y.XmlText('가'.repeat(chars))]);
      frag.insert(0, [p]);
    });
    return Y.encodeStateAsUpdate(d);
  }

  it('Y 상태가 상한(5MB)을 넘는 노트는 md를 파생하지도 쓰지도 않고, 한 번만 알린다', async () => {
    const { codec, calls } = countingCodec();
    const e = await setup('participant', { codec });
    e.providers[0].sync();
    Y.applyUpdate(e.manifestDoc, remoteManifestUpdate({ 'n-big': { path: 'big.md', title: '거대' } }));
    await e.manager.idle();
    const update = hugeNoteUpdate(MAX_NOTE_STATE_BYTES + 100_000);
    expect(update.byteLength).toBeGreaterThan(MAX_NOTE_STATE_BYTES);
    Y.applyUpdate(e.noteDoc('n-big')!, update);
    await e.manager.idle();
    await e.manager.reconcile();
    expect(calls.derive).toBe(0); // 파생조차 하지 않는다(CPU 보호)
    expect(e.fs.paths()).toEqual([]); // 물질화되지 않는다
    expect(e.hooks.messages.filter((m) => m.includes('너무 커서'))).toHaveLength(1);
  });

  it('파생한 md가 상한(2M자)을 넘으면 파일을 쓰지 않는다 — 이미 있던 파일은 그대로', async () => {
    const e = await materialized();
    const before = e.fs.get(A);
    appendParagraph(e.noteDoc('n-a')!, '나'.repeat(MAX_NOTE_MARKDOWN_CHARS + 10));
    // 상태 크기는 5MB 미만(한글 3바이트 × 2M ≈ 6MB이므로 상한 전에 걸릴 수 있다) — 어느 쪽이든 파일은 그대로다
    await until(() => e.hooks.messages.some((m) => m.includes('너무 커서')), '상한 알림');
    await e.manager.idle();
    expect(e.fs.get(A)).toBe(before);
    expect(e.hooks.messages.filter((m) => m.includes('너무 커서'))).toHaveLength(1);
  });

  it('manifest 노트 항목이 상한(2000)에 이르면 새 노트를 더 공유하지 않는다(파일은 그대로, 한 번 알림)', async () => {
    const e = await setup('owner', {
      init: (fs) => fs.put(`${FOLDER}/new.md`, noteFile('n-new', '새 노트', '새 노트 본문입니다 충분히 긴 본문')),
    });
    // 이미 상한만큼 꽉 찬 manifest(원격 참가자가 넣은 항목들)
    e.manifestDoc.transact(() => {
      const m = getManifestMap(e.manifestDoc);
      for (let i = 0; i < MAX_MANIFEST_NOTES; i++) m.set(`filler-${i}`, { path: `f${i}.md`, title: `f${i}`, rev: 1, seeded: true });
    });
    e.providers[0].sync();
    await e.manager.idle();
    await e.manager.scan();
    expect(readManifest(e.manifestDoc).has('n-new')).toBe(false);
    expect(getManifestMap(e.manifestDoc).size).toBe(MAX_MANIFEST_NOTES);
    expect(e.hooks.messages.filter((m) => m.includes('노트가 너무 많아'))).toHaveLength(1);
    expect(e.fs.get(`${FOLDER}/new.md`)).toContain('새 노트 본문입니다'); // 파일은 그대로
  });
});

// 자기 쓰기 해시 정합의 기본 확인(패치가 hashText와 같은 값을 남긴다)
describe('patchLocalNote 해시', () => {
  it('프론트매터 패치가 남긴 mdHash는 파일 바이트의 해시와 같다(사이드카 봉투)', async () => {
    const { decodeNoteEnvelope } = await import('../io/noteEnvelope');
    const e = await materialized();
    await e.manager.patchLocalNote(A, (n) => ({ ...n, links: [{ mapId: 'm', nodeId: 'n', nodeText: 't' }] }));
    await e.manager.idle();
    const env = decodeNoteEnvelope(e.fake.sidecars.get(noteSidecarKey(FOLDER, 'n-a'))!)!;
    expect(env.mdHash).toBe(hashText(e.fs.get(A)!));
  });
});
