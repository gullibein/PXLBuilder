import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { generateDungeon, nextLevel } from '../core/model/dungeon';
import { createDefinition, createProject, createScene, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { createRoguelikeProject } from '../core/model/roguelikeStarter';
import { checkScript } from '../core/script/language';
import type { Project } from '../core/types';
import { Fog } from './fog';
import { InputState } from './input';
import { Runtime, type RuntimeEntity } from './runtime';

const registry = createBuiltinRegistry();
const input = new InputState();
const step = (rt: Runtime, seconds: number) => {
  for (let i = 0; i < Math.max(1, Math.round(seconds * 120)); i++) rt.update(1 / 120, input);
};

/** The Roguelike starter (a fixed dungeon) with one more script on the hero. */
function withHeroScript(handlers: unknown[], vars: unknown[] = []): { project: Project; rt: Runtime; hero: RuntimeEntity } {
  const project = produce(createRoguelikeProject(registry), (d) => {
    m.setGenerator(d, d.scenes[0].id, { seed: 3 });
    const hero = d.definitions.find((x) => x.name === 'Player')!;
    const checked = checkScript({ id: 'scr_test', name: 'Test', vars, states: [], handlers }, d);
    if ('error' in checked) throw new Error(checked.error);
    hero.scripts = [...(hero.scripts ?? []), checked.script];
    // (The definition's placed copy too.)
    for (const e of d.scenes[0].entities) if (e.definitionId === hero.id) e.scripts = undefined;
  });
  const rt = new Runtime(project, project.scenes[0].id, registry);
  step(rt, 0.05);
  return { project, rt, hero: rt.entities.find((e) => e.controller)! };
}

describe('the random level from scripts', () => {
  it('caves and mazes: every thing placed can be walked to from the start', () => {
    let project = createProject(registry, 'D', 'topdown');
    project = produce(project, (d) => {
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 40, y: 40 }));
      m.setGenerator(d, d.scenes[0].id, { stairs: 'Teleporter', monsterCount: 6, lootCount: 4 });
    });
    for (const style of ['caves', 'maze'] as const) {
      const p = produce(project, (d) => {
        m.setGenerator(d, d.scenes[0].id, { style });
      });
      const scene = p.scenes[0];
      for (const seed of [2, 11, 300, 4321]) {
        const d = generateDungeon(p, scene, registry, seed);
        expect(d.problems).toEqual([]);
        expect(d.roomList).toEqual([]);
        const wall = scene.generator!.wall;
        const at = (x: number) => Math.floor(x / 32);
        const walls = new Set(d.entities.filter((e) => e.definitionId === wall).map((e) => `${at(e.transform.position.x)},${at(e.transform.position.y)}`));
        const start = `${at(d.start!.x)},${at(d.start!.y)}`;
        const seen = new Set([start]);
        const todo = [start];
        while (todo.length) {
          const [i, j] = todo.pop()!.split(',').map(Number);
          for (const [di, dj] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ]) {
            const k = `${i + di},${j + dj}`;
            if (i + di < 0 || j + dj < 0 || i + di >= scene.generator!.width || j + dj >= scene.generator!.height || walls.has(k) || seen.has(k)) continue;
            seen.add(k);
            todo.push(k);
          }
        }
        const placed = d.entities.filter((x) => x.definitionId !== wall && x.definitionId !== scene.generator!.floor);
        expect(placed.length).toBeGreaterThan(5);
        for (const e of placed) expect(seen.has(`${at(e.transform.position.x)},${at(e.transform.position.y)}`)).toBe(true);
        expect(d.stairs).not.toBeNull();
      }
    }
  });

  it('level_built comes after each build; the rooms can be read', () => {
    const { rt } = withHeroScript([
      {
        when: { on: 'signal', name: 'level_built' },
        if: null,
        do: [
          { do: 'set_game', var: 'rooms', value: 'room_count()' },
          { do: 'set_game', var: 'first_x', value: 'room_x(1)' },
          { do: 'set_game', var: 'seed', value: 'dungeon_seed' },
        ],
      },
    ]);
    expect(rt.scripts.errors).toEqual([]);
    expect(rt.game.get('rooms')).toBe(rt.dungeon!.roomList.length);
    expect(rt.game.get('rooms')).toBeGreaterThan(2);
    expect(rt.game.get('first_x')).toBe(rt.dungeon!.roomList[0].x);
    expect(rt.game.get('seed')).toBe(3);
  });

  it('set_generator in play changes the next build (restart_level), not the level in the editor', () => {
    const { project, rt } = withHeroScript([
      {
        when: { on: 'key', key: 'interact', edge: 'pressed' },
        if: null,
        do: [{ do: 'set_generator', values: { style: "'caves'", monsterCount: '1 + 1', wall: "'Wall'" } }, { do: 'restart_level' }],
      },
    ]);
    expect(rt.dungeon!.roomList.length).toBeGreaterThan(0);
    input.press('interact');
    step(rt, 1 / 60);
    input.release('interact');
    step(rt, 0.05);
    expect(rt.scripts.errors).toEqual([]);
    expect(rt.dungeon!.roomList).toEqual([]);
    expect(rt.entities.filter((e) => e.alive && e.tags.includes('monster')).length).toBe(2);
    expect(project.scenes[0].generator!.style ?? 'rooms').toBe('rooms');
  });

  it('a recipe change that does not fit is said, and changes nothing', () => {
    const { rt } = withHeroScript([{ when: { on: 'start' }, if: null, do: [{ do: 'set_generator', values: { wall: "'Nothing like it'" } }] }]);
    expect(rt.scripts.errors.some((x) => /set_generator/.test(x.message))).toBe(true);
    expect(rt.generatorPatch).toEqual({});
  });
});

