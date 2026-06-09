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
