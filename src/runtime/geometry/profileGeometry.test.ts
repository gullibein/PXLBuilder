/**
 * The geometry a game has (docs/engine-architecture-proposal.md §18.1): registered, selected, supported, active.
 * The runtime and the level checker use only the active geometry; whatever else a game's objects use works in its
 * module's lesser way, and the compatibility report says exactly that. And the rules for dug tiles filling in.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../../core/components/builtin';
import { activeGeometry, GEOMETRY, geometryStatus, profileTags } from '../../core/engine/geometry';
import { modules } from '../../core/engine/modules';
import { PRESETS } from '../../core/engine/presets';
import { changedProfile, checkGame, checkProfile, profileOf } from '../../core/engine/profile';
import type { GameProfile } from '../../core/engine/profileSchema';
import { createDefinition, createProject, instantiateDefinition } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { levelReachability } from '../../core/model/reachability';
import { setScript } from '../../core/script/mutations';
import { migrateProject } from '../../core/serialization/migrations';
import type { Project, Vec2 } from '../../core/types';
import { InputState } from '../input';
import { Runtime } from '../runtime';

const registry = createBuiltinRegistry();
const preset = (id: string) => PRESETS.find((p) => p.id === id)!.profile;

/** The registry's own answer: the tags every selected module really provides (engine/modules.ts). */
function registryTags(p: GameProfile): Set<string> {
  const ids: [Parameters<typeof modules.get>[0], string][] = [['view', p.view], ['time', p.time], ['locomotion', p.movement.model], ...p.movement.abilities.map((a) => ['ability', a] as ['ability', string]), ...p.geometry.map((g) => ['geometry', g] as ['geometry', string]), ...p.kits.map((k) => ['kit', k] as ['kit', string])];
  return new Set(ids.flatMap(([k, id]) => modules.get(k, id)?.provides ?? []));
}

/** Ground, a ramp up onto higher ground with the goal on it; the profile's geometry as given. */
function rampLevel(geometry: string[] | null): { project: Project; sceneId: string } {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    if (geometry) d.settings.profile = { ...profileOf(project, registry), geometry };
    d.definitions.find((x) => x.name === 'Player')!.components.CharacterController.jumpForce = 140;
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let x = -208; x <= 240; x += 32) place('Platform', { x, y: 48 });
    place('Ramp', { x: 16, y: 16 });
    for (let x = 48; x <= 240; x += 32) place('Platform', { x, y: 16 });
    place('Goal', { x: 208, y: -16 });
    place('Player', { x: -150, y: 16 });
  });
  return { project, sceneId };
}

const walk = (project: Project, sceneId: string, seconds: number) => {
  const rt = new Runtime(project, sceneId, registry);
  const input = new InputState();
  input.press('right');
  for (let i = 0; i < seconds * 60; i++) rt.update(1 / 60, input);
  return rt;
};

describe('geometry: registered, selected, supported, active', () => {
  it('every geometry is registered once, from one table; the light answer (for the runtime) is the registry\'s', () => {
    expect(modules.list('geometry').map((g) => g.id).sort()).toEqual(GEOMETRY.map((g) => g.id).sort());
    const variants: GameProfile[] = [
      ...PRESETS.map((p) => p.profile),
      changedProfile(preset('topdown'), { geometry: ['box', 'one_way', 'ramp', 'cells'] }),
      changedProfile(preset('platformer'), { geometry: ['box'] }),
      changedProfile(preset('platformer'), { abilities: ['dash'] }),
    ];
    for (const p of variants) expect(geometryStatus(p, profileTags(p)), p.preset ?? '').toEqual(geometryStatus(p, registryTags(p)));
  });

  it('a platformer has all four active; seen from above, ramps and jump-through platforms are selected but not supported', () => {
    expect(geometryStatus(preset('platformer'))).toMatchObject({ selected: ['box', 'one_way', 'ramp', 'cells'], active: ['box', 'one_way', 'ramp', 'cells'], unsupported: [], unknown: [] });
    const top = changedProfile(preset('topdown'), { geometry: ['box', 'one_way', 'ramp', 'cells', 'loops'] });
    const s = geometryStatus(top);
    expect(s.registered).toEqual(GEOMETRY.map((g) => g.id));
    expect(s.supported).toEqual(['box', 'cells']);
    expect(s.active).toEqual(s.supported);
    expect(s.unsupported.map((u) => u.id)).toEqual(['one_way', 'ramp']);
    expect(s.unsupported[1].why).toMatch(/block like walls/);
    expect(s.unknown).toEqual(['loops']);
    // (The profile check refuses the unknown one, and says what the unsupported ones do instead.)
    expect(checkProfile(top).state).toBe('incompatible');
    const known = changedProfile(top, { geometry: ['box', 'one_way', 'ramp', 'cells'] });
    expect(checkProfile(known)).toMatchObject({ state: 'degraded' });
  });

  it('a profile without boxes is refused: every game has walls and floors', () => {
    const p = changedProfile(preset('platformer'), { geometry: ['ramp'] });
    expect(checkProfile(p)).toMatchObject({ state: 'incompatible' });
  });
});

