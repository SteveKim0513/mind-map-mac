// IF-08 · Overlap resolution ("겹침 정돈"). The tree layout already guarantees
// no overlaps WITHIN a single root tree (disjoint vertical bands + chip-aware
// sizing). Overlaps only appear BETWEEN root trees, when a user drags one root
// (manualPos) onto another root's subtree. This resolves those by pushing the
// overlapping root boxes straight down just enough to clear — nodes, chips, and
// section blobs are all inside a root's box, so separating the boxes separates
// all three.

export interface TidyBox {
  id: string; // root id
  x: number; // left edge (world coords)
  y: number; // top edge (world coords)
  w: number;
  h: number;
}

/** Default vertical clearance left between de-overlapped root boxes. */
export const TIDY_GAP = 60;

/** Do two boxes intersect on both axes (touching edges do NOT count as overlap)? */
function intersects(a: TidyBox, b: TidyBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Resolve overlaps among root-subtree boxes by pushing later boxes straight DOWN
 * just enough to clear the ones already placed. Deterministic and stable: boxes
 * are processed top→bottom, left→right, and a box that already fits is never
 * moved. Returns the downward shift (dy > 0) per moved root id; unmoved roots
 * are absent from the map.
 */
export function resolveOverlaps(boxes: TidyBox[], gap: number = TIDY_GAP): Map<string, number> {
  const order = [...boxes].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  const placed: TidyBox[] = [];
  const shifts = new Map<string, number>();
  for (const box of order) {
    let top = box.y;
    // Drop below any already-placed box we'd overlap, rechecking until clear
    // (dropping below one box can bring us into another lower one).
    for (let guard = 0; guard < placed.length + 1; guard++) {
      let bumped = false;
      for (const p of placed) {
        if (intersects({ ...box, y: top }, p)) {
          top = p.y + p.h + gap;
          bumped = true;
        }
      }
      if (!bumped) break;
    }
    if (top !== box.y) shifts.set(box.id, top - box.y);
    placed.push({ ...box, y: top });
  }
  return shifts;
}
