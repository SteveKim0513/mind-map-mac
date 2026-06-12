import { describe, it, expect } from 'vitest';
import {
  dailyTotals, currentStreak, summary, perNode, nodeStat, sanitizeDuration, fmtDuration, isCounted,
  focusDaysInWindow,
} from './aggregate';
import type { FocusSession } from '../types';

const DAY = 86_400_000;
// a session starting `daysAgo` before `now`, lasting `min` minutes, on node `n` (map m1)
function S(now: number, daysAgo: number, min: number, n: string, ancestors: string[] = []): FocusSession {
  const start = now - daysAgo * DAY;
  return {
    sessionId: `${n}-${daysAgo}-${min}-${Math.random()}`,
    link: { mapId: 'm1', nodeId: n, nodeText: n },
    ancestorIds: ancestors,
    ancestorTexts: ancestors,
    start,
    end: start + min * 60_000,
    durationSec: min * 60,
  };
}

const NOW = new Date('2026-06-12T15:00:00').getTime();

describe('focus aggregate', () => {
  it('isCounted ignores running and zero sessions', () => {
    expect(isCounted({ ...S(NOW, 0, 10, 'a'), end: null, durationSec: 0 })).toBe(false);
    expect(isCounted(S(NOW, 0, 10, 'a'))).toBe(true);
  });

  it('sanitizeDuration flags an absurdly long (slept) session', () => {
    const start = NOW;
    expect(sanitizeDuration(start, start + 30 * 60_000).suspect).toBe(false);
    expect(sanitizeDuration(start, start + 18 * 3600_000).suspect).toBe(true);
  });

  it('dailyTotals buckets by start day', () => {
    const t = dailyTotals([S(NOW, 0, 30, 'a'), S(NOW, 0, 15, 'b'), S(NOW, 1, 20, 'a')]);
    expect(t.get('2026-06-12')).toBe(45 * 60);
    expect(t.get('2026-06-11')).toBe(20 * 60);
  });

  it('summary: today / week / streak', () => {
    const s = summary([S(NOW, 0, 30, 'a'), S(NOW, 0, 10, 'a'), S(NOW, 3, 60, 'b')], NOW);
    expect(s.todaySec).toBe(40 * 60);
    expect(s.countToday).toBe(2);
    expect(s.weekSec).toBe((40 + 60) * 60);
  });

  it('streak counts consecutive qualifying days and tolerates one gap (grace)', () => {
    // today, yesterday qualify; 2-days-ago is a gap; 3-days-ago qualifies → grace bridges the gap
    const sessions = [S(NOW, 0, 10, 'a'), S(NOW, 1, 10, 'a'), S(NOW, 3, 10, 'a')];
    expect(currentStreak(sessions, NOW)).toBe(3); // today,-1 then grace over -2, then -3
  });

  it('streak breaks after two consecutive missed days', () => {
    const sessions = [S(NOW, 0, 10, 'a'), S(NOW, 3, 10, 'a')]; // gap of -1 and -2
    expect(currentStreak(sessions, NOW)).toBe(1);
  });

  it('short sessions (<5m) do not count toward streak', () => {
    expect(currentStreak([S(NOW, 0, 2, 'a')], NOW)).toBe(0);
    expect(currentStreak([S(NOW, 0, 6, 'a')], NOW)).toBe(1);
  });

  it('focusDaysInWindow counts distinct qualifying days in the window only', () => {
    // today, -2 (two distinct days), -3 (a 2nd session on the same -3 day → still 1)
    const sessions = [S(NOW, 0, 30, 'a'), S(NOW, 2, 10, 'a'), S(NOW, 3, 10, 'a'), S(NOW, 3, 10, 'b')];
    expect(focusDaysInWindow(sessions, NOW, 7)).toBe(3); // 0, -2, -3
    expect(focusDaysInWindow(sessions, NOW, 3)).toBe(2); // window = today,-1,-2 → 0 and -2
    expect(focusDaysInWindow([S(NOW, 0, 2, 'a')], NOW, 7)).toBe(0); // <5m doesn't qualify
    expect(focusDaysInWindow([S(NOW, 30, 30, 'a')], NOW, 7)).toBe(0); // outside window
  });

  it('perNode rolls subtree time up the ancestor chain', () => {
    // session on leaf "login" whose ancestors are root "auth"
    const sessions = [S(NOW, 0, 30, 'login', ['auth']), S(NOW, 0, 20, 'login', ['auth'])];
    const agg = perNode(sessions);
    expect(nodeStat(agg, 'm1', 'login')).toEqual({ rolledSec: 50 * 60, sessions: 2 });
    // "auth" did no direct session but rolls up both children's time
    expect(nodeStat(agg, 'm1', 'auth')).toEqual({ rolledSec: 50 * 60, sessions: 0 });
  });

  it('a live resolver re-attributes time when a node has moved (snapshot ignored)', () => {
    // saved snapshot says ancestor "auth", but the node has since moved under "billing"
    const sessions = [S(NOW, 0, 30, 'login', ['auth'])];
    const live = (_m: string, nodeId: string) =>
      nodeId === 'login' ? { selfText: 'login', ancestors: [{ id: 'billing', text: '결제' }] } : null;
    const agg = perNode(sessions, live);
    expect(nodeStat(agg, 'm1', 'billing')?.rolledSec).toBe(30 * 60); // new parent gets it
    expect(nodeStat(agg, 'm1', 'auth')).toBeNull(); // old parent no longer credited
  });

  it('fmtDuration', () => {
    expect(fmtDuration(45)).toBe('45s');
    expect(fmtDuration(32 * 60)).toBe('32m');
    expect(fmtDuration(2 * 3600 + 15 * 60)).toBe('2h 15m');
    expect(fmtDuration(3 * 3600)).toBe('3h');
  });
});
