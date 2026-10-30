import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { ENGINE_PART_INFO, scriptedPart } from '../core/model/engineParts';
import { createDefinition, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Project, Vec2 } from '../core/types';
import { applyOperations } from '../core/commands/operations';
import { addRelationship } from '../core/logic/mutations';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';
import { checkScript } from '../core/script/language';
import { setScriptVar } from '../core/script/mutations';

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
      expect([part, checkScript(info.script({ name: def.name, components: def.components, requires: [{ item: 'key', consume: true, conditions: [] }] }), project)]).toEqual([part, { script: expect.anything() }]);
    }
  });
});

describe('shooting, moving platforms, hopping and timers, done by a script instead', () => {
  type Part = 'shooting' | 'moving' | 'hopping' | 'timer';
  /** Floor y=48 from -480 to 480 with walls at the ends; the player at `player`; `edit` adds things. With `scripted`, the parts' ready-made scripts. */
  function game(scripted: boolean, opts: { player: Vec2; gameType?: 'platformer' | 'topdown'; edit: (d: Project, place: (name: string, at: Vec2) => string) => void }): Runtime {
    let project = createProject(registry, 'Test', opts.gameType ?? 'platformer');
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      const place = (name: string, at: Vec2) => {
        const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, at);
        m.addEntity(d, sceneId, e);
        return e.id;
      };
      const solid = opts.gameType === 'topdown' ? 'Wall' : 'Platform';
      for (let x = -480; x <= 480; x += 32) place(solid, { x, y: 48 });
      for (let y = 16; y >= -144; y -= 32) {
        place(solid, { x: -480, y });
        place(solid, { x: 480, y });
      }
      place('Player', opts.player);
      opts.edit(d, place);
      if (scripted) {
        for (const def of d.definitions) {
          const parts = (['shooting', 'moving', 'hopping', 'timer'] as Part[]).filter((p) => def.components[ENGINE_PART_INFO[p].component]);
          if (parts.length) def.scripts = [...(def.scripts ?? []), ...parts.map((p) => ENGINE_PART_INFO[p].script({ name: def.name, components: def.components }))];
        }
      }
    });
    const rt = new Runtime(project, sceneId, registry);
    rt.random = (() => 0.5) as () => number;
    return rt;
  }
  /** Everything that moves, the shots, and what happened, step by step. */
  function film(rt: Runtime, steps: number, keys: Record<number, Action[]> = {}): string[] {
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
      const things = rt.entities.filter((e) => e.alive && (e.body !== 'static' || e.projectile)).map((e) => `${e.name}${e.projectile ? `(${e.projectile.left.toFixed(1)})` : ''}@${e.x.toFixed(4)},${e.y.toFixed(4)},${e.facing},${e.heading.x}/${e.heading.y}${e.health ? ` hp${e.health.current}` : ''}`);
      const events = rt.eventLog.filter((e) => ['shot', 'damaged', 'timer', 'died'].includes(e.type)).map((e) => `${e.type}:${e.subject}>${e.other}`);
      out.push(`${things.join(' ')} | ${events.length} ${events.slice(-1)}`);
    }
    return out;
  }
  function same(opts: Parameters<typeof game>[1], steps: number, keys?: Record<number, Action[]>) {
    const engine = film(game(false, opts), steps, keys);
    const script = film(game(true, opts), steps, keys);
    const at = script.findIndex((s, i) => s !== engine[i]);
    expect(at === -1 ? 'same' : `step ${at}:\nengine ${engine[at]}\nscript ${script[at]}`).toBe('same');
    return engine;
  }
  const shooter = (props: Record<string, unknown>) => (d: Project, place: (n: string, at: Vec2) => string) => {
    const turret = createDefinition('Turret', { Sprite: registry.createDefault('Sprite', { width: 24, height: 24 }), Collider: registry.createDefault('Collider', { size: { x: 24, y: 24 } }), Shooter: registry.createDefault('Shooter', props) }, ['enemy']);
    m.addDefinition(d, turret, registry);
    place('Turret', { x: 200, y: 20 });
  };

  it('Shooting: an auto turret fires at the player in range (facing it, or straight at it), hurting it, exactly as the engine', () => {
    const facing = same({ player: { x: 0, y: 16 }, edit: shooter({ interval: 0.5, range: 400 }) }, 900, { 200: ['right'], 260: [], 400: ['left'], 520: [] });
    expect(facing.at(-1)).toMatch(/shot:Turret>Shot/);
    expect(facing.some((t) => t.includes('damaged'))).toBe(true);
    same({ player: { x: 0, y: -60 }, edit: shooter({ interval: 0.4, direction: 'atTarget', range: 500 }) }, 600);
    // Out of range: nothing.
    expect(same({ player: { x: -400, y: 16 }, edit: shooter({ interval: 0.3, range: 100 }) }, 300).at(-1)).toMatch(/\| 0 $/);
  });

  it('Shooting: the player fires with X (left, right as it faces), and seen from above the way it last walked', () => {
    const gun = (d: Project) => {
      const p = d.definitions.find((x) => x.name === 'Player')!;
      p.components.Shooter = registry.createDefault('Shooter', { trigger: 'key', interval: 0.3, speed: 300 });
    };
    same({ player: { x: 0, y: 16 }, edit: gun }, 500, { 10: ['fire'], 12: [], 60: ['left'], 80: ['left', 'fire'], 82: ['left'], 150: [], 200: ['fire'], 202: [] });
    same({ player: { x: 0, y: -60 }, gameType: 'topdown', edit: gun }, 500, { 10: ['up'], 40: ['up', 'fire'], 42: [], 100: ['down', 'right'], 140: ['fire'], 142: [] });
  });

  it('Moving: a moving platform glides to its offset and back, waiting at each end, carrying the player standing on it', () => {
    const lift = (d: Project, place: (n: string, at: Vec2) => string) => {
      const platform = createDefinition('Lift', {
        Sprite: registry.createDefault('Sprite', { width: 64, height: 16 }),
        Collider: registry.createDefault('Collider', { size: { x: 64, y: 16 } }),
        PhysicsBody: registry.createDefault('PhysicsBody', { bodyType: 'kinematic' }),
        MovingPlatform: registry.createDefault('MovingPlatform', { offset: { x: 128, y: -64 }, speed: 60, pause: 0.4 }),
      });
      m.addDefinition(d, platform, registry);
      place('Lift', { x: 0, y: 24 });
    };
    const ride = same({ player: { x: 0, y: -8 }, edit: lift }, 1600, { 900: ['right'], 960: [] });
    // (The player rode it: carried right and up with it.)
    expect(ride.some((t) => /^Player@(1[0-9]{2})\./.test(t))).toBe(true);
  });

  it('after the switch, the Details settings still decide: a faster platform and a quicker turret, the same as the engine with them', () => {
    const tuned = (d: Project, place: (n: string, at: Vec2) => string) => {
      const platform = createDefinition('Lift', {
        Sprite: registry.createDefault('Sprite', { width: 64, height: 16 }),
        Collider: registry.createDefault('Collider', { size: { x: 64, y: 16 } }),
        PhysicsBody: registry.createDefault('PhysicsBody', { bodyType: 'kinematic' }),
        MovingPlatform: registry.createDefault('MovingPlatform', { offset: { x: 160, y: 0 }, speed: 140, pause: 0.1 }),
      });
      m.addDefinition(d, platform, registry);
      place('Lift', { x: -200, y: -100 });
      shooter({ interval: 0.2, speed: 400, range: 300 })(d, place);
    };
    const trace = same({ player: { x: 0, y: 16 }, edit: tuned }, 600);
    // (The platform went the whole 160 px at that speed, and the turret fired often.)
    expect(trace.some((t) => t.includes('Lift@-40.0000'))).toBe(true);
    expect(Number(trace.at(-1)!.split('| ')[1].split(' ')[0])).toBeGreaterThan(10);
  });

  it("a script's settings (its marked variables) change how it plays: a higher Stomp bounce", () => {
    const bounce = (high: boolean) => {
      let project = createProject(registry);
      const sceneId = project.scenes[0].id;
      project = produce(project, (d) => {
        const place = (name: string, at: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, at));
        for (let x = -160; x <= 160; x += 32) place('Platform', { x, y: 48 });
        place('Player', { x: 60, y: -80 });
        place('Enemy', { x: 60, y: 17 });
        const enemy = d.definitions.find((x) => x.name === 'Enemy')!;
        delete enemy.components.Patrol;
        const stomp = enemy.scripts!.find((x) => x.name === 'Stomp')!;
        expect(stomp.vars.filter((v) => v.setting).map((v) => v.name)).toEqual(['bounce', 'hits']);
        if (high) setScriptVar(d, { target: 'definition', id: enemy.id }, stomp.id, 'bounce', 520);
      });
      const rt = new Runtime(project, sceneId, registry);
      const input = new InputState();
      let fastest = 0;
      for (let i = 0; i < 120; i++) {
        rt.update(1 / 120, input);
        fastest = Math.min(fastest, rt.find('Player')!.vy);
      }
      return fastest;
    };
    expect(bounce(false)).toBeCloseTo(-320, 0);
    expect(bounce(true)).toBeCloseTo(-520, 0);
  });

  it('Hopping and Timer, exactly as the engine', () => {
    const hop = (d: Project) => {
      const p = d.definitions.find((x) => x.name === 'Enemy')!;
      delete p.components.Patrol;
      p.components.Jumper = registry.createDefault('Jumper', { interval: 0.7, jumpForce: 280 });
      p.components.Timer = registry.createDefault('Timer', { interval: 0.45, repeat: true });
    };
    const trace = same({ player: { x: -400, y: 16 }, edit: (d, place) => (hop(d), place('Enemy', { x: 100, y: 17 })) }, 900);
    expect(trace.at(-1)).toMatch(/timer:Enemy/);
  });
});

