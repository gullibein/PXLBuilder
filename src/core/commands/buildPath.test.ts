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
    const path = (steps: Extract<Operation, { op: 'build_path' }>['steps']) => () => build(project, [{ op: 'build_path', sceneId, start: null, floor: 'Platform', ladder: null, steps }]);
    expect(path([{ do: 'run', cells: 3 }, { do: 'jump', gap: 1, rise: 2 }])).toThrow(/at most 1 row up, not 2; use a climb step/);
    expect(path([{ do: 'run', cells: 3 }, { do: 'jump', gap: 6, rise: 0 }])).toThrow(/a gap of 6 cells at the same height is too wide; the player clears at most 3 cells/);
    expect(path([{ do: 'run', cells: 3 }, { do: 'hazard', object: 'Hazard', cells: 4 }])).toThrow(/at most 2 cells of hazards/);
    expect(path([{ do: 'jump', gap: 1, rise: 0 }])).toThrow(/needs floor to jump from/);
  });

  it('only starts where the player can get to, and never builds into what is there', () => {
    const { project, sceneId } = emptyLevel();
    const ground = build(project, [{ op: 'build_path', sceneId, start: null, floor: 'Platform', ladder: null, steps: [{ do: 'run', cells: 6 }] }]);
    const from = (start: { col: number; row: number }) => () => build(ground, [{ op: 'build_path', sceneId, start, floor: 'Stone', ladder: null, steps: [{ do: 'run', cells: 2 }] }]);
    expect(from({ col: 4, row: -6 })).toThrow(/not a spot the player can get to/);
    expect(from({ col: 4, row: 0 })).not.toThrow(); // on the ground the player walks on
    const blocked = build(ground, [{ op: 'place_instance', sceneId, definitionRef: ground.definitions.find((d) => d.name === 'Stone')!.id, x: 240, y: 16, name: null, ref: null }]);
    expect(() => build(blocked, [{ op: 'build_path', sceneId, start: { col: 5, row: 0 }, floor: 'Platform', ladder: null, steps: [{ do: 'run', cells: 3 }] }])).toThrow(/no room to stand|already taken/);
  });
});
