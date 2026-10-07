import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject, instantiateDefinition } from './factory';
import { levelMap } from './levelMap';
import * as m from './mutations';

const registry = createBuiltinRegistry();

describe('the level map for the AI', () => {
  it('draws each cell, and where the player can and cannot get to', () => {
    const base = createProject(registry);
    const sceneId = base.scenes[0].id;
    const project = produce(base, (d) => {
      const place = (name: string, x: number, y: number) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((q) => q.name === name)!, { x, y }));
      for (let x = 16; x < 400; x += 32) place('Platform', x, 48); // ground: row 1, cols 0..11
      place('Player', 48, 16); // col 1, row 0
      place('Hazard', 176, 24); // spikes in col 5, row 0
      for (const y of [16, -16, -48]) place('Ladder', 112, y); // col 3, rows -2..0
      for (const x of [144, 176]) place('Stone', x, -48); // a ledge: cols 4-5, row -2 (the ladder's top row)
      place('Key', 176, -76); // on the ledge (row -3)
      for (const x of [304, 336]) place('Stone', x, -112); // too high: cols 9-10, row -4
      place('Coin', 336, -140); // on it, out of reach (row -5)
    });
    const map = levelMap(project, sceneId, registry)!;
    expect(map.origin).toEqual({ col: -2, row: -9 });
    expect(map.rows.slice(4, 11)).toEqual([
      'r-5 ...........xc...', // the coin's ledge: a standing spot the player can't get to
      'r-4 ...........##...',
      'r-3 ......_k........', // the ledge the ladder leads to: reachable
      'r-2 .....H##........',
      'r-1 .....H..........',
      'r 0 .._P_H_^______..',
      'r 1 ..############..',
    ]);
    expect(map.ruler).toBe('    8901234567890123456'.slice(0, map.ruler.length));
    expect(map.legend).toMatchObject({ P: 'player start: Player', '^': 'hazard (hurts): Hazard', k: 'key: Key', c: 'item to collect: Coin', H: expect.stringMatching(/^ladder/) });
    expect(map.legend._).toMatch(/can stand here and get here/);
  });
});