describe('the fog from scripts', () => {
  it('fog_radius changes the sight; reveal marks the level explored', () => {
    const { rt } = withHeroScript([
      { when: { on: 'start' }, if: null, do: [{ do: 'fog_radius', value: '2' }] },
      { when: { on: 'key', key: 'interact', edge: 'pressed' }, if: null, do: [{ do: 'reveal', x: null, y: null, radius: '0' }, { do: 'set_game', var: 'far', value: 'explored_square(self.x + 320, self.y)' }] },
    ]);
    step(rt, 0.05);
    expect(rt.fog!.radius).toBe(2);
    expect(rt.fog!.visible.size).toBeLessThan(14);
    input.press('interact');
    step(rt, 1 / 60);
    input.release('interact');
    expect(rt.game.get('far')).toBe(true);
  });

  it('a Light lets the viewer see squares round it from beyond its own sight', () => {
    const viewer = { x: 16, y: 16, alive: true } as RuntimeEntity;
    const far = { x: 32 * 12 + 16, y: 16 } as RuntimeEntity;
    const fog = new Fog(viewer, [viewer, far], { radius: 3 });
    fog.update(new Set());
    expect(fog.sees(32 * 11 + 16, 16)).toBe(false);
    fog.update(new Set(), false, [{ x: far.x, y: far.y, r: 2 }]);
    expect(fog.sees(32 * 11 + 16, 16)).toBe(true);
    // A wall between the viewer and the lit squares: not seen.
    fog.update(new Set(['6,0']), true, [{ x: far.x, y: far.y, r: 2 }]);
    expect(fog.sees(32 * 11 + 16, 16)).toBe(false);
  });
});

