import { describe, it, expect } from 'vitest';
import { anchorPointOfBox, anchorBoxFor, elementBBox, noteBBox } from './boardGeometry';
import type { BoardStickyElement } from '../types';

function sticky(over: Partial<BoardStickyElement> = {}): BoardStickyElement {
  return { id: 's1', kind: 'sticky', x: 100, y: 100, width: 180, height: 140, text: '', ...over };
}

describe('anchorPointOfBox', () => {
  it('returns the mid-edge point for each side', () => {
    const box = { x0: 0, y0: 0, x1: 100, y1: 40 };
    expect(anchorPointOfBox(box, 'top')).toEqual({ x: 50, y: 0 });
    expect(anchorPointOfBox(box, 'bottom')).toEqual({ x: 50, y: 40 });
    expect(anchorPointOfBox(box, 'left')).toEqual({ x: 0, y: 20 });
    expect(anchorPointOfBox(box, 'right')).toEqual({ x: 100, y: 20 });
  });
});

describe('noteBBox', () => {
  it('places the first note directly below the sticky (+ top margin), spanning its full width', () => {
    const el = sticky();
    const box = noteBBox(el, 0, [50]);
    expect(box).toEqual({ x0: 100, y0: 100 + 140 + 6, x1: 100 + 180, y1: 100 + 140 + 6 + 50 });
  });

  it('stacks later notes below every earlier one, each separated by the note gap', () => {
    const el = sticky();
    const heights = [50, 30, 70];
    const box2 = noteBBox(el, 2, heights);
    // el.y + el.height + topMargin + (h0 + gap) + (h1 + gap)
    const expectedY0 = el.y + el.height + 6 + (50 + 6) + (30 + 6);
    expect(box2.y0).toBe(expectedY0);
    expect(box2.y1).toBe(expectedY0 + 70);
  });

  it('treats a missing/not-yet-measured height as 0 rather than throwing', () => {
    const el = sticky();
    const box = noteBBox(el, 1, [50]); // heights[1] is undefined
    expect(box.y1).toBe(box.y0); // zero-height box
  });
});

describe('anchorBoxFor', () => {
  it('resolves to the note box when noteIndex is valid', () => {
    const el = sticky({ notes: ['a', 'b'] });
    const box = anchorBoxFor(el, 1, [40, 60]);
    expect(box).toEqual(noteBBox(el, 1, [40, 60]));
  });

  it('falls back to the element\'s own box when noteIndex is unset', () => {
    const el = sticky({ notes: ['a'] });
    expect(anchorBoxFor(el, undefined, [40])).toEqual(elementBBox(el));
  });

  it('falls back to the element\'s own box on a stale/out-of-range note index (note deleted after the connector was drawn)', () => {
    const el = sticky({ notes: ['a'] });
    expect(anchorBoxFor(el, 5, [40])).toEqual(elementBBox(el));
  });

  it('falls back to the element\'s own box for a non-sticky (e.g. image) even if a noteIndex is somehow set', () => {
    const el = { id: 'i1', kind: 'image' as const, x: 0, y: 0, width: 50, height: 50, src: 'a.png' };
    expect(anchorBoxFor(el, 0, undefined)).toEqual(elementBBox(el));
  });

  it('returns null only when the element itself is missing', () => {
    expect(anchorBoxFor(undefined, 0, undefined)).toBeNull();
  });
});
