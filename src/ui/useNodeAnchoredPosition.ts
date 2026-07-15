import { useLayoutEffect, useState } from 'react';

/** Position a fixed-width popover just below the canvas node it's editing
 *  (`[data-node-id]`), clamped so it never runs off the left/right edge, with
 *  an optional flip-above-the-node fallback when there isn't room below.
 *  Shared by SchedulePopover/NodePopover/LinkAddPopover, which previously each
 *  hand-copied this same anchor-and-clamp math (UX-CLARITY-VISION 전략 A). */
export function useNodeAnchoredPosition(
  nodeId: string,
  width: number,
  opts?: { gap?: number; height?: number; edgeMargin?: number },
): { left: number; top: number } | null {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const gap = opts?.gap ?? 10;
  const margin = opts?.edgeMargin ?? 12;
  const height = opts?.height;

  useLayoutEffect(() => {
    const el = document.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null;
    if (!el) {
      setPos({ left: window.innerWidth - width - 24, top: 80 });
      return;
    }
    const r = el.getBoundingClientRect();
    const left = Math.max(margin, Math.min(r.left, window.innerWidth - width - margin));
    let top = r.bottom + gap;
    if (height && top + height > window.innerHeight - margin) {
      top = Math.max(margin, r.top - height - gap);
    }
    setPos({ left, top });
  }, [nodeId, width, gap, margin, height]);

  return pos;
}
