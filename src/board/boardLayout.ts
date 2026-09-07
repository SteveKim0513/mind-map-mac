import type { BoardConnectorElement, BoardElement } from '../types';
import { isBoxElement, type BoxElement } from './boardGeometry';

const PRIMARY_GAP = 96; // px between layers along the layout's growth direction
const CROSS_GAP = 32; // px between siblings within a layer
const GRID_GAP = 24; // px between cells in the filter grid below

/** Every box element reachable from `rootId` by following connectors in
 *  EITHER direction (not just outgoing) — a "정리" cluster is "everything
 *  related to this", not "everything this points at". Also returns every
 *  connector with both ends inside that cluster, so — unlike the old
 *  first-edge-wins tree walk this replaces — no relationship is dropped from
 *  the layout just because a node already had an incoming edge from
 *  elsewhere. */
function connectedCluster(
  rootId: string,
  elements: Record<string, BoardElement>,
): { boxIds: string[]; connectors: BoardConnectorElement[] } {
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    const set = adjacency.get(a);
    if (set) set.add(b);
    else adjacency.set(a, new Set([b]));
  };
  const connectors: BoardConnectorElement[] = [];
  for (const el of Object.values(elements)) {
    if (el.kind !== 'connector') continue;
    const from = elements[el.fromId];
    const to = elements[el.toId];
    if (!from || !isBoxElement(from) || !to || !isBoxElement(to)) continue;
    addEdge(el.fromId, el.toId);
    addEdge(el.toId, el.fromId);
    connectors.push(el);
  }

  const visited = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adjacency.get(cur) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }

  return {
    boxIds: [...visited],
    connectors: connectors.filter((c) => visited.has(c.fromId) && visited.has(c.toId)),
  };
}

/** Auto-arrange the WHOLE connected cluster reachable from `rootId` (any
 *  direction) using elkjs's `layered` (Sugiyama) algorithm — a real graph
 *  layout that minimizes edge crossings, unlike a hand-rolled tree walk.
 *
 *  2026-09-07 — replaces an earlier version of this function (a BFS tree
 *  layout, first-edge-wins) after user feedback: this board's actual use
 *  case is a genuine relationship diagram — a sticky can connect to several
 *  others at once — not a tree. A tree walk that only follows outgoing edges
 *  and visits each node once necessarily drops every "extra" relationship
 *  from its position calculation, so those connectors ended up crossing
 *  everything after a "정리". Minimizing crossings for an arbitrary directed
 *  graph is a well-studied, non-trivial problem (exactly what Sugiyama-style
 *  layered layout is for) — not something worth re-deriving by hand, so this
 *  brings in `elkjs` (Eclipse Layout Kernel's JS port; EPL-2.0-or-GPL-3.0,
 *  zero transitive deps, used here unmodified as a library — no obligation
 *  to open-source this app). Its bundled build is ~1.5MB/458KB gzipped, so
 *  it's dynamically imported here (not a top-level import) — Vite code-splits
 *  it into its own chunk, fetched from local disk only when "정리" actually
 *  runs, never adding to the app's startup bundle.
 *
 *  Async (elkjs's layout runs as a Promise) — callers must await it. Returns
 *  [] if `rootId` isn't a sticky/image or has no connectors at all. The
 *  cluster's positions are shifted as a whole so `rootId` lands exactly on
 *  its current x/y (elkjs has no notion of "keep this node where it is"). */
export async function layoutConnectedCluster(
  rootId: string,
  elements: Record<string, BoardElement>,
): Promise<{ id: string; x: number; y: number }[]> {
  const root = elements[rootId];
  if (!root || !isBoxElement(root)) return [];

  const { boxIds, connectors } = connectedCluster(rootId, elements);
  if (connectors.length === 0) return []; // nothing connected — matches the old no-op behavior

  const { default: ELK } = await import('elkjs/lib/elk.bundled.js');
  const elk = new ELK();
  const result = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': String(CROSS_GAP),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(PRIMARY_GAP),
      'elk.edgeRouting': 'ORTHOGONAL', // visually matches the board's own orthogonal connector rendering
    },
    children: boxIds.map((id) => {
      const el = elements[id] as BoxElement;
      return { id, width: el.width, height: el.height };
    }),
    edges: connectors.map((c) => ({ id: c.id, sources: [c.fromId], targets: [c.toId] })),
  });

  const resultById = new Map((result.children ?? []).map((c) => [c.id, c]));
  const rootResult = resultById.get(rootId);
  if (!rootResult) return [];
  const dx = root.x - (rootResult.x ?? 0);
  const dy = root.y - (rootResult.y ?? 0);
  return boxIds.map((id) => {
    const r = resultById.get(id)!;
    return { id, x: (r.x ?? 0) + dx, y: (r.y ?? 0) + dy };
  });
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
