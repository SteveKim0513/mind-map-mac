// Pure focus-session aggregation. No I/O, no React — unit-tested.
// Source records are FocusSession structs read from note frontmatter (via the
// workspace index). The dashboard and the canvas chip both build on these.

import type { FocusSession } from '../types';

const DAY_MS = 86_400_000;
export const STREAK_MIN_SEC = 5 * 60; // sessions under 5 min don't count toward streaks (anti-gaming)
const SANITY_MAX_SEC = 12 * 3600; // a single session longer than this is suspect (sleep/DST)

/** A finished, trustworthy session contributes to totals. */
export function isCounted(s: FocusSession): boolean {
  return s.end != null && s.durationSec > 0;
}

/** Clamp an absurd duration (laptop slept mid-session) and flag it. */
export function sanitizeDuration(startMs: number, endMs: number): { durationSec: number; suspect: boolean } {
  const durationSec = Math.max(0, Math.round((endMs - startMs) / 1000));
  return { durationSec, suspect: durationSec > SANITY_MAX_SEC };
}

/** Local YYYY-MM-DD for an epoch ms (heatmap buckets by the session's START day). */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Total focus seconds per day (start-day attribution). */
export function dailyTotals(sessions: FocusSession[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of sessions) {
    if (!isCounted(s)) continue;
    const k = dayKey(s.start);
    out.set(k, (out.get(k) ?? 0) + s.durationSec);
  }
  return out;
}

/**
 * Streak = consecutive days (ending today) with at least one qualifying session
 * (≥ STREAK_MIN_SEC), allowing ONE skipped day of grace before it breaks — so a
 * single off day doesn't reset to zero (avoids the what-the-hell drop-off).
 */
export function currentStreak(sessions: FocusSession[], now: number): number {
  const days = new Set<string>();
  for (const s of sessions) {
    if (isCounted(s) && s.durationSec >= STREAK_MIN_SEC) days.add(dayKey(s.start));
  }
  if (days.size === 0) return 0;
  let streak = 0;
  let graceLeft = 1;
  // walk backwards from today
  for (let i = 0; ; i++) {
    const key = dayKey(now - i * DAY_MS);
    if (days.has(key)) {
      streak++;
    } else if (i === 0) {
      // today not done yet — don't break, just don't count it
      continue;
    } else if (graceLeft > 0) {
      graceLeft--;
    } else {
      break;
    }
    if (i > 366) break; // safety
  }
  return streak;
}

/**
 * Distinct days with a qualifying session within the last `windowDays` (today
 * inclusive). A calm alternative to the streak: it shows progress without the
 * "don't break the chain" pressure (ADR 0007 / G2). DST-safe via dayKey.
 */
export function focusDaysInWindow(sessions: FocusSession[], now: number, windowDays: number): number {
  const window = new Set<string>();
  for (let i = 0; i < windowDays; i++) window.add(dayKey(now - i * DAY_MS));
  const hit = new Set<string>();
  for (const s of sessions) {
    if (!isCounted(s) || s.durationSec < STREAK_MIN_SEC) continue;
    const k = dayKey(s.start);
    if (window.has(k)) hit.add(k);
  }
  return hit.size;
}

export interface Totals {
  todaySec: number;
  weekSec: number;
  countToday: number;
  streak: number;
  focusDays7: number; // focus days in the last 7 (neutral, non-pressuring)
}

export function summary(sessions: FocusSession[], now: number): Totals {
  const today = dayKey(now);
  const weekAgo = now - 6 * DAY_MS;
  let todaySec = 0;
  let weekSec = 0;
  let countToday = 0;
  for (const s of sessions) {
    if (!isCounted(s)) continue;
    if (dayKey(s.start) === today) {
      todaySec += s.durationSec;
      countToday++;
    }
    if (s.start >= weekAgo) weekSec += s.durationSec;
  }
  return {
    todaySec,
    weekSec,
    countToday,
    streak: currentStreak(sessions, now),
    focusDays7: focusDaysInWindow(sessions, now, 7),
  };
}

export interface NodeAgg {
  mapId: string;
  nodeId: string;
  label: string; // best-known node text
  selfSec: number; // time on sessions attached directly to this node
  rolledSec: number; // self + all descendant sessions (subtree)
  sessions: number; // direct session count
}

/**
 * Per-node cumulative time WITH subtree roll-up: a node's rolledSec includes
 * every session attached to it or any descendant. Users run sessions on leaf
 * nodes ("login bug"), so the only way "auth system: 12h" ever appears is to
 * push each session's seconds up its ancestor chain (captured at session end).
 *
 * Returns a map keyed by "mapId nodeId" for every node that has direct OR
 * rolled-up time.
 */
export type LiveResolver = (
  mapId: string,
  nodeId: string,
) => { selfText: string; ancestors: { id: string; text: string }[] } | null;

export function perNode(sessions: FocusSession[], live?: LiveResolver): Map<string, NodeAgg> {
  const out = new Map<string, NodeAgg>();
  const key = (mapId: string, nodeId: string) => `${mapId} ${nodeId}`;
  const ensure = (mapId: string, nodeId: string, label: string): NodeAgg => {
    const k = key(mapId, nodeId);
    let a = out.get(k);
    if (!a) {
      a = { mapId, nodeId, label, selfSec: 0, rolledSec: 0, sessions: 0 };
      out.set(k, a);
    } else if (label) a.label = label; // keep the freshest non-empty label
    return a;
  };
  for (const s of sessions) {
    if (!isCounted(s)) continue;
    const { mapId, nodeId, nodeText } = s.link;
    // prefer the LIVE tree (so moving a node re-attributes its time); fall back
    // to the session's saved snapshot only when the map is closed/deleted.
    const cur = live?.(mapId, nodeId) ?? null;
    const selfLabel = cur?.selfText || nodeText || '';
    const ancestors = cur
      ? cur.ancestors
      : s.ancestorIds.map((id, i) => ({ id, text: s.ancestorTexts[i] ?? '' }));

    const self = ensure(mapId, nodeId, selfLabel);
    self.selfSec += s.durationSec;
    self.rolledSec += s.durationSec;
    self.sessions++;
    for (const anc of ancestors) {
      if (anc.id === nodeId) continue; // don't double-count the node itself
      ensure(mapId, anc.id, anc.text).rolledSec += s.durationSec;
    }
  }
  return out;
}

/** Lookup helper: rolled-up seconds + direct count for one node (canvas chip). */
export function nodeStat(
  agg: Map<string, NodeAgg>,
  mapId: string,
  nodeId: string,
): { rolledSec: number; sessions: number } | null {
  const a = agg.get(`${mapId} ${nodeId}`);
  return a ? { rolledSec: a.rolledSec, sessions: a.sessions } : null;
}

/** "2h 15m" / "32m" / "45s" — compact human duration. */
export function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
