import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { ENGINE_PART_INFO, scriptedPart } from '../core/model/engineParts';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Project, Vec2 } from '../core/types';
import { applyOperations } from '../core/commands/operations';
import { addRelationship } from '../core/logic/mutations';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';
import { checkScript } from '../core/script/language';

const registry = createBuiltinRegistry();

/**
 * Ground at y=48 from x=-160 to 96 (a ledge at its right end), a ladder at x=-120, the Player at x=0. With
 * `scripted`, the Player's jumping is done by the ready-made Jumping script instead of the engine.
 */
function level(scripted: boolean, edit: (d: Project) => void = () => {}): Runtime {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let x = -160; x <= 96; x += 32) place('Platform', { x, y: 48 });
    for (let y = 16; y >= -80; y -= 32) place('Ladder', { x: -120, y });
    place('Player', { x: 0, y: 16 });
    const player = d.definitions.find((x) => x.name === 'Player')!;
    if (scripted) player.scripts = [...(player.scripts ?? []), ENGINE_PART_INFO.jumping.script()];
    edit(d);
  });
  return new Runtime(project, sceneId, registry);
}

/** Plays `keys` (step -> keys held from then on) for `steps` fixed steps; where the player is, step by step. */
function play(rt: Runtime, keys: Record<number, Action[]>, steps: number): string[] {
  const input = new InputState();
  let held: Action[] = [];
  const out: string[] = [];
  for (let i = 0; i < steps; i++) {
    if (keys[i]) {
      for (const k of held) if (!keys[i].includes(k)) input.release(k);
      for (const k of keys[i]) if (!held.includes(k)) input.press(k);
      held = keys[i];
    }
    rt.update(1 / 120, input);
    const p = rt.find('Player')!;
    out.push(`${p.x.toFixed(6)},${p.y.toFixed(6)},${p.vx.toFixed(6)},${p.vy.toFixed(6)},${p.grounded}`);
  }
  return out;
}

/** The same keys, with the engine's jumping and with the Jumping script: the player is in the same place every step. */
function same(keys: Record<number, Action[]>, steps: number, edit?: (d: Project) => void) {
  const engine = play(level(false, edit), keys, steps);
  const script = play(level(true, edit), keys, steps);
  expect(script.findIndex((s, i) => s !== engine[i])).toBe(-1);
  expect(script).toEqual(engine);
  return engine;
}

describe('engine parts done by a script instead', () => {
  it('the ready-made Jumping script jumps exactly as the engine does: a full jump, and a short hop when let go early', () => {
    const full = same({ 30: ['jump'], 200: [] }, 260);
    const hop = same({ 30: ['jump'], 45: [], 200: [] }, 260);
    // (It really jumped, and the hop is lower.)
    const top = (trace: string[]) => Math.min(...trace.map((t) => Number(t.split(',')[1])));
    expect(top(full)).toBeLessThan(16 - 40);
    expect(top(hop)).toBeGreaterThan(top(full) + 10);
  });

  it('…a press just before landing still jumps, and so does one just after running off a ledge', () => {
    // Jump, and press again a few steps before landing.
    const steps = play(level(false), { 30: ['jump'], 31: [] }, 400);
    const landed = steps.findIndex((t, i) => i > 40 && t.endsWith('true'));
    same({ 30: ['jump'], 31: [], [landed - 8]: ['jump'], [landed - 7]: [] }, 400);
    // Run right off the ledge (x = 112) and press jump just after.
    const run = play(level(false), { 0: ['right'] }, 200);
    const off = run.findIndex((t, i) => i > 0 && t.endsWith('false'));
    same({ 0: ['right'], [off + 4]: ['right', 'jump'], [off + 5]: ['right'] }, 300);
  });

  it('…double jumps with DoubleJump, and jumps off a ladder', () => {
    const dj = (d: Project) => m.addDefinitionComponent(d, d.definitions.find((x) => x.name === 'Player')!.id, 'DoubleJump', registry);
    same({ 30: ['jump'], 31: [], 70: ['jump'], 71: [], 120: ['jump'], 121: [] }, 400, dj);
    // Walk left to the ladder, climb up, jump off.
    same({ 0: ['left'], 60: ['left', 'up'], 120: ['up'], 150: ['jump'], 151: [] }, 400);
  });

  it('the jump height setting still works with the script, and switching the script off gives jumping back to the engine', () => {
    const higher = (d: Project) => m.setDefinitionComponentField(d, d.definitions.find((x) => x.name === 'Player')!.id, 'CharacterController', 'jumpForce', 500, registry);
    same({ 30: ['jump'], 200: [] }, 260, higher);
    const off = level(true, (d) => {
      const s = d.definitions.find((x) => x.name === 'Player')!.scripts!.find((x) => x.takesOver === 'jumping')!;
      s.enabled = false;
    });
    expect(play(off, { 30: ['jump'], 200: [] }, 260)).toEqual(play(level(false), { 30: ['jump'], 200: [] }, 260));
    expect(scriptedPart(off.project.definitions.find((x) => x.name === 'Player')!.scripts, 'jumping')).toBe(false);
  });

  it('a script that took jumping over, changed: the engine no longer jumps by itself (only the script decides)', () => {
    const rt = level(true, (d) => {
      const s = d.definitions.find((x) => x.name === 'Player')!.scripts!.find((x) => x.takesOver === 'jumping')!;
      // A changed jump: twice as high a speed.
      s.handlers[0].do = s.handlers[0].do.map((st) => JSON.parse(JSON.stringify(st).replaceAll("field(self, 'CharacterController.jumpForce')", "field(self, 'CharacterController.jumpForce') * 2")));
    });
    const engine = play(level(false), { 30: ['jump'], 200: [] }, 60);
    const changed = play(rt, { 30: ['jump'], 200: [] }, 60);
    // (Gravity is added after the jump in the same step: the difference is one more jumpForce, 350.)
    expect(Number(changed[31].split(',')[3]) - Number(engine[31].split(',')[3])).toBeCloseTo(-350, 3);
    expect(rt.scripts.errors).toEqual([]);
  });
});

