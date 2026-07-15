import { describe, it, expect } from 'vitest';
import { startOfDay, addDays, startOfWeek, weekDays, monthGridCells, groupItemsByDay } from './calendarMath';
import type { AgendaItem } from '../focus/agenda';

const item = (over: Partial<AgendaItem>): AgendaItem => ({
  mapId: 'm',
  nodeId: 'n',
  text: '노드',
  scheduleAt: '',
  at: 0,
  hasTime: false,
  done: false,
  ...over,
});

describe('startOfDay / addDays', () => {
  it('startOfDay zeroes out the time component', () => {
    const noon = new Date(2026, 5, 15, 13, 30, 0).getTime();
    const midnight = startOfDay(noon);
    const d = new Date(midnight);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([0, 0, 0]);
    expect(d.getDate()).toBe(15);
  });

  it('addDays crosses month/year boundaries correctly', () => {
    const dec31 = new Date(2026, 11, 31).getTime();
    const jan1 = addDays(dec31, 1);
    const d = new Date(jan1);
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe('startOfWeek / weekDays', () => {
  it('returns the same day when called on a Sunday', () => {
    // walk forward from a known date until we hit a Sunday
    let d = new Date(2026, 0, 1);
    while (d.getDay() !== 0) d.setDate(d.getDate() + 1);
    const sunday = d.getTime();
    expect(startOfWeek(sunday)).toBe(startOfDay(sunday));
  });

  it('weekDays returns 7 consecutive local-midnight days starting on Sunday', () => {
    const anchor = new Date(2026, 6, 15).getTime(); // some arbitrary Wednesday-ish date
    const days = weekDays(anchor);
    expect(days).toHaveLength(7);
    expect(new Date(days[0]).getDay()).toBe(0);
    expect(new Date(days[6]).getDay()).toBe(6);
    for (let i = 1; i < 7; i++) {
      expect(Math.round((days[i] - days[i - 1]) / 86_400_000)).toBe(1);
    }
    // the anchor day must fall inside this week
    const anchorMidnight = startOfDay(anchor);
    expect(days).toContain(anchorMidnight);
  });
});

describe('monthGridCells', () => {
  it('produces a grid of complete Sun→Sat weeks covering every day of the month', () => {
    const year = 2026;
    const month = 1; // February (0-indexed)
    const cells = monthGridCells(year, month);

    expect(cells.length % 7).toBe(0);
    expect(new Date(cells[0].ms).getDay()).toBe(0);
    expect(new Date(cells[cells.length - 1].ms).getDay()).toBe(6);

    const inMonthDates = cells.filter((c) => c.inMonth).map((c) => new Date(c.ms).getDate());
    const daysInFeb2026 = new Date(year, month + 1, 0).getDate();
    expect(inMonthDates).toEqual(Array.from({ length: daysInFeb2026 }, (_, i) => i + 1));

    // leading/trailing cells belong to the adjacent months, not `month`
    for (const c of cells) {
      if (!c.inMonth) expect(new Date(c.ms).getMonth()).not.toBe(month);
    }
  });

  it('handles a month that starts on Sunday (no leading days)', () => {
    // Nov 2026: find a month starting on Sunday by scanning — keeps the test
    // independent of hardcoded calendar trivia.
    let year = 2026;
    let month = 0;
    outer: for (let y = 2026; y < 2028; y++) {
      for (let m = 0; m < 12; m++) {
        if (new Date(y, m, 1).getDay() === 0) {
          year = y;
          month = m;
          break outer;
        }
      }
    }
    const cells = monthGridCells(year, month);
    expect(cells[0].inMonth).toBe(true);
    expect(new Date(cells[0].ms).getDate()).toBe(1);
  });
});

describe('groupItemsByDay', () => {
  it('groups items by local day and sorts each group by time ascending', () => {
    const day1 = new Date(2026, 6, 10, 9, 0).getTime();
    const day1Later = new Date(2026, 6, 10, 15, 0).getTime();
    const day2 = new Date(2026, 6, 11, 8, 0).getTime();
    const items = [
      item({ nodeId: 'b', at: day1Later }),
      item({ nodeId: 'a', at: day1 }),
      item({ nodeId: 'c', at: day2 }),
    ];
    const grouped = groupItemsByDay(items);
    expect(grouped.size).toBe(2);
    const keys = [...grouped.keys()].sort();
    expect(grouped.get(keys[0])!.map((i) => i.nodeId)).toEqual(['a', 'b']);
    expect(grouped.get(keys[1])!.map((i) => i.nodeId)).toEqual(['c']);
  });

  it('skips items with an unparseable (NaN) schedule', () => {
    const grouped = groupItemsByDay([item({ at: NaN })]);
    expect(grouped.size).toBe(0);
  });
});
