import { describe, it, expect } from 'vitest';
import { autoLayoutPositions } from './boardLayout';
import type { BoardElement, BoardStickyElement, BoardConnectorElement } from '../types';

function sticky(id: string, x: number, y: number, width = 100, height = 60): BoardStickyElement {
  return { id, kind: 'sticky', x, y, width, height, text: id };
}

function connector(id: string, fromId: string, toId: string): BoardConnectorElement {
  return { id, kind: 'connector', fromId, fromAnchor: 'right', toId, toAnchor: 'left', arrow: true };
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
});
