import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { projectFromPreset } from '../engine/profile';
import { ENGINE_LIMITS } from '../engine/limits';
import { levelMap } from '../model/levelMap';
import { levelReachability } from '../model/reachability';
import { levelReachProblems } from '../validation/levelProblems';
import { applyOperations, type Operation } from './operations';

const registry = createBuiltinRegistry();

/** A city seen from above, `w` by `h` cells: a wall all round, blocks of 8 by 5 on a street grid; "P" the player. */
function cityRows(w: number, h: number, edges: { left: boolean; right: boolean }, player: boolean): string[] {
  return Array.from({ length: h }, (_, r) =>
    Array.from({ length: w }, (_, c) => {
      if (r === 0 || r === h - 1 || (edges.left && c === 0) || (edges.right && c === w - 1)) return '#';
      if (player && r === 2 && c === 2) return 'P';
      return r % 8 >= 3 && c % 12 >= 4 ? '#' : '.';
    }).join(''),
  );
}

describe('a map bigger than one operation holds (what the top-down guidance says, held to)', () => {
  const p = projectFromPreset('topdown', registry);
  const id = p.scenes[0].id;
  const wall = p.definitions.find((d) => d.name === 'Stone') ?? p.definitions.find((d) => !!d.components.Collider && !d.components.CharacterController)!;
  const legend = [{ char: '#', object: wall.id }, { char: 'P', object: p.definitions.find((d) => !!d.components.CharacterController)!.id }];
  const map = (col: number, rows: string[]): Operation => ({ op: 'draw_map', sceneId: id, col, row: 0, legend, rows, clear: true }) as Operation;

  it('one draw_map of 120 by 70 is refused, with the limit said', () => {
    expect(120 * 70).toBeGreaterThan(ENGINE_LIMITS.drawMapCells);
    expect(() => produce(p, (d) => void applyOperations(d, [map(0, cityRows(120, 70, { left: true, right: true }, true))], registry))).toThrow(/draw_map: 120x70 is too big at once \(at most 6000 cells\)/);
  });

  it('two draw_maps side by side in the same level make one level: 120 by 70, walked from end to end', () => {
    const after = produce(p, (d) => void applyOperations(d, [map(0, cityRows(60, 70, { left: true, right: false }, true)), map(60, cityRows(60, 70, { left: false, right: true }, false))], registry));
    const scene = after.scenes[0];
    const xs = scene.entities.map((e) => e.transform.position.x);
    const ys = scene.entities.map((e) => e.transform.position.y);
    expect([(Math.max(...xs) - Math.min(...xs)) / 32 + 1, (Math.max(...ys) - Math.min(...ys)) / 32 + 1]).toEqual([120, 70]);
    // (The second map cleared only its own half: the player and the first half are there.)
    expect(scene.entities.filter((e) => e.definitionId === legend[1].object)).toHaveLength(1);
    expect(scene.entities.length).toBeLessThan(ENGINE_LIMITS.smoothThings);
    // Nothing is walled off at the seam: the far right column of streets is reached from the start on the left.
    expect(levelReachability(after, id, registry).status).not.toBe('no-player');
    expect(levelReachProblems(after, id, registry)).toEqual([]);
    const m = levelMap(after, id, registry)!;
    expect(m.rows.join('')).not.toContain('x');
  });

  it('draw_tiles: 3,000 cells a call; a bigger area as several calls', () => {
    const rect = (col: number, width: number): Operation => ({ op: 'draw_tiles', sceneId: id, definitionRef: wall.id, rects: [{ col, row: 40, width, height: 30 }], onTop: null }) as Operation;
    expect(() => produce(p, (d) => void applyOperations(d, [rect(40, 120)], registry))).toThrow(/draw_tiles: 3600 cells is too many at once \(max 3000\)/);
    const after = produce(p, (d) => void applyOperations(d, [rect(40, 60), rect(100, 60)], registry));
    expect(after.scenes[0].entities.length - p.scenes[0].entities.length).toBeGreaterThanOrEqual(3500);
  });
});
