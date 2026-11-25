/**
 * Sleeping tiles (docs §30, W1): plain walls and floors nothing has acted on are skipped by the loops of a step.
 * That must be the same game. Tested three ways: what is asleep and what wakes it; the same game played with
 * sleepers and with everything awake, compared thing for thing after every step; and (in every other test that
 * plays a game) the step-by-step fingerprints and the check that no sleeper ever changed: regression/sameAnswers.ts.
 */
import { createHash } from 'node:crypto';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { getEntitySize } from '../core/model/geometry';
import { createIsometricProject } from '../core/model/isometricStarter';
import { createRoguelikeProject } from '../core/model/roguelikeStarter';
import { createRpgProject } from '../core/model/rpgStarter';
import { boulderDash, mining, spaceShooter } from '../regression/games/action';
import { drMario, tetris } from '../regression/games/boards';
import { digRoom } from '../regression/games/digging';
import { marioLevel } from '../regression/games/platformers';
import { rpgGame, tacticsBoard } from '../regression/games/turnBased';
import { checkScript } from '../core/script/language';
import type { Project } from '../core/types';
import { withSeed } from '../regression/harness';
import { StateText } from '../regression/stateText';
import { makeWorld } from '../regression/worlds';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** Every thing's whole state, as one fingerprint per step. */
function stateOf(rt: Runtime): string {
  const st = new StateText();
  st.index = new Map(rt.entities.map((e, i) => [e as object, i]));
  const h = createHash('sha256');
  for (const e of rt.entities) h.update(st.thing(e));
  return h.digest('hex').slice(0, 16);
}

/** Plays a game with keys held by time; `awake`: every tile woken before the first step (the engine as it was). */
function play(project: Project, steps: number, keys: (step: number) => Action[], awake: boolean): string[] {
  return withSeed(7, () => {
    const rt = new Runtime(project, project.scenes[0].id, registry);
    if (awake) rt.wakeAll();
    const input = new InputState();
    let held: Action[] = [];
    const out: string[] = [];
    for (let i = 0; i < steps; i++) {
      const want = keys(i);
      for (const a of held) if (!want.includes(a)) input.release(a);
      for (const a of want) if (!held.includes(a)) input.press(a);
      held = want;
      rt.update(1 / 60, input);
      out.push(stateOf(rt));
    }
    return out;
  });
}

const run = (i: number): Action[] => (i % 90 < 60 ? ['right', ...(i % 45 < 8 ? (['jump'] as Action[]) : [])] : i % 90 < 80 ? ['left'] : []);
/** Every key in turn: a direction held for a while, with jump, fire and the action key tapped at their own beats. */
const mash = (i: number): Action[] => [
  (['right', 'right', 'down', 'left', 'up', 'right'] as Action[])[Math.floor(i / 40) % 6],
  ...(i % 31 < 4 ? (['jump'] as Action[]) : []),
  ...(i % 23 === 0 ? (['fire'] as Action[]) : []),
  ...(i % 47 === 0 ? (['interact'] as Action[]) : []),
];
const roam = (i: number): Action[] => [(['right', 'down', 'left', 'up'] as Action[])[Math.floor(i / 50) % 4], ...(i % 37 === 0 ? (['fire'] as Action[]) : [])];