describe('use_script_for (the AI turning an engine part into a script, after the user said yes)', () => {
  const apply = (p: Project, ops: unknown[]) => produce(p, (d) => void applyOperations(d, ops as never, registry));
  const player = (p: Project) => p.definitions.find((x) => x.name === 'Player')!;

  it('gives the object the ready-made script (or the changed one asked for), once; removing it gives the part back', () => {
    const base = createProject(registry);
    const id = player(base).id;
    const once = apply(base, [{ op: 'use_script_for', target: 'definition', id, part: 'jumping', scriptJson: null }]);
    expect(player(once).scripts!.filter((s) => s.takesOver === 'jumping').map((s) => s.name)).toEqual(['Jumping']);
    expect(scriptedPart(player(once).scripts, 'jumping')).toBe(true);
    // A changed one, asked again: replaces it (never two scripts doing one part).
    const changed = { ...ENGINE_PART_INFO.jumping.script(), name: 'Floaty jumping', id: undefined };
    const twice = apply(once, [{ op: 'use_script_for', target: 'definition', id, part: 'jumping', scriptJson: JSON.stringify(changed) }]);
    expect(player(twice).scripts!.filter((s) => s.takesOver === 'jumping').map((s) => s.name)).toEqual(['Floaty jumping']);
    // (The mark is kept even when the changed script leaves it out.)
    const unmarked = apply(once, [{ op: 'use_script_for', target: 'definition', id, part: 'jumping', scriptJson: JSON.stringify({ ...changed, takesOver: undefined }) }]);
    expect(scriptedPart(player(unmarked).scripts, 'jumping')).toBe(true);
    const back = apply(twice, [{ op: 'remove_script', target: 'definition', id, scriptId: player(twice).scripts!.find((s) => s.takesOver)!.id }]);
    expect(scriptedPart(player(back).scripts, 'jumping')).toBe(false);
  });

  it('an object without a Character Controller has no jumping to take over', () => {
    const base = createProject(registry);
    const coin = base.definitions.find((x) => x.name === 'Coin')!;
    expect(() => apply(base, [{ op: 'use_script_for', target: 'definition', id: coin.id, part: 'jumping', scriptJson: null }])).toThrow(/no CharacterController/);
  });
});

