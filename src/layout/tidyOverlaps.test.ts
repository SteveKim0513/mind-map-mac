import { describe, it, expect } from 'vitest';
import { resolveOverlaps, TIDY_GAP, type TidyBox } from './tidyOverlaps';

const box = (id: string, x: number, y: number, w = 100, h = 50): TidyBox => ({ id, x, y, w, h });

describe('resolveOverlaps (IF-08 · 겹침 정돈)', () => {
  it('leaves non-overlapping boxes untouched', () => {
    const shifts = resolveOverlaps([box('a', 0, 0), box('b', 0, 200)]);
    expect(shifts.size).toBe(0);
  });

  it('touching edges do not count as overlap', () => {
    // b starts exactly where a ends → no intersection
    const shifts = resolveOverlaps([box('a', 0, 0, 100, 50), box('b', 0, 50, 100, 50)]);
    expect(shifts.size).toBe(0);
  });

  it('pushes an overlapping box down below the one it hit, plus the gap', () => {
    // a: y 0..50, b overlaps at y 30..80 → b drops to 50 + gap
    const shifts = resolveOverlaps([box('a', 0, 0, 100, 50), box('b', 0, 30, 100, 50)]);
    expect(shifts.get('a')).toBeUndefined(); // top-most stays put
    expect(shifts.get('b')).toBe(50 + TIDY_GAP - 30);
  });

  it('does not move boxes that overlap only on one axis', () => {
    // same y-band but far apart horizontally → no overlap
    const shifts = resolveOverlaps([box('a', 0, 0, 100, 50), box('b', 500, 10, 100, 50)]);
    expect(shifts.size).toBe(0);
  });

  it('cascades: a box pushed down past one box then clears a second lower box', () => {
    // a:0..50, b:40..90, c:70..120 all overlapping in one column
    const shifts = resolveOverlaps([box('a', 0, 0, 100, 50), box('b', 0, 40, 100, 50), box('c', 0, 70, 100, 50)]);
    const aTop = 0;
    const bTop = aTop + 50 + TIDY_GAP; // below a
    const cTop = bTop + 50 + TIDY_GAP; // below b
    expect(shifts.get('b')).toBe(bTop - 40);
    expect(shifts.get('c')).toBe(cTop - 70);
    // final tops must be strictly separated by at least the gap
    expect(bTop).toBeGreaterThanOrEqual(aTop + 50 + TIDY_GAP);
    expect(cTop).toBeGreaterThanOrEqual(bTop + 50 + TIDY_GAP);
  });

  it('is deterministic regardless of input order', () => {
    const a = resolveOverlaps([box('a', 0, 0), box('b', 0, 30), box('c', 0, 60)]);
    const b = resolveOverlaps([box('c', 0, 60), box('a', 0, 0), box('b', 0, 30)]);
    expect([...a.entries()].sort()).toEqual([...b.entries()].sort());
  });
});
