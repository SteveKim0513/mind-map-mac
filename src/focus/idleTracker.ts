// Live idle accumulator bridging the React activity listeners (useIdleTracker)
// and the session controller. It's a module singleton because endFocusSession()
// is a plain async action — not a component — and must read the idle total at the
// moment of ending. State is mirrored to localStorage keyed by sessionId so a
// session recovered after a restart keeps its idle estimate (the closed-app gap
// then counts as idle, which is the honest reading — the user wasn't in the app).

import { type IdleState, initIdle, foldActivity, idleSoFarSec } from './idle';

const storeKey = (sessionId: string) => `focusIdle:${sessionId}`;

let activeSessionId: string | null = null;
let state: IdleState | null = null;
// The just-finished session's idle, for the completion card (which only knows the
// note path). Single-slot: there is only ever one completion card at a time.
let lastFinished: { notePath: string; idleSec: number } | null = null;

function persist(): void {
  if (!activeSessionId || !state) return;
  try {
    localStorage.setItem(storeKey(activeSessionId), JSON.stringify(state));
  } catch {
    /* localStorage unavailable — tracking still works in-memory this run */
  }
}

export const idleTracker = {
  /** Start or resume tracking a session (idempotent per sessionId — a restart
   *  resumes the persisted state rather than resetting the idle total). */
  begin(sessionId: string, startMs: number): void {
    activeSessionId = sessionId;
    let restored: IdleState | null = null;
    try {
      const raw = localStorage.getItem(storeKey(sessionId));
      if (raw) {
        const p = JSON.parse(raw) as Partial<IdleState>;
        if (typeof p?.last === 'number' && typeof p?.idleMs === 'number') {
          restored = { last: p.last, idleMs: p.idleMs };
        }
      }
    } catch {
      /* ignore malformed / unavailable storage */
    }
    state = restored ?? initIdle(startMs);
    persist();
  },

  /** Fold one activity ping at `nowMs`. */
  record(nowMs: number): void {
    if (!state) return;
    state = foldActivity(state, nowMs);
    persist();
  },

  /** Idle seconds so far while the session is still running (0 when not tracking). */
  currentIdleSec(nowMs: number): number {
    return state ? idleSoFarSec(state, nowMs) : 0;
  },

  /** Finalize: the total idle seconds at `endMs`; clears the active state + its
   *  localStorage mirror. Returns 0 when nothing was tracked. */
  finish(endMs: number): number {
    if (!state) return 0;
    const total = idleSoFarSec(state, endMs);
    if (activeSessionId) {
      try {
        localStorage.removeItem(storeKey(activeSessionId));
      } catch {
        /* ignore */
      }
    }
    activeSessionId = null;
    state = null;
    return total;
  },

  /** Remember the finished session's idle so the completion card can show it. */
  stashFinished(notePath: string, idleSec: number): void {
    lastFinished = { notePath, idleSec };
  },

  /** Idle seconds of the most recently finished session, matched by note path. */
  finishedIdleSec(notePath: string): number {
    return lastFinished && lastFinished.notePath === notePath ? lastFinished.idleSec : 0;
  },

  /** Test/reset hook — clears all in-memory state. */
  _reset(): void {
    activeSessionId = null;
    state = null;
    lastFinished = null;
  },
};
