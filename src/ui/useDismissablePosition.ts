import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Clamp a floating menu/popover to the viewport and close it on outside click
 *  or Escape — the position+dismiss logic every ad-hoc floating menu in this
 *  app needs. Extracted so new ones (and existing ones, like the tab strip's
 *  right-click menu) don't each reinvent it slightly differently — before this,
 *  the tab menu had neither Escape support nor viewport clamping, unlike the
 *  canvas context menu (UX-CLARITY-VISION 전략 A). */
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

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [onClose]);

  return { ref, pos };
}
