/**
 * A falling-block puzzle (Tetris) made only of scripts, with the group statements: a piece of four blocks spawned
 * together (spawn … tag), moved and turned as one (move_group, turn_group) after checking it fits (fits,
 * fits_turned), locked in place, full rows found (count_in) and cleared, the rows above dropping down.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createDefinition, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { setScript } from '../core/script/mutations';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();
const CELL = 32;
const center = (col: number, row: number) => ({ x: col * CELL + 16, y: row * CELL + 16 });

function game(preset: { col: number; row: number }[] = []) {
  let blockId = '';
  let lockedId = '';
  const project = produce(createProject(registry, 'Blocks', 'topdown'), (d) => {
    const sceneId = d.scenes[0].id;
    d.scenes[0].entities = [];
    const block = createDefinition('Block', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32, color: '#4cc9f0' }) }, []);
    const locked = createDefinition('Settled', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32, color: '#888888' }) }, ['locked']);
    blockId = block.id;
    lockedId = locked.id;
    d.definitions.push(block, locked);
    const board = createDefinition('Board', { Sprite: registry.createDefault('Sprite', { width: 8, height: 8 }) }, []);
    d.definitions.push(board);
    const stone = d.definitions.find((x) => x.name === 'Wall')!;
    // The well: 10 columns (0..9), 20 rows (0..19), walls on both sides and a floor.
    for (let r = 0; r <= 20; r++) {
      m.addEntity(d, sceneId, instantiateDefinition(stone, center(-1, r)));
      m.addEntity(d, sceneId, instantiateDefinition(stone, center(10, r)));
    }
    for (let c = 0; c < 10; c++) m.addEntity(d, sceneId, instantiateDefinition(stone, center(c, 20)));
    for (const p of preset) m.addEntity(d, sceneId, instantiateDefinition(locked, center(p.col, p.row)));
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
          // An I piece, lying down: columns 3..6 of the top row, turning around its second block.
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
                // Landed: the blocks settle, full rows (top to bottom) go and what is above drops a row.
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
                          then: [
                            {
                              do: 'if',
                              cond: 'abs(it.y - row) < 1',
                              then: [{ do: 'remove', target: 'it' }],
                              else: [{ do: 'if', cond: 'it.y < row', then: [{ do: 'position', x: 'it.x', y: 'it.y + 32', on: 'it' }], else: [] }],
                            },
                          ],
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
  const rt = new Runtime(project, project.scenes[0].id, registry);
  const cells = (tag: string) =>
    rt.entities
      .filter((e) => e.alive && e.tags.includes(tag))
      .map((e) => `${Math.round((e.x - 16) / CELL)},${Math.round((e.y - 16) / CELL)}`)
      .sort();
  const input = new InputState();
  const tap = (key: 'left' | 'right' | 'up') => {
    input.press(key);
    rt.update(1 / 60, input);
    input.release(key);
    rt.update(1 / 60, input);
  };
  const wait = (seconds: number) => {
    for (let i = 0; i < seconds * 60; i++) rt.update(1 / 60, input);
  };
  const board = rt.entities.find((e) => e.name === 'Board')!;
  /** The piece's columns (it keeps falling meanwhile, a row every 0.1 s, so rows move on). */
  const cols = (tag: string) => [...new Set(cells(tag).map((c) => Number(c.split(',')[0])))].sort((a, b) => a - b);
  return { rt, cells, cols, tap, wait, board, blockId, lockedId };
}

describe('a falling-block puzzle from scripts (group statements)', () => {
  it('a piece of four blocks spawns together and moves, stopped by the walls', () => {
    const g = game();
    g.rt.update(1 / 60, new InputState());
    expect(g.cells('active')).toEqual(['3,0', '4,0', '5,0', '6,0']);
    g.tap('left');
    expect(g.cols('active')).toEqual([2, 3, 4, 5]);
    for (let i = 0; i < 6; i++) g.tap('left');
    // Against the left wall: no further, and still in one piece (one row).
    expect(g.cols('active')).toEqual([0, 1, 2, 3]);
    expect(new Set(g.cells('active').map((c) => c.split(',')[1])).size).toBe(1);
  });

  it('turns a quarter around its pivot, only when it fits', () => {
    const g = game();
    g.rt.update(1 / 60, new InputState());
    g.wait(0.25); // down a couple of rows, room to turn
    const before = g.cells('active');
    g.tap('up');
    const after = g.cells('active');
    expect(after).not.toEqual(before);
    // Lying down → standing up: all four in one column now.
    expect(new Set(after.map((c) => c.split(',')[0])).size).toBe(1);
    expect(after).toHaveLength(4);
  });

  it('falls, settles on the floor, and the next piece comes', () => {
    const g = game();
    g.wait(3); // 20 rows at 10 a second
    expect(g.cells('locked')).toEqual(['3,19', '4,19', '5,19', '6,19']);
    expect(g.cells('active')).toHaveLength(4);
  });

  it('a full row is cleared and the blocks above drop down a row', () => {
    // Row 19 filled except columns 6..9; one settled block above, in row 18.
    const preset = [0, 1, 2, 3, 4, 5].map((col) => ({ col, row: 19 })).concat([{ col: 0, row: 18 }]);
    const g = game(preset);
    g.rt.update(1 / 60, new InputState());
    for (let i = 0; i < 3; i++) g.tap('right'); // the I piece to columns 6..9
    expect(g.cols('active')).toEqual([6, 7, 8, 9]);
    g.wait(2.5);
    expect(g.rt.entities.find((e) => e.name === 'Board') && getVar(g.board, 'cleared')).toBe(1);
    // Row 19 is gone; the block from row 18 is in row 19 now.
    expect(g.cells('locked')).toEqual(['0,19']);
  });

  it('clearing four rows of a nearly full board is done in one go (the game carries on)', () => {
    // Columns 0..8 filled from row 4 down: 144 settled blocks; a standing I piece in column 9 clears rows 16..19.
    const preset = [];
    for (let col = 0; col < 9; col++) for (let row = 4; row < 20; row++) preset.push({ col, row });
    const g = game(preset);
    g.rt.update(1 / 60, new InputState());
    g.tap('up');
    for (let i = 0; i < 6; i++) g.tap('right');
    expect(g.cols('active')).toEqual([9]);
    g.wait(2.5);
    expect(g.rt.scripts.errors).toEqual([]);
    expect(getVar(g.board, 'cleared')).toBe(4);
    // What was above dropped four rows: column 0 (where no new piece lands) is now rows 8..19; and play goes on.
    expect(g.cells('locked').filter((c) => c.startsWith('0,'))).toHaveLength(12);
    expect(g.cells('locked').filter((c) => c.startsWith('9,'))).toHaveLength(0);
    expect(g.cells('active')).toHaveLength(4);
  });
});

function getVar(e: { scripts: { vars: Map<string, unknown> }[] } | unknown, name: string): unknown {
  const scripts = (e as { scripts?: { vars?: Map<string, unknown> | Record<string, unknown> }[] }).scripts ?? [];
  for (const s of scripts) {
    const v = s.vars instanceof Map ? s.vars.get(name) : (s.vars as Record<string, unknown> | undefined)?.[name];
    if (v !== undefined) return v;
  }
  return undefined;
}
