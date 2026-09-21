import { describe, expect, it } from 'vitest';
import type { Comment } from '../types';
import { BASELINE_SLACK_MS, decideBaseline, isRelevantToSelf, shouldNotify, type NotifyContext } from './commentRules';

const OWNER = 'owner-participant';
const ALICE = 'alice-participant';
const BOB = 'bob-participant';
const CAROL = 'carol-participant';

let seq = 0;
const c = (authorId: string, over: Partial<Comment> = {}): Comment => ({
  id: `c${++seq}`,
  anchor: { kind: 'map', fileId: 'file-1', targetId: 'n1' },
  authorId,
  authorName: authorId.split('-')[0],
  text: '내용',
  createdAt: 10_000,
  ...over,
});

const ctx = (self: { participantId: string; role: 'owner' | 'participant' }, comments: Comment[], baselineAt = 0): NotifyContext => ({ self, comments, baselineAt });

describe('shouldNotify — who gets notified', () => {
  it('the room owner is notified of anyone else’s comment on any file/note', () => {
    const n1 = c(BOB);
    const n2 = c(BOB, { anchor: { kind: 'note', noteId: 'note-1' } });
    const b = c(BOB, { anchor: { kind: 'board', fileId: 'file-2', targetId: 's1' } });
    for (const x of [n1, n2, b]) expect(shouldNotify(x, ctx({ participantId: OWNER, role: 'owner' }, [x]))).toBe(true);
  });

  it('never notifies about my own comment (also for the owner)', () => {
    const mine = c(OWNER);
    expect(shouldNotify(mine, ctx({ participantId: OWNER, role: 'owner' }, [mine]))).toBe(false);
    const mineP = c(ALICE);
    expect(shouldNotify(mineP, ctx({ participantId: ALICE, role: 'participant' }, [mineP]))).toBe(false);
  });

  it('a participant is notified only when they already took part in the same anchor thread', () => {
    const first = c(ALICE, { createdAt: 1000 });
    const reply = c(BOB, { createdAt: 2000 });
    expect(shouldNotify(reply, ctx({ participantId: ALICE, role: 'participant' }, [first, reply]))).toBe(true);
    // Carol never commented there → no notification (the comment still shows in the list/chip)
    expect(shouldNotify(reply, ctx({ participantId: CAROL, role: 'participant' }, [first, reply]))).toBe(false);
  });

  it('thread membership is per anchor: commenting on node A does not subscribe me to node B', () => {
    const mineOnA = c(ALICE, { anchor: { kind: 'map', fileId: 'file-1', targetId: 'A' } });
    const bobOnB = c(BOB, { anchor: { kind: 'map', fileId: 'file-1', targetId: 'B' } });
    expect(shouldNotify(bobOnB, ctx({ participantId: ALICE, role: 'participant' }, [mineOnA, bobOnB]))).toBe(false);
    const bobOnA = c(BOB, { anchor: { kind: 'map', fileId: 'file-1', targetId: 'A' } });
    expect(shouldNotify(bobOnA, ctx({ participantId: ALICE, role: 'participant' }, [mineOnA, bobOnA]))).toBe(true);
  });

  it('a note thread includes its participants (whole-note anchor)', () => {
    const mine = c(ALICE, { anchor: { kind: 'note', noteId: 'n' } });
    const other = c(BOB, { anchor: { kind: 'note', noteId: 'n' } });
    expect(shouldNotify(other, ctx({ participantId: ALICE, role: 'participant' }, [mine, other]))).toBe(true);
    expect(shouldNotify(other, ctx({ participantId: CAROL, role: 'participant' }, [mine, other]))).toBe(false);
  });

  it('a reply to my comment notifies me (via parentId) even if the anchor differs', () => {
    const parent = c(ALICE, { anchor: { kind: 'map', fileId: 'file-1', targetId: 'A' } });
    const reply = c(BOB, { parentId: parent.id, anchor: { kind: 'map', fileId: 'file-1', targetId: 'ELSEWHERE' } });
    expect(isRelevantToSelf(reply, ctx({ participantId: ALICE, role: 'participant' }, [parent, reply]))).toBe(true);
  });

  it('my own deleted comment no longer subscribes me to the thread', () => {
    const mineGone = c(ALICE, { deleted: true, text: '' });
    const other = c(BOB);
    expect(shouldNotify(other, ctx({ participantId: ALICE, role: 'participant' }, [mineGone, other]))).toBe(false);
  });

  it('a deleted comment is never a notification', () => {
    const gone = c(BOB, { deleted: true, text: '' });
    expect(shouldNotify(gone, ctx({ participantId: OWNER, role: 'owner' }, [gone]))).toBe(false);
  });
});

describe('shouldNotify — baseline (no flood of past comments)', () => {
  const owner = { participantId: OWNER, role: 'owner' as const };
  it('ignores comments written long before this device started knowing the room', () => {
    const old = c(BOB, { createdAt: 1_000_000 });
    expect(shouldNotify(old, ctx(owner, [old], 1_000_000 + BASELINE_SLACK_MS + 1))).toBe(false);
  });
  it('keeps comments after the baseline, and tolerates small clock skew before it', () => {
    const fresh = c(BOB, { createdAt: 5_000_000 });
    expect(shouldNotify(fresh, ctx(owner, [fresh], 5_000_000))).toBe(true);
    const skewed = c(BOB, { createdAt: 5_000_000 - BASELINE_SLACK_MS + 1 });
    expect(shouldNotify(skewed, ctx(owner, [skewed], 5_000_000))).toBe(true);
  });
});

describe('decideBaseline', () => {
  it('uses the stored baseline when there is one', () => {
    expect(decideBaseline(123, false, 999)).toBe(123);
    expect(decideBaseline(0, false, 999)).toBe(0);
  });
  it('a brand-new device (no sidecar) starts knowing the room from now', () => {
    expect(decideBaseline(undefined, false, 999)).toBe(999);
  });
  it('a device that already had a sidecar treats everything not in it as new', () => {
    expect(decideBaseline(undefined, true, 999)).toBe(0);
  });
});
