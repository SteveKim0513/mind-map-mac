import type { BoardAnchorSide, BoardElement } from '../types';
import { isBoxElement, type BoxElement } from './boardGeometry';

const PRIMARY_GAP = 96; // px between depth columns/rows along an arm's growth axis
const CROSS_GAP = 32; // px between siblings along the perpendicular axis
const GRID_GAP = 24; // px between cells in the filter grid below

// Which world axis an arm grows along, and which way, per the anchor side its
// FIRST connector left the root from (2026-09-07 redesign — see the doc
// comment on autoLayoutPositions below for why direction is fixed per-arm).
const ARM_AXIS: Record<BoardAnchorSide, 'x' | 'y'> = { right: 'x', left: 'x', bottom: 'y', top: 'y' };
const ARM_SIGN: Record<BoardAnchorSide, 1 | -1> = { right: 1, left: -1, bottom: 1, top: -1 };

function crossSize(el: BoxElement, side: BoardAnchorSide): number {
  return ARM_AXIS[side] === 'x' ? el.height : el.width; // the OTHER dimension from the growth axis
}
function primarySize(el: BoxElement, side: BoardAnchorSide): number {
  return ARM_AXIS[side] === 'x' ? el.width : el.height;
}

/** Auto-arrange the connected cluster reachable from `rootId`, following
 *  connectors in their `fromId → toId` direction (the same direction a click
 *  on an anchor creates a child in) — a pragmatic BFS-tree layout for a
 *  board's free-form connector graph, reimplemented here rather than reusing
 *  `layout/treeLayout.ts` (board/ can't import layout/'s internals across the
 *  domain boundary, and that one is coupled to MindNode's single left→right
 *  axis anyway — see below).
 *
 *  2026-09-07 redesign: the board lets you connect in any of 4 directions
 *  (arrow-key child creation from any anchor side), but the original version
 *  of this function always laid descendants out in rightward columns
 *  regardless — "정리" would silently override a structure the user had
 *  deliberately built downward/leftward/upward. Now each of the root's
 *  DIRECT children picks an "arm" from the anchor side its own connector
 *  used, and that arm's entire subtree keeps growing in that SAME direction
 *  (a deeper connector's own `fromAnchor` is ignored once inside an arm).
 *  This is the classic "4-direction radial tree" shape mature mind-mapping
 *  tools use (e.g. XMind's logic-chart layout) rather than a fully general
 *  2D packer: letting every node branch in its own arbitrary direction risks
 *  one branch's descendants colliding with a sibling arm's — fixing the
 *  direction per-arm keeps the 4 arms in 4 non-overlapping quadrants around
 *  the root by construction, while still fixing the actual reported problem
 *  (a branch built in one direction stays in that direction). Each arm uses
 *  the same "reserve a disjoint band per subtree" block-packing idea as
 *  `layout/treeLayout.ts`, just parameterized over which world axis is the
 *  growth axis vs. the cross axis for that arm.
 *
 *  Visits each element once (first edge wins), so cycles and diamonds just
 *  stop expanding rather than looping. The root keeps its current position;
 *  only descendants move. Returns [] if `rootId` isn't a sticky/image or has
 *  no outgoing connectors. */
