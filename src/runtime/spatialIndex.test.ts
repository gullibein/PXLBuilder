import { describe, expect, it } from 'vitest';
import { BoxGrid, byTag, PointGrid } from './spatialIndex';

const box = (x: number, y: number, hw = 16, hh = 16) => ({ x, y, hw, hh });

describe('the level index', () => {
  it('finds what is at a point like looking at everything in order: the first one in the level wins', () => {
    const items = [
      { id: 'a', b: box(16, 16) },
      { id: 'b', b: box(48, 16) },
      { id: 'c', b: box(16, 16) }, // on top of a, later
      { id: 'huge', b: box(0, 0, 5000, 5000) }, // covers everything, kept apart
    ];
    const grid = new PointGrid(items, (i) => i.b);
    const brute = (x: number, y: number, accept = (_: (typeof items)[number]) => true) => items.find((i) => Math.abs(x - i.b.x) < i.b.hw && Math.abs(y - i.b.y) < i.b.hh && accept(i)) ?? null;
    for (const [x, y] of [[16, 16], [48, 20], [63.9, 0.1], [64, 16], [200, 200], [-10, -10]])
      expect(grid.first(x, y)?.id).toBe(brute(x, y)?.id);
    expect(grid.first(16, 16, (i) => i.id !== 'a')?.id).toBe('c');
    expect(grid.first(16, 16, (i) => i.id === 'huge')?.id).toBe('huge');
  });

  it('a box query gives everything near it (in order), and tags group things in order', () => {
    const items = [{ b: box(16, 16), tags: ['dirt'] }, { b: box(300, 300), tags: ['rock'] }, { b: box(40, 16), tags: ['dirt', 'x'] }];
    const near = new BoxGrid(items, (i) => i.b).near(box(28, 16, 20, 4));
    expect(near).toEqual([items[0], items[2]]);
    expect(byTag(items).get('dirt')).toEqual([items[0], items[2]]);
  });
});
