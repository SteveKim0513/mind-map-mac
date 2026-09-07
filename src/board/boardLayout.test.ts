import { describe, it, expect } from 'vitest';
import { layoutConnectedCluster, filterGridPositions } from './boardLayout';
import type { BoardElement, BoardStickyElement, BoardConnectorElement } from '../types';

function sticky(id: string, x: number, y: number, width = 100, height = 60): BoardStickyElement {
  return { id, kind: 'sticky', x, y, width, height, text: id };
}

function connector(id: string, fromId: string, toId: string, fromAnchor: BoardConnectorElement['fromAnchor'] = 'right'): BoardConnectorElement {
  const opposite = { right: 'left', left: 'right', bottom: 'top', top: 'bottom' } as const;
  return { id, kind: 'connector', fromId, fromAnchor, toId, toAnchor: opposite[fromAnchor], arrow: true };
}

// These exercise the REAL elkjs `layered` algorithm (dynamically imported,
// same as production) rather than mocking it — exact pixel coordinates are
// elkjs's own implementation detail (and could shift across elkjs versions),
// so assertions stick to BEHAVIOR this function itself is responsible for:
// which nodes end up positioned, that the root stays anchored, and that no
// relationship is silently dropped from the graph handed to elkjs.
describe('layoutConnectedCluster', () => {
  it('returns [] when the root has no connectors at all', async () => {
    const elements: Record<string, BoardElement> = { root: sticky('root', 0, 0) };
    expect(await layoutConnectedCluster('root', elements)).toEqual([]);
  });

  it('returns [] for an unknown or non-box root id', async () => {
    expect(await layoutConnectedCluster('missing', {})).toEqual([]);
  });

  it('keeps the root at its current position and places a connected child elsewhere', async () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 500, 500, 100, 60),
      child: sticky('child', 999, 999, 120, 80),
      c1: connector('c1', 'root', 'child'),
    };
    const positions = await layoutConnectedCluster('root', elements);
    const byId = Object.fromEntries(positions.map((p) => [p.id, p]));
    expect(byId.root).toEqual({ id: 'root', x: 500, y: 500 });
    expect(byId.child).toBeDefined();
    expect(byId.child.x !== 500 || byId.child.y !== 500).toBe(true); // not stacked on the root
  });

  it('ignores a connector pointing at a non-box element', async () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 0, 0),
      child: sticky('child', 0, 0),
      bad: connector('bad', 'root', 'ghost'), // 'ghost' does not exist
      c1: connector('c1', 'root', 'child'),
    };
    const positions = await layoutConnectedCluster('root', elements);
    expect(positions.some((p) => p.id === 'ghost')).toBe(false);
    expect(positions.some((p) => p.id === 'child')).toBe(true);
  });

  it('includes a node reachable only via an INCOMING edge, not just outgoing (2026-09-07: this is the whole point of the redesign)', async () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 0, 0),
      upstream: sticky('upstream', 0, 0),
      c1: connector('c1', 'upstream', 'root'), // points AT root, not from it
    };
    const positions = await layoutConnectedCluster('root', elements);
    expect(positions.some((p) => p.id === 'upstream')).toBe(true);
  });

  it('keeps every node in a diamond (A→B, A→C, B→D, C→D) — no relationship silently dropped', async () => {
    const elements: Record<string, BoardElement> = {
      a: sticky('a', 500, 500),
      b: sticky('b', 0, 0),
      c: sticky('c', 0, 0),
      d: sticky('d', 0, 0),
      c1: connector('c1', 'a', 'b'),
      c2: connector('c2', 'a', 'c'),
      c3: connector('c3', 'b', 'd'),
      c4: connector('c4', 'c', 'd'), // second, independent path into d
    };
    const positions = await layoutConnectedCluster('a', elements);
    const ids = positions.map((p) => p.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
    expect(positions.find((p) => p.id === 'a')).toEqual({ id: 'a', x: 500, y: 500 });
  });

  it('is deterministic — the same graph laid out twice yields the same positions', async () => {
    const elements: Record<string, BoardElement> = {
      root: sticky('root', 10, 20, 100, 60),
      a: sticky('a', 0, 0, 100, 40),
      b: sticky('b', 0, 0, 100, 40),
      c1: connector('c1', 'root', 'a'),
      c2: connector('c2', 'root', 'b'),
      c3: connector('c3', 'a', 'b'),
    };
    const first = await layoutConnectedCluster('root', elements);
    const second = await layoutConnectedCluster('root', elements);
    expect(second).toEqual(first);
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
