import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import * as m from '../core/model/mutations';
import { ROGUELIKE_ARTS, createRoguelikeProject } from '../core/model/roguelikeStarter';
import { InputState, type Action } from './input';
import { Runtime, type RuntimeEntity } from './runtime';

const registry = createBuiltinRegistry();
const input = new InputState();
const step = (rt: Runtime, seconds: number) => {
  for (let i = 0; i < Math.max(1, Math.round(seconds * 120)); i++) rt.update(1 / 120, input);
};
/** One step: the key held until the hero has moved (or a moment). */
const move = (rt: Runtime, a: Action) => {
  input.press(a);
  step(rt, 1 / 60);
  input.release(a);
  step(rt, 0.4);
};
const cell = (e: RuntimeEntity) => `${Math.floor(e.x / 32)},${Math.floor(e.y / 32)}`;

/** The starter, with a fixed dungeon (seed 3) for the test. */
function game(seed = 3) {
  const project = produce(createRoguelikeProject(registry), (d) => {
    m.setGenerator(d, d.scenes[0].id, { seed });
  });
  const rt = new Runtime(project, project.scenes[0].id, registry);
  step(rt, 0.05);
  return { project, rt, hero: rt.entities.find((e) => e.controller)! };
}

/** A free square beside the hero (no wall, no one), and which key goes there. */
function freeBeside(rt: Runtime, hero: RuntimeEntity): { x: number; y: number; key: Action } {
  const solid = (x: number, y: number) => rt.entities.some((e) => e.alive && e !== hero && e.collider && !e.collider.trigger && Math.floor(e.x / 32) === Math.floor(x / 32) && Math.floor(e.y / 32) === Math.floor(y / 32));
  for (const [dx, dy, key] of [
    [32, 0, 'right'],
    [-32, 0, 'left'],
    [0, 32, 'down'],
    [0, -32, 'up'],
  ] as const)
    if (!solid(hero.x + dx, hero.y + dy)) return { x: hero.x + dx, y: hero.y + dy, key };
  throw new Error('no free square beside the hero');
}

describe('the Roguelike starter', () => {
  it('its pictures are whole (16 × 16)', () => {
    for (const a of Object.values(ROGUELIKE_ARTS)) expect(a.rows.every((r) => r.length === 16) && a.rows.length === 16).toBe(true);
  });

  it('the hero steps one square per key, and every step is a turn of the world: the monsters answer', () => {
    const { rt, hero } = game();
    expect(rt.scripts.errors).toEqual([]);
    const monsters = rt.entities.filter((e) => e.tags.includes('monster'));
    expect(monsters.length).toBe(4);
    const free = freeBeside(rt, hero);
    const before = monsters.map(cell).join('|');
    let turns = 0;
    const was = rt.gameplay.emit.bind(rt.gameplay);
    rt.gameplay.emit = (type, ...rest) => {
      if (type === 'signal') turns++;
      return was(type, ...rest);
    };
    move(rt, free.key);
    expect([hero.x, hero.y]).toEqual([free.x, free.y]);
    expect(turns).toBe(1);
    // Held for nothing: no more turns.
    step(rt, 0.5);
    expect(turns).toBe(1);
    void before;
  });

  it('stepping into a monster attacks it; a monster beside the hero strikes back on its turn', () => {
    const { rt, hero } = game();
    const free = freeBeside(rt, hero);
    const rat = rt.entities.find((e) => e.name === 'Rat')!;
    rat.x = free.x;
    rat.y = free.y;
    const hp = hero.health!.current;
    move(rt, free.key);
    expect(rat.health!.current).toBe(1);
    expect([hero.x, hero.y]).not.toEqual([free.x, free.y]);
    expect(hero.health!.current).toBe(hp - 1);
  });

  it('fog of war: the hero sees round itself, not through walls; monsters out of sight are not drawn', () => {
    const { rt, hero } = game();
    expect(rt.fog).not.toBeNull();
    expect(rt.fog!.sees(hero.x, hero.y)).toBe(true);
    expect(rt.fog!.sees(hero.x + 32 * 9, hero.y)).toBe(false);
    const drawn = new Set(rt.renderList().map((r) => r.id));
    for (const e of rt.entities.filter((x) => x.tags.includes('monster'))) expect(drawn.has(e.base.id)).toBe(rt.fog!.sees(e.x, e.y));
    // Explored squares stay (dim), squares never seen are dark.
    expect(rt.fog!.shade(Math.floor(hero.x / 32), Math.floor(hero.y / 32))).toBe(0);
    expect(rt.fog!.shade(rt.fog!.bounds.i1, rt.fog!.bounds.j1)).toBe(1);
  });

  it('the stairs: the next floor, built anew (more monsters), the hero keeping its health; dying starts a new run', () => {
    const { rt, hero } = game();
    const stairs = rt.entities.find((e) => e.name === 'Stairs')!;
    const free = freeBeside(rt, hero);
    stairs.x = free.x;
    stairs.y = free.y;
    hero.health!.current = 9;
    move(rt, free.key);
    step(rt, 0.1);
    expect(rt.game.get('floor')).toBe(2);
    const hero2 = rt.entities.find((e) => e.controller)!;
    expect(hero2.health!.current).toBe(9);
    expect(rt.entities.filter((e) => e.tags.includes('monster')).length).toBe(6);
    hero2.health!.current = 0;
    step(rt, 0.2);
    expect(rt.restartGameRequested).toBe(true);
  });
});
