// Pure idle-time computation for focus sessions. No I/O, no React — unit-tested.
//
// A focus session's stopwatch keeps running while the user is away, so a session
// left open over lunch inflates the dashboard's "focus time" and erodes trust in
// the numbers (FEATURE-INVENTORY §11c). Idle detection lets the UI show
// "real work = durationSec − idleSec" WITHOUT touching the honest wall-clock
// `durationSec` (which stays exactly (end − start)/1000). `idleSec` is purely
// additive, optional data.
//
// Everything here is epoch-ms based (same basis as durationSec) so it survives
// laptop sleep / DST / midnight identically to the rest of the focus module.

import type { FocusSession } from '../types';

/** No activity for this long ⇒ that whole stretch counts as idle. */
export const IDLE_THRESHOLD_SEC = 600; // 10 minutes

/**
 * FocusSession carrying the additive `idleSec`. The field lives on the session
 * object at runtime; `serializeNote` JSON-stringifies the whole struct, so it
 * round-trips through the note frontmatter and the workspace index with NO
 * change to `io/noteFormat.ts` or the schema version. Declared here (not in
 * `types.ts`) to keep this work inside `src/focus/`; promote `idleSec?: number`
 * onto `FocusSession` in `types.ts` when convenient and drop this alias.
 */
export type SessionWithIdle = FocusSession & { idleSec?: number };

/** Read a session's idle seconds (0 when absent), guarding against junk. */
export function sessionIdleSec(s: FocusSession): number {
  const v = (s as SessionWithIdle).idleSec;
  return typeof v === 'number' && v > 0 ? Math.round(v) : 0;
}

/** Real work = wall-clock duration minus idle, never negative. */
export function realWorkSec(durationSec: number, idleSec: number): number {
  return Math.max(0, durationSec - Math.max(0, idleSec));
}

/**
 * Batch: total idle seconds for a session running [start, end], given the epoch-ms
 * timestamps of user activity in between. `start` and `end` act as boundary marks,
 * so the pre-first-activity and post-last-activity stretches count too. Any gap
 * between consecutive marks that REACHES the threshold contributes its FULL length
 * as idle (you didn't touch anything for ≥ threshold ⇒ that whole span was away);
 * shorter gaps are normal working rhythm and count as active.
 */
export function idleSeconds(
  activity: readonly number[],
  start: number,
  end: number,
  thresholdSec: number = IDLE_THRESHOLD_SEC,
): number {
  if (end <= start) return 0;
  const thr = thresholdSec * 1000;
  const marks = [start];
  for (const t of activity) {
    if (t > start && t < end) marks.push(t);
  }
  marks.push(end);
  marks.sort((a, b) => a - b);
  let idleMs = 0;
  for (let i = 1; i < marks.length; i++) {
    const gap = marks[i] - marks[i - 1];
    if (gap >= thr) idleMs += gap;
  }
  return Math.round(idleMs / 1000);
}

// ── streaming reducer (drives the live tracker) ──────────────────────────────
// The live tracker can't keep every mousemove timestamp for a multi-hour session,
// so it folds activity into a tiny running state. These fold the SAME rule as the
// batch `idleSeconds` above (folding a session's sorted in-range activity then
// finalizing at `end` yields the identical total — see idle.test.ts).

export interface IdleState {
  last: number; // epoch ms of the most recent activity mark (or the session start)
  idleMs: number; // idle accumulated from gaps already CLOSED by later activity
}

export function initIdle(startMs: number): IdleState {
  return { last: startMs, idleMs: 0 };
}

/** Fold one activity mark at `nowMs`, closing the gap since `last`. Backwards /
 *  duplicate timestamps (clock skew) are ignored so idle can never go negative. */
export function foldActivity(state: IdleState, nowMs: number, thresholdSec = IDLE_THRESHOLD_SEC): IdleState {
  if (nowMs <= state.last) return state;
  const gap = nowMs - state.last;
  const idleMs = gap >= thresholdSec * 1000 ? state.idleMs + gap : state.idleMs;
  return { last: nowMs, idleMs };
}

/** Idle seconds so far, also counting the still-open (silent) stretch [last, now]. */
export function idleSoFarSec(state: IdleState, nowMs: number, thresholdSec = IDLE_THRESHOLD_SEC): number {
  const openGap = nowMs - state.last;
  const openIdle = openGap >= thresholdSec * 1000 ? openGap : 0;
  return Math.round((state.idleMs + Math.max(0, openIdle)) / 1000);
}
