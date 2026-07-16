// Observes user activity during the active focus session and feeds the idle
// tracker. Mounted once inside FocusOverlay (already wired into App.tsx), so no
// top-level App.tsx change is needed. Listeners attach only while a session runs.

import { useEffect } from 'react';
import { useUi } from '../store/uiStore';
import { idleTracker } from './idleTracker';

// Activity events (esp. mousemove) are noisy; one ping per 15s is plenty against
// a 600s idle threshold and keeps the reducer cheap.
const THROTTLE_MS = 15_000;

export function useIdleTracker(): void {
  // narrow subscriptions — re-arm only when the session identity changes
  const sessionId = useUi((s) => s.activeFocus?.sessionId);
  const start = useUi((s) => s.activeFocus?.start);

  useEffect(() => {
    if (!sessionId || start == null) return;
    idleTracker.begin(sessionId, start);

    let lastRec = 0;
    const ping = () => {
      const t = Date.now();
      if (t - lastRec < THROTTLE_MS) return;
      lastRec = t;
      idleTracker.record(t);
    };
    // A visibility flip (app hidden/shown) is a meaningful boundary — record it
    // unthrottled so a long time away in another app is bracketed correctly.
    const onVisibility = () => idleTracker.record(Date.now());

    const opts: AddEventListenerOptions = { passive: true, capture: true };
    window.addEventListener('keydown', ping, opts);
    window.addEventListener('mousemove', ping, opts);
    window.addEventListener('mousedown', ping, opts);
    window.addEventListener('wheel', ping, opts);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', ping, opts);
      window.removeEventListener('mousemove', ping, opts);
      window.removeEventListener('mousedown', ping, opts);
      window.removeEventListener('wheel', ping, opts);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [sessionId, start]);
}
