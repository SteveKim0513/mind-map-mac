import { describe, it, expect } from 'vitest';
import {
  startOfDay,
  addDays,
  startOfWeek,
  weekDays,
  monthGridCells,
  groupItemsByDay,
  isoDate,
  rescheduleToDay,
  rescheduleToMinute,
  gridTopMinutes,
  blockSpanMinutes,
  layoutDayBlocks,
  DEFAULT_BLOCK_MIN,
  WEEK_GRID_START_HOUR,
  WEEK_GRID_MINUTES,
  WEEK_GRID_HOUR_PX,
  WEEK_GRID_HEIGHT_PX,
  minutesToPx,
  pxToMinutes,
  gridHourPx,
} from './calendarMath';
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

describe('rescheduleToDay', () => {
  it('moves the date but keeps the time-of-day', () => {
    const target = new Date(2026, 6, 20).getTime(); // Jul 20 2026 local midnight
    expect(rescheduleToDay('2026-06-15T09:30:00', target)).toBe('2026-07-20T09:30:00');
  });

  it('keeps an all-day schedule all-day on the new date', () => {
    const target = new Date(2026, 0, 3).getTime();
    expect(rescheduleToDay('2026-06-15T00:00:00', target)).toBe('2026-01-03T00:00:00');
  });

  it('isoDate zero-pads month and day', () => {
    expect(isoDate(new Date(2026, 2, 5).getTime())).toBe('2026-03-05');
  });
});

describe('rescheduleToMinute', () => {
  it('sets the time on the existing date and turns a chip into a timed event', () => {
    expect(rescheduleToMinute('2026-06-15T00:00:00', 9 * 60 + 15)).toBe('2026-06-15T09:15:00');
  });

  it('clamps out-of-range minutes into the day', () => {
    expect(rescheduleToMinute('2026-06-15T10:00:00', -30)).toBe('2026-06-15T00:00:00');
    expect(rescheduleToMinute('2026-06-15T10:00:00', 99_999)).toBe('2026-06-15T23:59:00');
  });
});

describe('gridTopMinutes', () => {
  it('returns null for all-day items', () => {
    const at = new Date(2026, 6, 15, 0, 0).getTime();
    expect(gridTopMinutes(at, false)).toBeNull();
  });

  it('positions a timed item by minutes from the grid start hour', () => {
    const at = new Date(2026, 6, 15, WEEK_GRID_START_HOUR + 2, 30).getTime();
    expect(gridTopMinutes(at, true)).toBe(2 * 60 + 30);
  });

  it('returns null when the item falls outside the visible window', () => {
    const early = new Date(2026, 6, 15, WEEK_GRID_START_HOUR - 1, 0).getTime();
    expect(gridTopMinutes(early, true)).toBeNull();
    const late = new Date(2026, 6, 15, 23, 59).getTime();
    // 23:59 is within [start, start+span) only if span reaches it; assert consistency
    const min = gridTopMinutes(late, true);
    expect(min === null || (min >= 0 && min < WEEK_GRID_MINUTES)).toBe(true);
  });
});

describe('blockSpanMinutes', () => {
  it('uses the duration when set', () => {
    expect(blockSpanMinutes(90)).toBe(90);
  });
  it('falls back to a legible default for point events', () => {
    expect(blockSpanMinutes(undefined)).toBe(DEFAULT_BLOCK_MIN);
    expect(blockSpanMinutes(0)).toBe(DEFAULT_BLOCK_MIN);
  });
});

describe('layoutDayBlocks', () => {
  it('gives non-overlapping blocks a single full-width column each', () => {
    const out = layoutDayBlocks([
      { nodeId: 'a', startMin: 0, endMin: 30 },
      { nodeId: 'b', startMin: 60, endMin: 90 },
    ]);
    expect(out.every((b) => b.cols === 1 && b.col === 0)).toBe(true);
  });

  it('splits two overlapping blocks into two side-by-side columns', () => {
    const out = layoutDayBlocks([
      { nodeId: 'a', startMin: 0, endMin: 60 },
      { nodeId: 'b', startMin: 30, endMin: 90 },
    ]);
    const a = out.find((b) => b.nodeId === 'a')!;
    const b = out.find((b) => b.nodeId === 'b')!;
    expect(a.cols).toBe(2);
    expect(b.cols).toBe(2);
    expect(new Set([a.col, b.col])).toEqual(new Set([0, 1]));
  });

  it('reuses a freed column when a later block no longer overlaps', () => {
    // a and b overlap (2 cols); c starts after both end → new cluster, 1 col.
    const out = layoutDayBlocks([
      { nodeId: 'a', startMin: 0, endMin: 60 },
      { nodeId: 'b', startMin: 10, endMin: 60 },
      { nodeId: 'c', startMin: 120, endMin: 150 },
    ]);
    expect(out.find((b) => b.nodeId === 'c')!.cols).toBe(1);
    expect(out.find((b) => b.nodeId === 'a')!.cols).toBe(2);
  });

  it('touching blocks (end == next start) do not count as overlapping', () => {
    const out = layoutDayBlocks([
      { nodeId: 'a', startMin: 0, endMin: 30 },
      { nodeId: 'b', startMin: 30, endMin: 60 },
    ]);
    expect(out.every((b) => b.cols === 1)).toBe(true);
  });
});

describe('week grid px scale (alignment §3.8)', () => {
  it('rail label px and a block at that hour resolve to the SAME px', () => {
    // The bug: blocks were placed by percent-of-column-height while the rail is
    // fixed-px, so they drifted apart. The fix: both go through minutesToPx. A
    // schedule at h:00 must land exactly on the rail's h label.
    for (let h = WEEK_GRID_START_HOUR; h < WEEK_GRID_START_HOUR + 6; h++) {
      const at = new Date(2026, 6, 15, h, 0, 0).getTime();
      const topMin = gridTopMinutes(at, true)!;
      expect(minutesToPx(topMin)).toBe(gridHourPx(h));
    }
  });

  it('minutesToPx is a linear fixed scale independent of any container height', () => {
    expect(minutesToPx(0)).toBe(0);
    expect(minutesToPx(60)).toBe(WEEK_GRID_HOUR_PX);
    expect(minutesToPx(WEEK_GRID_MINUTES)).toBe(WEEK_GRID_HEIGHT_PX);
  });

  it('pxToMinutes round-trips minutesToPx (click/resize inverse)', () => {
    for (const min of [0, 15, 90, 375, WEEK_GRID_MINUTES]) {
      expect(pxToMinutes(minutesToPx(min))).toBeCloseTo(min, 6);
    }
  });
});
