import type { BoardAnchorSide, BoardElement, BoardImageElement, BoardStickyElement } from '../types';

// Must match .board-sticky-notes's `margin-top` and `gap` in styles.css —
// used to derive each fused note box's world position analytically from the
// sticky's own box plus every note's MEASURED height (heights aren't stored
// in the doc; they auto-grow with text — see BoardCanvasArea's note
// measurement effect, mirroring layout/measure.ts's offsetHeight pattern).
const NOTE_TOP_MARGIN = 6;
const NOTE_GAP = 6;

export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type BoxElement = BoardStickyElement | BoardImageElement;

export function isBoxElement(el: BoardElement): el is BoxElement {
  return el.kind !== 'connector';
}

export function elementBBox(el: BoxElement): BBox {
  return { x0: el.x, y0: el.y, x1: el.x + el.width, y1: el.y + el.height };
}

/** Bounding box of every sticky/image, or null when there are none. Connectors
 *  are excluded — their span always sits inside their two endpoints' boxes. */
export function boardBounds(elements: Record<string, BoardElement>): BBox | null {
  const boxes = Object.values(elements).filter(isBoxElement).map(elementBBox);
  if (boxes.length === 0) return null;
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}

/** World-space point where a connector attaches to a box — mid-edge on the
 *  given side, regardless of the box's own outline shape (kept simple;
 *  Miro/Freeform approximate the same way). Takes a plain `BBox` (rather
 *  than an element) so it works identically for an element's own box and for
 *  a fused note's box (see `noteBBox`). */
export function anchorPointOfBox(box: BBox, side: BoardAnchorSide): { x: number; y: number } {
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  switch (side) {
    case 'top':
      return { x: cx, y: box.y0 };
    case 'bottom':
      return { x: cx, y: box.y1 };
    case 'left':
      return { x: box.x0, y: cy };
    case 'right':
      return { x: box.x1, y: cy };
  }
}

/** World-space point where a connector attaches to an element's bounding box
 *  — mid-edge on the given side. */
export function anchorPoint(el: BoxElement, side: BoardAnchorSide): { x: number; y: number } {
  return anchorPointOfBox(elementBBox(el), side);
}

/** World bbox of the i-th fused note block stacked below a sticky (see
 *  `BoardStickyElement.notes`) — derived analytically from the sticky's own
 *  box plus every note's MEASURED height up to and including this one
 *  (`heights[i]`, indexed like `el.notes`; a missing/not-yet-measured height
 *  counts as 0). Width matches the sticky's own width and the block starts
 *  right below it — see `.board-sticky-notes`'s CSS (margin-top) and
 *  BoardElementView.tsx's doc comment on why notes stack in normal flow past
 *  the sticky's own height instead of being clipped inside it. */
export function noteBBox(el: BoardStickyElement, index: number, heights: number[]): BBox {
  let y = el.y + el.height + NOTE_TOP_MARGIN;
  for (let i = 0; i < index; i++) y += (heights[i] ?? 0) + NOTE_GAP;
  const h = heights[index] ?? 0;
  return { x0: el.x, y0: y, x1: el.x + el.width, y1: y + h };
}

/** Resolves which box a connector endpoint (or an in-progress anchor drag)
 *  actually attaches to: `el`'s own box, or — when `noteIndex` is given and
 *  still valid — one of its fused note boxes instead (see `noteBBox`). Falls
 *  back to the element's own box on a stale index (its note was deleted
 *  after the connector was drawn — `boardStore.removeStickyNote` keeps
 *  indices in sync, but this is a defensive fallback, not the primary path)
 *  rather than erroring. Returns null only if `el` itself is missing. */
export function anchorBoxFor(el: BoxElement | undefined, noteIndex: number | undefined, heights: number[] | undefined): BBox | null {
  if (!el) return null;
  if (noteIndex != null && el.kind === 'sticky' && el.notes && noteIndex < el.notes.length) {
    return noteBBox(el, noteIndex, heights ?? []);
  }
  return elementBBox(el);
}

const OPPOSITE: Record<BoardAnchorSide, BoardAnchorSide> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

export function oppositeAnchor(side: BoardAnchorSide): BoardAnchorSide {
  return OPPOSITE[side];
}
