import { describe, it, expect } from 'vitest';
import { autoLayoutPositions, filterGridPositions } from './boardLayout';
import type { BoardElement, BoardStickyElement, BoardConnectorElement } from '../types';

function sticky(id: string, x: number, y: number, width = 100, height = 60): BoardStickyElement {
  return { id, kind: 'sticky', x, y, width, height, text: id };
}

function connector(id: string, fromId: string, toId: string, fromAnchor: BoardConnectorElement['fromAnchor'] = 'right'): BoardConnectorElement {
  const opposite = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' } as const;
  return { id, kind: 'connector', fromId, fromAnchor, toId, toAnchor: opposite[fromAnchor], arrow: true };
}

describe('autoLayoutPositions', () => {
  it('returns [] when the root has no outgoing connectors', () => {
    const elements: Record<string, BoardElement> = { root: sticky('root', 0, 0) };
    expect(autoLayoutPositions('root', elements)).toEqual([]);
  });

  it('returns [] for an unknown or non-box root id', () => {
    expect(autoLayoutPositions('missing', {})).toEqual([]);
  });

  it('keeps the root in place and places a single child one column over', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 500, 500, 100, 60),
      child: sticky('child', 999, 999, 120, 80),
      c1: connector('c1', 'root', 'child'),
    };
    const positions = autoLayoutPositions('root', elements);
    const byId = Object.fromEntries(positions.map((p) => [p.id, p]));
    expect(byId.root).toEqual({ id: 'root', x: 500, y: 500 });
    expect(byId.child.x).toBe(500 + 100 + 96); // one H_GAP (96) past the root's right edge
    // vertically centered on the root's own center (500 + 60/2 = 530), child height 80 → y = 530-40
    expect(byId.child.y).toBe(530 - 40);
  });

  it('stacks multiple siblings in the same column, centered on the parent', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 0, 0, 100, 60),
      a: sticky('a', 0, 0, 100, 40),
      b: sticky('b', 0, 0, 100, 40),
      c1: connector('c1', 'root', 'a'),
      c2: connector('c2', 'root', 'b'),
    };
    const byId = Object.fromEntries(autoLayoutPositions('root', elements).map((p) => [p.id, p]));
    expect(byId.a.x).toBe(byId.b.x); // same depth column
    expect(byId.b.y).toBeGreaterThan(byId.a.y); // stacked, not overlapping
  });

  it('does not revisit an element reachable by two different edges (no infinite loop)', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 0, 0),
      a: sticky('a', 0, 0),
      b: sticky('b', 0, 0),
      shared: sticky('shared', 0, 0),
      c1: connector('c1', 'root', 'a'),
      c2: connector('c2', 'root', 'b'),
      c3: connector('c3', 'a', 'shared'),
      c4: connector('c4', 'b', 'shared'), // second edge into an already-visited node
    };
    const positions = autoLayoutPositions('root', elements);
    const sharedCount = positions.filter((p) => p.id === 'shared').length;
    expect(sharedCount).toBe(1);
  });

  it('ignores a connector pointing at a non-box element', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 0, 0),
      child: sticky('child', 0, 0),
      bad: connector('bad', 'root', 'ghost'), // 'ghost' does not exist
      c1: connector('c1', 'root', 'child'),
    };
    const positions = autoLayoutPositions('root', elements);
    expect(positions.some((p) => p.id === 'ghost')).toBe(false);
    expect(positions.some((p) => p.id === 'child')).toBe(true);
  });

  // ── 2026-09-07 redesign: each of the root's arms follows the anchor
  //    direction its OWN connector used, instead of always going rightward ──

  it('places a child BELOW the root when connected via a bottom anchor', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 500, 500, 100, 60),
      child: sticky('child', 999, 999, 120, 80),
      c1: connector('c1', 'root', 'child', 'bottom'),
    };
    const byId = Object.fromEntries(autoLayoutPositions('root', elements).map((p) => [p.id, p]));
    expect(byId.child.y).toBe(500 + 60 + 96); // one PRIMARY_GAP (96) below the root's bottom edge
    // horizontally centered on the root's own center (500 + 100/2 = 550), child width 120 → x = 550-60
    expect(byId.child.x).toBe(550 - 60);
  });

  it('places a child to the LEFT when connected via a left anchor', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 500, 500, 100, 60),
      child: sticky('child', 999, 999, 120, 80),
      c1: connector('c1', 'root', 'child', 'left'),
    };
    const byId = Object.fromEntries(autoLayoutPositions('root', elements).map((p) => [p.id, p]));
    expect(byId.child.x).toBe(500 - 96 - 120); // one PRIMARY_GAP left of the root's left edge, minus the child's own width
  });

  it('places a child ABOVE when connected via a top anchor', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 500, 500, 100, 60),
      child: sticky('child', 999, 999, 120, 80),
      c1: connector('c1', 'root', 'child', 'top'),
    };
    const byId = Object.fromEntries(autoLayoutPositions('root', elements).map((p) => [p.id, p]));
    expect(byId.child.y).toBe(500 - 96 - 80); // one PRIMARY_GAP above the root's top edge, minus the child's own height
  });

  it('a whole branch keeps growing in its arm\'s direction, ignoring deeper connectors\' own anchor side', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 0, 0, 100, 60),
      a: sticky('a', 0, 0, 100, 40),
      b: sticky('b', 0, 0, 100, 40),
      c1: connector('c1', 'root', 'a', 'bottom'),
      // a→b's own connector claims 'right', but b should still land BELOW a
      // (further down the 'bottom' arm), not to a's right — since it inherits
      // the arm's direction rather than using its own connector's side.
      c2: connector('c2', 'a', 'b', 'right'),
    };
    const byId = Object.fromEntries(autoLayoutPositions('root', elements).map((p) => [p.id, p]));
    expect(byId.b.y).toBeGreaterThan(byId.a.y);
    expect(byId.a.y).toBeGreaterThan(0); // below the root
  });

  it('independent arms in different directions from the same root do not interfere with each other', () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 0, 0, 100, 60),
      right1: sticky('right1', 0, 0, 100, 40),
      down1: sticky('down1', 0, 0, 100, 40),
      cr: connector('cr', 'root', 'right1', 'right'),
      cd: connector('cd', 'root', 'down1', 'bottom'),
    };
    const byId = Object.fromEntries(autoLayoutPositions('root', elements).map((p) => [p.id, p]));
    expect(byId.right1.x).toBeGreaterThan(0); // to the right of the root
    expect(byId.right1.y).toBe(30 - 20); // vertically centered on the root (center Y 30), single child in the arm
    expect(byId.down1.y).toBeGreaterThan(0); // below the root
    expect(byId.down1.x).toBe(0); // horizontally centered on the root (center X 50), single child in the arm
  });
});

