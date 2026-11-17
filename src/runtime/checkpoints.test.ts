/**
 * F6c, checkpoints (docs/engine-architecture-proposal.md §22.7): a place to come back to, in any kind of game. A
 * Checkpoint touched, or set by a script; coming back there after dying or falling out; what a level restart does
 * (from the very start, or at the checkpoint with the world as at the start); other levels and the game begun again
 * know nothing of it; a level left for a visit keeps its own.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { topicsFor } from '../core/ai/topics';
import { applyOperations } from '../core/commands/operations';
import { createBuiltinRegistry } from '../core/components/builtin';
import { checkGame, projectFromPreset } from '../core/engine/profile';
import { createDefinition, createLevelFor, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { setScript } from '../core/script/mutations';
import type { Project } from '../core/types';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';
import { GameSession, WON_PAUSE } from './session';

const registry = createBuiltinRegistry();
const DT = 1 / 60;

/** An object that is a checkpoint (a flag, a save stone): a picture, a trigger, the Checkpoint component. */
function addFlag(d: Project, name = 'Flag', settings: Record<string, unknown> = {}) {
  const def = createDefinition(name, {
    Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }),
    Collider: registry.createDefault('Collider', { size: { x: 32, y: 32 }, isTrigger: true }),
    Checkpoint: registry.createDefault('Checkpoint', settings),
  });
  m.addDefinition(d, def, registry);
  return def;
}

/**
 * Side view: a floor from x = -144 to 304 (its top at y = 32) with nothing beyond it, the player at 0, a coin at 48,
 * a flag at 160 and another at 256.
 */
function sideLevel(settings: Record<string, unknown> = {}, more: (d: Project, place: (name: string, x: number, y: number) => void) => void = () => {}): Project {
  return produce(createProject(registry), (d) => {
    addFlag(d, 'Flag', settings);
    const place = (name: string, x: number, y: number) => m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((q) => q.name === name)!, { x, y }));
    for (let x = -144; x <= 304; x += 32) place('Platform', x, 48);
    place('Player', 0, 16);
    place('Coin', 48, 16);
    place('Flag', 160, 16);
    place('Flag', 256, 16);
    more(d, place);
  });
}

function play(p: Project, scene = 0) {
  const rt = new Runtime(p, p.scenes[scene].id, registry);
  const input = new InputState();
  const run = (seconds: number, hold: Action[] = []) => {
    for (const a of hold) input.press(a);
    for (let i = 0; i < Math.round(seconds / DT); i++) rt.update(DT, input);
    for (const a of hold) input.release(a);
  };
  const events = (type: string) => rt.eventLog.filter((e) => e.type === type);
  return { rt, input, run, events, player: () => rt.entities.find((e) => e.controller)! };
}

/** Walks until the player's x passes `x` (right) or is under it (left). */
function walkTo(g: ReturnType<typeof play>, x: number) {
  const dir = g.player().x < x ? 'right' : 'left';
  for (let i = 0; i < 600 && (dir === 'right' ? g.player().x < x : g.player().x > x); i++) g.run(DT, [dir]);
}

