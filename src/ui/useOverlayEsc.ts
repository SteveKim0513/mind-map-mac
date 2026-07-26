import { useEffect } from 'react';
import { useUi, type OverlayId } from '../store/uiStore';

/** Escape handling for a managed overlay (ADR 0018). Every stacked overlay used
 *  to register its own window-capture keydown, so overlapping overlays all
 *  closed on one Esc (stopPropagation can't block other listeners on the same
 *  target). This hook makes Esc a one-step back: it only fires the callback
 *  when `id` is on TOP of the overlay stack — checked straight from the store,
 *  so the outcome is deterministic regardless of listener registration order.
 *  Palettes (⌘P/⌘K/global search/in-map search) are not in the stack but sit
 *  above it; while one is open we ignore Esc entirely and let the palette's own
 *  handler close it — that IS the one step back. */
export function useOverlayEsc(id: OverlayId, onEsc: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const s = useUi.getState();
      if (s.quickOpen || s.cmdkOpen || s.globalSearchOpen || s.searchOpen) return;
      if (s.overlayStack[s.overlayStack.length - 1] !== id) return;
      e.stopPropagation(); // don't let canvas/base UI also react to this Esc
      onEsc();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [id, onEsc]);
}