describe('sleeping tiles: the same game', () => {
  it('walls and floors made of a picture, a box and a still body are asleep; whatever does something is awake', () => {
    const city = makeWorld('city', 60, 34, registry);
    const rt = new Runtime(city.project, city.project.scenes[0].id, registry);
    const walls = rt.entities.filter((e) => e.name === 'Wall');
    expect(walls.length).toBeGreaterThan(800);
    expect(walls.every((e) => rt.isAsleep(e))).toBe(true);
    const others = rt.entities.filter((e) => e.name !== 'Wall');
    expect(others.length).toBeGreaterThan(3);
    expect(others.some((e) => rt.isAsleep(e))).toBe(false);
    expect([...rt.awake()]).toEqual(others);
    // A built platformer level: its ground sleeps; the player, coins, enemies, springs, water, ladders don't.
    const p = marioLevel(registry, 3).project;
    const starter = new Runtime(p, p.scenes[0].id, registry);
    const sleepers = new Set(starter.entities.filter((e) => starter.isAsleep(e)).map((e) => e.name));
    expect([...sleepers].every((n) => /Platform|Stone|Brick|Pipe|Ramp|Bridge/.test(n)), [...sleepers].join()).toBe(true);
    expect(sleepers.size).toBeGreaterThan(0);
    for (const e of starter.entities) if (e.scripts.length || e.controller || e.health || e.body === 'dynamic' || e.collectible || e.switch || e.liquid || e.climbable) expect(starter.isAsleep(e), e.name).toBe(false);
  });

  it('a sleeper is woken before anything can change it: found by name, pointed at by a script, dug out, moved by a switch, flipped', () => {
    const city = makeWorld('city', 30, 20, registry);
    const id = city.project.scenes[0].id;
    const fresh = () => new Runtime(city.project, id, registry);
    let rt = fresh();
    const count = () => rt.entities.filter((e) => rt.isAsleep(e)).length;
    const all = count();
    // By name.
    const one = rt.find('Wall')!;
    expect(rt.isAsleep(one)).toBe(false);
    expect(count()).toBe(all - 1);
    expect([...rt.awake()]).toContain(one);
    // The engine's own changes.
    const other = rt.entities.find((e) => rt.isAsleep(e))!;
    rt.moveTo(other, { x: other.x + 64, y: other.y }, 100);
    expect(rt.isAsleep(other)).toBe(false);
    rt.update(1 / 60, new InputState());
    expect(other.x).toBeGreaterThan(other.spawn.x);
    // A flip moves every thing: none sleeps through it.
    rt = fresh();
    expect(count()).toBe(all);
    rt.flipLevel('upside_down', null, 0, 0);
    expect(count()).toBe(0);
    // A script that goes through the walls and moves them: each is awake when the script has it, and then moves.
    const scripted = produce(city.project, (d) => {
      const hero = d.definitions.find((x) => x.name === 'Player')!;
      const wall = d.definitions.find((x) => x.name === 'Wall')!;
      wall.tags = [...new Set([...wall.tags, 'wall'])];
      const checked = checkScript({ id: 'scr_test', name: 'Test', vars: [], states: [], handlers: [{ when: { on: 'key', key: 'fire', edge: 'pressed' }, if: null, do: [{ do: 'move_group', tag: 'wall', dx: '0', dy: '-32' }] }] }, d);
      if ('error' in checked) throw new Error(checked.error);
      hero.scripts = [...(hero.scripts ?? []), checked.script];
    });
    rt = new Runtime(scripted, id, registry);
    const before = rt.entities.filter((e) => e.name === 'Wall').map((e) => e.y);
    expect(rt.entities.filter((e) => rt.isAsleep(e)).length).toBe(all);
    const input = new InputState();
    rt.update(1 / 60, input);
    input.press('fire');
    for (let i = 0; i < 30; i++) rt.update(1 / 60, input);
    const walls = rt.entities.filter((e) => e.name === 'Wall');
    // (The script goes through at most so many at once: those it had are awake and moved, the rest sleep where they were.)
    const moved = walls.filter((e, i) => e.y !== before[i]);
    expect(moved.length).toBeGreaterThan(50);
    expect(moved.every((e) => !rt.isAsleep(e))).toBe(true);
    expect(walls.filter((e, i) => e.y === before[i]).every((e) => rt.isAsleep(e))).toBe(true);
  });

  it('played with sleepers and with every thing awake: the same state of every thing after every step', { timeout: 120000 }, () => {
    const games: [string, Project, number, (i: number) => Action[]][] = [
      ['a city seen from above, enemies wandering', makeWorld('city', 60, 34, registry).project, 600, roam],
      ['a run with ledges and walkers', makeWorld('run', 170, 21, registry).project, 600, run],
      ['a mine of dirt', makeWorld('mine', 30, 40, registry).project, 400, run],
      // Every family of the regression suite, with every key in turn.
      ['a built platformer level', marioLevel(registry, 3).project, 900, mash],
      ['a space shooter', spaceShooter(registry), 600, mash],
      ['a mining game', mining(registry), 600, mash],
      ['Boulder Dash', boulderDash(registry), 600, mash],
      ['Tetris', tetris(registry), 600, mash],
      ['Dr. Mario', drMario(registry, [{ col: 2, row: 10, color: 'red' }, { col: 5, row: 12, color: 'blue' }]), 600, mash],
      ['a tactics board', tacticsBoard(registry), 400, mash],
      ['an RPG, its map and a battle', rpgGame(registry), 400, mash],
      ['a room to dig through', digRoom(registry), 600, mash],
      ['the roguelike starter', createRoguelikeProject(registry), 300, mash],
      ['the isometric starter', createIsometricProject(registry), 600, mash],
      ['the RPG starter', createRpgProject(registry), 600, mash],
    ];
    for (const [name, project, steps, keys] of games) {
      const sleeping = play(project, steps, keys, false);
      const allAwake = play(project, steps, keys, true);
      const first = sleeping.findIndex((s, i) => s !== allAwake[i]);
      expect(first, `${name}: differs from step ${first + 1}`).toBe(-1);
      // (And something happened: the state is not the same all the way through.)
      expect(new Set(sleeping).size, name).toBeGreaterThan(5);
    }
  });

  it('what is given to be drawn for an area is what the whole list has in it: the same things, in the same order', () => {
    const city = makeWorld('city', 100, 60, registry);
    const rt = new Runtime(city.project, city.project.scenes[0].id, registry);
    const input = new InputState();
    input.press('right');
    /** The renderer's own measure of whether a thing is on (or just beyond) the area shown. */
    const within = (e: ReturnType<Runtime['renderList']>[number], a: { left: number; right: number; top: number; bottom: number }) => {
      const size = getEntitySize(e);
      const { rotation, scale, position } = e.transform;
      const w = Math.abs(size.x * scale.x);
      const h = Math.abs(size.y * scale.y);
      const hx = (rotation % 360 !== 0 ? Math.hypot(w, h) : w) / 2 + 1 + w;
      const hy = (rotation % 360 !== 0 ? Math.hypot(w, h) : h) / 2 + 1 + h;
      return !(position.x + hx < a.left || position.x - hx > a.right || position.y + hy < a.top || position.y - hy > a.bottom);
    };
    for (let round = 0; round < 6; round++) {
      for (let i = 0; i < 40; i++) rt.update(1 / 60, input);
      // (A wall woken on the way: it is given as a thing awake, not twice.)
      if (round === 3) rt.wake(rt.entities.find((e) => rt.isAsleep(e))!);
      for (const area of [
        { left: 0, right: 1522, top: 0, bottom: 696 },
        { left: 1000 + round * 300, right: 2522 + round * 300, top: 500, bottom: 1196 },
        { left: 2900, right: 3300, top: 1700, bottom: 2000 },
        { left: -5000, right: -4000, top: 0, bottom: 100 },
        { left: -100, right: 100 * 32 + 100, top: -100, bottom: 60 * 32 + 100 },
      ]) {
        const whole = rt.renderList().filter((e) => within(e, area));
        const asked = rt.renderList(area);
        expect(asked.length).toBeLessThanOrEqual(rt.entities.length);
        expect(asked.filter((e) => within(e, area)).map((e) => e.id)).toEqual(whole.map((e) => e.id));
        expect(JSON.stringify(asked.filter((e) => within(e, area)))).toBe(JSON.stringify(whole));
      }
    }
    // (And it is far fewer than the level: one screen of a city of 2,700 things.)
    expect(rt.renderList({ left: 1000, right: 2522, top: 500, bottom: 1196 }).length).toBeLessThan(900);
  });
});
