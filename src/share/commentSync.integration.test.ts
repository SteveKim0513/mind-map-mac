// @vitest-environment node
// 코멘트 동기화·알림 통합 테스트 — 실제 릴레이(server/dist/relay.js, 포트 0·메모리 DB) + 실제 HocuspocusProvider +
// 메모리 사이드카(가짜 IPC). 테스트마다 자체 릴레이를 띄워 병렬 안전하다(fileReplica.integration.test.ts와 같은 방식).
//
// 사전 조건: `npm --prefix server run build`로 server/dist/relay.js를 만들어 둘 것.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { CommentAnchor, NotificationItem, ShareRole } from '../types';
import { COMMENTS_KEY } from './docKeys';
import { createCommentSync, readComments, type CommentSync } from './commentSync';
import { memSink } from './commentTestKit';
import { until } from './replicaTestKit';
import { attachSidecarPersistence, readSidecar } from './sidecar';
import { createShareSession, type ShareSession } from './shareClient';
import { makeFakeShareApi } from './testFakes';

const RELAY_ENTRY = resolve(process.cwd(), 'server/dist/relay.js');

interface Relay {
  url: string;
  wsUrl: string;
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
  name: string;
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
  return { roomId: r.roomId, owner: { participantId: r.ownerId, token: r.ownerToken, name: 'Owner' } };
}
async function addGuest(room: Room, name: string): Promise<Member> {
  const inv = await call('POST', `/rooms/${room.roomId}/invites`, { token: room.owner.token });
  const j = await call('POST', '/join', { body: { code: inv.inviteCode, displayName: name } });
  return { participantId: j.participantId, token: j.token, name };
}

/** 한 기기의 영속 상태 — 사이드카(가짜 IPC)와 알림 store 대역(기준선·알림)은 앱을 껐다 켜도 남는다. */
interface Device {
  folder: string;
  fake: ReturnType<typeof makeFakeShareApi>;
  mem: ReturnType<typeof memSink>;
}
const device = (name: string): Device => ({ folder: `/ws/${name}/team`, fake: makeFakeShareApi(), mem: memSink() });

interface Peer {
  session: ShareSession;
  sync: CommentSync;
  notified: NotificationItem[];
  hadSidecar: boolean;
  ydoc: ReturnType<ShareSession['openDoc']>['ydoc'];
  stop(): Promise<void>;
}

const NODE: CommentAnchor = { kind: 'map', fileId: 'file-1', targetId: 'n1', label: '루트' };
const OTHER_NODE: CommentAnchor = { kind: 'map', fileId: 'file-1', targetId: 'n2', label: '다른 가지' };

async function startPeer(dev: Device, room: Room, member: Member, role: ShareRole, o: { now?: () => number } = {}): Promise<Peer> {
  const session = createShareSession({ roomId: room.roomId, wsUrl: relay.wsUrl, getToken: async () => member.token });
  const bytes = await readSidecar(dev.fake.api, dev.folder, COMMENTS_KEY);
  const hadSidecar = !!bytes && bytes.byteLength > 0;
  const handle = session.openDoc(COMMENTS_KEY, { initialState: bytes });
  const persist = attachSidecarPersistence(handle.ydoc, { api: dev.fake.api, folderPath: dev.folder, docKey: COMMENTS_KEY, debounceMs: 20 });
  const notified: NotificationItem[] = [];
  const sync = createCommentSync({
    roomId: room.roomId,
    folderName: 'team',
    self: { participantId: member.participantId, displayName: member.name, role },
    ydoc: handle.ydoc,
    hadSidecar,
    sink: dev.mem.sink,
    describeTarget: (a) => `계획 · ${a.label ?? ''}`,
    onNotified: (i) => void notified.push(i),
    now: o.now,
  });
  await sync.start();
  session.connect();
  let stopped = false;
  const peer: Peer = {
    session,
    sync,
    notified,
    hadSidecar,
    ydoc: handle.ydoc,
    async stop() {
      if (stopped) return;
      stopped = true;
      sync.stop();
      await persist.stop();
      session.destroy();
    },
  };
  cleanups.push(() => peer.stop());
  return peer;
}

const commentTexts = (p: Peer) => readComments(p.ydoc).map((c) => c.text);
const add = (p: Peer, anchor: CommentAnchor, text: string, parentId?: string) => {
  const res = p.sync.add(anchor, text, parentId);
  if (!res.ok) throw new Error(`add failed: ${res.error}`);
  return res.comment;
};

