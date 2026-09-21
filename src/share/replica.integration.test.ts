// @vitest-environment node
// 노트 복제 통합 테스트 — 실제 릴레이(server/dist/relay.js, 포트 0·메모리 DB) + 실제 HocuspocusProvider +
// 메모리 파일시스템을 주입한 ReplicaManager 여러 개(= 여러 기기). 테스트마다 자체 릴레이를 띄워 병렬 안전하다.
//
// 사전 조건: `npm --prefix server run build`로 server/dist/relay.js를 만들어 둘 것(`make setup` 뒤 1회, 서버 소스를 고치면
// 다시). 릴레이 빌드가 없으면 skip이 아니라 명확한 메시지로 실패한다.
//
// node 환경인 이유: vitest의 jsdom 환경은 Event·WebSocket 같은 전역을 jsdom 것으로 바꿔 Node 내장 WebSocket이 깨진다.
// 코덱이 필요로 하는 DOM 전역만 replicaDomSetup이 채운다.
import { assertNodeNetworkGlobals } from './replicaDomSetup'; // 반드시 첫 import — 코덱용 DOM 전역(Node 네트워크 전역은 유지)
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNoteCodec } from '../note/collabCodec';
import { decodeNoteEnvelope } from '../io/noteEnvelope';
import { parseNote, serializeNote } from '../io/noteFormat';
import type { ShareRole } from '../types';
import { MANIFEST_KEY, noteKey } from './docKeys';
import { readManifest } from './manifest';
import { createReplicaManager, type ReplicaHooks, type ReplicaManager } from './replica';
import { MemFs, appendParagraph, count, prependParagraph, until } from './replicaTestKit';
import { attachSidecarPersistence, readSidecar } from './sidecar';
import { createShareSession, type ShareDocHandle, type ShareSession } from './shareClient';
import { makeFakeShareApi, noteSidecarKey } from './testFakes';

// vitest는 저장소 루트에서 실행된다(make verify / npm test).
const RELAY_ENTRY = resolve(process.cwd(), 'server/dist/relay.js');

// 환경 가드: 이 파일은 실제 WebSocket으로 릴레이에 붙는다 — jsdom 환경이 Node의 WebSocket을 jsdom 것으로 바꿔 놨다면 여기서 분명히 실패시킨다
// (그렇지 않으면 "연결이 안 된다"는 엉뚱한 타임아웃 실패로 보인다).
assertNodeNetworkGlobals();

interface Relay {
  port: number;
  url: string;
  wsUrl: string;
  stats(): { documents: number; connections: number };
  close(): Promise<void>;
}

async function startRelay(o: { port?: number; dbPath?: string } = {}): Promise<Relay> {
  if (!existsSync(RELAY_ENTRY)) {
    throw new Error('server/dist/relay.js 가 없습니다 — `npm --prefix server run build` 를 먼저 실행하세요 (릴레이 서버 빌드 산출물이 필요한 통합 테스트입니다).');
  }
  const mod = (await import(/* @vite-ignore */ pathToFileURL(RELAY_ENTRY).href)) as {
    startRelay(o: { port: number; silent: boolean; dbPath?: string }): Promise<Relay>;
  };
  return mod.startRelay({ port: o.port ?? 0, silent: true, dbPath: o.dbPath });
}

// ── 환경 ───────────────────────────────────────────────────────────────────

const codec = createNoteCodec();
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
  fs: MemFs;
  fake: ReturnType<typeof makeFakeShareApi>;
  order: string[];
}
function device(name: string): Device {
  const folder = `/ws/${name}/team`;
  const fs = new MemFs(folder);
  const fake = makeFakeShareApi();
  const order: string[] = [];
  fs.events = order;
  const rawWrite = fake.api.sidecarWrite;
  fake.api.sidecarWrite = async (f: string, id: string, data: Uint8Array) => {
    order.push(`sidecar:${id}`);
    return rawWrite(f, id, data);
  };
  return { name, folder, fs, fake, order };
}

interface Peer {
  dev: Device;
  session: ShareSession;
  manager: ReplicaManager;
  manifest: ShareDocHandle;
  hooks: ReplicaHooks & { messages: string[]; trashed: string[] };
  stop(): Promise<void>;
  noteDoc(id: string): Promise<Y.Doc>;
}

