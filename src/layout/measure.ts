/**
 * Measure a node's full rendered footprint in layout pixels.
 *
 * The `.node` box only contains the text row; its chips (`.node-meta`) and
 * badges are absolutely positioned and overflow the box. The layout needs to
 * know how far they actually extend so it can reserve real space and never let
 * a neighbour overlap them. We use offsetTop/offsetHeight (unaffected by the
 * canvas zoom transform) rather than getBoundingClientRect.
 */
export function measureNode(el: HTMLElement): { w: number; h: number; below: number } {
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let below = h; // box top → lowest accessory bottom (defaults to the box itself)
  for (const child of Array.from(el.children) as HTMLElement[]) {
    if (
      child.classList.contains('node-gutter') ||
      child.classList.contains('progress-badge') ||
      child.classList.contains('count-badge')
    ) {
      if (child.offsetParent === null) continue; // hidden
      below = Math.max(below, child.offsetTop + child.offsetHeight);
    }
  }
  return { w, h, below };
}
