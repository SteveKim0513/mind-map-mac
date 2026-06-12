// Period-scoped focus reporting: the dashboard is a credible work record you
// review yourself and present to a manager, so this turns raw sessions into
// insight (so-what), an outcome narrative, priority alignment, and quality
// signals. Pure + unit-tested. Builds on aggregate.ts.

import type { FocusSession } from '../types';
import { isCounted, fmtDuration, STREAK_MIN_SEC } from './aggregate';

const DAY = 86_400_000;

export interface Period {
  from: number; // inclusive epoch ms
  to: number; // exclusive epoch ms
  kind: 'week' | 'day';
}

/** Start of the local day for an epoch ms. */
function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
/** Monday 00:00 of the week containing `ms`. */
function startOfWeek(ms: number): number {
  const sod = startOfDay(ms);
  const dow = new Date(sod).getDay(); // 0=Sun..6=Sat
  const back = (dow + 6) % 7; // days since Monday
  return sod - back * DAY;
}

/** The week `offset` weeks from the one containing `now` (0 = this week, -1 = last). */
export function weekPeriod(now: number, offset: number): Period {
  const from = startOfWeek(now) + offset * 7 * DAY;
  return { from, to: from + 7 * DAY, kind: 'week' };
}
export function dayPeriod(ms: number): Period {
  const from = startOfDay(ms);
  return { from, to: from + DAY, kind: 'day' };
}

export function inPeriod(s: FocusSession, p: Period): boolean {
  return s.start >= p.from && s.start < p.to;
}
export function periodSessions(sessions: FocusSession[], p: Period): FocusSession[] {
  return sessions.filter((s) => isCounted(s) && inPeriod(s, p));
}

export function periodLabel(p: Period, now: number): string {
  if (p.kind === 'day') {
    if (startOfDay(now) === p.from) return '오늘';
    if (startOfDay(now) - DAY === p.from) return '어제';
    const d = new Date(p.from);
    return `${d.getMonth() + 1}월 ${d.getDate()}일`;
  }
  const thisWeek = startOfWeek(now);
  if (p.from === thisWeek) return '이번 주';
  if (p.from === thisWeek - 7 * DAY) return '지난주';
  const a = new Date(p.from);
  const b = new Date(p.to - DAY);
  return `${a.getMonth() + 1}/${a.getDate()} – ${b.getMonth() + 1}/${b.getDate()}`;
}

// ── quality signals ──────────────────────────────────────────────────────────
const FRAGMENT_AVG_SEC = 12 * 60; // avg session under this ⇒ "fragmented"
const DEEP_WORK_SEC = 50 * 60; // a single session this long ⇒ deep work

export interface Quality {
  totalSec: number;
  count: number;
  avgSec: number;
  longestSec: number;
  deepWorkCount: number; // sessions ≥ DEEP_WORK_SEC
  fragmented: boolean;
  byHour: number[]; // 24 buckets of seconds (by session start hour)
}

export function quality(sessions: FocusSession[]): Quality {
  const counted = sessions.filter(isCounted);
  const totalSec = counted.reduce((a, s) => a + s.durationSec, 0);
  const count = counted.length;
  const longestSec = counted.reduce((m, s) => Math.max(m, s.durationSec), 0);
  const avgSec = count ? Math.round(totalSec / count) : 0;
  const deepWorkCount = counted.filter((s) => s.durationSec >= DEEP_WORK_SEC).length;
  const byHour = new Array(24).fill(0);
  for (const s of counted) byHour[new Date(s.start).getHours()] += s.durationSec;
  return {
    totalSec,
    count,
    avgSec,
    longestSec,
    deepWorkCount,
    fragmented: count >= 3 && avgSec > 0 && avgSec < FRAGMENT_AVG_SEC,
    byHour,
  };
}

/** Per-week totals for the last `weeks` weeks (oldest → newest), for a trend line. */
export function weeklyTrend(sessions: FocusSession[], now: number, weeks: number): { from: number; sec: number }[] {
  const out: { from: number; sec: number }[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const p = weekPeriod(now, -i);
    out.push({ from: p.from, sec: periodSessions(sessions, p).reduce((a, s) => a + s.durationSec, 0) });
  }
  return out;
}

// ── priority vs actual ───────────────────────────────────────────────────────
export interface ScheduledNode {
  mapId: string;
  nodeId: string;
  text: string;
  scheduleAt: string; // local ISO
}
export interface PriorityRow {
  mapId: string;
  nodeId: string;
  label: string;
  dueInDays: number; // days from now to the deadline (negative = overdue)
  focusSec: number; // focus time on this node (+subtree) within the period
  flagged: boolean; // deadline near AND little/no focus
}

