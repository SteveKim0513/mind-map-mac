import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MAX_COMMENTS_PER_ROOM } from '../io/commentFormat';
import type { CommentAnchor, NotificationItem, ShareRole } from '../types';
import { COMMENTS_MAP_NAME, createCommentSync, readComments, type CommentSync } from './commentSync';
import { memSink } from './commentTestKit';

const ROOM = 'room-abcdef12';
const OWNER = 'owner-participant';
const BOB = 'bob-participant-1';
const CAROL = 'carol-participant';
const NODE: CommentAnchor = { kind: 'map', fileId: 'file-1', targetId: 'n1', label: '루트' };

interface Dev {
  doc: Y.Doc;
  sync: CommentSync;
  mem: ReturnType<typeof memSink>;
  notified: NotificationItem[];
  clock: { t: number };
}

let devSeq = 0;
async function makeDev(
  participantId: string,
  role: ShareRole,
  o: { doc?: Y.Doc; hadSidecar?: boolean; baselines?: Record<string, number>; preNotified?: string[]; clock?: number; stateLost?: boolean } = {},
): Promise<Dev> {
  const doc = o.doc ?? new Y.Doc();
  const mem = memSink({ baselines: o.baselines, preNotified: o.preNotified, stateLost: o.stateLost });
  const notified: NotificationItem[] = [];
  const clock = { t: o.clock ?? 1_000_000 };
  let n = 0;
  const devNo = ++devSeq; // 같은 사람의 두 기기가 같은 id를 만들지 않게
  const sync = createCommentSync({
    roomId: ROOM,
    folderName: '기획',
    self: { participantId, displayName: participantId.split('-')[0], role },
    ydoc: doc,
    hadSidecar: o.hadSidecar ?? false,
    sink: mem.sink,
    describeTarget: (a) => `계획 · ${a.label ?? ''}`,
    onNotified: (i) => void notified.push(i),
    now: () => clock.t,
    newId: () => `${participantId.split('-')[0]}${devNo}-c${++n}`,
  });
  await sync.start();
  return { doc, sync, mem, notified, clock };
}

/** 두 문서를 실시간으로 이어 준다(서버 대역). */
function link(a: Y.Doc, b: Y.Doc): void {
  a.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'link') Y.applyUpdate(b, u, 'link');
  });
  b.on('update', (u: Uint8Array, origin: unknown) => {
    if (origin !== 'link') Y.applyUpdate(a, u, 'link');
  });
}

describe('createCommentSync — write API', () => {
  it('adds a comment, publishes it and starts controls', async () => {
    const a = await makeDev(OWNER, 'owner');
    expect(a.mem.controls()).not.toBeNull();
    const res = a.sync.add(NODE, '  안녕하세요  ');
    expect(res.ok).toBe(true);
    const list = a.mem.lists.at(-1)!;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ authorId: OWNER, text: '안녕하세요', anchor: { kind: 'map', fileId: 'file-1', targetId: 'n1', label: '루트' } });
  });

  it('validates input: empty, too long, bad anchor, unknown parent', async () => {
    const a = await makeDev(OWNER, 'owner');
    expect(a.sync.add(NODE, '   ')).toEqual({ ok: false, error: 'empty' });
    expect(a.sync.add(NODE, 'x'.repeat(2001))).toEqual({ ok: false, error: 'too_long' });
    expect(a.sync.add({ kind: 'map', fileId: '../x' }, 'hi')).toEqual({ ok: false, error: 'invalid_anchor' });
    expect(a.sync.add(NODE, 'hi', 'no-such-parent')).toEqual({ ok: false, error: 'invalid_anchor' });
    expect(readComments(a.doc)).toHaveLength(0);
  });

  it('refuses new comments beyond the per-room cap', async () => {
    const a = await makeDev(OWNER, 'owner');
    a.doc.transact(() => {
      const m = a.doc.getMap<unknown>(COMMENTS_MAP_NAME);
      for (let i = 0; i < MAX_COMMENTS_PER_ROOM; i++) m.set(`x${i}`, { junk: i }); // even junk entries count against the cap
    });
    expect(a.sync.add(NODE, 'one too many')).toEqual({ ok: false, error: 'limit' });
  });

  it('only the author can delete; deletion is a soft delete that blanks the text', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const bob = await makeDev(BOB, 'participant');
    link(owner.doc, bob.doc);
    const res = bob.sync.add(NODE, '내 코멘트');
    if (!res.ok) throw new Error('add failed');
    expect(owner.sync.remove(res.comment.id)).toBe(false); // someone else's
    expect(readComments(bob.doc)[0].deleted).toBeUndefined();
    expect(bob.sync.remove(res.comment.id)).toBe(true);
    const after = readComments(owner.doc)[0];
    expect(after.deleted).toBe(true);
    expect(after.text).toBe('');
    expect(bob.sync.remove(res.comment.id)).toBe(false); // already gone
  });

  it('refuses to work after stop()', async () => {
    const a = await makeDev(OWNER, 'owner');
    a.sync.stop();
    expect(a.mem.controls()).toBeNull();
    expect(a.sync.add(NODE, 'late')).toEqual({ ok: false, error: 'not_ready' });
  });
});

