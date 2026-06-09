import type { MindMapDoc, MindNode, PositionedNode, PositionedEdge } from '../types';

// Vertical gap between node boxes (added on top of their measured heights).
const V_GAP = 26;
// Horizontal gap between a parent's right edge and its children's left edge.
const H_GAP = 88;
// Vertical gap between separate root trees stacked on the canvas.
const ROOT_GAP = 60;
// Fallbacks before a node has been measured.
const DEFAULT_WIDTH = 130;
const DEFAULT_HEIGHT = 34;

export interface NodeSize {
  w: number;
  h: number;
  // full rendered height from the box TOP down to the bottom of the lowest
  // accessory (note/link/schedule chips, badges). Defaults to `h` when absent.
  below?: number;
}

export interface LayoutResult {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * Auto-layout. Nodes are anchored by their LEFT edge and grow rightward, so a
 * node's text can lengthen without ever covering the connector to its parent.
 * Each child's left edge = parent's right edge + H_GAP (no overlap, ever).
 * Vertical placement comes from d3's tidy-tree breadth assignment.
 */
export function layout(
  doc: MindMapDoc,
  sizes: Record<string, NodeSize> = {},
  focusRootId?: string | null,
  colorFilter?: string | null,
  filterAncestors = false,
  filterDescendants = false,
): LayoutResult {
  const W = (id: string) => sizes[id]?.w ?? DEFAULT_WIDTH;

  // ── color filter: matched nodes only by default; optionally pull in
  //    ancestors and/or descendants. Visible nodes whose parent isn't visible
  //    become roots, so matched nodes show even without their ancestors. ──────
  let visibleSet: Set<string> | null = null;
  if (colorFilter) {
    const vis = new Set<string>();
    const matches = Object.values(doc.nodes)
      .filter((n) => n.color === colorFilter)
      .map((n) => n.id);
    matches.forEach((id) => vis.add(id));
    if (filterAncestors) {
      matches.forEach((id) => {
        let p = doc.nodes[id]?.parentId ?? null;
        while (p) {
          vis.add(p);
          p = doc.nodes[p]?.parentId ?? null;
        }
      });
    }
    if (filterDescendants) {
      const addDesc = (id: string) =>
        doc.nodes[id]?.children.forEach((c) => {
          vis.add(c);
          addDesc(c);
        });
      matches.forEach(addDesc);
    }
    visibleSet = vis;
  }
  const isVisible = (id: string) => !visibleSet || visibleSet.has(id);

  // directional vertical extents from MEASURED geometry. A node is anchored at
  // its box's vertical centre; chips/badges hang BELOW. d3 calls separation(a, b)
  // with a above b, so the gap between two stacked siblings =
  //   a's below-extent + b's above-extent + V_GAP.
  // Using the real measured footprint (not a guessed constant) means a node with
  // tall accessories always reserves exactly the room it occupies → never overlaps.
  // nodes inside a section need room for the surrounding blob ink.
  const sectionMembers = new Set<string>();
  (doc.sections ?? []).forEach((s) => s.nodeIds.forEach((id) => sectionMembers.add(id)));
  const SECTION_MARGIN = 20;

  const half = (id: string) => (sizes[id]?.h ?? DEFAULT_HEIGHT) / 2;
  // distance from the box centre down to the lowest accessory's bottom
  const belowExt = (id: string) => {
    const s = sizes[id];
    const full = s?.below ?? s?.h ?? DEFAULT_HEIGHT; // box-top → lowest accessory
    return full - half(id) + (sectionMembers.has(id) ? SECTION_MARGIN : 0);
  };
  const aboveExt = (id: string) =>
    half(id) + (sectionMembers.has(id) ? SECTION_MARGIN : 0);

  const countDescendants = (id: string): number => {
    const n = doc.nodes[id];
    if (!n) return 0;
    return n.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
  };

  const positioned: PositionedNode[] = [];
  const edges: PositionedEdge[] = [];
  let stackTop = 0;

  // Determine the roots to lay out:
  //  - color filter on → every visible node whose parent isn't visible (a forest)
  //  - focus mode → just the focused subtree
  //  - otherwise → the document's roots
  let roots: string[];
  if (visibleSet) {
    roots = [];
    const visit = (id: string) => {
      const n = doc.nodes[id];
      if (!n) return;
      if (visibleSet!.has(id) && (!n.parentId || !visibleSet!.has(n.parentId))) roots.push(id);
      n.children.forEach(visit);
    };
    doc.rootIds.forEach(visit);
  } else {
    roots = focusRootId && doc.nodes[focusRootId] ? [focusRootId] : doc.rootIds;
  }

  // visible children of a node (respecting collapse + the color filter)
  const visKids = (n: MindNode) =>
    n.collapsed ? [] : n.children.map((id) => doc.nodes[id]).filter((c) => c && isVisible(c.id));

  for (const rootId of roots) {
    const rootNode = doc.nodes[rootId];
    if (!rootNode) continue;

    // ── block-packing layout ────────────────────────────────────────────────
    // Each subtree reserves a vertical band equal to its full height; sibling
    // subtrees are stacked into DISJOINT bands (no tidy-tree "tucking"). So every
    // node of one branch sits entirely above/below every node of a sibling branch
    // → cousins at different depths can never overlap, whatever their size.
    const leftOf = new Map<string, number>();
    const centerYOf = new Map<string, number>();
    const depthOf = new Map<string, number>();

    const ownBand = (id: string) => aboveExt(id) + belowExt(id);

    // subtree block height: max of the node's own footprint and its children stacked
    const bhMemo = new Map<string, number>();
    const bh = (id: string): number => {
      const cached = bhMemo.get(id);
      if (cached !== undefined) return cached;
      const n = doc.nodes[id];
      const kids = n ? visKids(n) : [];
      let h: number;
      if (!kids.length) {
        h = ownBand(id);
      } else {
        let sum = 0;
        kids.forEach((c, i) => {
          sum += bh(c.id) + (i ? V_GAP : 0);
        });
        h = Math.max(ownBand(id), sum);
      }
      bhMemo.set(id, h);
      return h;
    };

    // place a subtree whose block starts at vertical offset `top`; returns the
    // node's centre y. The node is centred on its children's span; the children
    // block is centred within the node's (possibly taller) own block.
    const place = (id: string, top: number, depth: number, left: number): number => {
      depthOf.set(id, depth);
      leftOf.set(id, left);
      const n = doc.nodes[id];
      const kids = n ? visKids(n) : [];
      if (!kids.length) {
        const cy = top + aboveExt(id);
        centerYOf.set(id, cy);
        return cy;
      }
      let childSum = 0;
      kids.forEach((c, i) => {
        childSum += bh(c.id) + (i ? V_GAP : 0);
      });
      const childLeft = left + W(id) + H_GAP;
      let cursor = top + (bh(id) - childSum) / 2; // centre children within the block
      const centers: number[] = [];
      kids.forEach((c) => {
        centers.push(place(c.id, cursor, depth + 1, childLeft));
        cursor += bh(c.id) + V_GAP;
      });
      const cy = (centers[0] + centers[centers.length - 1]) / 2;
      centerYOf.set(id, cy);
      return cy;
    };
    place(rootId, 0, 0, 0);

    // vertical extent of the laid-out tree, relative to the root's centre
    const rootCenter = centerYOf.get(rootId) ?? 0;
    const relY = (id: string) => (centerYOf.get(id) ?? 0) - rootCenter;
    let minRelY = Infinity;
    let maxRelY = -Infinity;
    centerYOf.forEach((_cy, id) => {
      minRelY = Math.min(minRelY, relY(id) - aboveExt(id));
      maxRelY = Math.max(maxRelY, relY(id) + belowExt(id));
    });
    if (!isFinite(minRelY)) {
      minRelY = 0;
      maxRelY = 0;
    }

    let anchorX: number;
    let anchorY: number;
    // ignore the manual position while focused or filtering (auto-stack instead)
    if (rootNode.manualPos && !focusRootId && !colorFilter) {
      anchorX = rootNode.manualPos.x;
      anchorY = rootNode.manualPos.y;
    } else {
      anchorX = 0;
      anchorY = stackTop - minRelY;
    }
    stackTop += maxRelY - minRelY + ROOT_GAP;

    centerYOf.forEach((_cy, id) => {
      const n = doc.nodes[id];
      if (!n) return;
      const left = (leftOf.get(id) ?? 0) + anchorX;
      const y = relY(id) + anchorY;
      positioned.push({
        node: n,
        x: left,
        y,
        width: W(id),
        depth: depthOf.get(id) ?? 0,
        rootId,
        hiddenCount: n.collapsed ? countDescendants(id) : 0,
        childDone: n.children.reduce((s, c) => s + (doc.nodes[c]?.done ? 1 : 0), 0),
        childTotal: n.children.length,
      });
      const pid = n.parentId;
      if (pid && leftOf.has(pid)) {
        const pLeft = (leftOf.get(pid) ?? 0) + anchorX;
        edges.push({
          id: `${pid}->${id}`,
          source: { x: pLeft + W(pid), y: relY(pid) + anchorY },
          target: { x: left, y },
          rootId,
          depth: depthOf.get(pid) ?? 0,
        });
      }
    });
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of positioned) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + p.width);
    maxY = Math.max(maxY, p.y);
  }
  if (!isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }

  return { nodes: positioned, edges, bounds: { minX, minY, maxX, maxY } };
}