describe('F6c checkpoints: a place to come back to (side view)', () => {
  it('a Checkpoint touched: the player who falls out of the level comes back standing there, not at the start; the world stays as it was', () => {
    const g = play(sideLevel());
    g.run(0.3);
    const start = { x: g.player().x, y: g.player().y };
    walkTo(g, 170);
    expect(g.events('checkpoint_reached').map((e) => [e.subject, e.other])).toEqual([['Player', 'Flag']]);
    expect(g.events('collected').length).toBe(1);
    // Back a little (not onto the second flag), then off the left end of the floor.
    walkTo(g, -200);
    g.run(3);
    expect(g.events('respawned').map((e) => e.detail?.reason)).toEqual(['fell']);
    // Standing on the first flag's ground: its x, the height the player stood at at the start.
    expect(Math.round(g.player().x)).toBe(160);
    expect(g.player().y).toBeCloseTo(start.y, 0);
    expect(g.player().grounded).toBe(true);
    // The coin taken before stays taken.
    expect(g.rt.entities.filter((e) => e.name === 'Coin' && e.alive).length).toBe(0);
    expect(g.rt.scripts.errors).toEqual([]);
  });

  it('the last checkpoint touched counts (a second one, then the first again); touching the same one again says nothing new', () => {
    const g = play(sideLevel());
    walkTo(g, 262);
    expect(g.events('checkpoint_reached').length).toBe(2);
    g.rt.respawn(g.player(), 'died');
    expect(Math.round(g.player().x)).toBe(256);
    // (Standing on it after coming back: the same checkpoint, no new event.)
    g.run(0.3);
    expect(g.events('checkpoint_reached').length).toBe(2);
    walkTo(g, 150);
    expect(g.events('checkpoint_reached').length).toBe(3);
    g.rt.respawn(g.player(), 'died');
    expect(Math.round(g.player().x)).toBe(160);
  });

  it('heal: reaching it gives full health (off: health stays as it is)', () => {
    for (const heal of [true, false]) {
      const g = play(sideLevel({ heal }));
      g.run(0.2);
      const p = g.player();
      expect(p.health!.max).toBeGreaterThan(1);
      p.health!.current = 1;
      walkTo(g, 170);
      expect(p.health!.current, `heal ${heal}`).toBe(heal ? p.health!.max : 1);
    }
  });

  it('a level started again: from the very start by default; with keepOnRestart at the checkpoint, the world as at the start', () => {
    for (const keepOnRestart of [false, true]) {
      const g = play(sideLevel({ keepOnRestart }));
      g.run(0.2);
      walkTo(g, 170);
      expect(g.rt.entities.filter((e) => e.name === 'Coin' && e.alive).length).toBe(0);
      g.rt.restart();
      g.run(0.3);
      expect(Math.round(g.player().x), `keep ${keepOnRestart}`).toBe(keepOnRestart ? 160 : 0);
      expect(g.player().grounded).toBe(true);
      // The world is as at the start either way: the coin is back.
      expect(g.rt.entities.filter((e) => e.name === 'Coin' && e.alive).length).toBe(1);
      // And it still comes back there after dying (kept: the checkpoint; not kept: the start).
      walkTo(g, g.player().x + 40);
      g.rt.respawn(g.player(), 'died');
      expect(Math.round(g.player().x), `keep ${keepOnRestart}`).toBe(keepOnRestart ? 160 : 0);
      // Started again twice: the same.
      g.rt.restart();
      g.run(0.2);
      expect(Math.round(g.player().x), `keep ${keepOnRestart}`).toBe(keepOnRestart ? 160 : 0);
    }
  });

  it('dying restarts the level (a script) with keepOnRestart: the room is as new, the player at the checkpoint', () => {
    const p = produce(sideLevel({ keepOnRestart: true }), (d) => {
      setScript(d, { target: 'definition', id: d.definitions.find((x) => x.name === 'Player')!.id }, { name: 'Again', description: '', vars: [], handlers: [{ when: { on: 'event', event: 'respawned', with: null }, if: null, do: [{ do: 'restart_level' }] }] });
    });
    const g = play(p);
    g.run(0.2);
    walkTo(g, 170);
    walkTo(g, -200);
    g.run(3);
    expect(Math.round(g.player().x)).toBe(160);
    expect(g.rt.entities.filter((e) => e.name === 'Coin' && e.alive).length).toBe(1);
    expect(g.rt.scripts.errors).toEqual([]);
  });
});

describe('F6c checkpoints: the same seen from above (no platformer assumption)', () => {
  /** A top-down level: the player, a save stone to the right, nothing else. */
  const topDown = (stored: boolean) =>
    produce(stored ? projectFromPreset('topdown', registry) : createProject(registry, 'Above', 'topdown'), (d) => {
      addFlag(d, 'Save stone', { heal: true });
      const scene = d.scenes[0];
      scene.entities = [];
      const player = d.definitions.find((x) => x.components.CharacterController)!;
      m.addEntity(d, scene.id, instantiateDefinition(player, { x: 48, y: 48 }));
      m.addEntity(d, scene.id, instantiateDefinition(d.definitions.find((x) => x.name === 'Save stone')!, { x: 176, y: 52 }));
    });

  it('a save stone touched while walking: the player comes back on it (its middle: nothing falls here), healed; a stored profile or a worked-out one', () => {
    for (const stored of [true, false]) {
      const p = topDown(stored);
      expect(checkGame(p, registry).state, `stored ${stored}`).toBe('ok');
      const g = play(p);
      g.run(0.2);
      expect(g.rt.floats(g.player())).toBe(true);
      if (g.player().health) g.player().health!.current = 1;
      walkTo(g, 170);
      expect(g.events('checkpoint_reached').length, `stored ${stored}`).toBe(1);
      if (g.player().health) expect(g.player().health!.current).toBe(g.player().health!.max);
      g.run(0.5, ['down']);
      g.run(0.5, ['right']);
      g.rt.respawn(g.player(), 'died');
      expect([Math.round(g.player().x), Math.round(g.player().y)], `stored ${stored}`).toEqual([176, 52]);
      expect(g.rt.scripts.errors).toEqual([]);
    }
  });
});

