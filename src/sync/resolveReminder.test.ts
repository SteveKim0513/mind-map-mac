import { describe, it, expect } from 'vitest';
import { resolveReminder, type Base } from './resolveReminder';

const T = 1_000_000; // a fixed "now"
const b = (title: string, due: string | null, done: boolean): Base => ({ title, due, done });

describe('resolveReminder — field-level reminder reconcile', () => {
  it('completing in the app pushes done to the reminder (the reported bug)', () => {
    const base = b('할 일', '2026-07-01T09:00:00', false);
    const cur = b('할 일', '2026-07-01T09:00:00', true); // app: just toggled done
    const remote = b('할 일', '2026-07-01T09:00:00', false); // reminder unchanged
    const r = resolveReminder(base, cur, remote, T + 100, T); // local newer
    expect(r.resolved.done).toBe(true);
    expect(r.needPush).toBe(true);
    expect(r.needPull).toBe(false);
  });

  it('completing in Reminders pulls done into the node', () => {
    const base = b('할 일', null, false);
    const cur = b('할 일', null, false);
    const remote = b('할 일', null, true); // reminder: completed externally
    const r = resolveReminder(base, cur, remote, T, T + 100); // remote newer
    expect(r.resolved.done).toBe(true);
    expect(r.needPull).toBe(true);
    expect(r.needPush).toBe(false);
  });

  it('keeps BOTH edits when app changes done and Reminders changes title', () => {
    const base = b('초안', null, false);
    const cur = b('초안', null, true); // app toggled done
    const remote = b('초안 v2', null, false); // Reminders renamed
    // even if the reminder was touched more recently, done must not be lost
    const r = resolveReminder(base, cur, remote, T, T + 100);
    expect(r.resolved.done).toBe(true); // local edit survives
    expect(r.resolved.title).toBe('초안 v2'); // remote edit survives
    expect(r.needPush).toBe(true); // reminder needs done
    expect(r.needPull).toBe(true); // node needs title
  });

  it('same-field conflict falls back to recency (remote newer → remote wins)', () => {
    const base = b('할 일', null, false);
    const cur = b('내 제목', null, false);
    const remote = b('남의 제목', null, false);
    expect(resolveReminder(base, cur, remote, T, T + 100).resolved.title).toBe('남의 제목');
    expect(resolveReminder(base, cur, remote, T + 100, T).resolved.title).toBe('내 제목');
  });

  it('no change on either side → no push, no pull', () => {
    const base = b('할 일', null, false);
    const r = resolveReminder(base, { ...base }, { ...base }, T, T);
    expect(r.needPush).toBe(false);
    expect(r.needPull).toBe(false);
    expect(r.resolved).toEqual(base);
  });

  it('first contact (no base) adopts the side that changed more recently', () => {
    const cur = b('로컬', '2026-07-01T00:00:00', true);
    const remote = b('리모트', null, false);
    expect(resolveReminder(undefined, cur, remote, T, T + 100).resolved).toEqual(remote);
    expect(resolveReminder(undefined, cur, remote, T + 100, T).resolved).toEqual(cur);
  });

  it('due-date change in the app pushes without touching done', () => {
    const base = b('할 일', null, false);
    const cur = b('할 일', '2026-08-01T10:00:00', false);
    const remote = b('할 일', null, false);
    const r = resolveReminder(base, cur, remote, T + 100, T);
    expect(r.resolved.due).toBe('2026-08-01T10:00:00');
    expect(r.resolved.done).toBe(false);
    expect(r.needPush).toBe(true);
  });
});