describe('the runtime, the level checker and the compatibility report agree', () => {
  it('ramps selected: walked up (in play), reachable (checker), nothing to report', () => {
    const { project, sceneId } = rampLevel(null);
    expect(activeGeometry(profileOf(project, registry)).has('ramp')).toBe(true);
    expect(walk(project, sceneId, 4).completed).not.toBeNull();
    const reach = levelReachability(project, sceneId, registry);
    expect(reach.status === 'ok' && reach.unreachable.things).toEqual([]);
    expect(checkGame(project, registry).state).toBe('ok');
  });

  it('ramps not selected: the ramp is a wall in play, the checker finds the goal out of reach, and the report says why', () => {
    const { project, sceneId } = rampLevel(['box', 'one_way', 'cells']);
    const rt = walk(project, sceneId, 4);
    expect(rt.completed).toBeNull();
    // (Stopped against the ramp's square, as against a wall.)
    const p = rt.entities.find((e) => e.controller)!;
    expect(p.x).toBeLessThan(16 - 16);
    expect(rt.entities.find((e) => e.name === 'Ramp')!.collider!.slope).toBeUndefined();
    const reach = levelReachability(project, sceneId, registry);
    expect(reach.status === 'ok' && reach.unreachable.things.map((t) => t.name)).toEqual(['Goal']);
    const check = checkGame(project, registry);
    expect(check.state).toBe('degraded');
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(/Ramp.*doesn't select geometry "ramp".*ramps block like walls/);
  });

  it('jump-through platforms not selected: one blocks like a wall from below too', () => {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.settings.profile = { ...profileOf(project, registry), geometry: ['box', 'ramp', 'cells'] };
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let x = -64; x <= 64; x += 32) place('Platform', { x, y: 48 });
      place('Bridge', { x: 0, y: -48 });
      place('Player', { x: 0, y: 16 });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    input.press('jump');
    let top = Infinity;
    for (let i = 0; i < 60; i++) {
      rt.update(1 / 60, input);
      top = Math.min(top, rt.entities.find((e) => e.controller)!.y);
    }
    // (Its head stops under the bridge's square instead of going up through it.)
    const bridge = rt.entities.find((e) => e.name === 'Bridge')!;
    expect(bridge.collider!.oneWay).toBeUndefined();
    expect(top).toBeGreaterThan(bridge.y + bridge.collider!.oy + bridge.collider!.hh);
    expect(checkGame(project, registry).state).toBe('degraded');
  });

  it('cells not selected: dig is refused with a script error (nothing dug), and the report names the object', () => {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.settings.profile = { ...profileOf(project, registry), geometry: ['box', 'one_way', 'ramp'] };
      d.definitions.find((x) => x.name === 'Platform')!.tags.push('diggable');
      const pl = d.definitions.find((x) => x.name === 'Player')!;
      setScript(d, { target: 'definition', id: pl.id }, { name: 'Digger', description: '', vars: [], handlers: [{ when: { on: 'start' }, if: null, do: [{ do: 'dig', x: 'self.x', y: 'self.y + 32', seconds: '3', tag: 'diggable' }] }] } as never);
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let x = 16; x <= 144; x += 32) place('Platform', { x, y: 80 });
      place('Player', { x: 48, y: 48 });
    });
    const rt = new Runtime(project, sceneId, registry);
    for (let i = 0; i < 5; i++) rt.update(1 / 60, new InputState());
    expect(rt.dugAt(48, 80)).toBe(false);
    expect(rt.scripts.errors.map((e) => e.message).join(' ')).toMatch(/need the "cells" geometry/);
    const check = checkGame(project, registry);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(/Player.*"cells".*nothing can be dug/);
  });

  it('a game saved before cells existed gets them (format 16), so nothing it does changes', () => {
    const old = { formatVersion: 15, name: 'Old', settings: { profile: { ...preset('platformer'), geometry: ['box', 'one_way', 'ramp'] } } };
    const now = migrateProject(structuredClone(old)) as { settings: { profile: GameProfile } };
    expect(now.settings.profile.geometry).toEqual(['box', 'one_way', 'ramp', 'cells']);
    // (No stored profile: nothing written; worked out from the objects, which have cells.)
    expect((migrateProject({ formatVersion: 15, name: 'x', settings: {} }) as { settings: object }).settings).toEqual({});
  });
});