describe('running, done by a script instead', () => {
  const running = (d: Project) => {
    const player = d.definitions.find((x) => x.name === 'Player')!;
    player.scripts = [...(player.scripts ?? []), ENGINE_PART_INFO.running.script()];
  };
  /** Where the player is (and which way it faces) every step, with `edit` and optionally the Running script. */
  function trace(rt: Runtime, keys: Record<number, Action[]>, steps: number): string[] {
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
      out.push(`${p.x.toFixed(6)},${p.y.toFixed(6)},${p.vx.toFixed(6)},${p.vy.toFixed(6)},${p.grounded},${p.facing}`);
    }
    expect(rt.scripts.errors).toEqual([]);
    return out;
  }
  const same = (keys: Record<number, Action[]>, steps: number, edit: (d: Project) => void = () => {}) => {
    const engine = trace(level(false, edit), keys, steps);
    const script = trace(
      level(false, (d) => {
        edit(d);
        running(d);
      }),
      keys,
      steps,
    );
    expect(script.findIndex((s, i) => s !== engine[i])).toBe(-1);
    return engine;
  };

  it('runs, stops, turns and steers in the air exactly as the engine does', () => {
    const t = same({ 10: ['right'], 80: [], 120: ['left'], 200: ['left', 'jump'], 210: ['right'], 260: [] }, 360);
    // (It really ran right, then turned to face left.)
    expect(Number(t[79].split(',')[0])).toBeGreaterThan(20);
    expect(t[150].endsWith(',-1')).toBe(true);
  });

  it('…slips on ice the same way, and keeps to its speed setting and speed factor', () => {
    const ice = (d: Project) => {
      for (const def of d.definitions.filter((x) => x.name === 'Platform')) m.setDefinitionComponentField(d, def.id, 'PhysicsBody', 'friction', 0.03, registry);
    };
    const slide = same({ 10: ['right'], 60: [], 140: ['left'] }, 240, ice);
    const grippy = same({ 10: ['right'], 60: [], 140: ['left'] }, 240);
    expect(slide).not.toEqual(grippy);
    same({ 10: ['right'], 100: [] }, 160, (d) => m.setDefinitionComponentField(d, d.definitions.find((x) => x.name === 'Player')!.id, 'CharacterController', 'speed', 320, registry));
  });

  it('seen from above, walks in eight directions exactly as the engine does', () => {
    const topdown = (scripted: boolean) => {
      let project = createProject(registry, 'Test', 'topdown');
      const sceneId = project.scenes[0].id;
      project = produce(project, (d) => {
        m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 0, y: 0 }));
        m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Wall')!, { x: 96, y: 0 }));
        if (scripted) running(d);
      });
      return new Runtime(project, sceneId, registry);
    };
    const keys: Record<number, Action[]> = { 5: ['right'], 40: ['right', 'down'], 90: ['up'], 130: ['left', 'up'], 170: [], 200: ['right'] };
    const engine = trace(topdown(false), keys, 300);
    const script = trace(topdown(true), keys, 300);
    expect(script.findIndex((s, i) => s !== engine[i])).toBe(-1);
  });

  it('changed, it runs as the script says (the engine no longer sets its speed)', () => {
    const rt = level(false, (d) => {
      running(d);
      const s = d.definitions.find((x) => x.name === 'Player')!.scripts!.find((x) => x.takesOver === 'running')!;
      s.handlers[0].do = s.handlers[0].do.map((st) => JSON.parse(JSON.stringify(st).replaceAll("field(self, 'CharacterController.speed')", "field(self, 'CharacterController.speed') * 0.5")));
    });
    const slow = trace(rt, { 10: ['right'] }, 120);
    expect(Number(slow[119].split(',')[2])).toBeCloseTo(100, 3);
  });
});