describe('createCommentSync — notifications', () => {
  it('owner is notified immediately when a participant comments (push, no polling)', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const bob = await makeDev(BOB, 'participant');
    link(owner.doc, bob.doc);
    const res = bob.sync.add(NODE, '이 부분이 궁금해요');
    if (!res.ok) throw new Error('add failed');
    expect(owner.notified).toHaveLength(1);
    expect(owner.notified[0]).toMatchObject({
      id: res.comment.id,
      type: 'comment',
      roomId: ROOM,
      folderName: '기획',
      authorName: 'bob',
      preview: '이 부분이 궁금해요',
      targetLabel: '계획 · 루트',
      read: false,
    });
    expect(owner.mem.notifications.has(res.comment.id)).toBe(true);
    expect(bob.notified).toHaveLength(0); // never for my own comment
  });

  it('a reply notifies the earlier thread participants, but not unrelated participants', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const bob = await makeDev(BOB, 'participant');
    const carol = await makeDev(CAROL, 'participant');
    link(owner.doc, bob.doc);
    link(owner.doc, carol.doc);
    link(bob.doc, carol.doc);
    const first = bob.sync.add(NODE, '첫 코멘트');
    if (!first.ok) throw new Error('add failed');
    // carol is a participant who never commented on this node: no notification
    expect(carol.notified).toHaveLength(0);
    // the owner replies → bob (thread participant) is notified; carol still is not
    const reply = owner.sync.add(NODE, '답글이에요', first.comment.id);
    if (!reply.ok) throw new Error('reply failed');
    expect(bob.notified.map((n) => n.id)).toEqual([reply.comment.id]);
    expect(carol.notified).toHaveLength(0);
    expect(owner.notified.map((n) => n.id)).toEqual([first.comment.id]); // owner: only bob's, not their own reply
    // carol's list still contains both comments (visible in chip/thread)
    expect(readComments(carol.doc)).toHaveLength(2);
  });

  it('a comment by a third party on the same thread reaches every earlier participant', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const bob = await makeDev(BOB, 'participant');
    const carol = await makeDev(CAROL, 'participant');
    link(owner.doc, bob.doc);
    link(owner.doc, carol.doc);
    link(bob.doc, carol.doc);
    bob.sync.add(NODE, '먼저 쓴 사람');
    carol.sync.add(NODE, '나중에 온 사람');
    expect(bob.notified.map((n) => n.authorName)).toEqual(['carol']);
    expect(owner.notified.map((n) => n.authorName)).toEqual(['bob', 'carol']);
  });

  it('dedupes by comment id: replaying the same update never creates a second notification', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const bob = await makeDev(BOB, 'participant');
    link(owner.doc, bob.doc);
    bob.sync.add(NODE, '한 번만');
    expect(owner.notified).toHaveLength(1);
    // the same state applied again (reconnect resync) produces no new change events
    Y.applyUpdate(owner.doc, Y.encodeStateAsUpdate(bob.doc), 'link');
    expect(owner.notified).toHaveLength(1);
    // ...and a device that already has a notification with that id (e.g. from a previous run) skips it
    const owner2 = await makeDev(OWNER, 'owner', { preNotified: [readComments(bob.doc)[0].id] });
    Y.applyUpdate(owner2.doc, Y.encodeStateAsUpdate(bob.doc), 'link');
    expect(owner2.notified).toHaveLength(0);
  });

  it('a brand-new device (no sidecar) treats the comments from its first sync as already known', async () => {
    const bob = await makeDev(BOB, 'participant');
    bob.clock.t = 100_000; // old comments
    for (let i = 0; i < 5; i++) bob.sync.add(NODE, `과거 코멘트 ${i}`);
    // the owner joins much later on a fresh device: baseline = now, first sync brings everything at once
    const owner = await makeDev(OWNER, 'owner', { clock: 5_000_000, hadSidecar: false });
    expect(owner.mem.baselines.get(ROOM)).toBe(5_000_000);
    Y.applyUpdate(owner.doc, Y.encodeStateAsUpdate(bob.doc), 'link');
    expect(owner.notified).toHaveLength(0);
    expect(readComments(owner.doc)).toHaveLength(5); // still visible in the list
    // a comment made after the baseline does notify
    link(owner.doc, bob.doc);
    bob.clock.t = 5_000_100;
    bob.sync.add(NODE, '방금 남긴 코멘트');
    expect(owner.notified.map((n) => n.preview)).toEqual(['방금 남긴 코멘트']);
  });

  it('a device with a sidecar does not re-notify what it loaded, but notifies what arrives after being offline', async () => {
    const owner0 = await makeDev(OWNER, 'owner');
    const bob = await makeDev(BOB, 'participant');
    link(owner0.doc, bob.doc);
    bob.clock.t = 1_000_500;
    bob.sync.add(NODE, '오프라인 전에 받은 코멘트');
    expect(owner0.notified).toHaveLength(1);
    // owner "restarts": doc restored from sidecar bytes, stored baseline retained, notifications persisted
    const sidecar = Y.encodeStateAsUpdate(owner0.doc);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, sidecar, 'share:sidecar');
    const owner1 = await makeDev(OWNER, 'owner', {
      doc: restored,
      hadSidecar: true,
      baselines: { [ROOM]: owner0.mem.baselines.get(ROOM)! },
      preNotified: [...owner0.mem.notifications.keys()],
      clock: 2_000_000,
    });
    expect(owner1.notified).toHaveLength(0); // loaded state is not "new"
    // while owner was offline, bob commented twice; on reconnect the missing updates arrive
    const bobOnly = new Y.Doc();
    Y.applyUpdate(bobOnly, Y.encodeStateAsUpdate(bob.doc));
    link(bobOnly, bob.doc);
    const bob2 = await makeDev(BOB, 'participant', { doc: bobOnly, hadSidecar: true, clock: 1_900_000 });
    bob2.sync.add(NODE, '오프라인 중 코멘트 A');
    bob2.sync.add({ kind: 'note', noteId: 'note-1' }, '오프라인 중 코멘트 B');
    Y.applyUpdate(owner1.doc, Y.encodeStateAsUpdate(bobOnly), 'link');
    expect(owner1.notified.map((n) => n.preview)).toEqual(['오프라인 중 코멘트 A', '오프라인 중 코멘트 B']);
  });

  it('deleting a comment retracts its notification', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const bob = await makeDev(BOB, 'participant');
    link(owner.doc, bob.doc);
    const res = bob.sync.add(NODE, '지울 코멘트');
    if (!res.ok) throw new Error('add failed');
    expect(owner.mem.notifications.has(res.comment.id)).toBe(true);
    bob.sync.remove(res.comment.id);
    expect(owner.mem.notifications.has(res.comment.id)).toBe(false);
  });

  it('a comment that arrives already deleted never notifies', async () => {
    const bob = await makeDev(BOB, 'participant');
    const res = bob.sync.add(NODE, '잠깐 썼다 지움');
    if (!res.ok) throw new Error('add failed');
    bob.sync.remove(res.comment.id);
    const owner = await makeDev(OWNER, 'owner', { clock: 1_000_000 });
    Y.applyUpdate(owner.doc, Y.encodeStateAsUpdate(bob.doc), 'link');
    expect(owner.notified).toHaveLength(0);
  });
});

