import { describe, it, expect } from 'vitest';
import { routeWaypoints, roundedPath, pointsBBox, pathMidpoint } from './boardRouting';

describe('routeWaypoints', () => {
  it('draws a straight line when anchors face each other head-on and are aligned', () => {
    const pts = routeWaypoints({ x: 0, y: 50 }, 'right', { x: 200, y: 50 }, 'left');
    expect(pts).toEqual([{ x: 0, y: 50 }, { x: 200, y: 50 }]);
  });

  it('bends when the target is behind the source (same-ish side, not aligned)', () => {
    const pts = routeWaypoints({ x: 0, y: 0 }, 'right', { x: -200, y: 0 }, 'left');
    expect(pts.length).toBeGreaterThan(2);
    // still starts and ends at the exact anchor points
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: -200, y: 0 });
  });

  it('routes an L-shape for mixed horizontal/vertical anchors', () => {
    const pts = routeWaypoints({ x: 0, y: 0 }, 'bottom', { x: 100, y: 100 }, 'left');
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 100, y: 100 });
    expect(pts.length).toBeGreaterThanOrEqual(3);
  });

  it('bends for vertical-to-vertical anchors not vertically aligned', () => {
    const pts = routeWaypoints({ x: 0, y: 0 }, 'bottom', { x: 150, y: 200 }, 'top');
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 150, y: 200 });
    expect(pts.length).toBeGreaterThan(2);
  });
});

describe('roundedPath', () => {
  it('degrades to a straight M/L for two points', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M0,0 L10,0');
  });

  it('starts and ends at the first/last waypoint for a multi-point route', () => {
    const d = roundedPath([{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }]);
    expect(d.startsWith('M0,0')).toBe(true);
    expect(d.endsWith('L50,50')).toBe(true);
  });

  it('clamps the corner radius so it never exceeds half a short segment', () => {
    // a very short middle segment (length 4) must not produce a corner that
    // overshoots past the segment's own endpoints
    const d = roundedPath([{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 100 }], 10);
    expect(d).toContain('Q2,0');
  });
});

describe('pointsBBox', () => {
  it('covers every point plus padding', () => {
    const b = pointsBBox([{ x: 0, y: 0 }, { x: 10, y: -5 }, { x: -3, y: 8 }], 2);
    expect(b).toEqual({ x0: -5, y0: -7, x1: 12, y1: 10, w: 17, h: 17 });
  });
});

describe('pathMidpoint', () => {
  it('is the exact midpoint of a two-point straight line', () => {
    expect(pathMidpoint([{ x: 0, y: 0 }, { x: 100, y: 0 }])).toEqual({ x: 50, y: 0 });
  });

  it('sits at the halfway point of TOTAL path length, not the middle waypoint', () => {
    // an L-shape where the first leg is much longer than the second — the
    // middle waypoint (50,0) is NOT the length-midpoint, which falls partway
    // along the first (long) leg instead.
    const mid = pathMidpoint([{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 10 }]);
    expect(mid).toEqual({ x: 50, y: 0 });
  });

  it('handles a single point', () => {
    expect(pathMidpoint([{ x: 5, y: 5 }])).toEqual({ x: 5, y: 5 });
  });
});
