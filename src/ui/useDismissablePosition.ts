import { useLayoutEffect, useRef, useState } from 'react';
import { useOutsideDismiss } from './useOutsideDismiss';

/** Clamp a click-anchored floating menu (opened at a cursor x/y, like a
 *  right-click menu) to the viewport, and close it on outside click or
 *  Escape via useOutsideDismiss. Extracted so new ones (and existing ones,
 *  like the tab strip's right-click menu) don't each reinvent it slightly
 *  differently — before this, the tab menu had neither Escape support nor
 *  viewport clamping, unlike the canvas context menu (UX-CLARITY-VISION
 *  전략 A). Node-anchored popovers (Schedule/Node/LinkAdd) use
 *  useNodeAnchoredPosition instead — their position isn't click-based. */
export function useDismissablePosition<T extends HTMLElement>(
  x: number,
  y: number,
  onClose: () => void,
  opts?: { bottomInset?: number; rightInset?: number },
) {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - r.width - (opts?.rightInset ?? 8)),
      top: Math.min(y, window.innerHeight - r.height - (opts?.bottomInset ?? 8)),
    });
  }, [x, y, opts?.bottomInset, opts?.rightInset]);

  useOutsideDismiss(ref, onClose);

  return { ref, pos };
}
