/**
 * The level's fixed solids changed in place (docs §30, W1.1): when one thing that blocks goes, comes back, moves,
 * opens or closes, its own places in the lists are brought up to date and nothing else is read. What is left must
 * be exactly what making the lists afresh from the whole level gives, in the same order. Tested here on the grid
 * itself and on games; and in every other test that plays a game (regression/sameAnswers.ts turns on the
 * comparison with lists made afresh after every change).
 */
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { digRoom } from '../regression/games/digging';
import { makeWorld } from '../regression/worlds';
import { BoxGrid } from './geometry/boxGrid';
import { InputState } from './input';
import type { Box } from './physics';
import { Runtime, type RuntimeEntity } from './runtime';

const registry = createBuiltinRegistry();
const step = (rt: Runtime, n = 1, input = new InputState()) => {
  for (let i = 0; i < n; i++) rt.step(1 / 60, input);
};
const holds = (rt: Runtime, e: RuntimeEntity) => rt.world.solidAt(e.x, e.y);
/** The lists as they are against lists made afresh (the runtime's own comparison, asked for directly). */
const differs = (rt: Runtime) => {
  const could = (e: RuntimeEntity) => !!e.collider && !e.collider.trigger && !e.base.components.Goal && !e.pushable && (e.body === 'static' || e.body === 'none');
  return rt.world.differsFromFresh(rt.entities.filter(could), (e) => e.alive && !e.open, rt.entities.filter((e) => e.climbable && e.alive).map((e) => ({ x: e.x, y: e.y, hw: 16, hh: 16 })));
};