describe('the turn kit from scripts', () => {
  function walker(rules: Record<string, string>) {
    let project = createProject(registry, 'Walk', 'topdown');
    project = produce(project, (d) => {
      const def = createDefinition('Ghost', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }) }, ['ghost']);
      const checked = checkScript(
        {
          id: 'scr_w',
          name: 'W',
          vars: [{ name: 'sx', value: 0 }, { name: 'sy', value: 0 }],
          states: [],
          handlers: [
            { when: { on: 'start' }, if: null, do: [{ do: 'walk_rules', diagonal: rules.diagonal ?? 'false', through_units: 'false', through_walls: rules.walls ?? 'false', on: null }, { do: 'turn_order', value: '5', on: null }] },
            { when: { on: 'tick' }, if: null, do: [{ do: 'set', var: 'sx', value: 'next_step_x(self.x + 96, self.y + 96)' }, { do: 'set', var: 'sy', value: 'next_step_y(self.x + 96, self.y + 96)' }] },
          ],
        },
        d,
      );
      if ('error' in checked) throw new Error(checked.error);
      def.scripts = [checked.script];
      m.addDefinition(d, def, registry);
      d.scenes[0].entities = [];
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Ghost')!, { x: 16, y: 16 }));
    });
    const rt = new Runtime(project, project.scenes[0].id, registry);
    step(rt, 0.05);
    const g = rt.entities.find((e) => e.tags.includes('ghost'))!;
    return { rt, g, at: () => [g.scripts[0].vars.get('sx'), g.scripts[0].vars.get('sy')] };
  }

  it('walk_rules diagonal: the first step goes across; without it, along', () => {
    const d = walker({ diagonal: 'true' });
    expect(d.rt.scripts.errors).toEqual([]);
    expect(d.at()).toEqual([48, 48]);
    expect(d.rt.kit.priority.get(d.g)).toBe(5);
    const s = walker({});
    const [x, y] = s.at() as number[];
    expect(Math.abs(x - 16) + Math.abs(y - 16)).toBe(32);
  });
});

describe('locked doors and keys in random levels', () => {
  it('the door shuts off the stairs; the key can be reached without it; the door needs the key', () => {
    const project = createRoguelikeProject(registry);
    const scene = project.scenes[0];
    const g = scene.generator!;
    expect(scene.relationships.some((r) => r.type === 'requires' && (r.source as { id: string }).id === g.door && (r.target as { id: string }).id === g.key)).toBe(true);
    let locked = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
      const d = generateDungeon(project, scene, registry, seed);
      if (!d.locked) continue;
      locked++;
      const at = (x: number) => Math.floor(x / 32);
      const blocked = new Set(d.entities.filter((e) => e.definitionId === g.wall || e.definitionId === g.door).map((e) => `${at(e.transform.position.x)},${at(e.transform.position.y)}`));
      const start = `${at(d.start!.x)},${at(d.start!.y)}`;
      const seen = new Set([start]);
      const todo = [start];
      while (todo.length) {
        const [i, j] = todo.pop()!.split(',').map(Number);
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const k = `${i + di},${j + dj}`;
          if (i + di < 0 || j + dj < 0 || i + di >= g.width || j + dj >= g.height || blocked.has(k) || seen.has(k)) continue;
          seen.add(k);
          todo.push(k);
        }
      }
      expect(seen.has(`${at(d.locked.key.x)},${at(d.locked.key.y)}`)).toBe(true);
      expect(seen.has(`${at(d.stairs!.x)},${at(d.stairs!.y)}`)).toBe(false);
    }
    expect(locked).toBeGreaterThan(8);
  });

  it('the roguelike hero opens a shut door it steps into with the key (used up); without one it stays shut', () => {
    for (const withKey of [false, true]) {
      const project = produce(createRoguelikeProject(registry), (d) => {
        m.setGenerator(d, d.scenes[0].id, { seed: 2 });
      });
      const rt = new Runtime(project, project.scenes[0].id, registry);
      step(rt, 0.05);
      const door = rt.entities.find((e) => e.tags.includes('door'))!;
      const hero = rt.entities.find((e) => e.controller)!;
      // Beside the door, on an open square.
      const free = (x: number, y: number) => !rt.entities.some((e) => e.alive && e !== hero && e.collider && !e.collider.trigger && Math.abs(e.x - x) < 16 && Math.abs(e.y - y) < 16);
      const [dx, dy, key] = ([[32, 0, 'left'], [-32, 0, 'right'], [0, 32, 'up'], [0, -32, 'down']] as const).find(([dx, dy]) => free(door.x + dx, door.y + dy))!;
      hero.x = door.x + dx;
      hero.y = door.y + dy;
      for (const e of rt.entities) if (e.tags.includes('monster')) e.alive = false;
      if (withKey) rt.gameplay.addItem(hero, 'key', 1);
      input.press(key);
      step(rt, 1 / 60);
      input.release(key);
      step(rt, 0.3);
      expect(rt.scripts.errors).toEqual([]);
      expect(door.open).toBe(withKey);
      expect(hero.inventory?.get('key') ?? 0).toBe(0);
    }
  });

  it('the Debug tab gets the seed each dungeon was built from', async () => {
    const { PlayRecorder } = await import('./recorder');
    const project = produce(createRoguelikeProject(registry), (d) => {
      m.setGenerator(d, d.scenes[0].id, { seed: 77 });
    });
    const rt = new Runtime(project, project.scenes[0].id, registry);
    const rec = new PlayRecorder(rt);
    step(rt, 0.1);
    rt.restart();
    step(rt, 0.1);
    rec.sample();
    expect(rec.report().dungeons!.map((d) => d.seed)).toEqual([77, 77]);
  });
});

