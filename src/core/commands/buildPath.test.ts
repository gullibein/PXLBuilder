import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject, instantiateDefinition } from '../model/factory';
import { levelMap } from '../model/levelMap';
import * as m from '../model/mutations';
import { reachabilityProblems } from '../model/reachability';
import { applyOperations, type Operation } from './operations';

const registry = createBuiltinRegistry();

/** An empty level with just the player, standing in cell (1,0) with nothing under it yet. */
function emptyLevel() {
  const base = createProject(registry);
  const sceneId = base.scenes[0].id;
  const project = produce(base, (d) => {
    m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 48, y: 16 }));
  });
  return { project, sceneId };
}
const build = (project: ReturnType<typeof emptyLevel>['project'], ops: Operation[]) => produce(project, (d) => void applyOperations(d, ops, registry));

describe('build_path: levels built as a route the player can follow', () => {
  it('a whole route (jumps, spikes, a ladder, a key and a door) is reachable by construction', () => {
    const { project, sceneId } = emptyLevel();
    const after = build(project, [
      {
        op: 'build_path',
        sceneId,
        start: null,
        direction: 'right',
        floor: 'Platform',
        ladder: null,
        steps: [
          { do: 'run', cells: 4 },
          { do: 'jump', gap: 2, rise: 1 },
          { do: 'run', cells: 3 },
          { do: 'hazard', object: 'Hazard', cells: 2 },
          { do: 'run', cells: 2 },
          { do: 'climb', rows: 3 },
          { do: 'run', cells: 3 },
          { do: 'put', object: 'Key', name: null, ref: null },
          { do: 'jump', gap: 2, rise: -2 },
          { do: 'run', cells: 3 },
          { do: 'put', object: 'Door', name: null, ref: 'door' },
        ],
      },
      { op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: 'requires', source: { kind: 'entity', id: 'door' }, target: { kind: 'object', id: project.definitions.find((d) => d.name === 'Key')!.id }, params: {}, conditions: [] }) },
    ]);
    // Nothing out of reach, nothing floating, nothing inside spikes, the player not stuck.
    expect(reachabilityProblems(after, sceneId, registry)).toEqual([]);
    const map = levelMap(after, sceneId, registry)!;
    const text = map.rows.join('\n');
    expect(text).toContain('H'); // the ladder
    expect(text).toContain('^^'); // two spikes
    expect(text).toMatch(/k/);
    expect(text).toMatch(/D/);
  });

  it('refuses steps the player could not make, with the limits', () => {
    const { project, sceneId } = emptyLevel();
    const path = (steps: Extract<Operation, { op: 'build_path' }>['steps']) => () => build(project, [{ op: 'build_path', sceneId, start: null, direction: 'right', floor: 'Platform', ladder: null, steps }]);
    expect(path([{ do: 'run', cells: 3 }, { do: 'jump', gap: 1, rise: 2 }])).toThrow(/at most 1 row up, not 2; use a climb step/);
    expect(path([{ do: 'run', cells: 3 }, { do: 'jump', gap: 6, rise: 0 }])).toThrow(/a gap of 6 cells at the same height is too wide; the player clears at most 3 cells/);
    expect(path([{ do: 'run', cells: 3 }, { do: 'hazard', object: 'Hazard', cells: 4 }])).toThrow(/at most 2 cells of hazards/);
    expect(path([{ do: 'jump', gap: 1, rise: 0 }])).toThrow(/needs floor to jump from/);
  });

  it('only starts where the player can get to, and never builds into what is there', () => {
    const { project, sceneId } = emptyLevel();
    const ground = build(project, [{ op: 'build_path', sceneId, start: null, direction: 'right', floor: 'Platform', ladder: null, steps: [{ do: 'run', cells: 6 }] }]);
    const from = (start: { col: number; row: number }) => () => build(ground, [{ op: 'build_path', sceneId, start, direction: 'right', floor: 'Stone', ladder: null, steps: [{ do: 'run', cells: 2 }] }]);
    expect(from({ col: 4, row: -6 })).toThrow(/not a spot the player can get to/);
    expect(from({ col: 4, row: 0 })).not.toThrow(); // on the ground the player walks on
    const blocked = build(ground, [{ op: 'place_instance', sceneId, definitionRef: ground.definitions.find((d) => d.name === 'Stone')!.id, x: 240, y: 16, name: null, ref: null }]);
    expect(() => build(blocked, [{ op: 'build_path', sceneId, start: { col: 5, row: 0 }, direction: 'right', floor: 'Platform', ladder: null, steps: [{ do: 'run', cells: 3 }] }])).toThrow(/no room to stand|already taken/);
  });

  it('a level that starts in the middle: routes both ways, a teleporter pair and a goal, all reachable', () => {
    const base = createProject(registry);
    const sceneId = base.scenes[0].id;
    const project = produce(base, (d) => {
      m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 336, y: 16 })); // col 10
    });
    const id = (name: string) => project.definitions.find((d) => d.name === name)!.id;
    const after = build(project, [
      { op: 'build_path', sceneId, start: null, direction: 'right', floor: 'Stone', ladder: null, steps: [
        { do: 'run', cells: 4 }, { do: 'climb', rows: 4 }, { do: 'run', cells: 4 }, { do: 'put', object: 'Teleporter', name: 'Up', ref: 'up' },
        { do: 'jump', gap: 2, rise: -1 }, { do: 'run', cells: 3 }, { do: 'put', object: 'Door', name: null, ref: 'door' }, { do: 'run', cells: 2 }, { do: 'put', object: 'Goal', name: null, ref: null },
      ] },
      { op: 'build_path', sceneId, start: null, direction: 'left', floor: 'Platform', ladder: null, steps: [
        { do: 'run', cells: 3 }, { do: 'hazard', object: 'Hazard', cells: 2 }, { do: 'run', cells: 2 }, { do: 'jump', gap: 0, rise: -2 }, { do: 'run', cells: 3 },
        { do: 'put', object: 'Key', name: null, ref: null }, { do: 'put', object: 'Teleporter', name: 'Down', ref: 'down' },
      ] },
      { op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: 'teleports_to', source: { kind: 'entity', id: 'down' }, target: { kind: 'entity', id: 'up' }, params: {}, conditions: [] }) },
      { op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: 'requires', source: { kind: 'entity', id: 'door' }, target: { kind: 'object', id: id('Key') }, params: {}, conditions: [] }) },
      // An enemy placed in the air lands on the floor below it.
      { op: 'place_instance', sceneId, definitionRef: id('Enemy'), x: 400, y: -100, name: null, ref: null },
    ]);
    expect(reachabilityProblems(after, sceneId, registry)).toEqual([]);
    const map = levelMap(after, sceneId, registry)!.rows.join('\n');
    const [left, right] = [map.indexOf('k'), map.indexOf('G')];
    expect(left).toBeGreaterThan(-1);
    expect(right).toBeGreaterThan(-1);
    const enemy = after.scenes[0].entities.find((e) => e.name === 'Enemy')!;
    expect(enemy.transform.position.y).toBe(17); // standing on the floor (top at 32; the enemy is 30 tall)
  });
});

