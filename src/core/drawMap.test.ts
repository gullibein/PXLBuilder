import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createDefinition, createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { levelMap } from './model/levelMap';
import { levelReachability } from './model/reachability';
import type { Project } from './types';

const registry = createBuiltinRegistry();

function start(): { project: Project; sceneId: string } {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 500, y: 500 }));
    m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Coin')!, { x: 80, y: 80 }));
    m.addDefinition(d, createDefinition('Back wall', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32, layer: -1 }) }, []), registry);
  });
  return { project, sceneId };
}

// A compact two-floor room: walls all round, a ladder up to the second floor, the goal up there.
const ROOM = [
  '##########',
  '#........#',
  '#.c....G.#',
  '#####H####',
  '#....H...#',
  '#.P..H.c.#',
  '##########',
];

describe('draw_map: a whole level drawn as text', () => {
  it('puts each object in its cells, moves the player to P, and clears what was in the area first', () => {
    const { project, sceneId } = start();
    const op = { op: 'draw_map', sceneId, col: 0, row: 0, legend: [{ char: '#', object: 'Platform' }, { char: 'H', object: 'Ladder' }, { char: 'c', object: 'Coin' }, { char: 'G', object: 'Goal' }, { char: 'P', object: 'Player' }], rows: ROOM, clear: true } as Operation;
    const after = produce(project, (d) => void applyOperations(d, [op], registry));
    const scene = after.scenes[0];
    const count = (name: string) => scene.entities.filter((e) => after.definitions.find((d) => d.id === e.definitionId)?.name === name).length;
    expect(count('Platform')).toBe(ROOM.join('').split('#').length - 1);
    expect(count('Ladder')).toBe(3);
    expect(count('Coin')).toBe(2);
    expect(count('Goal')).toBe(1);
    // One player, moved (cell 2,5: its middle at 80, 176).
    const players = scene.entities.filter((e) => e.name === 'Player');
    expect(players).toHaveLength(1);
    expect(players[0].transform.position).toEqual({ x: 80, y: 176 });
    // The map the AI reads back is the room as drawn.
    const map = levelMap(after, sceneId, registry)!;
    expect(map.rows.some((r) => r.includes('#####H####'))).toBe(true);
    // Every part of it can be reached.
    const reach = levelReachability(after, sceneId, registry);
    expect(reach.status === 'ok' && reach.unreachable.things).toEqual([]);
    // (Nor is its roof, the top of its ceiling, a platform out of reach.)
    expect(reach.status === 'ok' && reach.unreachable.platforms).toEqual([]);
  });

  it('a second map of back walls (layer below 0) goes behind the first, keeping it', () => {
    const { project, sceneId } = start();
    const legend = [{ char: '#', object: 'Platform' }, { char: 'H', object: 'Ladder' }, { char: 'c', object: 'Coin' }, { char: 'G', object: 'Goal' }, { char: 'P', object: 'Player' }];
    const back = ROOM.map((r, j) => (j === 0 || j === ROOM.length - 1 ? '.'.repeat(r.length) : '.' + 'b'.repeat(r.length - 2) + '.'));
    const ops = [
      { op: 'draw_map', sceneId, col: 0, row: 0, legend, rows: ROOM, clear: true },
      { op: 'draw_map', sceneId, col: 0, row: 0, legend: [{ char: 'b', object: 'Back wall' }], rows: back, clear: false },
    ] as Operation[];
    const after = produce(project, (d) => void applyOperations(d, ops, registry));
    const names = after.scenes[0].entities.map((e) => after.definitions.find((d) => d.id === e.definitionId)?.name);
    expect(names.filter((n) => n === 'Coin')).toHaveLength(2);
    expect(names.filter((n) => n === 'Goal')).toHaveLength(1);
    expect(names.filter((n) => n === 'Platform')).toHaveLength(ROOM.join('').split('#').length - 1);
    expect(names.filter((n) => n === 'Ladder')).toHaveLength(3);
    expect(names.filter((n) => n === 'Back wall').length).toBeGreaterThan(20);
  });

  it('says which characters the legend leaves out', () => {
    const { project, sceneId } = start();
    const op = { op: 'draw_map', sceneId, col: 0, row: 0, legend: [{ char: '#', object: 'Platform' }], rows: ['#?#'], clear: true } as Operation;
    expect(() => produce(project, (d) => void applyOperations(d, [op], registry))).toThrow(/"\?"/);
  });
});

describe('terrain the AI makes stays on the grid', () => {
  it('a block and a ladder it made, placed by pixel at the edge of a cell, land on the cell (never half a cell off)', () => {
    const { project, sceneId } = start();
    const ops = [
      { op: 'create_definition', ref: 'dirt', name: 'Dirt', category: 'Platforms', tags: ['ground'], description: 'Ground', components: [{ component: 'Sprite', propsJson: '{"width":32,"height":32}' }, { component: 'Collider', propsJson: '{}' }] },
      { op: 'create_definition', ref: 'vine', name: 'Vine', category: 'Environment', tags: ['ladder'], description: 'A vine to climb', components: [{ component: 'Sprite', propsJson: '{"width":32,"height":32}' }, { component: 'Collider', propsJson: '{"isTrigger":true}' }, { component: 'Climbable', propsJson: '{}' }] },
      { op: 'place_instance', sceneId, definitionRef: 'dirt', x: 320, y: 64, name: null, ref: null, onTop: null },
      { op: 'place_instance', sceneId, definitionRef: 'vine', x: 352, y: 96, name: null, ref: null, onTop: null },
      { op: 'place_instance', sceneId, definitionRef: 'vine', x: 360, y: 130, name: null, ref: null, onTop: null },
    ] as unknown as Operation[];
    const after = produce(project, (d) => void applyOperations(d, ops, registry));
    const at = (name: string) => after.scenes[0].entities.filter((e) => e.name === name).map((e) => e.transform.position);
    expect(after.definitions.find((d) => d.name === 'Dirt')!.metadata.placement).toBe('tile');
    expect(at('Dirt')).toEqual([{ x: 336, y: 80 }]);
    // The two vine pieces one above the other, in one column.
    expect(at('Vine')).toEqual([{ x: 368, y: 112 }, { x: 368, y: 144 }]);
  });
});

describe('crates in the level checker', () => {
  it('a ledge too high to jump to is reachable with a crate on the floor below it (pushed under it), not without', () => {
    const level = (crate: boolean) => {
      const { project, sceneId } = start();
      const rows = [
        '##############',
        '#............#',
        '#............#',
        '#............#',
        '#.........G..#',
        '#.......######',
        `#P..${crate ? 'B' : '.'}........#`,
        '##############',
      ];
      const legend = [{ char: '#', object: 'Platform' }, { char: 'B', object: 'Crate' }, { char: 'G', object: 'Goal' }, { char: 'P', object: 'Player' }];
      return produce(project, (d) => void applyOperations(d, [{ op: 'draw_map', sceneId, col: 0, row: 0, legend, rows, clear: true } as Operation], registry));
    };
    // The ledge (its top at y=160, the floor's at 224: two rows, more than a jump).
    const ledge = (p: Project) => {
      const r = levelReachability(p, p.scenes[0].id, registry);
      return r.status === 'ok' ? r.surfaces.find((x) => Math.round(x.top) === 160)?.reached : undefined;
    };
    const withCrate = level(true);
    expect(ledge(withCrate)).toBe(true);
    expect(levelMap(withCrate, withCrate.scenes[0].id, registry)!.legend.B).toMatch(/crate/);
    expect(ledge(level(false))).toBe(false);
  });
});
