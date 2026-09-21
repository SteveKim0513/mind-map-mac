// @vitest-environment node
// 맵·보드 보기 전용 공유 통합 테스트 — 실제 릴레이(server/dist/relay.js, 포트 0·메모리 DB) + 실제 HocuspocusProvider +
// 메모리 파일시스템을 주입한 FileReplicaManager 여러 개(= 여러 기기). 테스트마다 자체 릴레이를 띄워 병렬 안전하다.
//
// 사전 조건: `npm --prefix server run build`로 server/dist/relay.js를 만들어 둘 것(replica.integration.test.ts와 같다).
import { assertNodeNetworkGlobals } from './replicaDomSetup';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { emptyBoard, serializeBoard } from '../io/boardFormat';
import { emptyDoc, serialize } from '../io/formats';
import { prepareSharedContent } from '../io/sharedFile';
import type { BoardStickyElement, MindMapDoc, ShareRole } from '../types';
import { fileKey, MANIFEST_KEY } from './docKeys';
import {
  FILE_MAP_NAME,
  createFileReplicaManager,
  readFileDoc,
  type FileReplicaHooks,
  type FileReplicaManager,
} from './fileReplica';
import {
  getManifestFileEntry,
  getManifestFilesMap,
  readManifestFiles,
  removeManifestFileEntry,
  upsertManifestFileEntry,
} from './manifest';
import { MemFileFs, until } from './replicaTestKit';
import { attachSidecarPersistence, readSidecar } from './sidecar';
import { createShareSession, type ShareDocHandle, type ShareSession } from './shareClient';
import { makeFakeShareApi } from './testFakes';

// 환경 가드: 실제 WebSocket으로 릴레이에 붙는다 — jsdom 환경이면 "연결 타임아웃" 대신 원인을 알려 주며 즉시 실패한다.
assertNodeNetworkGlobals();

const RELAY_ENTRY = resolve(process.cwd(), 'server/dist/relay.js');

interface Relay {
  url: string;
  wsUrl: string;
  stats(): { documents: number; connections: number };
  close(): Promise<void>;
}

async function startRelay(): Promise<Relay> {
  if (!existsSync(RELAY_ENTRY)) {
    throw new Error('server/dist/relay.js 가 없습니다 — `npm --prefix server run build` 를 먼저 실행하세요 (릴레이 서버 빌드 산출물이 필요한 통합 테스트입니다).');
  }
  const mod = (await import(/* @vite-ignore */ pathToFileURL(RELAY_ENTRY).href)) as {
    startRelay(o: { port: number; silent: boolean }): Promise<Relay>;
  };
  return mod.startRelay({ port: 0, silent: true });
}

let relay: Relay;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  relay = await startRelay();
  return async () => {
    await relay.close();
  };
});
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

interface Member {
  participantId: string;
  token: string;
}
interface Room {
  roomId: string;
  owner: Member;
}

