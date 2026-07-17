import { describe, it, expect } from 'vitest';
import {
  weekPeriod, dayPeriod, periodSessions, quality, weeklyTrend, priorityVsActual, insights,
  type ScheduledNode,
} from './report';
import type { FocusSession } from '../types';

const DAY = 86_400_000;
// Wednesday 2026-06-10 15:00 local
const NOW = new Date('2026-06-10T15:00:00').getTime();

function S(startMs: number, min: number, node = 'n', reflect?: string): FocusSession {
  return {
    sessionId: `${startMs}-${min}-${Math.random()}`,
    link: { mapId: 'm1', nodeId: node, nodeText: node },
    ancestorIds: [],
    ancestorTexts: [],
    start: startMs,
    end: startMs + min * 60_000,
    durationSec: min * 60,
    reflect,
  };
}

describe('report periods', () => {
  it('weekPeriod 0 contains now; -1 is the previous week', () => {
    const wk = weekPeriod(NOW, 0);
    expect(NOW).toBeGreaterThanOrEqual(wk.from);
    expect(NOW).toBeLessThan(wk.to);
    expect(wk.to - wk.from).toBe(7 * DAY);
    expect(weekPeriod(NOW, -1).to).toBe(wk.from);
  });

  it('starts the week on Sunday to match the calendar view', () => {
    // NOW = Wed 2026-06-10 → the containing week starts Sunday 2026-06-07.
    const wk = weekPeriod(NOW, 0);
    expect(new Date(wk.from).getDay()).toBe(0); // Sunday
    expect(new Date(wk.from).getDate()).toBe(7);
  });

  it('periodSessions filters by the period window', () => {
    const sessions = [S(NOW, 30), S(NOW - 8 * DAY, 30)]; // this week + last week
    expect(periodSessions(sessions, weekPeriod(NOW, 0))).toHaveLength(1);
    expect(periodSessions(sessions, weekPeriod(NOW, -1))).toHaveLength(1);
    expect(periodSessions(sessions, dayPeriod(NOW))).toHaveLength(1);
  });
});

describe('quality', () => {
  it('computes avg/longest/deepWork and flags fragmentation', () => {
    const q = quality([S(NOW, 5), S(NOW, 8), S(NOW, 6)]); // 3 short sessions
    expect(q.count).toBe(3);
    expect(q.totalSec).toBe(19 * 60);
    expect(q.avgSec).toBe(Math.round((19 * 60) / 3));
    expect(q.fragmented).toBe(true);
    expect(quality([S(NOW, 90)]).deepWorkCount).toBe(1);
    expect(quality([S(NOW, 90)]).fragmented).toBe(false);
  });

  it('buckets by start hour', () => {
    const nine = new Date('2026-06-10T09:30:00').getTime();
    expect(quality([S(nine, 20)]).byHour[9]).toBe(20 * 60);
  });
});

describe('weeklyTrend', () => {
  it('returns oldest→newest per-week totals', () => {
    const t = weeklyTrend([S(NOW, 30), S(NOW - 7 * DAY, 60)], NOW, 3);
    expect(t).toHaveLength(3);
    expect(t[2].sec).toBe(30 * 60); // newest = this week
    expect(t[1].sec).toBe(60 * 60); // last week
    expect(t[0].sec).toBe(0);
  });
});

describe('priorityVsActual', () => {
  const noSubtree = () => false;
  it('flags a near deadline with little focus', () => {
    const scheduled: ScheduledNode[] = [
      { mapId: 'm1', nodeId: 'auth', text: '인증', scheduleAt: new Date(NOW + 2 * DAY).toISOString() },
      { mapId: 'm1', nodeId: 'pay', text: '결제', scheduleAt: new Date(NOW + 2 * DAY).toISOString() },
    ];
    const rows = priorityVsActual(scheduled, [S(NOW, 60, 'pay')], weekPeriod(NOW, 0), NOW, noSubtree);
    const auth = rows.find((r) => r.nodeId === 'auth')!;
    const pay = rows.find((r) => r.nodeId === 'pay')!;
    expect(auth.flagged).toBe(true); // due soon, 0 focus
    expect(pay.flagged).toBe(false); // due soon but 60m focus
    expect(pay.focusSec).toBe(60 * 60);
  });
});

describe('insights', () => {
  it('reports total with a week-over-week delta and a deadline warning', () => {
    const q = quality([S(NOW, 60)]);
    const prev = quality([S(NOW - 7 * DAY, 30)]);
    const priority = priorityVsActual(
      [{ mapId: 'm1', nodeId: 'auth', text: '인증', scheduleAt: new Date(NOW + 1 * DAY).toISOString() }],
      [],
      weekPeriod(NOW, 0),
      NOW,
      () => false,
    );
    const out = insights(weekPeriod(NOW, 0), q, prev, priority, NOW);
    expect(out[0].text).toMatch(/집중 1h/);
    expect(out[0].text).toMatch(/\+100%/);
    expect(out.some((i) => i.tone === 'warn' && /인증/.test(i.text))).toBe(true);
  });
});
