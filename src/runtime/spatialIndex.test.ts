import { describe, expect, it } from 'vitest';
import { BoxGrid, byTag, LiveGrid, PointGrid } from './spatialIndex';

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

  it('kept from step to step, it answers exactly as one made afresh, as things move, appear and go', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    type Thing = { x: number; y: number; hw: number; hh: number; alive: boolean };
    const things: Thing[] = Array.from({ length: 300 }, () => ({ x: Math.floor(rand() * 40) * 16, y: Math.floor(rand() * 40) * 16, hw: 8 + Math.floor(rand() * 3) * 8, hh: 8, alive: true }));
    // One huge one (kept apart).
    things.push({ x: 0, y: 0, hw: 4000, hh: 4000, alive: true });
    const boxOf = (t: Thing) => (t.alive ? { x: t.x, y: t.y, hw: t.hw, hh: t.hh } : null);
    const live = new LiveGrid<Thing>();
    for (let step = 0; step < 60; step++) {
      // Some move, some go, some come back, a few new ones appear at the end; one grows.
      for (const t of things) {
        const r = rand();
        if (r < 0.05) t.x += 8;
        else if (r < 0.08) t.y -= 16;
        else if (r < 0.1) t.alive = !t.alive;
        else if (r < 0.11) t.hh = 24;
      }
      if (step % 10 === 3) things.push({ x: rand() * 600, y: rand() * 600, hw: 8, hh: 8, alive: true });
      live.sync(things, boxOf);
      const alive = things.filter((t) => t.alive);
      const fresh = new BoxGrid(alive, boxOf);
      const point = new PointGrid(alive, boxOf);
      for (let q = 0; q < 40; q++) {
        const x = rand() * 700 - 30;
        const y = rand() * 700 - 30;
        expect(live.first(x, y, (t) => t.hw !== 4000)).toBe(point.first(x, y, (t) => t.hw !== 4000));
        const b = { x, y, hw: 20, hh: 12 };
        expect(live.near(b)).toEqual(fresh.near(b));
      }
    }
    // A different list (the level restarted): everything filed again.
    const again = things.slice(0, 10);
    live.sync(again, boxOf);
    expect(live.near({ x: 300, y: 300, hw: 400, hh: 400 })).toEqual(new BoxGrid(again.filter((t) => t.alive), boxOf).near({ x: 300, y: 300, hw: 400, hh: 400 }));
  });
});