describe('F6c checkpoints: set by a script (any game makes its own)', () => {
  const withScript = (statement: Record<string, unknown>) =>
    produce(sideLevel(), (d) => {
      const enemy = d.definitions.find((x) => x.name === 'Enemy')!;
      delete enemy.components.Patrol;
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(enemy, { x: -96, y: 16 }));
      const marker = createDefinition('Marker', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', { size: { x: 28, y: 28 }, isTrigger: true }) });
      m.addDefinition(d, marker, registry);
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(marker, { x: 96, y: 16 }));
      setScript(d, { target: 'definition', id: marker.id }, { name: 'Marks', description: '', vars: [], handlers: [{ when: { on: 'contact' }, if: "has_tag(other, 'player')", do: [statement as never] }] });
    });

  it('set_checkpoint: where the target is now, or at a place; for anything, not only the player; the event says so', () => {
    // Here: the marker, touched, marks where the player is.
    const here = play(withScript({ do: 'set_checkpoint', target: 'other', x: null, y: null, keep: false }));
    here.run(0.2);
    walkTo(here, 90);
    // (Its handler runs while they touch: every step the place moves with the player, each a new place.)
    expect(here.events('checkpoint_reached').length).toBeGreaterThan(0);
    expect(new Set(here.events('checkpoint_reached').map((e) => `${e.subject}>${e.other}`))).toEqual(new Set(['Player>null']));
    // Back off the marker: the last place it marked stays.
    walkTo(here, 30);
    const at = { x: here.player().spawn.x, y: here.player().spawn.y };
    expect(at.x).toBeGreaterThan(40);
    expect(at.x).toBeLessThan(100);
    here.rt.respawn(here.player(), 'died');
    expect([here.player().x, here.player().y]).toEqual([at.x, at.y]);
    // At a place, for the enemy.
    const there = play(withScript({ do: 'set_checkpoint', target: "nearest('enemy')", x: '-32', y: '16', keep: false }));
    there.run(0.2);
    walkTo(there, 90);
    const enemy = there.rt.entities.find((e) => e.name === 'Enemy')!;
    expect(there.rt.scripts.errors).toEqual([]);
    // (The same place set again and again while they touch: said once.)
    expect(there.events('checkpoint_reached').map((e) => e.subject)).toEqual(['Enemy']);
    there.rt.respawn(enemy, 'script');
    expect([enemy.x, enemy.y]).toEqual([-32, 16]);
  });

  it('keep true: a level started again starts the target there', () => {
    const g = play(withScript({ do: 'set_checkpoint', target: 'other', x: '128', y: '16', keep: true }));
    g.run(0.2);
    walkTo(g, 90);
    g.rt.restart();
    g.run(0.2);
    expect(Math.round(g.player().x)).toBe(128);
  });
});