describe('createCommentSync — hostile remote input', () => {
  it('ignores malformed, oversize or forged entries without throwing and without notifying', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const evil = new Y.Doc();
    link(owner.doc, evil);
    const m = evil.getMap<unknown>(COMMENTS_MAP_NAME);
    evil.transact(() => {
      m.set('junk', 'not an object');
      m.set('c-huge', { id: 'c-huge', anchor: { kind: 'map', fileId: 'f1' }, authorId: BOB, authorName: 'bob', text: 'x'.repeat(50_000), createdAt: 1_000_000 });
      m.set('c-forged', { id: 'someone-else', anchor: { kind: 'map', fileId: 'f1' }, authorId: BOB, authorName: 'bob', text: 'hi', createdAt: 1_000_000 });
      m.set('c-html', { id: 'c-html', anchor: { kind: 'map', fileId: 'f1' }, authorId: BOB, authorName: '<img onerror=1>', text: 'hi', createdAt: 1_000_000 });
      m.set('c-anchor', { id: 'c-anchor', anchor: { kind: 'map', fileId: '../../etc' }, authorId: BOB, authorName: 'bob', text: 'hi', createdAt: 1_000_000 });
      m.set('c-ok', { id: 'c-ok', anchor: { kind: 'map', fileId: 'f1', targetId: 'n9' }, authorId: BOB, authorName: 'bob', text: '<b>진짜</b>', createdAt: 1_000_000 });
    });
    expect(readComments(owner.doc).map((c) => c.id)).toEqual(['c-ok']);
    expect(owner.notified.map((n) => n.id)).toEqual(['c-ok']);
    expect(owner.notified[0].preview).toBe('<b>진짜</b>'); // plain text preview — rendering escapes it
  });
});

