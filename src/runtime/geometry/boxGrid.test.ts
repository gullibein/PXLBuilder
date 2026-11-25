import { describe, expect, it } from 'vitest';
import { overlaps, type Box } from '../physics';
import { BoxGrid } from './boxGrid';

/** Random numbers that are the same every run. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A level's worth of boxes: tiles on the 32-pixel grid, odd-sized things anywhere, a few huge ones, some with no size. */
function boxes(n: number, rnd: () => number, span: number): Box[] {
  return Array.from({ length: n }, (_, i) => {
    const kind = rnd();
    if (kind < 0.7) return { x: Math.floor(rnd() * span - span / 2) * 32 + 16, y: Math.floor(rnd() * span - span / 2) * 32 + 16, hw: 16, hh: 16, friction: i };
    if (kind < 0.95) return { x: rnd() * span * 32 - span * 16, y: rnd() * span * 32 - span * 16, hw: rnd() * 90, hh: rnd() * 90, friction: i };
    if (kind < 0.98) return { x: rnd() * span * 32 - span * 16, y: rnd() * span * 32 - span * 16, hw: 2000 + rnd() * 9000, hh: rnd() * 3000, friction: i };
    return { x: rnd() * 100, y: rnd() * 100, hw: 0, hh: 0, friction: i };
  });
}

describe('boxes found by place answer exactly as the whole list does', () => {
  it('near: every box that overlaps a region is given, and in the order of the list', () => {
    for (const seed of [1, 2, 3, 4]) {
      const rnd = seeded(seed);
      const list = boxes(3000, rnd, 200);
      const grid = new BoxGrid(list);
      for (let q = 0; q < 600; q++) {
        const region: Box = { x: rnd() * 7000 - 3500, y: rnd() * 7000 - 3500, hw: q % 7 === 0 ? rnd() * 3000 : rnd() * 80, hh: q % 11 === 0 ? rnd() * 3000 : rnd() * 80 };
        const near = grid.near(region);
        const want = list.filter((b) => overlaps(region, b));
        // In the list's order (each box's place in the list is its friction here).
        const order = near.map((b) => b.friction!);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
        expect(new Set(order).size).toBe(order.length);
        // Nothing that overlaps is missing; what is given beyond that is merely near.
        expect(near.filter((b) => overlaps(region, b))).toEqual(want);
        expect(grid.overlapsAny(region)).toBe(want.length > 0);
        expect(grid.holds(region.x, region.y)).toBe(list.some((s) => Math.abs(region.x - s.x) < s.hw && Math.abs(region.y - s.y) < s.hh));
      }
    }
  });

  it('boxes touching a square\'s edge, far from the middle, and regions too wide for the grid', () => {
    const list: Box[] = [
      { x: 128, y: 128, hw: 16, hh: 16 },
      { x: 112, y: 112, hw: 16, hh: 16 },
      { x: -1_000_000, y: 2_000_000, hw: 16, hh: 16 },
      { x: 0, y: 0, hw: 0.5, hh: 0.5 },
    ];
    const grid = new BoxGrid(list);
    // (Touching is not overlapping: the box whose edge is on the line is near, and does not overlap.)
    expect(grid.near({ x: 144, y: 128, hw: 0.001, hh: 0.001 })).toContain(list[0]);
    expect(grid.overlapsAny({ x: 160, y: 128, hw: 16, hh: 16 })).toBe(false);
    expect(grid.overlapsAny({ x: 159, y: 128, hw: 16, hh: 16 })).toBe(true);
    expect(grid.near({ x: -1_000_000, y: 2_000_000, hw: 1, hh: 1 })).toEqual([list[2]]);
    expect(grid.near({ x: 0, y: 0, hw: 5_000_000, hh: 5_000_000 })).toBe(list);
    expect(grid.near({ x: 5000, y: 5000, hw: 10, hh: 10 })).toEqual([]);
    expect(new BoxGrid([]).near({ x: 0, y: 0, hw: 10, hh: 10 })).toEqual([]);
  });
});