describe('comments over a real relay', () => {
  it('propagates a comment and notifies the owner right away; the author is not notified', async () => {
    const room = await newRoom();
    const bobM = await addGuest(room, 'Bob');
    const a = await startPeer(device('a'), room, room.owner, 'owner');
    const b = await startPeer(device('b'), room, bobM, 'participant');

    const c1 = add(b, NODE, '이 노드 일정이 궁금해요');
    await until(() => a.notified.length === 1, 'owner notified');
    expect(a.notified[0]).toMatchObject({ id: c1.id, authorName: 'Bob', preview: '이 노드 일정이 궁금해요', targetLabel: '계획 · 루트', roomId: room.roomId, read: false });
    expect(commentTexts(a)).toEqual(['이 노드 일정이 궁금해요']);
    expect(b.notified).toHaveLength(0);
  });

  it('a reply notifies the thread participant; an unrelated participant gets no notification but still sees the comments', async () => {
    const room = await newRoom();
    const bobM = await addGuest(room, 'Bob');
    const carolM = await addGuest(room, 'Carol');
    const a = await startPeer(device('a'), room, room.owner, 'owner');
    const b = await startPeer(device('b'), room, bobM, 'participant');
    const c = await startPeer(device('c'), room, carolM, 'participant');

    const first = add(b, NODE, '첫 코멘트');
    await until(() => a.notified.length === 1, 'owner notified of the first comment');
    add(a, NODE, '소유자의 답글', first.id);
    await until(() => b.notified.length === 1, 'bob (thread participant) notified of the reply');
    expect(b.notified[0].authorName).toBe('Owner');
    // carol saw both comments in her list ...
    await until(() => commentTexts(c).length === 2, 'carol has both comments');
    // ... but was not notified of either (she never took part in the thread and is not the owner)
    expect(c.notified).toHaveLength(0);
    // a comment on a different node by carol does not subscribe bob/carol to each other
    add(c, OTHER_NODE, '다른 가지에 대한 코멘트');
    await until(() => a.notified.length === 2, 'owner notified of carol’s comment');
    expect(b.notified).toHaveLength(1);
  });

  it('a device that joins later (no sidecar) treats the existing comments as already known', async () => {
    const room = await newRoom();
    const bobM = await addGuest(room, 'Bob');
    let bobNow = Date.now() - 60 * 60 * 1000; // Bob's clock: an hour ago while he writes the history
    const b = await startPeer(device('b'), room, bobM, 'participant', { now: () => bobNow });
    for (let i = 0; i < 4; i++) add(b, NODE, `옛 코멘트 ${i}`);

    // the owner's device is brand new (no sidecar, no stored baseline) and syncs everything in one go
    const devA = device('a');
    const a = await startPeer(devA, room, room.owner, 'owner');
    expect(a.hadSidecar).toBe(false);
    await until(() => commentTexts(a).length === 4, 'owner received the history');
    expect(a.notified).toHaveLength(0); // past comments are baseline, not news
    expect(devA.mem.notifications.size).toBe(0);

    // ... and a comment made after that does notify
    bobNow = Date.now();
    add(b, NODE, '방금 남긴 코멘트');
    await until(() => a.notified.length === 1, 'owner notified of a fresh comment');
    expect(a.notified[0].preview).toBe('방금 남긴 코멘트');
  });

  it('a device with a sidecar that was offline is notified of what it missed — once, and never again after another restart', async () => {
    const room = await newRoom();
    const bobM = await addGuest(room, 'Bob');
    const devA = device('a');
    let a = await startPeer(devA, room, room.owner, 'owner');
    const b = await startPeer(device('b'), room, bobM, 'participant');

    add(b, NODE, '온라인일 때 받은 코멘트');
    await until(() => a.notified.length === 1, 'first notification while online');
    const firstId = [...devA.mem.notifications.keys()][0];

    // the owner quits (sidecar flushed), and Bob keeps commenting while the owner is offline
    await a.stop();
    const missed1 = add(b, NODE, '오프라인 중 코멘트 1');
    const missed2 = add(b, NODE, '오프라인 중 코멘트 2');

    // owner comes back: sidecar exists → the loaded comment is not re-notified, the two missed ones are
    a = await startPeer(devA, room, room.owner, 'owner');
    expect(a.hadSidecar).toBe(true);
    await until(() => a.notified.length === 2, 'two missed comments notified');
    expect(a.notified.map((n) => n.id).sort()).toEqual([missed1.id, missed2.id].sort());
    expect(devA.mem.notifications.size).toBe(3);
    expect(devA.mem.notifications.has(firstId)).toBe(true);

    // another restart with nothing new: no duplicate notifications (dedupe by comment id + sidecar)
    await a.stop();
    a = await startPeer(devA, room, room.owner, 'owner');
    await until(() => commentTexts(a).length === 3, 'owner has all three comments');
    expect(a.notified).toHaveLength(0);
    expect(devA.mem.notifications.size).toBe(3);
  });

  it('deleting my own comment reaches the other side and retracts its notification', async () => {
    const room = await newRoom();
    const bobM = await addGuest(room, 'Bob');
    const devA = device('a');
    const a = await startPeer(devA, room, room.owner, 'owner');
    const b = await startPeer(device('b'), room, bobM, 'participant');
    const c1 = add(b, NODE, '지울 코멘트');
    await until(() => devA.mem.notifications.has(c1.id), 'notification exists');
    expect(a.sync.remove(c1.id)).toBe(false); // not the owner's comment
    expect(b.sync.remove(c1.id)).toBe(true);
    await until(() => !devA.mem.notifications.has(c1.id), 'notification retracted');
    expect(readComments(a.ydoc)[0]).toMatchObject({ id: c1.id, deleted: true, text: '' });
  });
});
