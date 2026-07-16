import { describe, it, expect } from 'vitest';
import {
  IDLE_THRESHOLD_SEC,
  idleSeconds,
  initIdle,
  foldActivity,
  idleSoFarSec,
  realWorkSec,
  sessionIdleSec,
  type IdleState,
} from './idle';
import type { FocusSession } from '../types';

const MIN = 60_000; // 1 minute in ms
const T0 = 1_700_000_000_000; // an arbitrary fixed epoch — no wall-clock/Date.now, no sleep

describe('idleSeconds (batch)', () => {
  it('short session with no activity is not idle (under threshold)', () => {
    expect(idleSeconds([], T0, T0 + 5 * MIN)).toBe(0);
  });

  it('a silent session longer than the threshold is fully idle', () => {
    expect(idleSeconds([], T0, T0 + 25 * MIN)).toBe(25 * 60);
  });

  it('steady activity under the threshold keeps idle at zero', () => {
    const activity = [T0 + 5 * MIN, T0 + 9 * MIN, T0 + 12 * MIN]; // gaps of 5/4/3 min
    expect(idleSeconds(activity, T0, T0 + 15 * MIN)).toBe(0);
  });

  it('counts a single mid-session gap that reaches the threshold, in full', () => {
    // work, then away 20 min, then work again
    const activity = [T0 + 2 * MIN, T0 + 22 * MIN];
    expect(idleSeconds(activity, T0, T0 + 25 * MIN)).toBe(20 * 60);
  });

  it('sums multiple qualifying gaps', () => {
    // gap1: 2→14 (12m), active bridge at 15, gap2: 15→30 (15m)
    const activity = [T0 + 2 * MIN, T0 + 14 * MIN, T0 + 15 * MIN, T0 + 30 * MIN];
    expect(idleSeconds(activity, T0, T0 + 32 * MIN)).toBe((12 + 15) * 60);
  });

  it('counts the pre-first-activity stretch (start → first ping)', () => {
    // walked away right after starting, came back at 15m, then worked
    const activity = [T0 + 15 * MIN, T0 + 18 * MIN];
    expect(idleSeconds(activity, T0, T0 + 20 * MIN)).toBe(15 * 60);
  });

  it('counts the trailing stretch (last ping → end)', () => {
    // stopped touching at 3m, hit "end" 15m later
    const activity = [T0 + 3 * MIN];
    expect(idleSeconds(activity, T0, T0 + 18 * MIN)).toBe(15 * 60);
  });

  it('threshold is inclusive: a gap exactly at the threshold counts', () => {
    expect(idleSeconds([], T0, T0 + IDLE_THRESHOLD_SEC * 1000)).toBe(IDLE_THRESHOLD_SEC);
  });

  it('respects a custom threshold', () => {
    // 3-min gap: idle under a 2-min threshold, active under the default 10-min one
    expect(idleSeconds([], T0, T0 + 3 * MIN, 120)).toBe(3 * 60);
    expect(idleSeconds([], T0, T0 + 3 * MIN)).toBe(0);
  });

  it('ignores activity outside (start, end) and is order-independent', () => {
    const unsorted = [T0 + 22 * MIN, T0 - MIN /* before start */, T0 + 2 * MIN, T0 + 99 * MIN /* after end */];
    expect(idleSeconds(unsorted, T0, T0 + 25 * MIN)).toBe(20 * 60);
  });

  it('returns 0 for a non-positive span', () => {
    expect(idleSeconds([], T0, T0)).toBe(0);
    expect(idleSeconds([], T0, T0 - MIN)).toBe(0);
  });
});

describe('streaming reducer matches the batch function', () => {
  // Folding a session's sorted, in-range activity and finalizing at `end` must
  // yield the identical total as idleSeconds — the tracker and the batch agree.
  const cases: { activity: number[]; end: number }[] = [
    { activity: [], end: T0 + 25 * MIN },
    { activity: [T0 + 5 * MIN, T0 + 9 * MIN, T0 + 12 * MIN], end: T0 + 15 * MIN },
    { activity: [T0 + 2 * MIN, T0 + 22 * MIN], end: T0 + 25 * MIN },
    { activity: [T0 + 2 * MIN, T0 + 14 * MIN, T0 + 15 * MIN, T0 + 30 * MIN], end: T0 + 32 * MIN },
    { activity: [T0 + 15 * MIN, T0 + 18 * MIN], end: T0 + 20 * MIN },
  ];

  it.each(cases)('agrees for case %#', ({ activity, end }) => {
    let state: IdleState = initIdle(T0);
    for (const t of activity) state = foldActivity(state, t);
    expect(idleSoFarSec(state, end)).toBe(idleSeconds(activity, T0, end));
  });

  it('ignores backwards / duplicate timestamps (clock skew ⇒ never negative)', () => {
    let state = initIdle(T0);
    state = foldActivity(state, T0 + 5 * MIN);
    const before = state;
    state = foldActivity(state, T0 + 5 * MIN); // duplicate
    state = foldActivity(state, T0 + 2 * MIN); // backwards
    expect(state).toEqual(before);
    expect(idleSoFarSec(state, T0 + 6 * MIN)).toBe(0);
  });

  it('idleSoFarSec reflects an in-progress silent stretch', () => {
    let state = initIdle(T0);
    state = foldActivity(state, T0 + 2 * MIN);
    // 12 minutes of silence since the last ping, still running
    expect(idleSoFarSec(state, T0 + 14 * MIN)).toBe(12 * 60);
    // ...but only 3 minutes of silence is still "active"
    expect(idleSoFarSec(state, T0 + 5 * MIN)).toBe(0);
  });
});

describe('realWorkSec + sessionIdleSec', () => {
  it('subtracts idle from duration and clamps at zero', () => {
    expect(realWorkSec(1800, 600)).toBe(1200);
    expect(realWorkSec(600, 0)).toBe(600);
    expect(realWorkSec(600, 900)).toBe(0); // idle can't push real work negative
  });

  it('reads idleSec off a session, defaulting to 0', () => {
    const base: FocusSession = {
      sessionId: 's1',
      link: { mapId: 'm', nodeId: 'n', nodeText: 'x' },
      ancestorIds: [],
      ancestorTexts: [],
      start: T0,
      end: T0 + 30 * MIN,
      durationSec: 1800,
    };
    expect(sessionIdleSec(base)).toBe(0);
    expect(sessionIdleSec({ ...base, idleSec: 420 } as FocusSession & { idleSec: number })).toBe(420);
  });
});
