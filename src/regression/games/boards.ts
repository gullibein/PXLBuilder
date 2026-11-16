/**
 * Board games of the regression suite: a falling-block puzzle (Tetris) and a matching puzzle (Dr. Mario), each made
 * as the AI's falling-block guide makes them: the top-down starter (nothing falls by gravity), a well of walls, and
 * one Board object whose script spawns pieces as tagged groups, steers them (fits, move_group, turn_group), locks
 * them, and clears lines (count_in). No engine movement is involved: the gameplay is the script.
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../../core/components/registry';
import { createDefinition, instantiateDefinition } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { setScript } from '../../core/script/mutations';
import { projectFromPreset } from '../../core/engine/profile';
import type { Project } from '../../core/types';

const CELL = 32;
const at = (col: number, row: number) => ({ x: col * CELL + 16, y: row * CELL + 16 });

/** A well `cols` wide and `rows` tall (walls at -1 and cols, floor at row `rows`) on the top-down starter. */
function well(registry: ComponentRegistry, name: string, cols: number, rows: number, extra: (d: Project, sceneId: string) => void): Project {
  return produce(projectFromPreset('topdown', registry, name), (d) => {
    const sceneId = d.scenes[0].id;
    d.scenes[0].entities = [];
    const wall = d.definitions.find((x) => x.name === 'Wall')!;
    for (let r = 0; r <= rows; r++) {
      m.addEntity(d, sceneId, instantiateDefinition(wall, at(-1, r)));
      m.addEntity(d, sceneId, instantiateDefinition(wall, at(cols, r)));
    }
    for (let c = 0; c < cols; c++) m.addEntity(d, sceneId, instantiateDefinition(wall, at(c, rows)));
    extra(d, sceneId);
  });
}

/** Tetris: a 10×20 well; I pieces (the guide's recipe, one shape); full rows clear and what is above drops. */
export function tetris(registry: ComponentRegistry, preset: { col: number; row: number }[] = []): Project {
  return well(registry, 'Tetris', 10, 20, (d, sceneId) => {
    const block = createDefinition('Block', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32, color: '#4cc9f0' }) }, []);
    const settled = createDefinition('Settled', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32, color: '#888888' }) }, ['locked']);
    const board = createDefinition('Board', { Sprite: registry.createDefault('Sprite', { width: 8, height: 8 }) }, []);
    d.definitions.push(block, settled, board);
    for (const p of preset) m.addEntity(d, sceneId, instantiateDefinition(settled, at(p.col, p.row)));
    m.addEntity(d, sceneId, instantiateDefinition(board, { x: -200, y: -200 }));
    const spawnAt = (dx: number) => ({ do: 'spawn', object: block.id, x: `px + ${dx * CELL}`, y: 'py', tag: 'active' });
    setScript(d, { target: 'definition', id: board.id }, {
      name: 'Tetris',
      description: 'Spawns pieces, moves and turns them with the arrow keys, drops them, locks them and clears full rows.',
      vars: [
        { name: 'px', value: 144 },
        { name: 'py', value: 16 },
        { name: 'cleared', value: 0 },
        { name: 'row', value: 0 },
      ],
      handlers: [
        { when: { on: 'start' }, if: null, do: [{ do: 'signal', name: 'new_piece' }] },
        {
          when: { on: 'signal', name: 'new_piece' },
          if: null,
          do: [{ do: 'set', var: 'px', value: '144' }, { do: 'set', var: 'py', value: '16' }, spawnAt(-1), spawnAt(0), spawnAt(1), spawnAt(2), { do: 'if', cond: 'not fits("active", 0, 0, "locked")', then: [{ do: 'restart_level' }], else: [] }],
        },
        { when: { on: 'key', key: 'left', edge: 'pressed' }, if: 'fits("active", -32, 0, "locked")', do: [{ do: 'move_group', tag: 'active', dx: '-32', dy: '0' }, { do: 'set', var: 'px', value: 'px - 32' }] },
        { when: { on: 'key', key: 'right', edge: 'pressed' }, if: 'fits("active", 32, 0, "locked")', do: [{ do: 'move_group', tag: 'active', dx: '32', dy: '0' }, { do: 'set', var: 'px', value: 'px + 32' }] },
        { when: { on: 'key', key: 'up', edge: 'pressed' }, if: 'fits_turned("active", px, py, 1, "locked")', do: [{ do: 'turn_group', tag: 'active', x: 'px', y: 'py', dir: '1' }] },
        {
          when: { on: 'every', seconds: 0.1 },
          if: null,
          do: [
            {
              do: 'if',
              cond: 'fits("active", 0, 32, "locked")',
              then: [{ do: 'move_group', tag: 'active', dx: '0', dy: '32' }, { do: 'set', var: 'py', value: 'py + 32' }],
              else: [
                { do: 'each', tag: 'active', then: [{ do: 'tag', tag: 'locked', add: true, on: 'it' }, { do: 'tag', tag: 'active', add: false, on: 'it' }] },
                {
                  do: 'repeat',
                  times: '20',
                  then: [
                    { do: 'set', var: 'row', value: '16 + i * 32' },
                    {
                      do: 'if',
                      cond: 'count_in("locked", 0, row - 1, 320, row + 1) == 10',
                      then: [
                        { do: 'set', var: 'cleared', value: 'cleared + 1' },
                        {
                          do: 'each',
                          tag: 'locked',
                          then: [{ do: 'if', cond: 'abs(it.y - row) < 1', then: [{ do: 'remove', target: 'it' }], else: [{ do: 'if', cond: 'it.y < row', then: [{ do: 'position', x: 'it.x', y: 'it.y + 32', on: 'it' }], else: [] }] }],
                        },
                      ],
                      else: [],
                    },
                  ],
                },
                { do: 'signal', name: 'new_piece' },
              ],
            },
          ],
        },
      ],
    });
  });
}

