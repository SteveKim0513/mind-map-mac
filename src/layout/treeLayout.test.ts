import { describe, it, expect } from 'vitest';
import { layout } from './treeLayout';
import type { MindMapDoc } from '../types';

function singleRoot(): MindMapDoc {
  return {
    version: 1,
    rootIds: ['a'],
    nodes: { a: { id: 'a', text: 'root', parentId: null, children: [], collapsed: false } },
    view: { zoom: 1, panX: 0, panY: 0 },
  };
}

describe('layout bounds (Closes #8)', () => {
  it('vertical bounds reflect node height + below-box chips, not just the center', () => {
    const doc = singleRoot();
    const { bounds } = layout(doc, { a: { w: 120, h: 40, below: 80 } });
    // a single node's vertical extent must equal its full below-box height (80),
    // not 0 (which is what using the center for both top and bottom produced).
    expect(bounds.maxY - bounds.minY).toBeCloseTo(80, 5);
  });

  it('horizontal bounds span the node width', () => {
    const doc = singleRoot();
    const { bounds } = layout(doc, { a: { w: 120, h: 40, below: 40 } });
    expect(bounds.maxX - bounds.minX).toBeCloseTo(120, 5);
  });
});

describe('focus + color filter composition (B1)', () => {
  // r → a → {b(red), c};  x(red) is a separate root, out of a's subtree.
  function doc(): MindMapDoc {
    return {
      version: 1,
      rootIds: ['r', 'x'],
      nodes: {
        r: { id: 'r', text: 'R', parentId: null, children: ['a'], collapsed: false },
        a: { id: 'a', text: 'A', parentId: 'r', children: ['b', 'c'], collapsed: false },
        b: { id: 'b', text: 'B', parentId: 'a', children: [], collapsed: false, color: 'red' },
        c: { id: 'c', text: 'C', parentId: 'a', children: [], collapsed: false },
        x: { id: 'x', text: 'X', parentId: null, children: [], collapsed: false, color: 'red' },
      },
      view: { zoom: 1, panX: 0, panY: 0 },
    };
  }
  const ids = (
    d: MindMapDoc,
    focusRootId: string | null,
    colorFilter: string | null,
    filterAncestors = false,
  ) => new Set(layout(d, {}, focusRootId, colorFilter, filterAncestors).nodes.map((n) => n.node.id));

  it('without focus, the filter surfaces matches document-wide', () => {
    const set = ids(doc(), null, 'red');
    expect(set.has('b')).toBe(true);
    expect(set.has('x')).toBe(true); // out-of-subtree match shows when not focused
  });

  it('focus + filter confines matches to the focused subtree', () => {
    const set = ids(doc(), 'a', 'red');
    expect(set.has('b')).toBe(true); // in-scope match
    expect(set.has('x')).toBe(false); // out-of-scope match must NOT appear
  });

  it('focus + filter + ancestors stops at the focus boundary', () => {
    const set = ids(doc(), 'a', 'red', true);
    expect(set.has('b')).toBe(true);
    expect(set.has('a')).toBe(true); // ancestor within the subtree is pulled in
    expect(set.has('r')).toBe(false); // ancestor ABOVE the focus root stays hidden
    expect(set.has('x')).toBe(false);
  });
});
