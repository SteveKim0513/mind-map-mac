import type { BoardAnchorSide } from '../types';

export interface Point {
  x: number;
  y: number;
}

function dir(side: BoardAnchorSide): Point {
  switch (side) {
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
  }
}

const EXIT_GAP = 26; // px pushed straight out from an anchor before the path is allowed to turn

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.5 || Math.abs(last.y - p.y) > 0.5) out.push(p);
  }
  return out;
}

/** Waypoints for a connector between two anchors, adapting the route to their
 *  relative position instead of always drawing a straight line (2026-09-03
 *  UX feedback — Miro/Lucidchart-style "smart" orthogonal routing). A
 *  straight line is still used when the anchors already face each other
 *  head-on and are roughly aligned — no point manufacturing a bend that
 *  isn't there. */
export function routeWaypoints(a: Point, fromSide: BoardAnchorSide, b: Point, toSide: BoardAnchorSide): Point[] {
  const da = dir(fromSide);
  const db = dir(toSide);
  const horizA = da.y === 0;
  const horizB = db.y === 0;

  // Straight line only when the sides face each other AND b actually sits in
  // the direction `a` exits toward — two 'right' anchors 26px apart facing
  // the same way, or a target BEHIND the exit direction, must still bend
  // (a literal straight line there would cut back through the source box).
  if (horizA && horizB) {
    const facing = Math.sign(db.x) === -Math.sign(da.x);
    const ahead = a.x === b.x || Math.sign(b.x - a.x) === Math.sign(da.x);
    if (facing && ahead && Math.abs(a.y - b.y) < 2) return [a, b];
  }
  if (!horizA && !horizB) {
    const facing = Math.sign(db.y) === -Math.sign(da.y);
    const ahead = a.y === b.y || Math.sign(b.y - a.y) === Math.sign(da.y);
    if (facing && ahead && Math.abs(a.x - b.x) < 2) return [a, b];
  }

  const e = { x: a.x + da.x * EXIT_GAP, y: a.y + da.y * EXIT_GAP }; // pushed out from `a`
  const n = { x: b.x + db.x * EXIT_GAP, y: b.y + db.y * EXIT_GAP }; // pushed out from `b`
  const pts: Point[] = [a, e];

  if (horizA && horizB) {
    const midX = (e.x + n.x) / 2;
    pts.push({ x: midX, y: e.y }, { x: midX, y: n.y });
  } else if (!horizA && !horizB) {
    const midY = (e.y + n.y) / 2;
    pts.push({ x: e.x, y: midY }, { x: n.x, y: midY });
  } else if (horizA && !horizB) {
    pts.push({ x: n.x, y: e.y });
  } else {
    pts.push({ x: e.x, y: n.y });
  }
  pts.push(n, b);
  return dedupe(pts);
}

/** Rounded-corner SVG path `d` string through the given waypoints — small
 *  quadratic-bezier corners instead of sharp right angles (Apple-style
 *  polish, 2026-09-03 feedback). Degrades to a straight `M L` for 2 points. */
export function roundedPath(pts: Point[], radius = 10): string {
  if (pts.length < 2) return '';
  if (pts.length === 2) return `M${pts[0].x},${pts[0].y} L${pts[1].x},${pts[1].y}`;
  let d = `M${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const toPrev = { x: prev.x - cur.x, y: prev.y - cur.y };
    const toNext = { x: next.x - cur.x, y: next.y - cur.y };
    const lenPrev = Math.hypot(toPrev.x, toPrev.y) || 1;
    const lenNext = Math.hypot(toNext.x, toNext.y) || 1;
    const r = Math.min(radius, lenPrev / 2, lenNext / 2);
    const start = { x: cur.x + (toPrev.x / lenPrev) * r, y: cur.y + (toPrev.y / lenPrev) * r };
    const end = { x: cur.x + (toNext.x / lenNext) * r, y: cur.y + (toNext.y / lenNext) * r };
    d += ` L${start.x},${start.y} Q${cur.x},${cur.y} ${end.x},${end.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last.x},${last.y}`;
  return d;
}

/** Point at the midpoint of a polyline's total LENGTH (not just the middle
 *  waypoint) — used to place a connector's label chip so it sits centered on
 *  the visible path even when the route bends. */
export function pathMidpoint(pts: Point[]): Point {
  if (pts.length === 1) return pts[0];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const len = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    segLens.push(len);
    total += len;
  }
  let target = total / 2;
  for (let i = 0; i < segLens.length; i++) {
    if (target <= segLens[i] || i === segLens.length - 1) {
      const t = segLens[i] > 0 ? target / segLens[i] : 0;
      const a = pts[i];
      const b = pts[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    target -= segLens[i];
  }
  return pts[Math.floor(pts.length / 2)];
}

/** Bounding box of a set of points, padded — used to size a connector's own
 *  SVG (the route can bow outside the straight line between its endpoints). */
export function pointsBBox(pts: Point[], pad = 2) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs) - pad;
  const y0 = Math.min(...ys) - pad;
  const x1 = Math.max(...xs) + pad;
  const y1 = Math.max(...ys) + pad;
  return { x0, y0, x1, y1, w: Math.max(x1 - x0, 1), h: Math.max(y1 - y0, 1) };
}
