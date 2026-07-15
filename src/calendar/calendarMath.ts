// Pure date-grid math for the Calendar view (day/week/month). No I/O, no
// React — CalendarView.tsx renders these into cells; what goes INSIDE a cell
// reuses focus/agenda.ts's AgendaItem + focus/AgendaRow.tsx's row rendering.

import { dayKey } from '../focus/aggregate';
import type { AgendaItem } from '../focus/agenda';

const DAY = 86_400_000;

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

/** Local midnight of the Sunday on/before `ms` (Date#getDay(): Sun=0). */
export function startOfWeek(ms: number): number {
  const d0 = startOfDay(ms);
  return addDays(d0, -new Date(d0).getDay());
}

/** The 7 local-midnight days (Sun→Sat) of the week containing `ms`. */
export function weekDays(ms: number): number[] {
  const start = startOfWeek(ms);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export interface MonthCell {
  ms: number; // local midnight
  inMonth: boolean; // false for leading/trailing days from adjacent months
}

/**
 * Full calendar grid for `year`/`month` (0-indexed) — always complete weeks
 * (Sun→Sat rows), so leading days from the previous month and trailing days
 * from the next month are included and marked `inMonth: false` for dimming.
 */
export function monthGridCells(year: number, month: number): MonthCell[] {
  const first = new Date(year, month, 1).getTime();
  const last = new Date(year, month + 1, 0).getTime(); // day 0 of next month = last day of this month
  const gridStart = startOfWeek(first);
  const lastRowStart = startOfWeek(last);
  const totalDays = Math.round((lastRowStart - gridStart) / DAY) + 7;
  return Array.from({ length: totalDays }, (_, i) => {
    const ms = addDays(gridStart, i);
    return { ms, inMonth: new Date(ms).getMonth() === month };
  });
}

/** Group agenda items by local day key ("YYYY-MM-DD") for week/month cells. */
export function groupItemsByDay(items: AgendaItem[]): Map<string, AgendaItem[]> {
  const map = new Map<string, AgendaItem[]>();
  for (const it of items) {
    if (Number.isNaN(it.at)) continue;
    const k = dayKey(it.at);
    (map.get(k) ?? map.set(k, []).get(k)!).push(it);
  }
  for (const list of map.values()) list.sort((a, b) => a.at - b.at);
  return map;
}