export function autoLayoutPositions(
  rootId: string,
  elements: Record<string, BoardElement>,
): { id: string; x: number; y: number }[] {
  const root = elements[rootId];
  if (!root || !isBoxElement(root)) return [];

  const outgoing = new Map<string, { id: string; side: BoardAnchorSide }[]>();
  for (const el of Object.values(elements)) {
    if (el.kind !== 'connector') continue;
    const list = outgoing.get(el.fromId) ?? [];
    list.push({ id: el.toId, side: el.fromAnchor });
    outgoing.set(el.fromId, list);
  }

  // BFS from root, assigning each visited element the arm (anchor side) it
  // belongs to — its own connector's side if its parent IS the root, else its
  // parent's arm (inherited, not its own connector's side).
  const sideOf = new Map<string, BoardAnchorSide>();
  const depthOf = new Map<string, number>([[rootId, 0]]);
  const childrenInTree = new Map<string, string[]>();
  const visited = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    const depth = depthOf.get(cur)!;
    const inheritedSide = sideOf.get(cur); // undefined only at the root
    for (const { id, side } of outgoing.get(cur) ?? []) {
      if (visited.has(id)) continue; // already visited via a shorter/earlier path
      const el = elements[id];
      if (!el || !isBoxElement(el)) continue;
      visited.add(id);
      sideOf.set(id, inheritedSide ?? side);
      depthOf.set(id, depth + 1);
      const kids = childrenInTree.get(cur);
      if (kids) kids.push(id);
      else childrenInTree.set(cur, [id]);
      queue.push(id);
    }
  }

  if (!childrenInTree.has(rootId)) return []; // nothing connected outward from root

  // cross-axis block size (subtree band width) per node, bottom-up.
  const blockMemo = new Map<string, number>();
  const blockSize = (id: string): number => {
    const cached = blockMemo.get(id);
    if (cached !== undefined) return cached;
    const el = elements[id] as BoxElement;
    const side = sideOf.get(id)!;
    const own = crossSize(el, side);
    const kids = childrenInTree.get(id) ?? [];
    let size = own;
    if (kids.length) {
      let sum = 0;
      kids.forEach((k, i) => { sum += blockSize(k) + (i ? CROSS_GAP : 0); });
      size = Math.max(own, sum);
    }
    blockMemo.set(id, size);
    return size;
  };

  // cross-axis center per node, top-down — centered on its children's span,
  // clamped to stay inside its own reserved band (mirrors treeLayout.ts's `place`).
  const crossCenterOf = new Map<string, number>();
  const placeCross = (id: string, top: number): number => {
    const el = elements[id] as BoxElement;
    const side = sideOf.get(id)!;
    const own = crossSize(el, side);
    const kids = childrenInTree.get(id) ?? [];
    if (!kids.length) {
      const c = top + own / 2;
      crossCenterOf.set(id, c);
      return c;
    }
    const block = blockSize(id);
    let childSum = 0;
    kids.forEach((k, i) => { childSum += blockSize(k) + (i ? CROSS_GAP : 0); });
    let cursor = top + (block - childSum) / 2;
    const centers: number[] = [];
    kids.forEach((k) => {
      centers.push(placeCross(k, cursor));
      cursor += blockSize(k) + CROSS_GAP;
    });
    const mid = (centers[0] + centers[centers.length - 1]) / 2;
    const c = Math.max(top + own / 2, Math.min(mid, top + block - own / 2));
    crossCenterOf.set(id, c);
    return c;
  };

  const rootKids = childrenInTree.get(rootId)!;
  const armsUsed = [...new Set(rootKids.map((id) => sideOf.get(id)!))];
  for (const side of armsUsed) {
    const arm = rootKids.filter((id) => sideOf.get(id) === side);
    const armBlock = arm.reduce((sum, id, i) => sum + blockSize(id) + (i ? CROSS_GAP : 0), 0);
    const rootCrossCenter = ARM_AXIS[side] === 'x' ? root.y + root.height / 2 : root.x + root.width / 2;
    let cursor = rootCrossCenter - armBlock / 2;
    for (const id of arm) {
      placeCross(id, cursor);
      cursor += blockSize(id) + CROSS_GAP;
    }
  }

  // primary-axis (growth-axis) position per node, per arm — each depth is one
  // column (left/right arms) or row (top/bottom arms), sized to its widest/
  // tallest member, exactly like the original single-direction version.
  const primaryOf = new Map<string, number>();
  for (const side of armsUsed) {
    const byDepth = new Map<number, string[]>();
    for (const [id, s] of sideOf) {
      if (s !== side) continue;
      const d = depthOf.get(id)!;
      const list = byDepth.get(d);
      if (list) list.push(id);
      else byDepth.set(d, [id]);
    }
    const maxDepth = Math.max(...byDepth.keys());
    const axis = ARM_AXIS[side];
    const sign = ARM_SIGN[side];
    const rootLeading = axis === 'x' ? (sign === 1 ? root.x + root.width : root.x) : sign === 1 ? root.y + root.height : root.y;
    let cursor = rootLeading + sign * PRIMARY_GAP;
    for (let depth = 1; depth <= maxDepth; depth++) {
      const ids = byDepth.get(depth) ?? [];
      for (const id of ids) primaryOf.set(id, cursor);
      const maxSize = Math.max(...ids.map((id) => primarySize(elements[id] as BoxElement, side)));
      cursor += sign * (maxSize + PRIMARY_GAP);
    }
  }

  const positions: { id: string; x: number; y: number }[] = [{ id: rootId, x: root.x, y: root.y }];
  for (const [id, side] of sideOf) {
    const el = elements[id] as BoxElement;
    const cross = crossCenterOf.get(id)!;
    const primary = primaryOf.get(id)!;
    if (side === 'right') positions.push({ id, x: primary, y: cross - el.height / 2 });
    else if (side === 'left') positions.push({ id, x: primary - el.width, y: cross - el.height / 2 });
    else if (side === 'bottom') positions.push({ id, x: cross - el.width / 2, y: primary });
    else positions.push({ id, x: cross - el.width / 2, y: primary - el.height });
  }
  return positions;
}

/** View-only grid arrangement for a color/shape filter's matching elements
 *  (2026-09-06 — "필터가 흐리게 dim만 하고, 마인드맵처럼 재배치하지 않음"). The
 *  mindmap's color filter excludes non-matching nodes from the tree layout
 *  itself, so the rest compact together; a board has no tree to compact, so
 *  this computes an equivalent fresh arrangement for JUST the matching
 *  elements — left to right, wrapping into rows sized to the current
 *  viewport's world-space width. Callers render elements at these positions
 *  WITHOUT writing them back to the document (`board.elements` keeps its real
 *  x/y untouched) — turning the filter off simply stops using this map and
 *  the real positions show again. `order` should already be just the
 *  matching elements, in the order to place them (e.g. board.order filtered
 *  to matches, so the grid reads in the same back-to-front order as the
 *  document). */
export function filterGridPositions(
  order: string[],
  elements: Record<string, BoardElement>,
  viewportWidth: number,
): Record<string, { x: number; y: number }> {
  const els = order.map((id) => elements[id]).filter((el): el is BoxElement => !!el && isBoxElement(el));
  if (els.length === 0) return {};

  const colWidth = Math.max(...els.map((el) => el.width)) + GRID_GAP;
  const cols = Math.max(1, Math.floor(viewportWidth / colWidth));
  const positions: Record<string, { x: number; y: number }> = {};
  let y = 0;
  for (let i = 0; i < els.length; i += cols) {
    const row = els.slice(i, i + cols);
    row.forEach((el, j) => {
      positions[el.id] = { x: j * colWidth, y };
    });
    y += Math.max(...row.map((el) => el.height)) + GRID_GAP;
  }
  return positions;
}
