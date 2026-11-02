import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { ENGINE_PART_INFO } from '../core/model/engineParts';
import { createDefinition, createProject, createScene, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { checkScript, type BehaviorScript } from '../core/script/language';
import type { Project, Vec2 } from '../core/types';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

function script(d: Project, raw: Record<string, unknown>): BehaviorScript {
  const checked = checkScript({ id: `scr_${Math.random().toString(36).slice(2)}`, name: 'Test', vars: [], states: [], ...raw }, d);
  if ('error' in checked) throw new Error(checked.error);
  return checked.script;
}

/** A floor from -320 to 320 at y=48 (a platformer); `edit` adds things. */
function game(edit: (d: Project, place: (name: string, at: Vec2) => void) => void): Runtime {
  let project = createProject(registry, 'Test', 'platformer');
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const place = (name: string, at: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, at));
    for (let x = -320; x <= 320; x += 32) place('Platform', { x, y: 48 });
    edit(d, place);
  });
  return new Runtime(project, sceneId, registry);
}

function run(rt: Runtime, steps: number, keys: Record<number, Action[]> = {}) {
  const input = new InputState();
  let held: Action[] = [];
  for (let i = 0; i < steps; i++) {
    if (keys[i]) {
      for (const k of held) if (!keys[i].includes(k)) input.release(k);
      for (const k of keys[i]) if (!held.includes(k)) input.press(k);
      held = keys[i];
    }
    rt.update(1 / 120, input);
  }
}

describe('falling off the level, done by a script instead', () => {
  const fall = (own: ((d: Project) => BehaviorScript) | null) =>
    game((d, place) => {
      place('Player', { x: 600, y: -40 });
      const p = d.definitions.find((x) => x.name === 'Player')!;
      if (own) p.scripts = [...(p.scripts ?? []), own(d)];
    });

  it('the ready-made script puts it back at its start, as the engine does', () => {
    for (const rt of [fall(null), fall(() => ENGINE_PART_INFO.falling_off.script())]) {
      run(rt, 400);
      expect(rt.scripts.errors).toEqual([]);
      expect(rt.eventLog.filter((e) => e.type === 'respawned').length).toBeGreaterThan(0);
    }
  });

  it('changed, it does what the script says: here it hears "fell_off" once and is not put back', () => {
    const rt = fall((d) => script(d, { takesOver: 'falling_off', handlers: [{ when: { on: 'event', event: 'fell_off', with: null }, do: [{ do: 'set_game', var: 'falls', value: "game_value('falls', 0) + 1" }] }] }));
    run(rt, 600);
    expect(rt.scripts.errors).toEqual([]);
    expect(rt.game.get('falls')).toBe(1);
    expect(rt.eventLog.filter((e) => e.type === 'respawned').length).toBe(0);
    expect(rt.find('Player')!.y).toBeGreaterThan(rt.fallLimit);
  });
});

describe('a shot hitting, done by a script instead', () => {
  /** The player fires Bolts right (X) at two dummies in a row. */
  const range = (own: ((d: Project) => BehaviorScript) | null) =>
    game((d, place) => {
      const bolt = createDefinition('Bolt', { Sprite: registry.createDefault('Sprite', { width: 8, height: 8 }), Collider: registry.createDefault('Collider', { size: { x: 8, y: 8 }, isTrigger: true }) }, []);
      if (own) bolt.scripts = [own(d)];
      m.addDefinition(d, bolt, registry);
      const dummy = createDefinition('Dummy', { Sprite: registry.createDefault('Sprite', { width: 24, height: 24 }), Collider: registry.createDefault('Collider', { size: { x: 24, y: 24 } }), PhysicsBody: registry.createDefault('PhysicsBody', { bodyType: 'dynamic' }), Health: registry.createDefault('Health', { maxHealth: 5, currentHealth: 5 }) }, ['target']);
      m.addDefinition(d, dummy, registry);
      const p = d.definitions.find((x) => x.name === 'Player')!;
      p.components.Shooter = registry.createDefault('Shooter', { trigger: 'key', interval: 5, speed: 400, damage: 2, range: 500, projectile: 'Bolt' });
      place('Player', { x: 0, y: 16 });
      place('Dummy', { x: 120, y: 20 });
      place('Dummy', { x: 200, y: 20 });
    });
  const hp = (rt: Runtime) => rt.entities.filter((e) => e.name === 'Dummy').map((e) => e.health!.current);

  it('the ready-made script hurts the first one by the shot\'s damage and the shot is gone, as the engine does', () => {
    for (const rt of [range(null), range(() => ENGINE_PART_INFO.shot_hitting.script())]) {
      run(rt, 200, { 5: ['fire'], 8: [] });
      expect(rt.scripts.errors).toEqual([]);
      expect(hp(rt)).toEqual([3, 5]);
      expect(rt.entities.some((e) => e.projectile && e.alive)).toBe(false);
    }
  });

  it('changed, it does what the script says: here the shot goes through, hurting both', () => {
    const rt = range((d) => script(d, { takesOver: 'shot_hitting', handlers: [{ when: { on: 'event', event: 'shot_hit', with: null }, if: 'other != null', do: [{ do: 'damage', target: 'other', amount: 'self.shot_damage' }] }] }));
    run(rt, 200, { 5: ['fire'], 8: [] });
    expect(rt.scripts.errors).toEqual([]);
    expect(hp(rt)).toEqual([3, 3]);
  });
});

describe('the end of a level, done by scripts', () => {
  it('with the built-in level end hidden, the game goes on after complete_level, and go_to_level goes on to the level named', () => {
    let project = createProject(registry, 'Two', 'platformer');
    project = produce(project, (d) => {
      m.addScene(d, { ...createScene('Secret') });
      d.scenes[0].entities = [];
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 0, y: 16 }));
      for (let x = -96; x <= 96; x += 32) m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Platform')!, { x, y: 48 }));
      const p = d.definitions.find((x) => x.name === 'Player')!;
      p.scripts = [
        ...(p.scripts ?? []),
        script(d, {
          vars: [{ name: 'after', value: 0 }],
          handlers: [
            { when: { on: 'start' }, do: [{ do: 'builtin_display', what: 'level_end', show: false }] },
            { when: { on: 'key', key: 'interact', edge: 'pressed' }, do: [{ do: 'complete_level', by: null }] },
            { when: { on: 'tick' }, if: 'after >= 0', do: [{ do: 'set', var: 'after', value: 'after + 1' }] },
            { when: { on: 'event', event: 'level_completed', with: null }, do: [{ do: 'set_game', var: 'next', value: 'next_level' }, { do: 'go_to_level', level: '{next_level}' }] },
          ],
        }),
      ];
    });
    const rt = new Runtime(project, project.scenes[0].id, registry);
    run(rt, 20, { 5: ['interact'], 7: [] });
    expect(rt.scripts.errors).toEqual([]);
    expect(rt.completed).not.toBeNull();
    expect(rt.game.get('next')).toBe('Secret');
    expect(rt.goRequest?.level).toBe('Secret');
    const ticks = rt.find('Player')!.scripts.at(-1)!.vars.get('after') as number;
    run(rt, 10);
    expect(rt.find('Player')!.scripts.at(-1)!.vars.get('after')).toBe(ticks + 10);
  });
});