async function call(method: string, path: string, opts: { token?: string; body?: unknown } = {}) {
  const res = await fetch(relay.url + path, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  if (res.status !== 200) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return JSON.parse(text) as Record<string, string>;
}
async function newRoom(): Promise<Room> {
  const r = await call('POST', '/rooms', { body: { ownerName: 'Owner', folderName: 'team' } });
  return { roomId: r.roomId, owner: { participantId: r.ownerId, token: r.ownerToken } };
}
async function addGuest(room: Room, name: string): Promise<Member> {
  const inv = await call('POST', `/rooms/${room.roomId}/invites`, { token: room.owner.token });
  const j = await call('POST', '/join', { body: { code: inv.inviteCode, displayName: name } });
  return { participantId: j.participantId, token: j.token };
}

/** 한 기기의 영속 상태(파일 + 사이드카) — 앱을 껐다 켜도 남는다. */
interface Device {
  name: string;
  folder: string;
  fs: MemFileFs;
  fake: ReturnType<typeof makeFakeShareApi>;
}
const device = (name: string): Device => {
  const folder = `/ws/${name}/team`;
  return { name, folder, fs: new MemFileFs(folder), fake: makeFakeShareApi() };
};

interface TestHooks extends FileReplicaHooks {
  messages: string[];
  written: string[];
  trashed: string[];
  moved: [string, string][];
  paths: Record<string, string>;
}

interface Peer {
  dev: Device;
  session: ShareSession;
  manager: FileReplicaManager;
  manifest: ShareDocHandle;
  hooks: TestHooks;
  stop(): Promise<void>;
}

async function startPeer(
  dev: Device,
  room: Room,
  member: Member,
  role: ShareRole,
  o: { deleteGraceMs?: number; publishDebounceMs?: number } = {},
): Promise<Peer> {
  const session = createShareSession({ roomId: room.roomId, wsUrl: relay.wsUrl, getToken: async () => member.token });
  const manifestBytes = await readSidecar(dev.fake.api, dev.folder, MANIFEST_KEY);
  const manifest = session.openDoc(MANIFEST_KEY, { initialState: manifestBytes });
  const persist = attachSidecarPersistence(manifest.ydoc, { api: dev.fake.api, folderPath: dev.folder, docKey: MANIFEST_KEY, debounceMs: 20 });
  const hooks: TestHooks = {
    messages: [],
    written: [],
    trashed: [],
    moved: [],
    paths: {},
    notify: (m) => hooks.messages.push(m),
    onFileWritten: (p) => hooks.written.push(p),
    onFileTrashed: (p) => hooks.trashed.push(p),
    onFileMoved: (a, b) => hooks.moved.push([a, b]),
    onPathsChanged: (p) => (hooks.paths = p),
  };
  const manager = createFileReplicaManager({
    roomId: room.roomId,
    folderPath: dev.folder,
    role,
    api: dev.fake.api,
    manifest,
    fs: dev.fs,
    hooks,
    host: {
      openDoc: async (docKey, initialState) => session.openDoc(docKey, { initialState }),
      closeDoc: async (docKey) => session.closeDoc(docKey),
    },
    publishDebounceMs: o.publishDebounceMs ?? 20,
    deleteConfirmScans: 1,
    missingRecheckMs: 0,
    remoteDeleteGraceMs: o.deleteGraceMs ?? 60,
  });
  await manager.start();
  session.connect();
  let stopped = false;
  const peer: Peer = {
    dev,
    session,
    manager,
    manifest,
    hooks,
    async stop() {
      if (stopped) return;
      stopped = true;
      await manager.stop();
      await persist.stop();
      session.destroy();
    },
  };
  cleanups.push(() => peer.stop());
  return peer;
}

// ── 데이터 ─────────────────────────────────────────────────────────────────

function mapDoc(id: string, text: string, extra: Partial<MindMapDoc['nodes'][string]> = {}): MindMapDoc {
  const doc = emptyDoc();
  doc.id = id;
  doc.rootIds = ['r'];
  doc.nodes = { r: { id: 'r', text, parentId: null, children: [], collapsed: false, ...extra } };
  return doc;
}
const mapText = (doc: MindMapDoc) => serialize(doc);
const sticky = (id: string, text: string, x = 0): BoardStickyElement => ({ id, kind: 'sticky', x, y: 0, width: 160, height: 120, text });
function boardText(id: string, ...stickies: BoardStickyElement[]): string {
  const b = emptyBoard();
  b.id = id;
  for (const s of stickies) {
    b.elements[s.id] = s;
    b.order.push(s.id);
  }
  return serializeBoard(b);
}
const nodeText = (text: string | null) => (text ? (JSON.parse(text) as MindMapDoc).nodes.r.text : null);

const REMINDER_MAP = mapText(
  mapDoc('map-plan', '계획', {
    todo: true,
    scheduled: true,
    scheduleAt: '2026-10-01T09:00:00.000Z',
    reminderOn: true,
    reminderId: 'owner-only-reminder-id',
    reminderSyncedAt: 5,
  }),
);
const BOARD = boardText('board-idea', sticky('s1', '아이디어'));

function seedOwner(dev: Device): Record<string, string> {
  const files = { 'plan.mind': REMINDER_MAP, 'sub/idea.board': BOARD };
  for (const [rel, text] of Object.entries(files)) dev.fs.put(`${dev.folder}/${rel}`, text);
  return files;
}

async function sharedPair() {
  const room = await newRoom();
  const A = device('A');
  const originals = seedOwner(A);
  const pa = await startPeer(A, room, room.owner, 'owner');
  const B = device('B');
  const memberB = await addGuest(room, 'Bea');
  const pb = await startPeer(B, room, memberB, 'participant');
  await until(() => B.fs.paths().length === 2, 'B가 두 파일을 미러링');
  await pa.manager.idle();
  await pb.manager.idle();
  return { room, A, B, pa, pb, originals, memberB };
}

/** 소유자 A가 file 문서를 직접 볼 수 있게 핸들을 돌려준다. */
const fileDoc = (p: Peer, id: string): Y.Doc => {
  const h = p.session.getDoc(fileKey(id));
  if (!h) throw new Error(`no file doc ${id}`);
  return h.ydoc;
};

describe('맵·보드 보기 전용 공유 — 실제 릴레이 통합', () => {
  it('(a) 소유자의 맵·보드가 참가자 폴더에 같은 상대 경로로 나타난다 — 소유자 파일은 그대로, 리마인더 신원은 제거', async () => {
    const { A, B, pa, pb, originals } = await sharedPair();
    // 소유자의 원본 파일은 1바이트도 바뀌지 않았다(읽기만 한다)
    for (const [rel, text] of Object.entries(originals)) expect(A.fs.get(`${A.folder}/${rel}`)).toBe(text);
    expect(A.fs.writes).toEqual([]);

    const plan = B.fs.get(`${B.folder}/plan.mind`)!;
    expect(nodeText(plan)).toBe('계획');
    const n = (JSON.parse(plan) as MindMapDoc).nodes.r;
    expect(n.scheduleAt).toBe('2026-10-01T09:00:00.000Z'); // 일정은 그대로
    expect(n.reminderOn).toBeUndefined(); // 리마인더 신원은 다른 기기로 가지 않는다
    expect(n.reminderId).toBeUndefined();
    expect(n.reminderSyncedAt).toBeUndefined();
    expect(B.fs.get(`${B.folder}/sub/idea.board`)).toBe(prepareSharedContent('board', BOARD));

    // manifest 항목·경로 맵
    const entries = readManifestFiles(pa.manifest.ydoc);
    expect(entries.get('map-plan')).toMatchObject({ path: 'plan.mind', kind: 'map', title: 'plan' });
    expect(entries.get('board-idea')).toMatchObject({ path: 'sub/idea.board', kind: 'board', title: 'idea' });
    expect(pb.hooks.paths).toEqual({ [`${B.folder}/plan.mind`]: 'map-plan', [`${B.folder}/sub/idea.board`]: 'board-idea' });
    expect(pa.hooks.paths).toEqual({ [`${A.folder}/plan.mind`]: 'map-plan', [`${A.folder}/sub/idea.board`]: 'board-idea' });
    expect(pb.manager.isFile(`${B.folder}/plan.mind`)).toBe(true);
    expect(pb.manager.isFile(`${B.folder}/other.mind`)).toBe(false);
  }, 30_000);

  it('(b) 소유자가 저장하면 참가자 미러가 갱신되고 onFileWritten 훅이 온다 — file 문서는 Map 키 덮어쓰기(rev 증가)', async () => {
    const { A, B, pa, pb } = await sharedPair();
    const before = pb.hooks.written.length;
    const revBefore = readFileDoc(fileDoc(pa, 'map-plan'))!.rev;
    A.fs.put(`${A.folder}/plan.mind`, mapText(mapDoc('map-plan', '계획 (수정됨)')));
    pa.manager.onFileSaved(`${A.folder}/plan.mind`);
    await until(() => nodeText(B.fs.get(`${B.folder}/plan.mind`)) === '계획 (수정됨)', '참가자 미러 갱신');
    expect(pb.hooks.written.length).toBeGreaterThan(before);
    expect(pb.hooks.written[pb.hooks.written.length - 1]).toBe(`${B.folder}/plan.mind`);
    const doc = readFileDoc(fileDoc(pa, 'map-plan'))!;
    expect(doc.rev).toBeGreaterThan(revBefore);
    expect(doc.kind).toBe('map');
    // 문서 구조는 Map 하나(content·rev·kind) — 수정을 많이 해도 키가 늘지 않는다
    for (let i = 0; i < 5; i++) {
      A.fs.put(`${A.folder}/plan.mind`, mapText(mapDoc('map-plan', `계획 ${i}`)));
      pa.manager.onFileSaved(`${A.folder}/plan.mind`);
      await until(() => nodeText(B.fs.get(`${B.folder}/plan.mind`)) === `계획 ${i}`, `미러가 ${i}번째 수정을 반영`); // 시간 대신 도착으로 속도를 맞춘다
    }
    await until(() => nodeText(B.fs.get(`${B.folder}/plan.mind`)) === '계획 4', '연속 수정 반영');
    expect([...fileDoc(pa, 'map-plan').getMap(FILE_MAP_NAME).keys()].sort()).toEqual(['content', 'kind', 'rev']);
  }, 30_000);

  it('(c) 참가자가 file 문서·manifest를 고쳐도 서버가 버려 소유자와 다른 참가자에게 반영되지 않는다', async () => {
    const { room, A, B, pa, pb } = await sharedPair();
    const C = device('C');
    const pc = await startPeer(C, room, await addGuest(room, 'Cyd'), 'participant');
    await until(() => C.fs.paths().length === 2, 'C도 미러링');

    // 악의적인 B: 자기 Y 문서를 직접 고친다(정상 앱은 이렇게 하지 않는다)
    const hijack = mapText(mapDoc('map-plan', '가로채기'));
    fileDoc(pb, 'map-plan').transact(() => {
      fileDoc(pb, 'map-plan').getMap(FILE_MAP_NAME).set('content', hijack);
      fileDoc(pb, 'map-plan').getMap(FILE_MAP_NAME).set('rev', 999);
    });
    // B 자신의 미러 파일은 로컬 변경으로는 바뀌지 않는다(우리가 낸 트랜잭션은 무시) — 이 검사는 기다릴 일이 없다
    await pb.manager.idle();
    expect(nodeText(B.fs.get(`${B.folder}/plan.mind`))).toBe('계획');
    // 양성 신호: 그 뒤에 소유자가 정상 수정을 발행하고 C의 미러에 도착할 때까지 기다린다 — B의 조작이 서버에서 받아들여졌다면 그 전에 C에게 갔을 것이다.
    A.fs.put(`${A.folder}/plan.mind`, mapText(mapDoc('map-plan', '계획 (조작 뒤 정상 수정)')));
    pa.manager.onFileSaved(`${A.folder}/plan.mind`);
    await until(() => nodeText(C.fs.get(`${C.folder}/plan.mind`)) === '계획 (조작 뒤 정상 수정)', 'C가 정상 수정을 수신');
    await pa.manager.idle();
    await pc.manager.idle();
    expect(readFileDoc(fileDoc(pa, 'map-plan'))!.content).not.toContain('가로채기'); // 소유자 문서 그대로
    expect(readFileDoc(fileDoc(pc, 'map-plan'))!.content).not.toContain('가로채기'); // 다른 참가자에게도 안 감
    expect(nodeText(C.fs.get(`${C.folder}/plan.mind`))).toBe('계획 (조작 뒤 정상 수정)'); // 조작이 아니라 소유자의 수정만 반영됐다
    expect(A.fs.writes).toEqual([]); // 소유자 파일은 앱이 쓰지 않는다(테스트가 직접 고친 것뿐)
    // B 자신의 미러 파일도 로컬 변경으로는 바뀌지 않는다(우리가 낸 트랜잭션은 무시)
  }, 30_000);

  it('(d) 참가자는 받은 내용을 parse 검증한다 — 손상·종류 불일치는 거부하고 유효한 내용은 그대로 받는다', async () => {
    // 정상 소유자 매니저는 문서가 (자기 값과 달라지면) 곧바로 되돌려 버리므로, 참가자 쪽 검증을 보려면 "원시" 소유자가 필요하다.
    const room = await newRoom();
    const session = createShareSession({ roomId: room.roomId, wsUrl: relay.wsUrl, getToken: async () => room.owner.token });
    const manifest = session.openDoc(MANIFEST_KEY);
    const raw = session.openDoc(fileKey('raw-map'));
    session.connect();
    cleanups.push(async () => session.destroy());
    await manifest.whenSynced();
    await raw.whenSynced();
    const publish = (content: string, rev: number) =>
      raw.ydoc.transact(() => {
        const m = raw.ydoc.getMap(FILE_MAP_NAME);
        m.set('content', content);
        m.set('rev', rev);
        m.set('kind', 'map');
      });
    publish(mapText(mapDoc('raw-map', '첫 내용')), 1);
    upsertManifestFileEntry(manifest.ydoc, 'raw-map', { path: 'raw.mind', kind: 'map', title: 'raw' });
    await until(() => manifest.provider.unsyncedChanges === 0 && raw.provider.unsyncedChanges === 0, '서버가 변경을 수신');

    const B = device('B');
    const pb = await startPeer(B, room, await addGuest(room, 'Bea'), 'participant');
    await until(() => nodeText(B.fs.get(`${B.folder}/raw.mind`)) === '첫 내용', '첫 내용 미러링');
    await pb.manager.idle();
    const written = pb.hooks.written.length;
    const bDoc = () => readFileDoc(fileDoc(pb, 'raw-map'));

    // 손상된 JSON: 도착을 확인(양성 신호)한 뒤 처리가 끝나면 파일이 그대로여야 한다
    publish('{not valid json', 2);
    await until(() => bDoc()?.content === '{not valid json', '손상된 내용이 참가자 문서에 도착');
    await pb.manager.idle();
    expect(nodeText(B.fs.get(`${B.folder}/raw.mind`))).toBe('첫 내용');
    expect(pb.hooks.written.length).toBe(written);

    // 종류 불일치(manifest는 map인데 보드 내용)
    publish(BOARD, 3);
    await until(() => bDoc()?.content === BOARD, '보드 내용이 도착');
    await pb.manager.idle();
    expect(nodeText(B.fs.get(`${B.folder}/raw.mind`))).toBe('첫 내용');
    expect(pb.hooks.written.length).toBe(written);

    // 유효한 내용은 다시 정상적으로 반영된다(거부가 미러를 망가뜨리지 않았다)
    publish(mapText(mapDoc('raw-map', '거부 뒤 유효한 내용')), 4);
    await until(() => nodeText(B.fs.get(`${B.folder}/raw.mind`)) === '거부 뒤 유효한 내용', '유효한 내용 반영');
    expect(pb.hooks.written.length).toBe(written + 1);
    // 거부 안내는 한 번뿐이다(같은 미러의 반복 거부가 토스트를 도배하지 않는다) — 사유 코드 로그도 남았다
    expect(pb.hooks.messages.filter((m) => m.includes('반영하지 않았어요'))).toHaveLength(1);

    // 리마인더 필드가 든 유효한 내용 — 받는 쪽이 다시 정제한다((m)에서도 검증)
    expect(prepareSharedContent('map', REMINDER_MAP)!).not.toContain('owner-only-reminder-id');
  }, 30_000);

  it('(e) 소유자의 값이 문서에서 밀리면 소유자 매니저가 되돌린다(소유자가 항상 이긴다)', async () => {
    const { A, pa, pb } = await sharedPair();
    const good = readFileDoc(fileDoc(pa, 'map-plan'))!.content;
    const oDoc = fileDoc(pa, 'map-plan');
    oDoc.transact(() => oDoc.getMap(FILE_MAP_NAME).set('content', '{broken'));
    await until(() => readFileDoc(fileDoc(pa, 'map-plan'))!.content === good, '소유자가 재확립');
    await until(() => readFileDoc(fileDoc(pb, 'map-plan'))!.content === good, '참가자 문서도 원래 값');
    expect(A.fs.writes).toEqual([]);
  }, 30_000);

  it('(f) 소유자가 파일을 지우면 참가자의 미러는 휴지통으로 가고 토스트·탭 닫기 훅이 온다(영구 삭제 없음)', async () => {
    const { A, B, pa, pb } = await sharedPair();
    const mirrored = B.fs.get(`${B.folder}/sub/idea.board`)!;
    A.fs.remove(`${A.folder}/sub/idea.board`);
    await pa.manager.scan();
    await until(() => !B.fs.has(`${B.folder}/sub/idea.board`), '미러가 사라짐');
    expect(B.fs.trashed).toEqual([{ path: `${B.folder}/sub/idea.board`, text: mirrored }]);
    expect(pb.hooks.trashed).toEqual([`${B.folder}/sub/idea.board`]);
    expect(pb.hooks.messages.some((m) => m.includes('휴지통'))).toBe(true);
    expect(B.fs.has(`${B.folder}/plan.mind`)).toBe(true); // 다른 파일은 그대로
    expect(pb.hooks.paths[`${B.folder}/sub/idea.board`]).toBeUndefined();
  }, 30_000);

  it('(g) 소유자가 이름을 바꾸면(안정 문서 id) 참가자 미러도 같은 이름으로 따라간다', async () => {
    const { A, B, pa, pb } = await sharedPair();
    const text = A.fs.get(`${A.folder}/plan.mind`)!;
    A.fs.remove(`${A.folder}/plan.mind`);
    A.fs.put(`${A.folder}/renamed.mind`, text);
    await pa.manager.scan();
    await until(() => B.fs.has(`${B.folder}/renamed.mind`) && !B.fs.has(`${B.folder}/plan.mind`), '참가자 미러 이름 변경');
    expect(B.fs.trashed).toEqual([]); // 삭제가 아니라 이동이다
    expect(pb.hooks.moved).toEqual([[`${B.folder}/plan.mind`, `${B.folder}/renamed.mind`]]);
    expect(getManifestFileEntry(pa.manifest.ydoc, 'map-plan')).toMatchObject({ path: 'renamed.mind', title: 'renamed' });
    expect(pb.hooks.paths[`${B.folder}/renamed.mind`]).toBe('map-plan');
  }, 30_000);

  it('(h) 참가자가 다시 접속해도 파일이 중복되지 않고 미러는 그대로다 — 소유자가 오프라인이어도 뷰어 경로가 복원된다', async () => {
    const { room, A, B, pa, pb, memberB } = await sharedPair();
    await pb.stop();
    // 소유자도 끈다 → 서버 상태 폐기. 참가자는 사이드카(미러 기록)·파일만으로 시작한다.
    await pa.stop();
    await until(() => relay.stats().documents === 0, '서버가 문서 상태를 폐기', 15_000);
    const snapshot = new Map(B.fs.paths().map((p) => [p, B.fs.get(p)!]));
    const writesBefore = B.fs.writes.length;
    const pb2 = await startPeer(B, room, memberB, 'participant'); // 같은 참가자·같은 기기(파일 + 사이드카)로 다시 시작
    await pb2.manager.idle();
    expect(pb2.hooks.paths).toEqual({ [`${B.folder}/plan.mind`]: 'map-plan', [`${B.folder}/sub/idea.board`]: 'board-idea' }); // 오프라인에서도 미러로 인식
    expect(B.fs.paths()).toEqual([...snapshot.keys()].sort()); // 중복 파일("… 2") 없음
    for (const [p, t] of snapshot) expect(B.fs.get(p)).toBe(t);
    expect(B.fs.writes.length).toBe(writesBefore); // 다시 쓰지도 않았다
    // 소유자가 돌아오면(서버는 비어 있었다) 소유자가 다시 발행하고, 내용이 같으니 참가자는 다시 쓰지 않는다
    const pa2 = await startPeer(A, room, room.owner, 'owner');
    await pa2.manager.idle();
    await until(() => readFileDoc(fileDoc(pb2, 'map-plan')) !== null, '소유자의 새 세션이 발행한 문서가 도착'); // 양성 신호
    await pb2.manager.idle();
    expect(B.fs.writes.length).toBe(writesBefore);
    expect(B.fs.paths()).toEqual([...snapshot.keys()].sort());
    expect(readFileDoc(fileDoc(pb2, 'map-plan'))?.kind).toBe('map'); // 소유자의 새 세션이 다시 발행해 문서가 도착했다
  }, 60_000);

  it('(i) 참가자가 같은 경로에 만들어 둔 자기 파일은 덮어쓰지 않고 접미사를 붙여 미러링한다', async () => {
    const room = await newRoom();
    const A = device('A');
    seedOwner(A);
    await startPeer(A, room, room.owner, 'owner');
    const B = device('B');
    B.fs.put(`${B.folder}/plan.mind`, mapText(mapDoc('b-own', '내 로컬 계획')));
    const pb = await startPeer(B, room, await addGuest(room, 'Bea'), 'participant');
    await until(() => B.fs.has(`${B.folder}/plan 2.mind`), '접미사 미러');
    expect(nodeText(B.fs.get(`${B.folder}/plan.mind`))).toBe('내 로컬 계획'); // 내 파일 불변
    expect(nodeText(B.fs.get(`${B.folder}/plan 2.mind`))).toBe('계획');
    // 내 로컬 파일은 미러가 아니다 — 뷰어 대상이 아님(편집 가능), 접미사 파일이 뷰어 대상
    expect(pb.manager.isFile(`${B.folder}/plan.mind`)).toBe(false);
    expect(pb.manager.isFile(`${B.folder}/plan 2.mind`)).toBe(true);
  }, 30_000);

  it('(j) 참가자가 manifest를 조작해도 소유자가 되돌리고, 다른 참가자의 미러는 지워지지 않는다', async () => {
    const { room, A, pa, pb } = await sharedPair();
    const C = device('C');
    const pc = await startPeer(C, room, await addGuest(room, 'Cyd'), 'participant', { deleteGraceMs: 400 });
    await until(() => C.fs.paths().length === 2, 'C도 미러링');
    // B가 소유자의 항목을 지우고, 경로를 바꾸고, 가짜 항목을 심는다(manifest는 모두에게 쓰기 허용)
    removeManifestFileEntry(pb.manifest.ydoc, 'map-plan');
    getManifestFilesMap(pb.manifest.ydoc).set('board-idea', { path: 'evil/../x.board', kind: 'board', title: 'x', rev: 1 });
    upsertManifestFileEntry(pb.manifest.ydoc, 'fake-file', { path: 'fake.mind', kind: 'map', title: 'fake' });
    await until(() => getManifestFileEntry(pa.manifest.ydoc, 'map-plan') !== null, '소유자가 삭제된 항목을 되돌림', 15_000);
    await until(() => getManifestFileEntry(pa.manifest.ydoc, 'board-idea')?.path === 'sub/idea.board', '소유자가 조작된 경로를 되돌림');
    await pa.manager.scan();
    await pa.manager.scan(); // 가짜 항목은 연속 스캔에서도 없으면 지운다
    await until(() => getManifestFileEntry(pa.manifest.ydoc, 'fake-file') === null, '가짜 항목 제거');
    // 양성 신호: 소유자가 되돌린 항목이 C의 manifest에도 복구되고 가짜 항목이 사라질 때까지 기다린다 — 복구되면 C의 대기 중이던 삭제(유예 타이머)가 취소된다.
    await until(() => getManifestFileEntry(pc.manifest.ydoc, 'map-plan') !== null && getManifestFileEntry(pc.manifest.ydoc, 'fake-file') === null, 'C의 manifest도 복구');
    await pc.manager.idle();
    expect(C.fs.trashed).toEqual([]); // 조작된 삭제가 반영되지 않았다
    expect(C.fs.paths()).toEqual([`${C.folder}/plan.mind`, `${C.folder}/sub/idea.board`]);
    expect(A.fs.paths()).toHaveLength(2);
    expect(A.fs.writes).toEqual([]);
  }, 40_000);

  it('(k) 새 파일·복사본·손상된 파일: 새 맵은 발행되고, 같은 id 복사본은 공유하지 않고, 손상된 파일은 건너뛴다', async () => {
    const { A, B, pa } = await sharedPair();
    A.fs.put(`${A.folder}/new.mind`, mapText(mapDoc('map-new', '새 맵')));
    A.fs.put(`${A.folder}/copy of plan.mind`, REMINDER_MAP); // 같은 문서 id의 복사본
    A.fs.put(`${A.folder}/broken.mind`, '{oops');
    await pa.manager.scan();
    await until(() => B.fs.has(`${B.folder}/new.mind`), '새 맵 미러');
    await pa.manager.idle();
    expect([...readManifestFiles(pa.manifest.ydoc).keys()].sort()).toEqual(['board-idea', 'map-new', 'map-plan']);
    expect(B.fs.has(`${B.folder}/copy of plan.mind`)).toBe(false);
    expect(B.fs.has(`${B.folder}/broken.mind`)).toBe(false);
  }, 30_000);

  it('(l) 문서 id가 없는 옛 파일도 공유되고(경로 해시 id), 소유자 파일은 고쳐 쓰지 않는다', async () => {
    const room = await newRoom();
    const A = device('A');
    const legacy = JSON.stringify({ version: 1, rootIds: ['r'], nodes: { r: { id: 'r', text: '옛 맵', parentId: null, children: [], collapsed: false } }, view: { zoom: 1, panX: 0, panY: 0 } });
    A.fs.put(`${A.folder}/old.mind`, legacy);
    const pa = await startPeer(A, room, room.owner, 'owner');
    const B = device('B');
    await startPeer(B, room, await addGuest(room, 'Bea'), 'participant');
    await until(() => B.fs.has(`${B.folder}/old.mind`), '미러링');
    expect(A.fs.get(`${A.folder}/old.mind`)).toBe(legacy);
    expect(A.fs.writes).toEqual([]);
    const ids = [...readManifestFiles(pa.manifest.ydoc).keys()];
    expect(ids).toHaveLength(1);
    expect(ids[0]).toMatch(/^f-[0-9a-f]+$/);
    expect(nodeText(B.fs.get(`${B.folder}/old.mind`))).toBe('옛 맵');
  }, 30_000);

  it('(m) 소유자 쪽이 정제하지 않은 내용(리마인더 신원·위험한 이미지 경로)을 보내도 참가자가 받는 쪽에서 다시 정제해 쓴다', async () => {
    const room = await newRoom();
    // 정제 없이 발행하는 원시 소유자 클라이언트(오래된 버전·조작된 클라이언트를 흉내)
    const session = createShareSession({ roomId: room.roomId, wsUrl: relay.wsUrl, getToken: async () => room.owner.token });
    const manifest = session.openDoc(MANIFEST_KEY);
    const evil = session.openDoc(fileKey('raw-map'));
    const evilBoard = session.openDoc(fileKey('raw-board'));
    const board = JSON.parse(boardText('raw-board', sticky('s', '보드'))) as { elements: Record<string, unknown>; order: string[] };
    board.elements.img = { id: 'img', kind: 'image', x: 0, y: 0, width: 10, height: 10, src: '../../../../etc/passwd' };
    board.order.push('img');
    session.connect();
    cleanups.push(async () => session.destroy());
    await manifest.whenSynced();
    await evil.whenSynced();
    await evilBoard.whenSynced();
    evil.ydoc.transact(() => {
      const m = evil.ydoc.getMap(FILE_MAP_NAME);
      m.set('content', REMINDER_MAP);
      m.set('rev', 1);
      m.set('kind', 'map');
    });
    evilBoard.ydoc.transact(() => {
      const m = evilBoard.ydoc.getMap(FILE_MAP_NAME);
      m.set('content', JSON.stringify(board));
      m.set('rev', 1);
      m.set('kind', 'board');
    });
    upsertManifestFileEntry(manifest.ydoc, 'raw-map', { path: 'raw.mind', kind: 'map', title: 'raw' });
    upsertManifestFileEntry(manifest.ydoc, 'raw-board', { path: 'raw.board', kind: 'board', title: 'raw' });
    // 서버가 세 문서의 변경을 모두 받을 때까지(양성 신호) — 그래야 뒤에 참가하는 B가 내용을 받는다
    await until(
      () => manifest.provider.unsyncedChanges === 0 && evil.provider.unsyncedChanges === 0 && evilBoard.provider.unsyncedChanges === 0,
      '서버가 변경을 수신',
    );

    const B = device('B');
    await startPeer(B, room, await addGuest(room, 'Bea'), 'participant');
    await until(() => B.fs.has(`${B.folder}/raw.mind`) && B.fs.has(`${B.folder}/raw.board`), '미러링');
    const written = B.fs.get(`${B.folder}/raw.mind`)!;
    expect(written).not.toContain('owner-only-reminder-id');
    expect(written).not.toContain('reminderOn');
    expect(nodeText(written)).toBe('계획');
    const wb = JSON.parse(B.fs.get(`${B.folder}/raw.board`)!) as { elements: Record<string, { src?: string }> };
    expect(wb.elements.img.src).toBe('');
  }, 30_000);
});
