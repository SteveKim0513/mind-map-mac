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

// ── Drag-reschedule (Phase 1) ─────────────────────────────────────────────────
// scheduleAt is local-ISO "YYYY-MM-DDTHH:mm:ss" (see types.ts). Moving a schedule
// to another day keeps its time-of-day (and all-day-ness) — only the date changes.
// Local-only: never touch UTC here or the Reminders round-trip drifts (decision 0002).

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Local "YYYY-MM-DD" for a local-midnight (or any) epoch ms. */
export function isoDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Move a schedule to `targetDayMs` (a local day), preserving the time-of-day.
 * Input/output are local-ISO "YYYY-MM-DDTHH:mm:ss"; an all-day source
 * ("...T00:00:00") stays all-day on the new date.
 */
export function rescheduleToDay(scheduleAt: string, targetDayMs: number): string {
  const time = scheduleAt.length > 11 ? scheduleAt.slice(11) : '00:00:00';
  return `${isoDate(targetDayMs)}T${time}`;
}

/**
 * Set the time-of-day of a schedule to `minutesFromMidnight` on its existing
 * date (used by vertical drag / resize on the week time-grid). Snaps nothing —
 * callers pre-snap. Produces "...THH:mm:00" so hasTime becomes true (unless 00:00).
 */
export function rescheduleToMinute(scheduleAt: string, minutesFromMidnight: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutesFromMidnight)));
  const date = scheduleAt.slice(0, 10);
  return `${date}T${pad2(Math.floor(m / 60))}:${pad2(m % 60)}:00`;
}

// ── Week time-grid layout (Phase 1b) ──────────────────────────────────────────
// A compact business-hours window. Timed items land at their start minute;
// all-day items and anything outside the window render in the top strip so
// nothing is silently hidden.

export const WEEK_GRID_START_HOUR = 6;
export const WEEK_GRID_END_HOUR = 24;
export const WEEK_GRID_MINUTES = (WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR) * 60;

/** Hour labels (6…23) rendered down the grid's left rail. */
export function gridHourLabels(): number[] {
  return Array.from({ length: WEEK_GRID_END_HOUR - WEEK_GRID_START_HOUR }, (_, i) => WEEK_GRID_START_HOUR + i);
}

/**
 * Minutes from the top of the grid for a timed item, or null when it is all-day
 * or falls outside the visible window (caller puts those in the top strip).
 */
export function gridTopMinutes(at: number, hasTime: boolean): number | null {
  if (!hasTime || Number.isNaN(at)) return null;
  const d = new Date(at);
  const min = (d.getHours() - WEEK_GRID_START_HOUR) * 60 + d.getMinutes();
  if (min < 0 || min >= WEEK_GRID_MINUTES) return null;
  return min;
}

// ── Time blocks (Phase 3) ─────────────────────────────────────────────────────
// A block's visual length is its durationMin; a point event (no duration) gets a
// small default so it stays legible. Overlapping blocks are packed side-by-side.

export const DEFAULT_BLOCK_MIN = 30;

/** Visual span (minutes) of a block; falls back to a legible default for points. */
export function blockSpanMinutes(durationMin: number | undefined): number {
  return durationMin && durationMin > 0 ? durationMin : DEFAULT_BLOCK_MIN;
}

export interface BlockInput {
  nodeId: string;
  startMin: number; // minutes from grid top
  endMin: number; // startMin + span
}
export interface BlockLayout extends BlockInput {
  col: number; // 0-based column within its overlap cluster
  cols: number; // number of side-by-side columns in that cluster
}

/**
 * Assign each timed block a column so overlapping blocks sit side-by-side
 * (Google-Calendar-style). Within a cluster of mutually-overlapping blocks, each
 * gets a `col` and a shared `cols` (the max concurrency) → width = 1/cols.
 * Pure + unit-tested; the grid renderer turns col/cols into left/width.
 */
export function layoutDayBlocks(items: BlockInput[]): BlockLayout[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: BlockLayout[] = [];
  let cluster: BlockLayout[] = [];
  let clusterEnd = -1;
  let colEnds: number[] = []; // end time per column, reset per cluster

  const flush = () => {
    const cols = cluster.reduce((m, b) => Math.max(m, b.col + 1), 0);
    for (const b of cluster) b.cols = cols;
    out.push(...cluster);
    cluster = [];
    colEnds = [];
    clusterEnd = -1;
  };

  for (const it of sorted) {
    if (cluster.length && it.startMin >= clusterEnd) flush(); // no overlap → new cluster
    let col = colEnds.findIndex((end) => end <= it.startMin);
    if (col === -1) col = colEnds.length;
    colEnds[col] = it.endMin;
    cluster.push({ ...it, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) flush();
  return out;
}