describe('picking things up, done by a script instead', () => {
  /** Coins, a key and a heart in a row to the right of the player (hurt once, so the heart heals); with `scripted`, each item's object has its ready-made "Picked up" script. */
  function items(scripted: boolean, edit: (d: Project) => void = () => {}): Runtime {
    return level(false, (d) => {
      const sceneId = d.scenes[0].id;
      const place = (name: string, x: number) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((n) => n.name === name)!, { x, y: 20 }));
      place('Coin', 40);
      place('Coin', 56);
      place('Key', 72);
      place('Heart', 88);
      d.definitions.find((x) => x.name === 'Player')!.components.Health.currentHealth = 2;
      if (scripted) {
        for (const def of d.definitions.filter((x) => x.components.Collectible)) {
          def.scripts = [...(def.scripts ?? []), ENGINE_PART_INFO.picking_up.script({ name: def.name, components: def.components })];
        }
      }
      edit(d);
    });
  }
  /** Walking right: step by step, what the player carries, its health, what is left and what happened. */
  function walk(rt: Runtime): string[] {
    const input = new InputState();
    input.press('right');
    const out: string[] = [];
    for (let i = 0; i < 160; i++) {
      rt.update(1 / 120, input);
      const p = rt.find('Player')!;
      const left = rt.entities.filter((e) => e.collectible && e.alive).length;
      const events = rt.eventLog.filter((e) => !e.type.startsWith('touch')).map((e) => `${e.type}:${e.subject}>${e.other}`);
      out.push(`${p.x.toFixed(4)} ${JSON.stringify([...(p.inventory ?? new Map())])} hp${p.health?.current} left${left} ${events.join('|')}`);
    }
    return out;
  }

  it('the ready-made script picks things up exactly as the engine does: items, health back, what is left, the events', () => {
    const engine = walk(items(false));
    expect(walk(items(true))).toEqual(engine);
    // (It really picked them up: two coins, a key, a heart's health back.)
    expect(engine.at(-1)).toContain('[["coin",2],["key",1]] hp3 left0');
    expect(engine.at(-1)).toContain('collected:Player>Coin');
  });

  it('…also by a "collects" connection (a player without an Inventory picks up only coins)', () => {
    const connection = (d: Project) => {
      const player = d.definitions.find((x) => x.name === 'Player')!;
      delete player.components.Inventory;
      addRelationship(d, d.scenes[0].id, { type: 'collects', source: { kind: 'object', id: player.id }, target: { kind: 'object', id: d.definitions.find((x) => x.name === 'Coin')!.id }, params: {}, conditions: [] });
    };
    const engine = walk(items(false, connection));
    expect(walk(items(true, connection))).toEqual(engine);
    expect(engine.at(-1)).toContain('left2');
  });
});

