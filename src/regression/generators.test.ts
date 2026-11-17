/**
 * F6a's non-regression goldens (docs/engine-architecture-proposal.md §22.1): what the dungeon generator builds, for
 * fixed seeds: every style, deeper floors, the locked door and its key, room templates; the roguelike starter as it
 * is built at play; and that the editor's example and play build the same level for the same seed. Recorded before
 * the generators moved behind their interface; they must stay identical. (REGRESSION_RECORD=1 prints them.)
 */
import { createHash } from 'node:crypto';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { projectFromPreset } from '../core/engine/profile';
import { buildLevel, generateDungeon } from '../core/model/dungeon';
import { createScene, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { EntityInstance, Project } from '../core/types';
import { Runtime } from '../runtime/runtime';
import { withSeed } from './harness';

const registry = createBuiltinRegistry();
const RECORD = !!process.env.REGRESSION_RECORD;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const golden = (name: string, got: unknown, want: string) => {
  if (RECORD) console.log(`GOLDEN ${JSON.stringify(name)}: '${hash(got)}',`);
  else expect(hash(got), `${name}: what the generator builds changed`).toBe(want);
};

/** Things by their object's name and where they are (ids are made new with each game). */
export const placed = (project: Project, entities: EntityInstance[]) => entities.map((e) => [project.definitions.find((d) => d.id === e.definitionId)?.name ?? e.name, e.transform.position.x, e.transform.position.y]);

/** The roguelike starter with its recipe changed. */
export function roguelike(recipe: Record<string, unknown> = {}, more?: (d: Project) => void): Project {
  return produce(projectFromPreset('roguelike', registry), (d) => {
    more?.(d);
    m.setGenerator(d, d.scenes[0].id, recipe);
  });
}

/** A small room to mix in: two pillars and a coin. */
const withVault = (d: Project) => {
  const vault = createScene('Vault');
  m.addScene(d, vault);
  const place = (name: string, x: number, y: number) => m.addEntity(d, vault.id, instantiateDefinition(d.definitions.find((x) => x.name === name)!, { x, y }));
  place('Wall', 16, 16);
  place('Wall', 80, 16);
  place('Coin', 48, 48);
};

export const DUNGEONS: Record<string, { project: () => Project; seed: number; floor: number }> = {
  'rooms, floor 1': { project: () => roguelike(), seed: 11, floor: 1 },
  'rooms, floor 2': { project: () => roguelike(), seed: 11, floor: 2 },
  'rooms, floor 3 (locked door from its floor)': { project: () => roguelike({ lockFromFloor: 1 }), seed: 12, floor: 3 },
  'caves': { project: () => roguelike({ style: 'caves' }), seed: 13, floor: 1 },
  'maze': { project: () => roguelike({ style: 'maze' }), seed: 14, floor: 1 },
  'big, many rooms, loops, wide corridors': { project: () => roguelike({ width: 60, height: 40, rooms: 14, loops: 0.8, corridor: 2 }), seed: 15, floor: 2 },
  'room templates': { project: () => roguelike({ templates: ['Vault'], templateChance: 1 }, withVault), seed: 16, floor: 1 },
};

export function dungeonOf(name: string) {
  const { project, seed, floor } = DUNGEONS[name];
  const p = project();
  const d = generateDungeon(p, p.scenes[0], registry, seed, floor);
  return { entities: placed(p, d.entities), start: d.start, stairs: d.stairs, rooms: d.rooms, roomList: d.roomList, locked: d.locked, problems: d.problems };
}

/** The roguelike starter as play builds it (its recipe's seed fixed), on a floor. */
export function atPlay(seed: number, floor: number) {
  return withSeed(21, () => {
    const p = roguelike({ seed });
    const rt = new Runtime(p, p.scenes[0].id, registry, new Map([['floor', floor]]));
    return { seed: rt.dungeonSeed, entities: rt.entities.map((e) => [e.name, e.x, e.y]), rooms: rt.dungeon?.roomList, stairs: rt.dungeon?.stairs };
  });
}

const GOLDENS: Record<string, string> = {
  'rooms, floor 1': '683bd703d529ffe0',
  'rooms, floor 2': '815d001a1929e054',
  'rooms, floor 3 (locked door from its floor)': '9882d69bae40b5db',
  'caves': 'b25061c99381952c',
  'maze': 'eeb3b3f64104ef9e',
  'big, many rooms, loops, wide corridors': '256341d8df91f3d6',
  'room templates': '259aed0c0ea0fd65',
  'at play, floor 1': 'a2ce0ce3e8425f72',
  'at play, floor 4': '83ff6b00b45bb127',
};

describe('F6a non-regression: what the dungeon generator builds', () => {
  it('every style, deeper floors, the locked door and key, room templates: the same dungeon for the same seed', () => {
    for (const name of Object.keys(DUNGEONS)) {
      const d = dungeonOf(name);
      expect(d.entities.length, name).toBeGreaterThan(20);
      golden(`dungeon: ${name}`, d, GOLDENS[name]);
    }
    // (What the goldens are of: a locked door with its key; a template's coin in the rooms.)
    expect(dungeonOf('rooms, floor 3 (locked door from its floor)').locked).not.toBeNull();
    expect(dungeonOf('room templates').entities.filter((e) => e[0] === 'Coin').length).toBeGreaterThan(0);
  });

  it('the roguelike starter as play builds it (floor 1, floor 4)', () => {
    golden('dungeon: at play, floor 1', atPlay(31, 1), GOLDENS['at play, floor 1']);
    golden('dungeon: at play, floor 4', atPlay(31, 4), GOLDENS['at play, floor 4']);
  });

  it('the editor\'s example and play build the same level for the same seed and floor', () => {
    const p = roguelike({ seed: 44 });
    const example = buildLevel(p, p.scenes[0], registry, 44, 2).scene;
    const rt = new Runtime(p, p.scenes[0].id, registry, new Map([['floor', 2]]));
    expect(rt.entities.map((e) => [e.name, e.x, e.y])).toEqual(example.entities.map((e) => [p.definitions.find((d) => d.id === e.definitionId)?.name ?? e.name, e.transform.position.x, e.transform.position.y]));
  });
});
