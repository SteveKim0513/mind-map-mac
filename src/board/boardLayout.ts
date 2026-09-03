import type { BoardElement } from '../types';
import { isBoxElement, type BoxElement } from './boardGeometry';

const H_GAP = 96; // px between depth columns
const V_GAP = 32; // px between siblings in the same column

/** Auto-arrange the connected cluster reachable from `rootId` by following
 *  connectors in their `fromId → toId` direction (the same direction a click
 *  on an anchor creates a child in) into left-to-right columns by depth,
 *  siblings stacked and vertically centered on their parent. A pragmatic
 *  BFS-tree layout for a board's free-form connector graph — not the
 *  mindmap's `layout/treeLayout.ts` (that's coupled to MindNode/PositionedNode
 *  and a strict parent-tree; a board graph can have cycles/multiple parents,
 *  and board/ can't import layout/'s internals across the domain boundary
 *  anyway). Visits each element once (first edge wins), so cycles and
 *  diamonds just stop expanding rather than looping. The root keeps its
 *  current position; only descendants move. Returns [] if `rootId` isn't a
 *  sticky/image or has no outgoing connectors. */
export function autoLayoutPositions(
  rootId: string,
  elements: Record<string, BoardElement>,
): { id: string; x: number; y: number }[] {
  const root = elements[rootId];
  if (!root || !isBoxElement(root)) return [];

  const childrenOf = new Map<string, string[]>();
  for (const el of Object.values(elements)) {
    if (el.kind !== 'connector') continue;
    const list = childrenOf.get(el.fromId) ?? [];
    list.push(el.toId);
    childrenOf.set(el.fromId, list);
  }

  const depthOf = new Map<string, number>([[rootId, 0]]);
  const byDepth: string[][] = [[rootId]];
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    const depth = depthOf.get(cur)!;
    for (const childId of childrenOf.get(cur) ?? []) {
      if (depthOf.has(childId)) continue; // already visited via a shorter/earlier path
      const el = elements[childId];
      if (!el || !isBoxElement(el)) continue;
      depthOf.set(childId, depth + 1);
      (byDepth[depth + 1] ??= []).push(childId);
      queue.push(childId);
    }
  }

  if (byDepth.length <= 1) return []; // nothing connected outward from root

  const positions: { id: string; x: number; y: number }[] = [{ id: rootId, x: root.x, y: root.y }];
  const rootCenterY = root.y + root.height / 2;
  let x = root.x + root.width + H_GAP;

  for (let depth = 1; depth < byDepth.length; depth++) {
    const ids = byDepth[depth];
    const els = ids.map((id) => elements[id] as BoxElement);
    const totalH = els.reduce((sum, el) => sum + el.height, 0) + V_GAP * (els.length - 1);
    let y = rootCenterY - totalH / 2;
    for (let i = 0; i < ids.length; i++) {
      positions.push({ id: ids[i], x, y });
      y += els[i].height + V_GAP;
    }
    x += Math.max(...els.map((el) => el.width)) + H_GAP;
  }

  return positions;
}
