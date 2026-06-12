import { describe, it, expect } from 'vitest';
import { buildAgenda, parseSchedule, type AgendaItem } from './agenda';

const DAY = 86_400_000;
const NOW = new Date('2026-06-12T15:00:00').getTime(); // Fri 15:00

function I(daysFromNow: number, opts: { hasTime?: boolean; done?: boolean } = {}): AgendaItem {
  const base = new Date(NOW + daysFromNow * DAY);
  const hasTime = !!opts.hasTime;
  const at = hasTime
    ? new Date(base.getFullYear(), base.getMonth(), base.getDate(), 9, 0).getTime() // 09:00
    : new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime(); // 00:00 (date-only)
  return {
    mapId: 'm', nodeId: `n${daysFromNow}-${Math.random()}`, text: 't',
    scheduleAt: new Date(at).toISOString(), at, hasTime, done: !!opts.done, mapPath: undefined,
  };
}

describe('buildAgenda', () => {
  it('buckets into overdue / today / upcoming(≤7d)', () => {
    const a = buildAgenda([I(-2), I(0), I(1), I(3), I(8)], NOW);
    expect(a.overdue).toHaveLength(1); // -2
    expect(a.today).toHaveLength(1); // 0
    expect(a.upcoming.map((u) => u.items.length)).toEqual([1, 1]); // +1, +3 (+8 excluded)
  });

  it('date-only today is "today", not overdue (even though 00:00 < now)', () => {
    const a = buildAgenda([I(0, { hasTime: false })], NOW);
    expect(a.today).toHaveLength(1);
    expect(a.overdue).toHaveLength(0);
  });

  it('done items drop out; done-today is counted', () => {
    const a = buildAgenda([I(0, { done: true }), I(-1, { done: true }), I(0)], NOW);
    expect(a.today).toHaveLength(1);
    expect(a.overdue).toHaveLength(0);
    expect(a.doneToday).toBe(1); // only the done item due today
  });

  it('groups upcoming by day and sorts within a day by time', () => {
    const a = buildAgenda([I(1, { hasTime: true }), I(1, { hasTime: false }), I(2)], NOW);
    expect(a.upcoming).toHaveLength(2);
    expect(a.upcoming[0].items).toHaveLength(2); // both +1 items in one day group
    // date-only (00:00) sorts before 09:00
    expect(a.upcoming[0].items[0].hasTime).toBe(false);
  });

  it('parseSchedule detects time vs date-only (app stores local ISO at 00:00 for date-only)', () => {
    expect(parseSchedule('2026-06-12T09:30:00').hasTime).toBe(true);
    expect(parseSchedule('2026-06-12T00:00:00').hasTime).toBe(false);
  });
});