describe('F6c checkpoints and progression: other levels know nothing of them', () => {
  /** Two side-view levels (the first with two flags and a goal at its right end; the second with one flag, and a door at its left that restarts the game, or does what the test says). */
  const twoLevels = (does: Record<string, unknown> = { do: 'restart_game' }) =>
    produce(sideLevel({ keepOnRestart: true }), (d) => {
      const def = (name: string) => d.definitions.find((x) => x.name === name)!;
      const door = createDefinition('Reset door', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', { size: { x: 28, y: 28 }, isTrigger: true }) });
      m.addDefinition(d, door, registry);
      setScript(d, { target: 'definition', id: door.id }, { name: 'Again', description: '', vars: [], handlers: [{ when: { on: 'contact' }, if: "has_tag(other, 'player')", do: [does as never] }] });
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(def('Goal'), { x: 304, y: 16 }));
      const two = createLevelFor(d, 'Two');
      m.addScene(d, two);
      const place = (name: string, x: number, y: number) => m.addEntity(d, two.id, instantiateDefinition(def(name), { x, y }));
      for (let x = -144; x <= 304; x += 32) place('Platform', x, 48);
      place('Player', 0, 16);
      place('Flag', 96, 16);
      place('Reset door', -128, 16);
    });

  function session(p: Project) {
    const s = new GameSession(p, p.scenes[0].id, registry);
    const input = new InputState();
    const run = (seconds: number, hold: Action[] = []) => {
      for (const a of hold) input.press(a);
      for (let i = 0; i < Math.round(seconds / DT); i++) s.step(DT, input);
      for (const a of hold) input.release(a);
    };
    const player = () => s.runtime.entities.find((e) => e.controller)!;
    const walk = (x: number) => {
      const from = s.runtime;
      const dir = player().x < x ? 'right' : 'left';
      for (let i = 0; i < 600 && s.runtime === from && (dir === 'right' ? player().x < x : player().x > x); i++) run(DT, [dir]);
    };
    return { s, run, player, walk };
  }

  it('the next level starts at its own start, with its own checkpoints; the game begun again starts at the first level\'s start', () => {
    const g = session(twoLevels());
    g.run(0.2);
    g.walk(262);
    expect(g.player().checkpoint).not.toBeNull();
    // On to the goal: the next level, from its start.
    g.walk(400);
    g.run(WON_PAUSE + 0.2);
    expect(g.s.scene.name).toBe('Two');
    expect(Math.round(g.player().x)).toBe(0);
    expect(g.player().checkpoint).toBeNull();
    g.s.runtime.respawn(g.player(), 'died');
    expect(Math.round(g.player().x)).toBe(0);
    // Its own checkpoint, then R: kept, in this level.
    g.walk(100);
    g.s.restart();
    g.run(0.2);
    expect(Math.round(g.player().x)).toBe(96);
    // The game begun again (the door at the left): the first level, its very start, although its flags keep on restart.
    g.walk(-200);
    g.run(0.2);
    expect(g.s.scene.name).toBe('Level 1');
    expect(Math.round(g.player().x)).toBeLessThan(40);
    expect(g.player().checkpoint).toBeNull();
    g.s.restart();
    g.run(0.2);
    expect(Math.round(g.player().x)).toBe(0);
  });

  it('a level left for a visit keeps its checkpoint for the way back', () => {
    // A door in the first level leads to a visit of Two; Two's door leads back.
    const p = produce(twoLevels({ do: 'return_level', result: "'done'" }), (d) => {
      const door = createDefinition('Visit door', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', { size: { x: 28, y: 28 }, isTrigger: true }) });
      m.addDefinition(d, door, registry);
      setScript(d, { target: 'definition', id: door.id }, { name: 'Visit', description: '', vars: [], handlers: [{ when: { on: 'contact' }, if: "has_tag(other, 'player')", do: [{ do: 'visit_level', level: 'Two' }] }] });
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(door, { x: 208, y: 16 }));
    });
    const g = session(p);
    g.run(0.2);
    g.walk(170);
    const map = g.s.runtime;
    expect(g.player().checkpoint).not.toBeNull();
    g.walk(215);
    g.run(0.2);
    expect(g.s.scene.name).toBe('Two');
    // (Until the game is back: the door there would lead to another visit at once.)
    g.walk(-200);
    expect(g.s.runtime).toBe(map);
    expect(map.scripts.errors).toEqual([]);
    map.respawn(g.player(), 'died');
    expect(Math.round(g.player().x)).toBe(160);
  });

  it('a level built anew when it starts again (the roguelike\'s floors) keeps no checkpoint: the places are other ones', () => {
    const p = produce(projectFromPreset('roguelike', registry), (d) => void m.setGenerator(d, d.scenes[0].id, { seed: 3 }));
    const g = play(p);
    g.run(0.3);
    const hero = g.player();
    const start = { x: hero.x, y: hero.y };
    g.rt.setCheckpoint(hero, { x: start.x + 32, y: start.y }, null, true);
    g.rt.game.set('floor', 2);
    g.rt.restart();
    g.run(0.3);
    const again = g.player();
    expect(again.checkpoint).toBeNull();
    expect([again.spawn.x, again.spawn.y]).toEqual([again.x, again.y]);
  });
});

describe('F6c checkpoints: by hand and by prompt', () => {
  it('the component is an ordinary one (the inspector lists it; add_component adds it), and its guidance comes with requests about checkpoints', () => {
    expect(registry.get('Checkpoint')?.category).toBe('Gameplay');
    const p = createProject(registry);
    const coin = p.definitions.find((d) => d.name === 'Coin')!;
    const done = produce(p, (d) => void applyOperations(d, [{ op: 'add_component', target: 'definition', id: coin.id, component: 'Checkpoint', propsJson: '{"heal":true}' } as never], registry));
    expect(done.definitions.find((d) => d.name === 'Coin')!.components.Checkpoint).toEqual({ heal: true, keepOnRestart: false });
    const level = { kind: 'level' as const, sceneId: p.scenes[0].id, point: null };
    expect(topicsFor(level, 'add a checkpoint halfway')).toContain('checkpoints');
    expect(topicsFor(level, 'a save point before the boss')).toContain('checkpoints');
    expect(topicsFor(level, 'make the player run faster')).not.toContain('checkpoints');
  });
});