async function startPeer(
  dev: Device,
  room: Room,
  member: Member,
  role: ShareRole,
  o: { maxEagerDocs?: number; writeDebounceMs?: number } = {},
): Promise<Peer> {
  const session = createShareSession({
    roomId: room.roomId,
    wsUrl: relay.wsUrl,
    getToken: async () => member.token,
  });
  // rooms.ts와 같은 순서: manifest 사이드카 복원 → 문서 열기 → 사이드카 자동 저장 → 복제 매니저 시작 → 연결.
  const manifestBytes = await readSidecar(dev.fake.api, dev.folder, MANIFEST_KEY);
  const manifest = session.openDoc(MANIFEST_KEY, { initialState: manifestBytes });
  const persist = attachSidecarPersistence(manifest.ydoc, {
    api: dev.fake.api,
    folderPath: dev.folder,
    docKey: MANIFEST_KEY,
    debounceMs: 20,
  });
  const hooks: Peer['hooks'] = {
    messages: [],
    trashed: [],
    notify: (m) => hooks.messages.push(m),
    onNoteTrashed: (p) => hooks.trashed.push(p),
  };
  const manager = createReplicaManager({
    roomId: room.roomId,
    folderPath: dev.folder,
    role,
    api: dev.fake.api,
    manifest,
    codec,
    fs: dev.fs,
    hooks,
    host: {
      openDoc: async (docKey, initialState) => session.openDoc(docKey, { initialState }),
      closeDoc: async (docKey) => session.closeDoc(docKey),
    },
    writeDebounceMs: o.writeDebounceMs ?? 20,
    maxEagerDocs: o.maxEagerDocs,
    deleteConfirmScans: 1,
    missingRecheckMs: 0,
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
    async noteDoc(id) {
      const h = await manager.ensureNoteDoc(id);
      if (!h) throw new Error(`no doc for ${id}`);
      return h.ydoc;
    },
  };
  cleanups.push(() => peer.stop());
  return peer;
}

// ── 데이터 ─────────────────────────────────────────────────────────────────

const noteFile = (id: string, title: string, body: string) => serializeNote({ id, title, body, links: [] });
const bodyOf = (dev: Device, path: string) => parseNote(dev.fs.get(path) ?? '').body;
const canon = (md: string) => codec.canonical(md);

const NOTES = {
  alpha: { id: 'n-alpha', title: '알파', rel: 'alpha.md', body: '# 알파\n\n알파 첫 문단입니다\n\n알파 둘째 문단입니다' },
  beta: { id: 'n-beta', title: '베타', rel: 'sub/beta.md', body: '# 베타\n\n- 항목 하나\n- 항목 둘\n\n베타 마지막 줄입니다' },
  gamma: { id: 'n-gamma', title: '감마', rel: 'gamma.md', body: '# 감마\n\n- [ ] 할 일 하나\n- [x] 끝난 일\n\n감마 본문입니다' },
};

function seedOwnerFiles(dev: Device): Record<string, string> {
  const originals: Record<string, string> = {};
  for (const n of Object.values(NOTES)) {
    const text = noteFile(n.id, n.title, n.body);
    dev.fs.put(`${dev.folder}/${n.rel}`, text);
    originals[n.rel] = text;
  }
  return originals;
}

/** 소유자 A가 시드하고 참가자 B가 세 노트를 모두 물질화할 때까지 진행한다. */
async function sharedPair() {
  const room = await newRoom();
  const A = device('A');
  const originals = seedOwnerFiles(A);
  const pa = await startPeer(A, room, room.owner, 'owner');
  const B = device('B');
  const pb = await startPeer(B, room, await addGuest(room, 'Bea'), 'participant');
  await until(() => B.fs.paths().length === 3, 'B가 세 노트를 물질화');
  await pa.manager.idle();
  await pb.manager.idle();
  return { room, A, B, pa, pb, originals };
}

/** 두 기기의 manifest와 (열려 있는) 모든 노트 문서가 서버와 동기화될 때까지 기다린다 — 시간 대기 대신 쓰는 양성 신호. */
async function allNotesSynced(...peers: Peer[]): Promise<void> {
  const ids = Object.values(NOTES).map((n) => n.id);
  await until(
    () =>
      peers.every(
        (p) => p.manifest.provider.isSynced === true && ids.every((id) => p.session.getDoc(noteKey(id))?.provider.isSynced === true),
      ),
    '모든 문서가 서버와 동기화',
    20_000,
  );
}

// ── 시나리오 ───────────────────────────────────────────────────────────────

describe('노트 복제 — 실제 릴레이 통합', () => {
  it('(a) 소유자 시드 → 참가자가 폴더 안 상대 경로에 파일로 물질화(내용 동일·중복 없음)', async () => {
    const { A, B, pa, originals } = await sharedPair();
    for (const n of Object.values(NOTES)) {
      const path = `${B.folder}/${n.rel}`;
      expect(B.fs.has(path)).toBe(true);
      const parsed = parseNote(B.fs.get(path)!);
      expect(parsed.id).toBe(n.id);
      expect(parsed.title).toBe(n.title);
      expect(canon(parsed.body)).toBe(canon(n.body));
    }
    expect(B.fs.paths()).toHaveLength(3); // 중복 파일 없음
    // 소유자의 원본 파일은 시드 때 다시 쓰이지 않았다(로드 시점 md 파생 금지)
    for (const n of Object.values(NOTES)) expect(A.fs.get(`${A.folder}/${n.rel}`)).toBe(originals[n.rel]);
    const m = readManifest(pa.manifest.ydoc);
    expect([...m.keys()].sort()).toEqual(['n-alpha', 'n-beta', 'n-gamma']);
    expect(m.get('n-beta')).toMatchObject({ path: 'sub/beta.md', title: '베타', seeded: true });
    // 본문이 두 번 들어가지 않았다
    expect(count(bodyOf(B, `${B.folder}/alpha.md`), '알파 첫 문단입니다')).toBe(1);
  }, 30_000);

  it('(b) 동시 편집 수렴 — 세 기기가 같은 노트를 동시에 고쳐도 모두 같은 내용', async () => {
    const room = await newRoom();
    const A = device('A');
    seedOwnerFiles(A);
    const pa = await startPeer(A, room, room.owner, 'owner');
    const B = device('B');
    const C = device('C');
    const pb = await startPeer(B, room, await addGuest(room, 'Bea'), 'participant');
    const pc = await startPeer(C, room, await addGuest(room, 'Cyd'), 'participant');
    await until(() => B.fs.paths().length === 3 && C.fs.paths().length === 3, '두 참가자가 물질화');
    const [da, db, dc] = await Promise.all([pa.noteDoc('n-alpha'), pb.noteDoc('n-alpha'), pc.noteDoc('n-alpha')]);
    // 동시 편집(서로를 기다리지 않는다)
    appendParagraph(da, 'A의 동시 편집');
    appendParagraph(db, 'B의 동시 편집');
    prependParagraph(dc, 'C의 동시 편집');
    const has3 = (dev: Device) => {
      const b = bodyOf(dev, `${dev.folder}/alpha.md`);
      return ['A의 동시 편집', 'B의 동시 편집', 'C의 동시 편집'].every((s) => b.includes(s));
    };
    await until(() => has3(A) && has3(B) && has3(C), '세 편집이 모든 파일에 반영');
    await Promise.all([pa.manager.idle(), pb.manager.idle(), pc.manager.idle()]);
    const bodies = [A, B, C].map((d) => canon(bodyOf(d, `${d.folder}/alpha.md`)));
    expect(new Set(bodies).size).toBe(1); // 수렴
    for (const s of ['A의 동시 편집', 'B의 동시 편집', 'C의 동시 편집', '알파 첫 문단입니다', '# 알파']) {
      expect(count(bodies[0], s)).toBe(1); // 중복·소실 없음
    }
  }, 30_000);

  it('(c) 오프라인에서 각자 편집한 뒤 재접속하면 병합된다(오프라인 편집은 사이드카로 보존)', async () => {
    const { A, B, pa, pb } = await sharedPair();
    const [da, db] = await Promise.all([pa.noteDoc('n-alpha'), pb.noteDoc('n-alpha')]);
    pb.session.disconnect(); // B 오프라인
    appendParagraph(db, 'B가 오프라인에서 쓴 문단');
    prependParagraph(da, 'A가 온라인에서 쓴 문단');
    await until(() => bodyOf(B, `${B.folder}/alpha.md`).includes('오프라인에서 쓴'), 'B의 오프라인 편집이 로컬 파일·사이드카에 남음');
    expect(bodyOf(B, `${B.folder}/alpha.md`)).not.toContain('A가 온라인에서');
    const env = decodeNoteEnvelope(B.fake.sidecars.get(noteSidecarKey(B.folder, 'n-alpha'))!)!;
    const local = new Y.Doc();
    Y.applyUpdate(local, env.update);
    expect(codec.yDocToMarkdown(local)).toContain('B가 오프라인에서 쓴 문단'); // 사이드카가 오프라인 편집을 보존
    await until(() => bodyOf(A, `${A.folder}/alpha.md`).includes('A가 온라인에서'), 'A의 편집이 A 파일에 반영');

    pb.session.connect(); // 재접속
    const both = (dev: Device) => {
      const b = bodyOf(dev, `${dev.folder}/alpha.md`);
      return b.includes('B가 오프라인에서 쓴 문단') && b.includes('A가 온라인에서 쓴 문단');
    };
    await until(() => both(A) && both(B), '재접속 후 양쪽 병합');
    await Promise.all([pa.manager.idle(), pb.manager.idle()]);
    expect(canon(bodyOf(A, `${A.folder}/alpha.md`))).toBe(canon(bodyOf(B, `${B.folder}/alpha.md`)));
    expect(count(bodyOf(A, `${A.folder}/alpha.md`), 'B가 오프라인에서 쓴 문단')).toBe(1);
    expect(count(bodyOf(A, `${A.folder}/alpha.md`), '알파 첫 문단입니다')).toBe(1);
  }, 40_000);

  it('(d) 모든 접속자가 나가 서버 상태가 폐기돼도 사이드카로 재접속하면 중복 없이 이어진다', async () => {
    const { room, A, B, pa, pb } = await sharedPair();
    appendParagraph(await pa.noteDoc('n-alpha'), '폐기 전에 쓴 문단');
    await until(() => bodyOf(B, `${B.folder}/alpha.md`).includes('폐기 전에 쓴 문단'), '전파');
    await pa.manager.idle();
    await pb.manager.idle();
    await pa.stop();
    await pb.stop();
    await until(() => relay.stats().documents === 0, '서버가 문서 상태를 폐기', 15_000);
    const filesA = new Map(A.fs.paths().map((p) => [p, A.fs.get(p)!]));
    const filesB = new Map(B.fs.paths().map((p) => [p, B.fs.get(p)!]));

    // 서버는 비었다 — 각자 사이드카·파일만으로 다시 접속한다
    const pa2 = await startPeer(A, room, room.owner, 'owner');
    const memberB = await addGuest(room, 'Bea2');
    const pb2 = await startPeer(B, room, memberB, 'participant');
    await allNotesSynced(pa2, pb2); // 양성 신호: 두 기기의 모든 노트 문서가 서버와 동기화됐다 — 중복이 생긴다면 이 동기화로 들어와 md에 나타난다
    await Promise.all([pa2.manager.idle(), pb2.manager.idle()]);
    // 로드 시점에는 md를 다시 쓰지 않는다 — 바이트 그대로
    for (const [p, t] of filesA) expect(A.fs.get(p)).toBe(t);
    for (const [p, t] of filesB) expect(B.fs.get(p)).toBe(t);
    expect(A.fs.paths()).toHaveLength(3);
    expect(B.fs.paths()).toHaveLength(3);
    // 재접속 후 편집이 정상 전파되고 여전히 중복이 없다
    appendParagraph(await pb2.noteDoc('n-alpha'), '재접속 후 문단');
    await until(() => bodyOf(A, `${A.folder}/alpha.md`).includes('재접속 후 문단'), '재접속 후 전파');
    for (const d of [A, B]) {
      const b = bodyOf(d, `${d.folder}/alpha.md`);
      expect(count(b, '알파 첫 문단입니다')).toBe(1);
      expect(count(b, '폐기 전에 쓴 문단')).toBe(1);
      expect(count(b, '# 알파')).toBe(1);
    }
    expect(readManifest(pa2.manifest.ydoc).size).toBe(3);
    expect([...readManifest(pb2.manifest.ydoc).values()].every((e) => e.seeded)).toBe(true);
  }, 60_000);

  it('(d2) 사이드카를 잃어도 manifest의 seeded 마커 때문에 재시드하지 않는다(중복 없음·충돌 사본 없음)', async () => {
    const { room, A, B, pa, pb } = await sharedPair();
    await pa.stop();
    await pb.stop();
    await until(() => relay.stats().documents === 0, '서버가 문서 상태를 폐기', 15_000);
    // B가 alpha 사이드카를 잃었다(파일은 남아 있음)
    B.fake.sidecars.delete(noteSidecarKey(B.folder, 'n-alpha'));
    const pa2 = await startPeer(A, room, room.owner, 'owner');
    const pb2 = await startPeer(B, room, await addGuest(room, 'Bea2'), 'participant');
    await allNotesSynced(pa2, pb2); // 양성 신호: 모든 노트 문서가 동기화됐다
    await Promise.all([pa2.manager.idle(), pb2.manager.idle()]);
    const doc = await pb2.noteDoc('n-alpha');
    // A가 온라인이므로 원격 내용이 내려온다 — 재시드했다면 본문이 두 번 나온다
    await until(() => doc.getXmlFragment('default').length > 0, '원격 내용 수신');
    await pb2.manager.idle();
    expect(count(codec.yDocToMarkdown(doc), '알파 첫 문단입니다')).toBe(1);
    expect(B.fs.paths().filter((p) => p.includes('충돌 사본'))).toEqual([]);
    expect(B.fs.paths()).toHaveLength(3);
  }, 60_000);

  it('(e) 사이드카 없는 신규 참가자는 피어가 온라인일 때만 내용을 받는다', async () => {
    const { room, A, pa, pb } = await sharedPair();
    await pa.stop();
    await pb.stop();
    await until(() => relay.stats().documents === 0, '서버가 문서 상태를 폐기', 15_000);

    const D = device('D'); // 사이드카·파일 없음
    const pd = await startPeer(D, room, await addGuest(room, 'Dan'), 'participant');
    await until(() => pd.manifest.provider.isSynced === true, 'D의 manifest가 서버와 동기화'); // 양성 신호: 서버가 답했다(비어 있다는 답)
    await pd.manager.idle();
    expect(D.fs.paths()).toEqual([]); // 아무도 없으면 받을 게 없다(빈 파일을 만들지도 않는다)
    expect(readManifest(pd.manifest.ydoc).size).toBe(0);

    const pa2 = await startPeer(A, room, room.owner, 'owner'); // 피어 온라인
    await until(() => D.fs.paths().length === 3, '피어가 온라인이 되자 내용 수신', 20_000);
    for (const n of Object.values(NOTES)) {
      expect(canon(bodyOf(D, `${D.folder}/${n.rel}`))).toBe(canon(n.body));
    }
    expect(pa2.manager.stats().attached).toBe(3);
  }, 60_000);

  it('(f) 새 노트 생성·제목 변경·삭제(휴지통)가 전파된다', async () => {
    const { A, B, pa, pb } = await sharedPair();

    // 생성 — A에서 프론트매터 없는 새 파일, B에서도 하나
    A.fs.put(`${A.folder}/delta.md`, '# 델타\n\n델타 본문입니다');
    await pa.manager.scan();
    await until(() => [...B.fs.paths()].some((p) => p.endsWith('/delta.md')), 'A의 새 노트가 B에 나타남');
    const deltaId = parseNote(A.fs.get(`${A.folder}/delta.md`)!).id;
    expect(parseNote(B.fs.get(`${B.folder}/delta.md`)!).id).toBe(deltaId); // A 파일에도 id가 기록됨
    expect(canon(bodyOf(B, `${B.folder}/delta.md`))).toBe(canon('# 델타\n\n델타 본문입니다'));

    B.fs.put(`${B.folder}/mine.md`, noteFile('n-mine', '비 노트', '# 비\n\nB가 만든 노트'));
    await pb.manager.scan();
    await until(() => A.fs.has(`${A.folder}/mine.md`), 'B의 새 노트가 A에 나타남');

    // 제목 변경 — manifest로 전파, 파일명은 그대로
    pa.manager.onLocalTitleChanged(deltaId, '델타 개정판');
    await until(() => parseNote(B.fs.get(`${B.folder}/delta.md`)!).title === '델타 개정판', '제목 전파');
    expect(B.fs.has(`${B.folder}/delta.md`)).toBe(true);

    // 삭제 — A에서 지우면 B는 휴지통으로 옮기고 알린다(영구 삭제 아님)
    A.fs.remove(`${A.folder}/delta.md`);
    await pa.manager.scan();
    await until(() => !B.fs.has(`${B.folder}/delta.md`), 'B에서 사라짐');
    expect(B.fs.trashed.map((t) => t.path)).toContain(`${B.folder}/delta.md`);
    expect(B.fs.trashed.find((t) => t.path.endsWith('delta.md'))!.text).toContain('델타 본문');
    expect(pb.hooks.trashed).toContain(`${B.folder}/delta.md`);
    expect(pb.hooks.messages.some((m) => m.includes('휴지통'))).toBe(true);
    expect(readManifest(pb.manifest.ydoc).has(deltaId)).toBe(false);
  }, 60_000);

  it('(g) 외부 수정: 3-way 흡수는 피어 편집을 보존하고, 대량 교체는 충돌 사본으로 보존한다', async () => {
    const room = await newRoom();
    const A = device('A');
    seedOwnerFiles(A);
    const pa = await startPeer(A, room, room.owner, 'owner');
    const B = device('B');
    // B는 파일 쓰기 디바운스가 길다 — A의 편집이 B의 Y에는 있지만 파일에는 아직 없는 순간을 만든다.
    const pb = await startPeer(B, room, await addGuest(room, 'Bea'), 'participant', { writeDebounceMs: 60_000 });
    await until(() => B.fs.paths().length === 3, 'B 물질화');
    await pa.manager.idle();
    await pb.manager.idle();
    const path = `${B.folder}/alpha.md`;
    const diskBefore = B.fs.get(path)!;

    appendParagraph(await pa.noteDoc('n-alpha'), 'A가 추가한 문단');
    const dbDoc = await pb.noteDoc('n-alpha');
    await until(() => JSON.stringify(dbDoc.getXmlFragment('default').toJSON()).includes('A가 추가한 문단'), 'B의 Y에 A 편집 도착');
    expect(B.fs.get(path)).toBe(diskBefore); // 파일은 아직 옛 상태

    // 외부 에디터가 (A의 편집을 모르는) 파일의 첫 문단을 고침 → 흡수
    B.fs.put(path, diskBefore.replace('알파 첫 문단입니다', '알파 첫 문단을 B가 외부에서 고쳤습니다'));
    expect(await pb.manager.onExternalChange(path)).toBe('absorbed');
    await pb.manager.flush();
    const both = (dev: Device) => {
      const b = bodyOf(dev, `${dev.folder}/alpha.md`);
      return b.includes('알파 첫 문단을 B가 외부에서 고쳤습니다') && b.includes('A가 추가한 문단');
    };
    await until(() => both(A) && both(B), '외부 수정과 피어 편집이 양쪽에 모두 반영');
    for (const d of [A, B]) {
      const b = bodyOf(d, `${d.folder}/alpha.md`);
      expect(count(b, '알파 둘째 문단입니다')).toBe(1);
      expect(count(b, 'A가 추가한 문단')).toBe(1);
      expect(count(b, '# 알파')).toBe(1);
    }

    // 자기 쓰기는 무시
    expect(await pb.manager.onExternalChange(path)).toBe('ignored');

    // 대량 교체 → 충돌 사본 (B는 이제 즉시 쓰도록 flush로 처리)
    B.fs.put(path, noteFile('n-alpha', '알파', '# 전혀 다른 글\n\n원래 노트와 아무 관련 없는 내용을 통째로 붙여 넣었습니다\n\n두번째 단락도 완전히 다릅니다'));
    expect(await pb.manager.onExternalChange(path)).toBe('conflict');
    await pb.manager.idle();
    const copy = `${B.folder}/alpha (충돌 사본).md`;
    expect(B.fs.has(copy)).toBe(true);
    expect(bodyOf(B, copy)).toContain('전혀 다른 글');
    expect(parseNote(B.fs.get(copy)!).id).not.toBe('n-alpha');
    expect(bodyOf(B, path)).toContain('알파 첫 문단을 B가 외부에서 고쳤습니다'); // 원본은 공유 내용으로 복구
    expect(bodyOf(B, path)).not.toContain('전혀 다른 글');
    expect(pb.hooks.messages.some((m) => m.includes('사본'))).toBe(true);
    await until(() => A.fs.has(`${A.folder}/alpha (충돌 사본).md`), '충돌 사본도 새 공유 노트로 전파');
    expect(bodyOf(A, `${A.folder}/alpha.md`)).not.toContain('전혀 다른 글'); // 공유 문서는 오염되지 않았다
  }, 60_000);

  it('로컬 파일이 이미 있는 참가자가 새로 참가해도 중복 없이 원격을 채택한다', async () => {
    const room = await newRoom();
    const A = device('A');
    seedOwnerFiles(A);
    const pa = await startPeer(A, room, room.owner, 'owner');
    // B의 폴더에 같은 id의 파일이 이미 있다(같은 폴더의 복사본) — 참가자는 시드하지 않고 원격 내용을 채택한다
    const B = device('B');
    const copy = noteFile('n-alpha', '알파', NOTES.alpha.body);
    B.fs.put(`${B.folder}/내가 가진 알파.md`, copy);
    const pb = await startPeer(B, room, await addGuest(room, 'Bea'), 'participant');
    await until(() => B.fs.paths().length === 3, '나머지 두 노트 물질화');
    await pa.manager.idle();
    await pb.manager.idle();
    expect(B.fs.has(`${B.folder}/내가 가진 알파.md`)).toBe(true); // 기존 파일을 그대로 사용
    expect(B.fs.has(`${B.folder}/alpha.md`)).toBe(false); // 같은 노트를 또 만들지 않는다
    expect(B.fs.get(`${B.folder}/내가 가진 알파.md`)).toBe(copy); // 내용이 같으면 다시 쓰지 않는다
    expect(count((await pb.noteDoc('n-alpha')).getXmlFragment('default').toJSON().toString(), '알파 첫 문단입니다')).toBeLessThanOrEqual(1);
  }, 40_000);

  it('상한(maxEagerDocs)을 넘는 참가자는 일부 노트만 상시 복제하고 나머지는 열 때 붙인다', async () => {
    const room = await newRoom();
    const A = device('A');
    seedOwnerFiles(A);
    await startPeer(A, room, room.owner, 'owner');
    const B = device('B');
    const pb = await startPeer(B, room, await addGuest(room, 'Bea'), 'participant', { maxEagerDocs: 2 });
    await until(() => B.fs.paths().length === 2, '상한만큼만 물질화');
    await until(() => pb.manager.stats().overLimit === 1, '상한을 넘은 노트를 알아챔'); // 양성 신호
    expect(B.fs.paths()).toHaveLength(2);
    expect(pb.manager.stats()).toMatchObject({ attached: 2, overLimit: 1 });
    const missingId = Object.values(NOTES).map((n) => n.id).find((id) => !pb.manager.pathForNote(id))!;
    expect(await pb.manager.ensureNoteDoc(missingId)).not.toBeNull();
    await until(() => B.fs.paths().length === 3, '열린 노트는 물질화');
  }, 40_000);
  it('(f) 릴레이가 재시작돼도(같은 포트·같은 DB) 자동으로 재접속해 서버가 내려간 동안의 양쪽 편집이 중복 없이 수렴한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'relay-restart-'));
    const dbPath = join(dir, 'relay.db'); // 메타데이터(방·참가자·토큰 해시)는 DB에 남고 문서 상태만 사라진다 — 운영과 같다
    const original = relay;
    const first = await startRelay({ dbPath });
    let current = first;
    relay = first;
    try {
      const { A, B, pa, pb } = await sharedPair();
      const [da, db] = await Promise.all([pa.noteDoc('n-alpha'), pb.noteDoc('n-alpha')]);
      appendParagraph(da, '재시작 전에 쓴 문단');
      await until(() => bodyOf(B, `${B.folder}/alpha.md`).includes('재시작 전에 쓴 문단'), '재시작 전 전파');
      await Promise.all([pa.manager.idle(), pb.manager.idle()]);

      await first.close(); // 릴레이 다운 — 서버의 문서 상태는 폐기된다
      await until(() => pa.session.status !== 'connected' && pb.session.status !== 'connected', '양쪽이 연결 끊김을 알아챔', 20_000);
      appendParagraph(da, 'A가 서버 다운 중에 쓴 문단');
      appendParagraph(db, 'B가 서버 다운 중에 쓴 문단');
      // 오프라인 편집도 각자 파일·사이드카에 남는다
      await until(() => bodyOf(A, `${A.folder}/alpha.md`).includes('A가 서버 다운 중에') && bodyOf(B, `${B.folder}/alpha.md`).includes('B가 서버 다운 중에'), '오프라인 편집이 로컬 파일에 반영');

      const second = await startRelay({ port: first.port, dbPath }); // 같은 포트·같은 DB로 재시작
      current = second;
      relay = second;
      const both = (dev: Device) => {
        const b = bodyOf(dev, `${dev.folder}/alpha.md`);
        return b.includes('A가 서버 다운 중에 쓴 문단') && b.includes('B가 서버 다운 중에 쓴 문단');
      };
      await until(() => both(A) && both(B), '릴레이 재시작 뒤 양쪽 병합', 60_000);
      await Promise.all([pa.manager.idle(), pb.manager.idle()]);
      expect(canon(bodyOf(A, `${A.folder}/alpha.md`))).toBe(canon(bodyOf(B, `${B.folder}/alpha.md`)));
      for (const d of [A, B]) {
        const b = bodyOf(d, `${d.folder}/alpha.md`);
        for (const t of ['재시작 전에 쓴 문단', 'A가 서버 다운 중에 쓴 문단', 'B가 서버 다운 중에 쓴 문단', '알파 첫 문단입니다', '# 알파']) expect(count(b, t), t).toBe(1);
      }
      // 접근 해제로 오인하지 않았다(토큰은 DB에 남아 있어 그대로 유효하다)
      expect(pa.session.status).not.toBe('denied');
      expect(pb.session.status).not.toBe('denied');
      expect(A.fs.paths()).toHaveLength(3);
      expect(B.fs.paths()).toHaveLength(3);
    } finally {
      relay = original;
      await current.close().catch(() => undefined);
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('(g) 소유자가 manifest 사이드카만 잃고 참가자보다 먼저 접속해도 재시드가 중복을 만들지 않는다 — 노트 사이드카를 재사용한다', async () => {
    const { room, A, B, pa, pb } = await sharedPair();
    appendParagraph(await pa.noteDoc('n-alpha'), '잃기 전에 쓴 문단');
    await until(() => bodyOf(B, `${B.folder}/alpha.md`).includes('잃기 전에 쓴 문단'), '전파');
    await Promise.all([pa.manager.idle(), pb.manager.idle()]);
    await pa.stop();
    await pb.stop();
    await until(() => relay.stats().documents === 0, '서버가 문서 상태를 폐기', 15_000);
    A.fake.sidecars.delete(`${A.folder}|_manifest`); // 소유자가 manifest 사이드카를 잃었다(노트 사이드카·파일은 남음)

    const pa2 = await startPeer(A, room, room.owner, 'owner'); // 참가자는 아직 오프라인 — 소유자가 먼저 접속한다
    await until(() => readManifest(pa2.manifest.ydoc).size === 3, '소유자가 manifest를 다시 채움');
    await pa2.manager.idle();
    const pb2 = await startPeer(B, room, await addGuest(room, 'Bea2'), 'participant');
    await allNotesSynced(pa2, pb2);
    await Promise.all([pa2.manager.idle(), pb2.manager.idle()]);
    for (const d of [A, B]) {
      const b = bodyOf(d, `${d.folder}/alpha.md`);
      expect(count(b, '알파 첫 문단입니다'), `${d.name} 본문 중복 없음`).toBe(1);
      expect(count(b, '잃기 전에 쓴 문단'), `${d.name} 편집 중복 없음`).toBe(1);
      expect(count(b, '# 알파'), `${d.name} 제목 중복 없음`).toBe(1);
      expect(d.fs.paths()).toHaveLength(3);
      expect(d.fs.paths().filter((p) => p.includes('충돌 사본'))).toEqual([]);
    }
    expect(readManifest(pa2.manifest.ydoc).size).toBe(3);
    expect(canon(codec.yDocToMarkdown(await pa2.noteDoc('n-alpha')))).toBe(canon(codec.yDocToMarkdown(await pb2.noteDoc('n-alpha'))));
  }, 60_000);
});