/**
 * Dr. Mario: an 8×16 well with viruses; pills of two halves (the first red and red, then random colours) fall and
 * are steered; four or more of one colour in a column or a row clear, viruses with them.
 */
export function drMario(registry: ComponentRegistry, viruses: { col: number; row: number; color: 'red' | 'blue' }[]): Project {
  return well(registry, 'Dr. Mario', 8, 16, (d, sceneId) => {
    const half = (name: string, color: string, tags: string[]) => createDefinition(name, { Sprite: registry.createDefault('Sprite', { width: 32, height: 32, color }) }, tags);
    const red = half('Red', '#e5534b', ['red']);
    const blue = half('Blue', '#4c8ef0', ['blue']);
    const redVirus = half('Red virus', '#ff8a80', ['red', 'virus', 'locked']);
    const blueVirus = half('Blue virus', '#8ab4ff', ['blue', 'virus', 'locked']);
    const board = createDefinition('Board', { Sprite: registry.createDefault('Sprite', { width: 8, height: 8 }) }, []);
    d.definitions.push(red, blue, redVirus, blueVirus, board);
    for (const v of viruses) m.addEntity(d, sceneId, instantiateDefinition(v.color === 'red' ? redVirus : blueVirus, at(v.col, v.row)));
    m.addEntity(d, sceneId, instantiateDefinition(board, { x: -200, y: -200 }));
    // (A half: red or blue by a formula; spawned with the "active" tag, its colour tag comes with its object.)
    const spawnHalf = (y: string, colour: string) => ({ do: 'if', cond: `${colour} == 0`, then: [{ do: 'spawn', object: red.id, x: 'px', y, tag: 'active' }], else: [{ do: 'spawn', object: blue.id, x: 'px', y, tag: 'active' }] });
    // Clearing: every window of four cells in a line (columns, then rows), for each colour.
    const clear = (colour: 'red' | 'blue', vertical: boolean) => ({
      do: 'repeat',
      times: vertical ? '104' : '80',
      then: [
        { do: 'set', var: 'cx', value: vertical ? '16 + (i % 8) * 32' : '16 + (i % 5) * 32' },
        { do: 'set', var: 'cy', value: vertical ? '16 + floor(i / 8) * 32' : '16 + floor(i / 5) * 32' },
        {
          do: 'if',
          cond: vertical ? `count_in("${colour}", cx - 1, cy - 1, cx + 1, cy + 97) == 4` : `count_in("${colour}", cx - 1, cy - 1, cx + 97, cy + 1) == 4`,
          then: [
            { do: 'set', var: 'cleared', value: 'cleared + 1' },
            {
              do: 'each',
              tag: colour,
              then: [{ do: 'if', cond: vertical ? 'abs(it.x - cx) < 1 and it.y > cy - 1 and it.y < cy + 97' : 'abs(it.y - cy) < 1 and it.x > cx - 1 and it.x < cx + 97', then: [{ do: 'remove', target: 'it' }], else: [] }],
            },
          ],
          else: [],
        },
      ],
    });
    setScript(d, { target: 'definition', id: board.id }, {
      name: 'Pills',
      description: 'Drops two-coloured pills, steered with the arrow keys; four of a colour in a line clear (viruses too).',
      vars: [
        { name: 'px', value: 112 },
        { name: 'first', value: true },
        { name: 'a', value: 0 },
        { name: 'b', value: 0 },
        { name: 'cx', value: 0 },
        { name: 'cy', value: 0 },
        { name: 'cleared', value: 0 },
      ],
      handlers: [
        { when: { on: 'start' }, if: null, do: [{ do: 'signal', name: 'new_pill' }] },
        {
          when: { on: 'signal', name: 'new_pill' },
          if: null,
          do: [
            { do: 'set', var: 'px', value: '112' },
            { do: 'set', var: 'a', value: 'pick(first, 0, floor(rand(0, 2)))' },
            { do: 'set', var: 'b', value: 'pick(first, 0, floor(rand(0, 2)))' },
            { do: 'set', var: 'first', value: 'false' },
            spawnHalf('16', 'a'),
            spawnHalf('48', 'b'),
            { do: 'if', cond: 'not fits("active", 0, 0, "locked")', then: [{ do: 'restart_level' }], else: [] },
          ],
        },
        { when: { on: 'key', key: 'left', edge: 'pressed' }, if: 'fits("active", -32, 0, "locked")', do: [{ do: 'move_group', tag: 'active', dx: '-32', dy: '0' }, { do: 'set', var: 'px', value: 'px - 32' }] },
        { when: { on: 'key', key: 'right', edge: 'pressed' }, if: 'fits("active", 32, 0, "locked")', do: [{ do: 'move_group', tag: 'active', dx: '32', dy: '0' }, { do: 'set', var: 'px', value: 'px + 32' }] },
        {
          when: { on: 'every', seconds: 0.15 },
          if: null,
          do: [
            {
              do: 'if',
              cond: 'fits("active", 0, 32, "locked")',
              then: [{ do: 'move_group', tag: 'active', dx: '0', dy: '32' }],
              else: [
                { do: 'each', tag: 'active', then: [{ do: 'tag', tag: 'locked', add: true, on: 'it' }, { do: 'tag', tag: 'active', add: false, on: 'it' }] },
                clear('red', true),
                clear('blue', true),
                clear('red', false),
                clear('blue', false),
                { do: 'signal', name: 'new_pill' },
              ],
            },
          ],
        },
      ],
    });
  });
}
