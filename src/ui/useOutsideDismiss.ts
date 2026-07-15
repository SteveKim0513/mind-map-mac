import { useEffect, type RefObject } from 'react';

/** Close on outside click or Escape — the two dismiss rules every floating
 *  menu/popover in this app needs. Split out from useDismissablePosition so
 *  node-anchored popovers (SchedulePopover, NodePopover, LinkAddPopover — see
 *  useNodeAnchoredPosition) can share it too, even though they compute their
 *  position completely differently (anchored to a DOM node, not a click
 *  point) — before this, each of the three had its own hand-copied version
 *  (UX-CLARITY-VISION 전략 A). */
export function useOutsideDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  opts?: { skip?: (e: MouseEvent) => boolean },
) {
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return;
      if (opts?.skip?.(e)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [ref, onClose]);
}