describe('climbing ladders and ledge grabs, done by scripts instead', () => {
  const give = (d: Project, part: 'climbing' | 'ledge_grab' | 'running' | 'jumping') => {
    const player = d.definitions.find((x) => x.name === 'Player')!;
    player.scripts = [...(player.scripts ?? []), ENGINE_PART_INFO[part].script()];
  };
  function trace(rt: Runtime, keys: Record<number, Action[]>, steps: number): string[] {
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
      out.push(`${p.x.toFixed(6)},${p.y.toFixed(6)},${p.vx.toFixed(6)},${p.vy.toFixed(6)},${p.grounded},${p.climbing},${p.hanging ? p.hanging.side : 0},${p.facing}`);
    }
    expect(rt.scripts.errors).toEqual([]);
    return out;
  }
  /** The same keys with the engine and with the scripts for `parts`: the same, step by step. */
  const same = (parts: ('climbing' | 'ledge_grab' | 'running' | 'jumping')[], keys: Record<number, Action[]>, steps: number, edit: (d: Project) => void = () => {}) => {
    const engine = trace(level(false, edit), keys, steps);
    const script = trace(
      level(false, (d) => {
        edit(d);
        for (const p of parts) give(d, p);
      }),
      keys,
      steps,
    );
    const first = script.findIndex((s, i) => s !== engine[i]);
    expect(first === -1 ? 'same' : `step ${first}: engine ${engine[first]} script ${script[first]}`).toBe('same');
    return engine;
  };

  it('climbs up to the top and stands on it, climbs down again, jumps off, and steps off the side, exactly as the engine does', () => {
    // Walk left to the ladder and climb all the way up (it stands on top, then walks off it).
    const up = same(['climbing'], { 0: ['left'], 60: ['left', 'up'], 80: ['up'], 260: ['right'], 300: [] }, 400);
    expect(up.some((t) => t.split(',')[5] === 'true')).toBe(true);
    expect(Math.min(...up.map((t) => Number(t.split(',')[1])))).toBeLessThan(-80);
    // Up a little, down to the floor, up again and jump off; then up and step off to the side.
    same(['climbing'], { 0: ['left'], 60: ['left', 'up'], 80: ['up'], 120: ['down'], 200: ['up'], 230: ['jump'], 231: [], 300: ['up'], 330: ['up', 'right'], 360: [] }, 460);
    // Climbed up, then down from the top.
    same(['climbing'], { 0: ['left'], 60: ['left', 'up'], 80: ['up'], 260: [], 280: ['down'], 340: [] }, 420);
    // With Running and Jumping scripts too.
    same(['running', 'jumping', 'climbing'], { 0: ['left'], 60: ['left', 'up'], 80: ['up'], 230: ['jump'], 231: [], 300: ['up', 'right'], 360: [] }, 420);
  });

  it('grabs a ledge, climbs up onto it or lets go, exactly as the engine does', () => {
    // A wall two tiles high right of the player (its top at y = -16), and the Player can grab ledges.
    const wall = (d: Project) => {
      const sceneId = d.scenes[0].id;
      for (const y of [16, -16]) m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Platform')!, { x: 64, y }));
      m.addDefinitionComponent(d, d.definitions.find((x) => x.name === 'Player')!.id, 'LedgeGrab', registry);
    };
    const grab = (d: Project) => wall(d);
    // Jump against the wall pressing right: it hangs; Up climbs on top.
    const climbed = same(['ledge_grab'], { 0: ['jump', 'right'], 40: ['right'], 150: ['up'], 160: [] }, 260, grab);
    expect(climbed.some((t) => t.split(',')[6] === '1')).toBe(true);
    /** Hanging (h) or not (-) over time, runs merged: "-h-h-" is hang, let go, hang again. */
    const hangs = (trace: string[]) => trace.map((x) => (x.split(',')[6] === '0' ? '-' : 'h')).join('').replace(/(.)\1+/g, '$1');
    // (Climbed up: it ends standing on top of the wall, at y = -48.)
    expect(hangs(climbed)).toBe('-h-');
    expect(Number(climbed.at(-1)!.split(',')[1])).toBeCloseTo(-48, 3);
    // Hangs, then lets go with Down; hangs again after the wait.
    const dropped = same(['ledge_grab'], { 0: ['jump', 'right'], 40: ['right'], 150: ['down'], 160: ['right'], 200: ['jump', 'right'], 240: ['right'] }, 360, grab);
    expect(hangs(dropped)).toBe('-h-h');
    // Pressing away lets go too; Jump climbs up.
    const away = same(['ledge_grab'], { 0: ['jump', 'right'], 40: ['right'], 120: ['left'], 140: [], 160: ['jump', 'right'], 200: ['right'], 320: ['jump'], 321: [] }, 420, grab);
    expect(hangs(away)).toBe('-h-h-');
    // With the other scripts too.
    same(['running', 'jumping', 'climbing', 'ledge_grab'], { 0: ['jump', 'right'], 40: ['right'], 150: ['up'], 160: [] }, 260, grab);
  });
});