describe('enemy movement, done by a script instead', () => {
  /** Random numbers that are the same every run (so both games draw the same ones). */
  const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);

  /**
   * A side-view level: a long floor with a wall at each end, a raised ledge on the right, ladders up to it, the
   * player at `player`; enemies placed at `enemies`. With `scripted`, the enemies' objects have their ready-made
   * Patrol / Wander scripts.
   */
  function world(scripted: boolean, opts: { player: Vec2; enemies: Vec2[]; gameType?: 'platformer' | 'topdown'; edit?: (d: Project) => void }): Runtime {
    let project = createProject(registry, 'Test', opts.gameType ?? 'platformer');
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      const wall = opts.gameType === 'topdown' ? 'Wall' : 'Stone';
      const floor = opts.gameType === 'topdown' ? 'Wall' : 'Platform';
      for (let x = -480; x <= 480; x += 32) place(floor, { x, y: 48 });
      for (let y = 16; y >= -144; y -= 32) {
        place(wall, { x: -480, y });
        place(wall, { x: 480, y });
      }
      if (opts.gameType === 'topdown') for (let x = -480; x <= 480; x += 32) place(wall, { x, y: -176 });
      else {
        for (let x = 224; x <= 448; x += 32) place('Platform', { x, y: -80 });
        for (let y = 16; y >= -80; y -= 32) place('Ladder', { x: 192, y });
        for (let y = 16; y >= -80; y -= 32) place('Ladder', { x: -160, y });
        for (let x = -224; x <= -96; x += 32) place('Platform', { x, y: -112 });
      }
      place('Player', opts.player);
      for (const at of opts.enemies) place('Enemy', at);
      opts.edit?.(d);
      if (scripted) {
        for (const def of d.definitions) {
          const parts = (['patrolling', 'wandering'] as const).filter((p) => def.components[ENGINE_PART_INFO[p].component]);
          if (parts.length) def.scripts = [...(def.scripts ?? []), ...parts.map((p) => ENGINE_PART_INFO[p].script({ name: def.name, components: def.components }))];
        }
      }
    });
    const rt = new Runtime(project, sceneId, registry);
    rt.random = seeded(7);
    return rt;
  }

  /** Plays `keys` (step -> keys held from then on); the enemies, step by step. */
  function watch(rt: Runtime, steps: number, keys: Record<number, Action[]> = {}): string[] {
    const input = new InputState();
    let held: Action[] = [];
    const out: string[] = [];
    for (let i = 0; i < steps; i++) {
      if (keys[i]) {
        for (const k of held) if (!keys[i].includes(k)) input.release(k);
        for (const k of keys[i]) if (!held.includes(k)) input.press(k);
        held = keys[i];
      }
      rt.update(1 / 120, input);
      out.push(
        rt.entities
          .filter((e) => e.name === 'Enemy')
          .map((e) => `${e.x.toFixed(5)},${e.y.toFixed(5)},${e.vx.toFixed(5)},${e.vy.toFixed(5)},${e.facing},${e.climbing ? 'c' : ''}${e.climbDir},${e.heading.x}/${e.heading.y}`)
          .join(' '),
      );
    }
    return out;
  }

  function same(opts: Parameters<typeof world>[1], steps: number, keys?: Record<number, Action[]>) {
    const engine = watch(world(false, opts), steps, keys);
    const script = watch(world(true, opts), steps, keys);
    const at = script.findIndex((s, i) => s !== engine[i]);
    expect(at === -1 ? 'same' : `step ${at}: engine ${engine[at]} / script ${script[at]}`).toBe('same');
    return engine;
  }

  it('Patrol: walks back and forth, turns at walls and ledges and after its distance, climbs ladders it passes, exactly as the engine', () => {
    // The player far away behind a wall (never seen): only patrolling. Enemies on the floor and on the ledge.
    const trace = same({ player: { x: -400, y: -400 }, enemies: [{ x: 0, y: 17 }, { x: 300, y: -113 }, { x: -140, y: 17 }] }, 2600);
    // (They really moved, turned, and one climbed.)
    expect(new Set(trace.map((t) => t.split(' ')[0].split(',')[4])).size).toBe(2);
    expect(trace.some((t) => t.includes(',c'))).toBe(true);
  });

  it('Patrol: chases the player it sees, slowing down to turn when the player gets behind it, and follows up a ladder', () => {
    // The player runs right past the enemy, then back, then climbs the ladder at x=192 onto the ledge.
    same({ player: { x: -100, y: 16 }, enemies: [{ x: 60, y: 17 }] }, 2400, { 0: ['right'], 180: [], 300: ['left'], 420: ['right'], 560: ['up'], 700: ['right'], 760: [] });
  });

  it('Patrol for fliers: up and down, and chasing straight at the player', () => {
    const flier = (d: Project) => {
      const enemy = d.definitions.find((x) => x.name === 'Enemy')!;
      enemy.components.PhysicsBody = { ...enemy.components.PhysicsBody, gravityScale: 0 };
      enemy.components.Patrol = { ...enemy.components.Patrol, startDirection: 'up', distance: 64, chaseRange: 0 };
    };
    same({ player: { x: -400, y: 16 }, enemies: [{ x: 0, y: -40 }], edit: flier }, 1200);
    const chaser = (d: Project) => {
      const enemy = d.definitions.find((x) => x.name === 'Enemy')!;
      enemy.components.PhysicsBody = { ...enemy.components.PhysicsBody, gravityScale: 0 };
    };
    same({ player: { x: -100, y: 16 }, enemies: [{ x: 100, y: -60 }], edit: chaser }, 1200, { 0: ['left'], 300: ['right'], 600: [] });
  });

  it('Wander: walks around at random, turning at walls and standing still now and then, exactly as the engine (also seen from above)', () => {
    const wanderer = (d: Project) => {
      const enemy = d.definitions.find((x) => x.name === 'Enemy')!;
      delete enemy.components.Patrol;
      enemy.components.Wander = registry.createDefault('Wander', { speed: 60, interval: 1 });
    };
    const side = same({ player: { x: -400, y: -400 }, enemies: [{ x: 0, y: 17 }, { x: 200, y: 17 }], edit: wanderer }, 2400);
    expect(new Set(side.map((t) => t.split(' ')[0].split(',')[2])).size).toBeGreaterThan(2);
    same({ player: { x: -400, y: -100 }, enemies: [{ x: 0, y: -60 }, { x: 120, y: -20 }], gameType: 'topdown' }, 2400);
  });
});

describe('the ready-made scripts', () => {
  it('every one checks out (a script that does not would not run, and the engine would leave the part undone)', () => {
    const project = createProject(registry);
    for (const [part, info] of Object.entries(ENGINE_PART_INFO)) {
      const def = project.definitions.find((d) => d.components[info.component]) ?? { name: 'Thing', components: { [info.component]: {} } };
      expect([part, checkScript(info.script({ name: def.name, components: def.components }), project)]).toEqual([part, { script: expect.anything() }]);
    }
  });
});