/** Compare planned (nodes with a schedule/deadline) against actual focus time in
 *  the period. Flags "deadline within 3 days but ~no focus" — the manager's
 *  first question. `inSubtree(nodeId, sessionLeafId)` decides roll-up. */
export function priorityVsActual(
  scheduled: ScheduledNode[],
  sessions: FocusSession[],
  period: Period,
  now: number,
  inSubtree: (mapId: string, ancestorId: string, leafId: string) => boolean,
): PriorityRow[] {
  const counted = periodSessions(sessions, period);
  return scheduled
    .map((n) => {
      const due = new Date(n.scheduleAt).getTime();
      const dueInDays = Math.round((startOfDay(due) - startOfDay(now)) / DAY);
      let focusSec = 0;
      for (const s of counted) {
        if (s.link.mapId !== n.mapId) continue;
        if (s.link.nodeId === n.nodeId || inSubtree(n.mapId, n.nodeId, s.link.nodeId)) {
          focusSec += s.durationSec;
        }
      }
      return {
        mapId: n.mapId,
        nodeId: n.nodeId,
        label: n.text || '(이름 없음)',
        dueInDays,
        focusSec,
        flagged: dueInDays >= 0 && dueInDays <= 3 && focusSec < 15 * 60,
      };
    })
    .sort((a, b) => a.dueInDays - b.dueInDays);
}

// ── insight strip (rule-based "so what") ─────────────────────────────────────
export interface Insight {
  text: string;
  tone: 'good' | 'warn' | 'neutral';
}

export function insights(
  period: Period,
  periodQ: Quality,
  prevQ: Quality,
  priority: PriorityRow[],
  now: number,
): Insight[] {
  const out: Insight[] = [];
  const unit = period.kind === 'week' ? '주' : '날';

  // total + week-over-week delta
  if (periodQ.totalSec > 0) {
    let delta = '';
    if (prevQ.totalSec > 0) {
      const pct = Math.round(((periodQ.totalSec - prevQ.totalSec) / prevQ.totalSec) * 100);
      if (Math.abs(pct) >= 10) delta = ` — 지난 ${unit}보다 ${pct > 0 ? '+' : ''}${pct}% ${pct > 0 ? '↑' : '↓'}`;
    }
    out.push({ text: `집중 ${fmtDuration(periodQ.totalSec)}${delta}`, tone: 'good' });
  } else {
    out.push({ text: `이번 ${unit} 집중 기록이 없어요`, tone: 'warn' });
  }

  // deepest session
  if (periodQ.longestSec >= DEEP_WORK_SEC) {
    out.push({ text: `가장 깊은 몰입 ${fmtDuration(periodQ.longestSec)}`, tone: 'good' });
  }

  // fragmentation
  if (periodQ.fragmented) {
    out.push({ text: `평균 세션 ${fmtDuration(periodQ.avgSec)} — 파편화 신호(잦은 중단)`, tone: 'warn' });
  }

  // deadline at risk
  const atRisk = priority.filter((p) => p.flagged);
  for (const p of atRisk.slice(0, 2)) {
    const d = p.dueInDays === 0 ? '오늘 마감' : `마감 D-${p.dueInDays}`;
    const f = p.focusSec === 0 ? '집중 0분' : `집중 ${fmtDuration(p.focusSec)}`;
    out.push({ text: `‘${p.label}’ ${d}인데 ${f}`, tone: 'warn' });
  }

  void now;
  return out;
}

/** A markdown report of a period (for "export to note"). */
export function buildReportMarkdown(
  period: Period,
  now: number,
  q: Quality,
  byDay: { day: string; sessions: FocusSession[] }[],
): string {
  const lines: string[] = [];
  lines.push(`# 작업 요약 · ${periodLabel(period, now)}`, '');
  lines.push(`- 총 집중: **${fmtDuration(q.totalSec)}** · ${q.count}세션 · 평균 ${fmtDuration(q.avgSec)}`, '');
  for (const { day, sessions } of byDay) {
    const dayTotal = sessions.reduce((a, s) => a + s.durationSec, 0);
    lines.push(`## ${day} · ${fmtDuration(dayTotal)}`);
    for (const s of sessions) {
      const t = new Date(s.start);
      const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      const topic = s.link.nodeText || '노드';
      const outcome = s.reflect || '(성과 미기록)';
      lines.push(`- ${hm} · ${fmtDuration(s.durationSec)} · ${topic} — ${outcome}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export { STREAK_MIN_SEC };