describe('switches and locked doors, done by scripts instead', () => {
  type Part = 'switching' | 'unlocking';
  /**
   * Floor y=48; the Player at x=0; a Switch at x=64 that controls a Door at x=200; a Key at x=-80 and a second
   * Door at x=-200 that requires it. With `parts`, the Switch and the Doors use their ready-made scripts.
   */
  function world(parts: Part[], edit: (d: Project, ids: Record<string, string>) => void = () => {}): Runtime {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      const def = (name: string) => d.definitions.find((x) => x.name === name)!;
      const place = (name: string, pos: Vec2) => {
        const e = instantiateDefinition(def(name), pos);
        m.addEntity(d, sceneId, e);
        return e.id;
      };
      for (let x = -320; x <= 320; x += 32) place('Platform', { x, y: 48 });
      place('Player', { x: 0, y: 16 });
      const ids = { switch: place('Switch', { x: 64, y: 16 }), door: place('Door', { x: 200, y: 0 }), key: place('Key', { x: -80, y: 20 }), locked: place('Door', { x: -200, y: 0 }) };
      addRelationship(d, sceneId, { type: 'controls', source: { kind: 'entity', id: ids.switch }, target: { kind: 'entity', id: ids.door }, params: {}, conditions: [] });
      addRelationship(d, sceneId, { type: 'requires', source: { kind: 'entity', id: ids.locked }, target: { kind: 'object', id: def('Key').id }, params: { consume: true }, conditions: [] });
      edit(d, ids);
      if (parts.includes('switching')) applyOperations(d, [{ op: 'use_script_for', target: 'entity', id: ids.switch, part: 'switching', scriptJson: null }] as never, registry);
      if (parts.includes('unlocking')) applyOperations(d, [{ op: 'use_script_for', target: 'entity', id: ids.locked, part: 'unlocking', scriptJson: null }] as never, registry);
    });
    return new Runtime(project, sceneId, registry);
  }
  /** Each step: where the player is, what it carries, the switch, the doors; and what happened (the event log). */
  function trace(rt: Runtime, keys: Record<number, Action[]>, steps: number): { steps: string[]; events: string[] } {
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
      const doors = rt.entities.filter((e) => e.name === 'Door');
      const sw = rt.entities.find((e) => e.name === 'Switch')!;
      out.push(`${p.x.toFixed(4)},${p.y.toFixed(4)},${p.inventory?.get('key') ?? 0},${sw.switch!.on},${doors.map((dd) => dd.open).join('/')}`);
    }
    expect(rt.scripts.errors).toEqual([]);
    const events = rt.gameplay.log.filter((e) => !['touch_started', 'touch_ended', 'level_started'].includes(e.type)).map((e) => `${e.time} ${e.type} ${e.subject}>${e.other} ${JSON.stringify(e.detail ?? {})}`);
    return { steps: out, events };
  }
  const same = (parts: Part[], keys: Record<number, Action[]>, steps: number, edit?: (d: Project, ids: Record<string, string>) => void) => {
    const engine = trace(world([], edit), keys, steps);
    const script = trace(world(parts, edit), keys, steps);
    const first = script.steps.findIndex((t, i) => t !== engine.steps[i]);
    expect(first === -1 ? 'same' : `step ${first}: engine ${engine.steps[first]} script ${script.steps[first]}`).toBe('same');
    expect(script.events).toEqual(engine.events);
    return engine;
  };

  it('a switch used with E (on, off, on again) opens and closes what it controls exactly as the engine does', () => {
    const t = same(['switching'], { 0: ['right'], 30: [], 60: ['interact'], 62: [], 120: ['interact'], 122: [], 180: ['interact'], 182: [] }, 240);
    expect(t.events.filter((e) => e.includes('switch_activated')).length).toBe(3);
    expect(t.steps.at(-1)!.endsWith('true,true/false')).toBe(true);
  });

  it('…once only, and one used by walking into it', () => {
    const once = (d: Project, ids: Record<string, string>) => m.setEntityComponentField(d, d.scenes[0].id, ids.switch, 'Switch', 'once', true, registry);
    const t = same(['switching'], { 0: ['right'], 30: [], 60: ['interact'], 62: [], 120: ['interact'], 122: [] }, 200, once);
    expect(t.events.filter((e) => e.includes('switch_activated')).length).toBe(1);
    const touch = (d: Project, ids: Record<string, string>) => m.setEntityComponentField(d, d.scenes[0].id, ids.switch, 'Switch', 'activation', 'touch', registry);
    const w = same(['switching'], { 0: ['right'], 60: ['left'], 120: ['right'], 180: [] }, 260, touch);
    expect(w.events.filter((e) => e.includes('switch_activated')).length).toBeGreaterThan(1);
  });

  it('a locked door: "locked" without the key, opens with it (using it up), exactly as the engine does', () => {
    const t = same(['unlocking'], { 0: ['left'], 200: [] }, 260);
    expect(t.events.some((e) => e.includes('locked'))).toBe(false);
    expect(t.steps.at(-1)!.split(',')[2]).toBe('0');
    expect(t.steps.at(-1)!.endsWith('false/true')).toBe(true);
    // Without picking the key up first (it is elsewhere): locked, stays shut.
    const away = (d: Project, ids: Record<string, string>) => m.setEntityTransform(d, d.scenes[0].id, ids.key, { position: { x: 280, y: 20 } });
    const l = same(['unlocking'], { 0: ['left'], 200: [] }, 260, away);
    expect(l.events.some((e) => e.includes('locked'))).toBe(true);
    // Both scripted at once.
    same(['switching', 'unlocking'], { 0: ['right'], 30: [], 60: ['interact'], 62: [], 80: ['left'], 300: [] }, 360);
  });

  it('a key connection with conditions is turned into the same script conditions', () => {
    const healthy = (d: Project) => {
      const r = d.scenes[0].relationships.find((x) => x.type === 'requires')!;
      r.conditions = [{ type: 'health', entity: { kind: 'subject' }, compare: '>=', value: 3, not: false }];
    };
    const t = same(['unlocking'], { 0: ['left'], 200: [] }, 260, healthy);
    expect(t.steps.at(-1)!.endsWith('false/true')).toBe(true);
    const tooHigh = (d: Project) => {
      const r = d.scenes[0].relationships.find((x) => x.type === 'requires')!;
      r.conditions = [{ type: 'health', entity: { kind: 'subject' }, compare: '>=', value: 99, not: false }];
    };
    const shut = same(['unlocking'], { 0: ['left'], 200: [] }, 260, tooHigh);
    expect(shut.steps.at(-1)!.endsWith('false/false')).toBe(true);
  });
});
