import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations, checkOperations, type Operation } from '../commands/operations';
import { Runtime } from '../../runtime/runtime';
import { createProject, instantiateDefinition } from './factory';
import { generateDungeon } from './dungeon';
import * as m from './mutations';

const registry = createBuiltinRegistry();

/** A top-down game whose first level is random: the player placed by hand, slimes, coins and a goal as the way down. */
function randomGame(patch: Record<string, unknown> = {}) {
  let project = createProject(registry, 'Dungeon', 'topdown');
  project = produce(project, (d) => {
    const scene = d.scenes[0];
    m.addEntity(d, scene.id, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 400, y: 400 }));
    m.setGenerator(d, scene.id, { stairs: 'Teleporter', ...patch });
  });
  return project;
}

describe('random levels', () => {
  it('the same seed gives the same dungeon; another seed another', () => {
    const project = randomGame();
    const scene = project.scenes[0];
    const a = generateDungeon(project, scene, registry, 42);
    const b = generateDungeon(project, scene, registry, 42);
    const c = generateDungeon(project, scene, registry, 43);
    const where = (d: typeof a) => d.entities.map((e) => `${e.definitionId}@${e.transform.position.x},${e.transform.position.y}`).join('|');
    expect(where(a)).toBe(where(b));
    expect(where(a)).not.toBe(where(c));
    expect(a.rooms).toBe(8);
    expect(a.problems).toEqual([]);
  });

  it('every open square can be walked to from the start, and the way down is in another room', () => {
    const project = randomGame({ loops: 0.5 });
    const scene = project.scenes[0];
    for (const seed of [1, 7, 99, 1234, 55555]) {
      const d = generateDungeon(project, scene, registry, seed);
      const wall = scene.generator!.wall;
      const walls = new Set(d.entities.filter((e) => e.definitionId === wall).map((e) => `${Math.floor(e.transform.position.x / 32)},${Math.floor(e.transform.position.y / 32)}`));
      // Walk from the start over squares without walls, inside the dungeon.
      const start = `${Math.floor(d.start!.x / 32)},${Math.floor(d.start!.y / 32)}`;
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
          if (i + di < 0 || j + dj < 0 || i + di >= 40 || j + dj >= 28 || walls.has(k) || seen.has(k)) continue;
          seen.add(k);
          todo.push(k);
        }
      }
      // Every monster, treasure and the way down is somewhere the player can walk to.
      for (const e of d.entities.filter((x) => x.definitionId !== wall)) expect(seen.has(`${Math.floor(e.transform.position.x / 32)},${Math.floor(e.transform.position.y / 32)}`)).toBe(true);
      expect(d.stairs).not.toBeNull();
      expect(Math.abs(d.stairs!.x - d.start!.x) + Math.abs(d.stairs!.y - d.start!.y)).toBeGreaterThan(64);
    }
  });

  it('deeper floors: more monsters, and kinds that only come from a floor on', () => {
    const project = randomGame({ monsterCount: 3, monstersPerFloor: 2, lootCount: 0 });
    const scene = project.scenes[0];
    const slime = project.definitions.find((d) => d.name === 'Enemy')!.id;
    const barrel = project.definitions.find((d) => d.name === 'Barrel')!.id;
    const withBarrels = produce(project, (d) => {
      m.setGenerator(d, scene.id, { monsters: [{ object: slime, weight: 1, fromFloor: 1 }, { object: barrel, weight: 1000, fromFloor: 3 }] });
    });
    const count = (floor: number, id: string) => generateDungeon(withBarrels, withBarrels.scenes[0], registry, 5, floor).entities.filter((e) => e.definitionId === id).length;
    expect(count(1, slime)).toBe(3);
    expect(count(1, barrel)).toBe(0);
    expect(count(2, slime)).toBe(5);
    expect(count(3, barrel)).toBeGreaterThan(5);
  });

  it('played, the level is built anew each time, the player in the first room; hand-placed things stay', () => {
    const project = randomGame();
    const a = new Runtime(project, project.scenes[0].id, registry);
    const b = new Runtime(project, project.scenes[0].id, registry);
    expect(a.dungeonSeed).not.toBe(b.dungeonSeed);
    expect(a.entities.length).toBeGreaterThan(100);
    const player = a.entities.find((e) => e.controller)!;
    const start = generateDungeon(project, project.scenes[0], registry, a.dungeonSeed!).start!;
    expect([player.x, player.y]).toEqual([start.x, start.y]);
    // The editor's level itself is unchanged: only the player and the recipe.
    expect(project.scenes[0].entities.length).toBe(1);
    // A fixed seed: the same each play.
    const fixed = produce(project, (d) => {
      m.setGenerator(d, d.scenes[0].id, { seed: 77 });
    });
    expect(new Runtime(fixed, fixed.scenes[0].id, registry).dungeonSeed).toBe(77);
  });

  it('the AI makes a level random and changes it (objects by name); wrong settings are said; keep makes the example ordinary objects', () => {
    let project = createProject(registry, 'D', 'topdown');
    const sceneId = project.scenes[0].id;
    const op = (json: string) => ({ op: 'set_generator', sceneId, generatorJson: json }) as unknown as Operation;
    project = produce(project, (d) => {
      applyOperations(d, [op('{"rooms":5,"wall":"Wall","monsters":[{"object":"Enemy","weight":2,"fromFloor":1}]}')], registry);
    });
    expect(project.scenes[0].generator?.rooms).toBe(5);
    expect(project.scenes[0].generator?.monsters[0].weight).toBe(2);
    expect(checkOperations(project, [op('{"rooms":5,"walls":"Wall"}')], registry)).toMatch(/no setting "walls"/);
    expect(checkOperations(project, [op('{"wall":"Lava"}')], registry)).toMatch(/no library object "Lava"/);
    const kept = produce(project, (d) => {
      applyOperations(d, [{ op: 'keep_dungeon', sceneId } as unknown as Operation], registry);
    });
    expect(kept.scenes[0].generator).toBeUndefined();
    expect(kept.scenes[0].entities.length).toBe(generateDungeon(project, project.scenes[0], registry, project.scenes[0].generator!.preview).entities.length);
    expect(kept.scenes[0].entities.every((e) => !e.id.startsWith('gen_'))).toBe(true);
  });
});