describe('room templates', () => {
  it('rooms that fit get the template (its things where they were in it); the dungeon stays joined; the template level is not played', () => {
    const project = produce(createRoguelikeProject(registry), (d) => {
      const vault = createScene('Vault');
      m.addScene(d, vault);
      const put = (name: string, x: number, y: number) => m.addEntity(d, vault.id, instantiateDefinition(d.definitions.find((x) => x.name === name)!, { x: x * 32 + 16, y: y * 32 + 16 }));
      // Four pillars round a heap of gold, 3 × 3.
      put('Wall', 0, 0);
      put('Wall', 2, 0);
      put('Wall', 0, 2);
      put('Wall', 2, 2);
      put('Gold', 1, 1);
      m.setGenerator(d, d.scenes[0].id, { templates: ['Vault'], templateChance: 1, lootCount: 0, door: null });
    });
    const scene = project.scenes[0];
    const gold = project.definitions.find((x) => x.name === 'Gold')!.id;
    const wall = scene.generator!.wall;
    for (const seed of [1, 5, 9, 13]) {
      const d = generateDungeon(project, scene, registry, seed);
      expect(d.problems).toEqual([]);
      const golds = d.entities.filter((e) => e.definitionId === gold);
      expect(golds.length).toBeGreaterThan(2);
      const at = (x: number) => Math.floor(x / 32);
      const walls = new Set(d.entities.filter((e) => e.definitionId === wall).map((e) => `${at(e.transform.position.x)},${at(e.transform.position.y)}`));
      // Each heap has its four pillars round it.
      for (const g of golds) for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) expect(walls.has(`${at(g.transform.position.x) + dx},${at(g.transform.position.y) + dy}`)).toBe(true);
      const start = `${at(d.start!.x)},${at(d.start!.y)}`;
      const seen = new Set([start]);
      const todo = [start];
      while (todo.length) {
        const [i, j] = todo.pop()!.split(',').map(Number);
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const k = `${i + di},${j + dj}`;
          if (i + di < 0 || j + dj < 0 || i + di >= 40 || j + dj >= 30 || walls.has(k) || seen.has(k)) continue;
          seen.add(k);
          todo.push(k);
        }
      }
      for (const e of d.entities.filter((x) => x.definitionId !== wall && x.definitionId !== scene.generator!.floor)) expect(seen.has(`${at(e.transform.position.x)},${at(e.transform.position.y)}`)).toBe(true);
    }
    expect(nextLevel(project, scene.id)).toBeUndefined();
  });
});
