import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from '../commands/operations';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { levelStats, statsLine } from './levelIdeas';

const registry = createBuiltinRegistry();

describe('a level counted (to make the next one harder than it)', () => {
  it('its size, floor rows, enemies, hazards and the kinds of pieces in it', () => {
    const p0 = createProject(registry);
    const sceneId = p0.scenes[0].id;
    const id = (n: string) => p0.definitions.find((d) => d.name === n)!.id;
    const legend = [['#', 'Platform'], ['H', 'Ladder'], ['^', 'Hazard'], ['P', 'Player'], ['E', 'Enemy'], ['B', 'Crate'], ['/', 'Ramp'], ['~', 'Water']].map(([char, n]) => ({ char, object: id(n) }));
    const rows = [
      '############',
      '#..........#',
      '#.E....H...#',
      '#.######H..#',
      '#.......H..#',
      '#P.B../#~~~#',
      '############',
    ];
    const p = produce(p0, (d) => void applyOperations(d, [{ op: 'draw_map', sceneId, col: 0, row: 0, legend, rows, clear: true } as unknown as Operation], registry));
    const s = levelStats(p, p.scenes[0], registry)!;
    expect(s).toMatchObject({ w: 12, h: 7, enemies: 1, hazards: 0 });
    expect(s.floors).toBeGreaterThanOrEqual(2);
    expect(s.pieces).toEqual(expect.arrayContaining(['ladders', 'ramps', 'water to swim', 'crates']));
    expect(statsLine(s)).toMatch(/^12x7 cells, \d+ floor rows, 1 enemies, 0 hazards; pieces: /);
  });
});
