import type { BoardAnchorSide, BoardElement, BoardImageElement, BoardStickyElement } from '../types';

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

/** World-space point where a connector attaches to an element's bounding box
 *  — mid-edge on the given side, regardless of the element's own outline
 *  shape (kept simple; Miro/Freeform approximate the same way). */
export function anchorPoint(el: BoxElement, side: BoardAnchorSide): { x: number; y: number } {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  switch (side) {
    case 'top':
      return { x: cx, y: el.y };
    case 'bottom':
      return { x: cx, y: el.y + el.height };
    case 'left':
      return { x: el.x, y: cy };
    case 'right':
      return { x: el.x + el.width, y: cy };
  }
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