describe('build_path: turning and building in layers', () => {
  it('a tower: climbs that turn back stack each floor above the one below, and it is all reachable', () => {
    const { project, sceneId } = emptyLevel();
    const after = build(project, [
      {
        op: 'build_path',
        sceneId,
        start: null,
        direction: 'right',
        floor: 'Platform',
        ladder: null,
        steps: [
          { do: 'run', cells: 7 },
          { do: 'climb', rows: 3, back: true },
          { do: 'run', cells: 6 },
          { do: 'climb', rows: 3, back: true },
          { do: 'run', cells: 6 },
          { do: 'put', object: 'Goal', name: null, ref: null },
        ],
      },
    ]);
    expect(reachabilityProblems(after, sceneId, registry)).toEqual([]);
    // Three floors, each right above the one below (same columns), 3 rows apart.
    const floors = after.scenes[0].entities.filter((e) => e.name === 'Platform');
    const rows = [...new Set(floors.map((e) => Math.round(e.transform.position.y)))].sort((a, b) => b - a);
    expect(rows).toHaveLength(3);
    expect(rows[0] - rows[1]).toBe(96);
    expect(rows[1] - rows[2]).toBe(96);
    const cols = (y: number) => floors.filter((e) => Math.round(e.transform.position.y) === y).map((e) => e.transform.position.x);
    expect(Math.min(...cols(rows[1]))).toBeLessThan(Math.max(...cols(rows[0])));
    // The top layer goes right again, above the bottom one.
    const goal = after.scenes[0].entities.find((e) => e.name === 'Goal')!;
    expect(goal.transform.position.x).toBeGreaterThan(Math.min(...cols(rows[2])));
  });

  it('turn reverses the route; floor squeezed one row above other floor is refused', () => {
    const { project, sceneId } = emptyLevel();
    // Ground under the start, then a 2-row climb ahead: its platform would be one row above the ground.
    const withGround = produce(project, (d) => {
      for (let c = -2; c <= 10; c++) m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Platform')!, { x: c * 32 + 16, y: 48 }));
    });
    expect(() => build(withGround, [{ op: 'build_path', sceneId, start: null, direction: 'right', floor: 'Platform', ladder: null, steps: [{ do: 'run', cells: 2 }, { do: 'climb', rows: 2 }] }])).toThrow(/one row above the floor .* no room to jump/);
    // A jump up onto a block standing on the floor is just a step: fine.
    const step = build(withGround, [{ op: 'build_path', sceneId, start: null, direction: 'right', floor: 'Platform', ladder: null, steps: [{ do: 'run', cells: 3 }, { do: 'turn' }, { do: 'jump', gap: 1, rise: 1 }] }]);
    expect(reachabilityProblems(step, sceneId, registry)).toEqual([]);
    // Turning and dropping down beyond the start is fine.
    const ok = build(project, [
      { op: 'build_path', sceneId, start: null, direction: 'right', floor: 'Platform', ladder: null, steps: [{ do: 'run', cells: 3 }, { do: 'turn' }, { do: 'run', cells: 5 }, { do: 'jump', gap: 1, rise: -2 }, { do: 'run', cells: 2 }] },
    ]);
    expect(reachabilityProblems(ok, sceneId, registry)).toEqual([]);
    const xs = ok.scenes[0].entities.filter((e) => e.name === 'Platform').map((e) => e.transform.position.x);
    expect(Math.min(...xs)).toBeLessThan(48);
  });

  it('a climb back needs room for the floor below', () => {
    const { project, sceneId } = emptyLevel();
    expect(() => build(project, [{ op: 'build_path', sceneId, start: null, direction: 'right', floor: 'Platform', ladder: null, steps: [{ do: 'run', cells: 4 }, { do: 'climb', rows: 2, back: true }] }])).toThrow(/at least 3 rows/);
  });
});