describe('filterGridPositions', () => {
  it('returns {} for an empty order list', () => {
    expect(filterGridPositions([], {}, 1000)).toEqual({});
  });

  it('places one element at the origin', () => {
    const elements: Record<string, BoardElement> = { a: sticky('a', 999, 999, 100, 60) };
    expect(filterGridPositions(['a'], elements, 1000)).toEqual({ a: { x: 0, y: 0 } });
  });

  it('wraps to a new row when elements no longer fit the viewport width', () => {
    const elements: Record<string, BoardElement> = {
      a: sticky('a', 0, 0, 100, 60),
      b: sticky('b', 0, 0, 100, 60),
      c: sticky('c', 0, 0, 100, 60),
    };
    // colWidth = 100 + 24 = 124; viewport 300 fits 2 columns (floor(300/124)=2)
    const pos = filterGridPositions(['a', 'b', 'c'], elements, 300);
    expect(pos.a).toEqual({ x: 0, y: 0 });
    expect(pos.b).toEqual({ x: 124, y: 0 });
    expect(pos.c).toEqual({ x: 0, y: 60 + 24 }); // wrapped to row 2
  });

  it('sizes each row by its tallest element', () => {
    const elements: Record<string, BoardElement> = {
      tall: sticky('tall', 0, 0, 100, 200),
      short: sticky('short', 0, 0, 100, 40),
      next: sticky('next', 0, 0, 100, 40),
    };
    // 1 column (viewport only fits one 124px-wide cell)
    const pos = filterGridPositions(['tall', 'short', 'next'], elements, 150);
    expect(pos.tall).toEqual({ x: 0, y: 0 });
    expect(pos.short).toEqual({ x: 0, y: 200 + 24 });
    expect(pos.next).toEqual({ x: 0, y: 200 + 24 + 40 + 24 });
  });

  it('ignores connectors and unknown ids in the order list', () => {
    const elements: Record<string, BoardElement> = {
      a: sticky('a', 0, 0),
      c1: { id: 'c1', kind: 'connector', fromId: 'a', fromAnchor: 'right', toId: 'a', toAnchor: 'left' },
    };
    const pos = filterGridPositions(['a', 'c1', 'missing'], elements, 1000);
    expect(Object.keys(pos)).toEqual(['a']);
  });
});
