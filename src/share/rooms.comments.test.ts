// @vitest-environment jsdom
// rooms.ts ↔ CommentSync 배선 — commentHooks가 주어지면 방마다 `comments` 문서(사이드카 `_comments`)를 열어 코멘트 동기화를
// 시작하고, 끊으면 정리하는지. 알림 규칙 자체는 commentSync.test.ts가 다룬다.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { useComments } from '../store/commentStore';
import { useShare } from '../store/shareStore';
import type { ShareMarker } from '../types';
import { COMMENTS_KEY } from './docKeys';
import { COMMENTS_MAP_NAME, readComments } from './commentSync';
import { memSink } from './commentTestKit';
import { connectRoom, disconnectRoom, getCommentSync, refreshShareMarkers, stopAllRooms } from './rooms';
import { until } from './replicaTestKit';
import { makeFakeFactories, makeFakeShareApi } from './testFakes';

const R1 = 'room-AAAAAAAA';
const PID = 'pid-AAAAAAAAAAAA';
const BOB = 'bob-BBBBBBBBBBBB';
const FOLDER = '/ws/team';

const marker = (role: ShareMarker['role']): ShareMarker => ({
  v: 1,
  roomId: R1,
  relayUrl: 'https://relay.example.com',
  role,
  participantId: PID,
  folderName: 'team',
  displayName: '지호',
});

function setup(role: ShareMarker['role']) {
  const fake = makeFakeShareApi({ listMarkers: async () => [{ folderPath: FOLDER, marker: marker(role) }] });
  fake.tokens.set(R1, 'tok-1');
  const f = makeFakeFactories();
  const mem = memSink();
  const notified: string[] = [];
  const deps = {
    api: fake.api,
    factories: f.factories,
    sidecarDebounceMs: 10,
    commentHooks: { onNotified: (i: { id: string }) => void notified.push(i.id) },
    commentSink: mem.sink,
    commentOptions: { now: () => 1_000_000 },
  };
  return { fake, ...f, mem, notified, deps };
}

beforeEach(() => {
  useShare.setState({ rooms: {} });
  useComments.setState({ rooms: {}, controls: {} });
});
afterEach(async () => {
  await stopAllRooms();
});

describe('connectRoom + commentHooks', () => {
  it('commentHooks가 없으면 코멘트 문서를 열지 않는다(기존 동작)', async () => {
    const { deps, fake } = setup('participant');
    await refreshShareMarkers(deps);
    await connectRoom(R1, { ...deps, commentHooks: undefined });
    expect(getCommentSync(R1)).toBeUndefined();
    expect(useShare.getState().getDoc(R1, COMMENTS_KEY)).toBeUndefined();
    expect(fake.calls.some((c) => c === 'read:_comments')).toBe(false);
  });

  it('연결하면 comments 문서를 열고(사이드카 _comments 읽기) 쓰기 핸들·기준선을 등록한다', async () => {
    const { deps, fake, mem } = setup('participant');
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    expect(getCommentSync(R1)).toBeDefined();
    expect(useShare.getState().getDoc(R1, COMMENTS_KEY)).toBeDefined();
    expect(fake.calls).toContain('read:_comments');
    expect(mem.controls()).not.toBeNull();
    expect(mem.baselines.get(R1)).toBe(1_000_000); // 사이드카가 없었다 → 처음 참가한 기기: 지금부터
  });

  it('사이드카가 이미 있던 기기는 기준선 0 — 사이드카에 없던 코멘트는 전부 새 것', async () => {
    const { deps, fake, mem } = setup('owner');
    const seed = new Y.Doc();
    seed.getMap(COMMENTS_MAP_NAME).set('old', { id: 'old', anchor: { kind: 'note', noteId: 'n1' }, authorId: BOB, authorName: 'Bob', text: '이전에 받은 코멘트', createdAt: 1000 });
    fake.sidecars.set(`${FOLDER}|_comments`, Y.encodeStateAsUpdate(seed));
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    expect(mem.baselines.get(R1)).toBe(0);
    expect(readComments(useShare.getState().getDoc(R1, COMMENTS_KEY)!.ydoc).map((c) => c.id)).toEqual(['old']);
    expect(mem.lists.at(-1)?.map((c) => c.id)).toEqual(['old']); // 뷰어에서도 보이도록 store에 반영
  });

  it('원격 코멘트가 오면 알림 훅이 불리고, 내가 쓴 코멘트는 사이드카에 저장된다', async () => {
    const { deps, fake, providers, notified } = setup('owner');
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    const doc = useShare.getState().getDoc(R1, COMMENTS_KEY)!.ydoc;
    // 소켓에서 온 것처럼 원격 update를 적용한다
    const remote = new Y.Doc();
    remote.getMap(COMMENTS_MAP_NAME).set('r1', { id: 'r1', anchor: { kind: 'map', fileId: 'file-1', targetId: 'n1' }, authorId: BOB, authorName: 'Bob', text: '원격 코멘트', createdAt: 1_000_500 });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote), 'remote');
    expect(notified).toEqual(['r1']);
    // 내가 쓴 코멘트: 성공하고 사이드카에 남는다
    const res = getCommentSync(R1)!.add({ kind: 'note', noteId: 'n1' }, '내 코멘트');
    expect(res.ok).toBe(true);
    await until(() => fake.calls.includes('write:_comments'), 'comments sidecar written');
    expect(providers.length).toBeGreaterThan(0);
  });

  it('연결을 끊으면 코멘트 동기화가 멈추고 store가 정리된다', async () => {
    const { deps, mem } = setup('participant');
    await refreshShareMarkers(deps);
    await connectRoom(R1, deps);
    useComments.getState().setRoomComments(R1, []);
    await disconnectRoom(R1);
    expect(getCommentSync(R1)).toBeUndefined();
    expect(mem.controls()).toBeNull();
    expect(useComments.getState().rooms[R1]).toBeUndefined();
  });
});
