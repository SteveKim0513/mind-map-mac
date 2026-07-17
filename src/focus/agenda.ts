// "오늘" view aggregation — group scheduled nodes (from anywhere in the
// workspace) into overdue / today / upcoming. Pure + unit-tested; the I/O
// collector lives in collectAgenda.ts.

import { dayKey } from './aggregate';

const DAY = 86_400_000;

export interface AgendaItem {
  mapId: string;
  nodeId: string;
  text: string;
  scheduleAt: string; // local ISO ("YYYY-MM-DD" or "...THH:mm:ss")
  at: number; // epoch ms (parsed)
  hasTime: boolean; // false for date-only chips (treated as all-day)
  done: boolean;
  durationMin?: number; // time-block length (calendar grid); local-only
  mapPath?: string;
}

export interface Agenda {
  overdue: AgendaItem[];
  today: AgendaItem[];
  upcoming: { day: string; items: AgendaItem[] }[]; // next 7 days, grouped (date asc)
  doneToday: number; // completed items scheduled for today (for the summary)
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Parse a node's schedule into an AgendaItem field set (at + hasTime).
 * `allDay` (the node's explicit flag) wins when set; otherwise hasTime is derived
 * from the time component (00:00 = all-day) — so pre-existing docs, which have no
 * allDay field, behave exactly as before.
 */
export function parseSchedule(
  scheduleAt: string,
  allDay?: boolean,
): { at: number; hasTime: boolean } {
  const d = new Date(scheduleAt);
  const at = d.getTime();
  const derived = !Number.isNaN(at) && (d.getHours() !== 0 || d.getMinutes() !== 0);
  const hasTime = allDay === true ? false : allDay === false ? !Number.isNaN(at) : derived;
  return { at, hasTime };
}

/**
 * Bucket items by their schedule day relative to `nowMs`. A date-only schedule
 * stays "today" all day (matches scheduleInfo) — only a fully-past day is overdue.
 * `done` items drop out of the lists (counted into doneToday when due today).
 */
export function buildAgenda(items: AgendaItem[], nowMs: number): Agenda {
  const t0 = startOfDay(nowMs);
  const overdue: AgendaItem[] = [];
  const today: AgendaItem[] = [];
  const up = new Map<string, AgendaItem[]>();
  let doneToday = 0;

  for (const it of items) {
    if (Number.isNaN(it.at)) continue;
    const dayDiff = Math.round((startOfDay(it.at) - t0) / DAY);
    if (it.done) {
      if (dayDiff === 0) doneToday++;
      continue;
    }
    if (dayDiff < 0) overdue.push(it);
    else if (dayDiff === 0) today.push(it);
    else if (dayDiff <= 7) {
      const k = dayKey(it.at);
      (up.get(k) ?? up.set(k, []).get(k)!).push(it);
    }
  }

  const byAt = (a: AgendaItem, b: AgendaItem) => a.at - b.at;
  overdue.sort(byAt);
  today.sort(byAt);
  const upcoming = [...up.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, list]) => ({ day, items: list.sort(byAt) }));

  return { overdue, today, upcoming, doneToday };
}