describe('createCommentSync — notifications.json 소실(복구) 시 알림 폭주 방지', () => {
  it('기준선이 없고 사이드카가 있어도 저장소가 "복구됨"이면 과거 코멘트를 알림으로 만들지 않고 지금을 기준선으로 저장한다', async () => {
    const bob = await makeDev(BOB, 'participant');
    bob.clock.t = 100_000;
    for (let i = 0; i < 5; i++) bob.sync.add(NODE, `아주 오래된 코멘트 ${i}`);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(bob.doc), 'share:sidecar'); // 사이드카에서 복원
    // 기준선(notifications.json)은 사라졌다 — 이전 규칙(사이드카가 있으면 기준선 0)이라면 5개가 전부 알림이 된다
    const owner = await makeDev(OWNER, 'owner', { doc: restored, hadSidecar: true, stateLost: true, clock: 9_000_000 });
    expect(owner.mem.baselines.get(ROOM)).toBe(9_000_000);
    expect(owner.notified).toHaveLength(0);
    expect(owner.mem.notifications.size).toBe(0);
    // 그 뒤에 달린 코멘트는 정상적으로 알림이 된다
    link(owner.doc, bob.doc);
    bob.clock.t = 9_000_100;
    bob.sync.add(NODE, '복구 뒤 새 코멘트');
    expect(owner.notified.map((n) => n.preview)).toEqual(['복구 뒤 새 코멘트']);
  });

  it('저장소가 정상이면(복구 아님) 예전 규칙 그대로: 사이드카가 있고 기준선이 없으면 0', async () => {
    const bob = await makeDev(BOB, 'participant');
    bob.clock.t = 100_000;
    bob.sync.add(NODE, '오래됐지만 새 것으로 취급');
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(bob.doc), 'share:sidecar');
    const owner = await makeDev(OWNER, 'owner', { doc: restored, hadSidecar: true, stateLost: false, clock: 9_000_000 });
    expect(owner.mem.baselines.get(ROOM)).toBe(0);
  });
});