describe('dug tiles fill in by a defined rule, the same for everyone', () => {
  /** A floor of diggable bricks at row 2 (y 64..96) over rock; the player at column 1; an enemy and a crate. */
  function pit(extra: ('enemy' | 'crate')[] = []) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.definitions.find((x) => x.name === 'Platform')!.tags.push('diggable');
      m.addDefinition(d, createDefinition('Rock', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', {}) }, ['platform']), registry);
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = 0; c < 10; c++) place('Platform', { x: c * 32 + 16, y: 80 });
      for (let c = 0; c < 10; c++) place('Rock', { x: c * 32 + 16, y: 112 });
      place('Player', { x: 48, y: 48 });
      if (extra.includes('enemy')) {
        place('Enemy', { x: 208, y: 48 });
        delete d.definitions.find((x) => x.name === 'Enemy')!.components.Patrol;
      }
      if (extra.includes('crate')) place('Crate', { x: 272, y: 48 });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    rt.update(1 / 60, input);
    return { rt, step: (n: number) => { for (let i = 0; i < n; i++) rt.update(1 / 60, input); } };
  }

  it('"trap" (the default): the player, an enemy and a crate caught in filling squares all go the same way', () => {
    const { rt, step } = pit(['enemy', 'crate']);
    for (const x of [48, 208, 272]) rt.dig(x, 80, 0.5, 'diggable');
    step(45);
    const died = rt.eventLog.filter((e) => e.type === 'died').map((e) => e.subject);
    expect(died).toEqual(expect.arrayContaining(['Player', 'Enemy', 'Crate']));
    expect(rt.entities.find((e) => e.name === 'Enemy')!.alive).toBe(false);
    expect(rt.entities.find((e) => e.name === 'Crate')!.alive).toBe(false);
  });

  it('"wait": a square with something in it fills in only once it is empty; no one dies', () => {
    const { rt, step } = pit();
    rt.dig(48, 80, 0.5, 'diggable', 'wait');
    step(60);
    // (The player fell into the hole and stays there: the hole stays open past its time.)
    expect(rt.dugAt(48, 80)).toBe(true);
    const p = rt.entities.find((e) => e.controller)!;
    expect(Math.floor(p.y / 32)).toBe(2);
    // Out of it (moved away, as a jump would): it fills in.
    p.x = 176;
    p.y = 48;
    step(2);
    expect(rt.dugAt(48, 80)).toBe(false);
    expect(rt.eventLog.some((e) => e.type === 'died')).toBe(false);
  });

  it('only its own time (or the level again) brings a dug tile back: a respawn aimed at it is refused', () => {
    const { rt, step } = pit();
    rt.dig(144, 80, 5, 'diggable');
    step(2);
    const tile = rt.entities.find((e) => !e.alive && e.name === 'Platform')!;
    rt.respawn(tile, 'script');
    expect(tile.alive).toBe(false);
    expect(rt.dugAt(144, 80)).toBe(true);
    // (A switch's hiding and showing never touches it either: it isn't hidden by a switch.)
    rt.gameplay.setHidden(tile, false);
    expect(tile.alive).toBe(false);
  });
});