describe('boxes kept by place: one box out, back, or moved', () => {
  it('after any run of changes, every question is answered as a grid made afresh from the list answers it', () => {
    let s = 5;
    const rnd = () => (s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296;
    const box = (): Box => ({ x: Math.floor(rnd() * 120) * 32 + 16, y: Math.floor(rnd() * 80) * 32 + 16, hw: rnd() < 0.05 ? 16 * 40 : 16, hh: rnd() < 0.02 ? 16 * 600 : 16 });
    const all = Array.from({ length: 2500 }, box);
    const now: (Box | null)[] = [...all];
    const grid = new BoxGrid<Box>([...all]);
    for (let round = 0; round < 60; round++) {
      for (let k = 0; k < 25; k++) {
        const i = Math.floor(rnd() * all.length);
        const what = rnd();
        now[i] = what < 0.4 ? null : what < 0.7 ? all[i] : box();
        grid.set(i, now[i]);
      }
      const list = now.filter((b): b is Box => !!b);
      expect(grid.boxes).toEqual(list);
      const fresh = new BoxGrid<Box>(list);
      for (let q = 0; q < 40; q++) {
        const region: Box = { x: rnd() * 4000, y: rnd() * 2600, hw: rnd() < 0.1 ? 3000 : 20 + rnd() * 200, hh: 20 + rnd() * 200 };
        const near = grid.near(region);
        // (The same boxes, the same objects, in the list's order.)
        expect(near.length).toBe(fresh.near(region).length);
        expect(near.every((b, k) => b === fresh.near(region)[k])).toBe(true);
        expect(grid.overlapsAny(region)).toBe(fresh.overlapsAny(region));
        expect(grid.holds(region.x, region.y)).toBe(fresh.holds(region.x, region.y));
      }
    }
  });
});

describe("a game's fixed solids, changed in place", () => {
  it('a tile dug out and filled in again, a thing hidden and shown, moved, opened and closed: never the whole level read again', () => {
    const p = makeWorld('run', 60, 21, registry).project;
    const rt = new Runtime(p, p.scenes[0].id, registry);
    step(rt, 3);
    expect(rt.solidsAfresh).toBe(1);
    const tiles = rt.entities.filter((e) => e.name === 'Platform');
    const order = [...rt.world.staticSolids];
    const tile = tiles[Math.floor(tiles.length / 2)];
    expect(holds(rt, tile)).toBe(true);
    // (The engine wakes a tile before it changes it; so does this test.)
    rt.wake(tile);
    // Gone (as a dig, a rule's "remove", a thing collected or defeated leave it).
    tile.alive = false;
    rt.markSolidsDirty(tile);
    step(rt);
    expect(holds(rt, tile)).toBe(false);
    expect(rt.world.staticSolids.length).toBe(order.length - 1);
    // Back: where it was in the list (collision resolves in the list's order).
    tile.alive = true;
    rt.markSolidsDirty(tile);
    step(rt);
    expect(holds(rt, tile)).toBe(true);
    expect(rt.world.staticSolids.map((b) => `${b.x},${b.y}`)).toEqual(order.map((b) => `${b.x},${b.y}`));
    // Hidden and shown by a switch; opened and closed.
    rt.gameplay.setHidden(tile, true);
    step(rt);
    expect(holds(rt, tile)).toBe(false);
    rt.gameplay.setHidden(tile, false);
    step(rt);
    expect(holds(rt, tile)).toBe(true);
    rt.gameplay.setOpen(tile, true, null);
    step(rt);
    expect(holds(rt, tile)).toBe(false);
    rt.gameplay.setOpen(tile, false, null);
    step(rt);
    expect(holds(rt, tile)).toBe(true);
    // Moved (a script's "set position", a switch gliding it): solid where it is, not where it was.
    const was = { x: tile.x, y: tile.y };
    tile.x += 320;
    tile.y -= 96;
    rt.markSolidsDirty(tile);
    step(rt);
    expect(rt.world.solidAt(was.x, was.y)).toBe(false);
    expect(holds(rt, tile)).toBe(true);
    expect(differs(rt)).toBe('');
    expect(rt.solidsAfresh).toBe(1);
  });

  it('a thing that appears: one that does not block changes nothing; one that blocks has the lists made afresh', () => {
    const p = makeWorld('run', 60, 21, registry).project;
    const rt = new Runtime(p, p.scenes[0].id, registry);
    step(rt, 2);
    const coin = p.definitions.find((d) => d.name === 'Coin')!;
    const platform = p.definitions.find((d) => d.name === 'Platform')!;
    const n = rt.world.staticSolids.length;
    for (let i = 0; i < 20; i++) rt.spawn(coin.id, { x: 5000 + i * 40, y: -400 });
    step(rt, 2);
    expect(rt.solidsAfresh).toBe(1);
    expect(rt.world.staticSolids.length).toBe(n);
    const wall = rt.spawn(platform.id, { x: 6000, y: -400 })!;
    step(rt);
    expect(rt.solidsAfresh).toBe(2);
    expect(holds(rt, wall)).toBe(true);
    // (From then on it has its own places too.)
    wall.alive = false;
    rt.markSolidsDirty(wall);
    step(rt);
    expect(holds(rt, wall)).toBe(false);
    expect(rt.solidsAfresh).toBe(2);
    expect(differs(rt)).toBe('');
  });

  it('the digging game: holes dug and filling in again while a guard walks, the lists never made afresh after the start', () => {
    const p = digRoom(registry);
    const rt = new Runtime(p, p.scenes[0].id, registry);
    const input = new InputState();
    let dug = 0;
    for (let i = 0; i < 900; i++) {
      if (i % 50 === 0) input.press('fire');
      if (i % 50 === 2) input.release('fire');
      if (i % 200 === 60) input.press(i % 400 === 60 ? 'right' : 'left');
      if (i % 200 === 100) (input.release('right'), input.release('left'));
      rt.step(1 / 60, input);
      if (rt.entities.some((e) => !e.alive && e.tags.includes('diggable'))) dug++;
    }
    expect(dug).toBeGreaterThan(100);
    expect(rt.solidsAfresh).toBe(1);
    expect(differs(rt)).toBe('');
  });

  it('a mine of 12,000 things: a step in which a tile goes costs about what any step costs', () => {
    const w = makeWorld('mine', 60, 200, registry);
    const rt = new Runtime(w.project, w.project.scenes[0].id, registry);
    step(rt, 3);
    const tiles = rt.entities.filter((e) => e.name === 'Platform');
    for (let k = 0; k < 40; k++) {
      const t = tiles[(k * 131) % tiles.length];
      rt.wake(t);
      t.alive = !t.alive;
      rt.markSolidsDirty(t);
      step(rt);
    }
    expect(rt.solidsAfresh).toBe(1);
    expect(differs(rt)).toBe('');
  });
});