describe('createCommentSync — 증분 처리·입력 상한', () => {
  it('바뀌지 않은 코멘트는 무관한 이벤트에서 다시 파싱하지 않는다(증분)', async () => {
    const a = await makeDev(BOB, 'participant');
    const first = a.sync.add(NODE, '원래 본문');
    if (!first.ok) throw new Error('add failed');
    // Y 밖에서 저장된 객체를 몰래 바꾼다 — 전체 재파싱이라면 다음 이벤트에서 바뀐 본문이 보인다
    (a.doc.getMap<{ text: string }>(COMMENTS_MAP_NAME).get(first.comment.id) as { text: string }).text = '몰래 바뀜';
    a.sync.add(NODE, '무관한 두 번째');
    expect(a.sync.list().map((c) => c.text)).toEqual(['원래 본문', '무관한 두 번째']);
  });

  it('원격 코멘트가 몰려와도 목록은 항상 정렬돼 있고 상한(5000)을 넘지 않는다', async () => {
    const owner = await makeDev(OWNER, 'owner', { clock: 1 });
    const evil = new Y.Doc();
    link(owner.doc, evil);
    const m = evil.getMap<unknown>(COMMENTS_MAP_NAME);
    for (let i = MAX_COMMENTS_PER_ROOM + 50; i > 0; i--) {
      // 시간 역순으로 하나씩(각각 별도 트랜잭션 = 이벤트 하나씩) — 이분 삽입이 순서를 맞춰야 한다
      m.set(`c${i}`, { id: `c${i}`, anchor: { kind: 'map', fileId: 'f1' }, authorId: BOB, authorName: 'bob', text: `t${i}`, createdAt: 1_000_000 + i });
    }
    const list = owner.sync.list();
    expect(list).toHaveLength(MAX_COMMENTS_PER_ROOM);
    expect(list.map((c) => c.createdAt)).toEqual([...list.map((c) => c.createdAt)].sort((x, y) => x - y));
    expect(list.at(-1)!.id).toBe(`c${MAX_COMMENTS_PER_ROOM + 50}`); // 오래된 것부터 잘린다
    expect(list.map((c) => c.id)).toEqual(readComments(owner.doc).map((c) => c.id)); // 증분 결과 == 전체 재파싱
  });

  it('정크 키가 대량으로 있어도(코멘트 id로 쓸 수 없는 키) 그 뒤의 정상 코멘트는 보인다', async () => {
    const d = new Y.Doc();
    d.transact(() => {
      const m = d.getMap<unknown>(COMMENTS_MAP_NAME);
      for (let i = 0; i < MAX_COMMENTS_PER_ROOM * 6; i++) m.set(`bad key ${i}`, { junk: i });
      m.set('c-good', { id: 'c-good', anchor: { kind: 'map', fileId: 'f1' }, authorId: BOB, authorName: 'bob', text: '정상', createdAt: 1_000_000 });
    });
    expect(readComments(d).map((c) => c.id)).toEqual(['c-good']);
  });

  it('특성화: id 모양은 맞지만 값이 어긋난 항목이 스캔 상한(5000×4)을 넘으면 그 뒤의 정상 코멘트는 보이지 않는다(알려진 한계)', async () => {
    const d = new Y.Doc();
    d.transact(() => {
      const m = d.getMap<unknown>(COMMENTS_MAP_NAME);
      for (let i = 0; i < MAX_COMMENTS_PER_ROOM * 4; i++) m.set(`j${i}`, { junk: i });
      m.set('c-late', { id: 'c-late', anchor: { kind: 'map', fileId: 'f1' }, authorId: BOB, authorName: 'bob', text: '뒤늦은 정상', createdAt: 1_000_000 });
    });
    expect(readComments(d)).toEqual([]);
  });
});

describe('createCommentSync — 작성자 위조·덮어쓰기(특성화: 프로토콜이 막지 못하는 것을 문서화)', () => {
  it('참가자가 다른 사람의 authorId/이름으로 코멘트를 써넣으면 그대로 그 사람의 코멘트로 보인다', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const evil = new Y.Doc();
    link(owner.doc, evil);
    evil.getMap<unknown>(COMMENTS_MAP_NAME).set('c-forge', {
      id: 'c-forge',
      anchor: { kind: 'map', fileId: 'f1' },
      authorId: CAROL,
      authorName: 'carol',
      text: '캐롤이 쓴 것처럼 보임',
      createdAt: 1_000_100,
    });
    expect(owner.sync.list()[0]).toMatchObject({ authorId: CAROL, authorName: 'carol' }); // 서버는 작성자를 검증하지 못한다
  });

  it('다른 사람의 코멘트 id로 덮어쓰면(LWW) 원본이 바뀐다 — "내 코멘트만 삭제"는 UI 규칙일 뿐', async () => {
    const bob = await makeDev(BOB, 'participant');
    const carol = await makeDev(CAROL, 'participant');
    link(bob.doc, carol.doc);
    const res = bob.sync.add(NODE, '밥의 원래 코멘트');
    if (!res.ok) throw new Error('add failed');
    const raw = carol.doc.getMap<unknown>(COMMENTS_MAP_NAME);
    raw.set(res.comment.id, { ...res.comment, text: '캐롤이 바꿔치기' });
    expect(bob.sync.list()[0].text).toBe('캐롤이 바꿔치기');
    // 그래도 API 수준에서는 캐롤이 밥의 코멘트를 지울 수 없다
    expect(carol.sync.remove(res.comment.id)).toBe(false);
  });

  it('위조된 코멘트의 "작성자"인 척 표시된 사람은 그 코멘트를 지울 수 있다(authorId 일치만 본다)', async () => {
    const owner = await makeDev(OWNER, 'owner');
    const evil = new Y.Doc();
    link(owner.doc, evil);
    evil.getMap<unknown>(COMMENTS_MAP_NAME).set('c-forge', {
      id: 'c-forge', anchor: { kind: 'map', fileId: 'f1' }, authorId: OWNER, authorName: 'owner', text: '소유자 명의 위조', createdAt: 1_000_100,
    });
    expect(owner.sync.remove('c-forge')).toBe(true); // 소유자 본인이 위조 항목을 지울 수 있다
    expect(owner.sync.list()[0].deleted).toBe(true);
  });
});
