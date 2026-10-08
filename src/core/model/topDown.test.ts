import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations, type Operation } from '../commands/operations';
import { createProject, instantiateDefinition } from './factory';
import { levelMap } from './levelMap';
import * as m from './mutations';
import { levelReachability, reachabilityProblems } from './reachability';
import { isTopDownScene } from './topDown';
import type { Id, Project } from '../types';

const registry = createBuiltinRegistry();

/**
 * A top-down room of Stone walls: columns -3..3, rows -3..3 (the walls on the
 * edge), the player in the middle cell (0,0). `build` adds more; place takes
 * cells.
 */
function room(build: (place: (name: string, col: number, row: number) => Id, d: Project, sceneId: Id) => void = () => {}, opts: { gravity?: number; movement?: 'topdown' | 'platformer' } = {}) {
  const base = createProject(registry);
  const sceneId = base.scenes[0].id;
  const project = produce(base, (d) => {
    d.scenes[0].entities = [];
    m.setWorldSettings(d, sceneId, { gravity: { x: 0, y: opts.gravity ?? 0 } });
    if (opts.movement !== 'platformer') m.setDefinitionComponentField(d, d.definitions.find((x) => x.name === 'Player')!.id, 'CharacterController', 'movement', opts.movement ?? 'topdown', registry);
    const place = (name: string, col: number, row: number) => {
      const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, { x: col * 32 + 16, y: row * 32 + 16 });
      m.addEntity(d, sceneId, e);
      return e.id;
    };
    for (let i = -3; i <= 3; i++) {
      for (const [c, r] of [[i, -3], [i, 3], [-3, i], [3, i]]) place('Stone', c, r);
    }
    place('Player', 0, 0);
    build(place, d, sceneId);
  });
  return { project, sceneId, scene: project.scenes[0], check: () => levelReachability(project, sceneId, registry), problems: () => reachabilityProblems(project, sceneId, registry) };
}

describe('top-down levels', () => {
  it('a level is top-down when its player walks top-down, or when it has no gravity', () => {
    const a = room(() => {}, { gravity: 980 });
    expect(isTopDownScene(a.project, a.scene, registry)).toBe(true);
    const b = room(() => {}, { gravity: 0, movement: 'platformer' });
    expect(isTopDownScene(b.project, b.scene, registry)).toBe(true);
    const c = room(() => {}, { gravity: 980, movement: 'platformer' });
    expect(isTopDownScene(c.project, c.scene, registry)).toBe(false);
  });

  it('things anywhere inside the room are reachable on foot, without ground under them', () => {
    const l = room((place) => {
      place('Coin', -2, -2);
      place('Coin', 2, 2);
    });
    const r = l.check();
    expect(r.status).toBe('topdown');
    expect(r.status === 'topdown' && r.unreachable.things).toEqual([]);
    expect(l.problems()).toEqual([]);
  });

  it('a coin walled off in a closed room is reported, and its floor is marked x on the map', () => {
    const l = room((place) => {
      // A closed 1-cell room at (6,0), walled on all sides.
      for (const [c, r] of [[5, -1], [6, -1], [7, -1], [5, 0], [7, 0], [5, 1], [6, 1], [7, 1]]) place('Stone', c, r);
      place('Coin', 6, 0);
    });
    const r = l.check();
    expect(r.status === 'topdown' && r.unreachable.things.map((t) => t.name)).toEqual(['Coin']);
    expect(l.problems().map((p) => p.text).join()).toMatch(/can't walk to Coin.*walls are in the way/);
    const map = levelMap(l.project, l.sceneId, registry)!;
    expect(map.legend._).toMatch(/walk to/);
    // Inside the main room: floor the player reaches; the sealed cell: x.
    const label = map.rows[0].indexOf(' ', 1) + 1;
    const rowOf = (row: number) => map.rows[row - map.origin.row].slice(label);
    const at = (col: number, row: number) => rowOf(row)[col - map.origin.col];
    expect(at(1, 1)).toBe('_');
    expect(at(6, 0)).toBe('c');
    expect(rowOf(0)).not.toMatch(/x/);
    expect(rowOf(0)).toMatch(/#c#/);
  });

  it('a gap in the wall lets the player out to what is beyond it', () => {
    const l = room((place, d, sceneId) => {
      // Open the right wall at row 0 and put a coin outside.
      const wall = d.scenes[0].entities.find((e) => e.transform.position.x === 3 * 32 + 16 && e.transform.position.y === 16)!;
      m.removeEntities(d, sceneId, [wall.id]);
      place('Coin', 6, 0);
    });
    const r = l.check();
    expect(r.status === 'topdown' && r.unreachable.things).toEqual([]);
  });

  it('nothing is reported as floating in mid-air, and the AI is told the level is top-down', () => {
    const l = room((place) => place('Hazard', 1, 1));
    expect(l.problems()).toEqual([]);
  });

  it('build_path is refused in a top-down level, with what to do instead', () => {
    const l = room();
    const op = { op: 'build_path', sceneId: l.sceneId, direction: 'right', start: null, steps: [{ kind: 'run', cells: 3 }] } as unknown as Operation;
    expect(() => produce(l.project, (d) => void applyOperations(d, [op], registry))).toThrow(/seen from above.*draw_tiles/);
  });

  it('things the AI places stay where they are put (no dropping onto the floor below)', () => {
    const l = room();
    const door = l.project.definitions.find((d) => d.components.Openable)!;
    const op: Operation = { op: 'place_instance', sceneId: l.sceneId, definitionRef: door.id, x: 48, y: -48, name: null, ref: null };
    const after = produce(l.project, (d) => void applyOperations(d, [op], registry));
    const placed = after.scenes[0].entities.find((e) => e.definitionId === door.id)!;
    expect(placed.transform.position.y).toBe(-48);
  });
});
