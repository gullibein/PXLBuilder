import { describe, expect, it } from 'vitest';
import { isoDrawingProblem } from './ai/isoDrawing';
import type { Operation } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { isoBlockFromFlat, looksFlat } from './model/isoBlockArt';
import { createIsometricProject } from './model/isometricStarter';
import { ISO_TILES } from './model/isoTiles';

const registry = createBuiltinRegistry();
const flatGrass = { palette: [{ key: 'g', color: '#5cc84a' }, { key: 'G', color: '#3e9a34' }], rows: Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => ((x * 3 + y * 5) % 7 === 0 ? 'G' : 'g')).join('')) };

describe('isometric block pictures', () => {
  it('the ready-made blocks are blocks; a square seen from above is flat', () => {
    for (const name of ['Grass', 'Dirt', 'Water', 'Wood', 'Island Corner North', 'Road Turn SE-SW']) expect(looksFlat(ISO_TILES[name])).toBe(false);
    expect(looksFlat(flatGrass)).toBe(true);
  });

  it('a flat drawing becomes a block: the drawing on the diamond top, shaded sides, empty corners', () => {
    const block = isoBlockFromFlat(flatGrass)!;
    expect(block.rows).toHaveLength(16);
    expect(block.rows.every((r) => r.length === 16)).toBe(true);
    expect(looksFlat(block)).toBe(false);
    const color = (x: number, y: number) => block.palette.find((p) => p.key === block.rows[y][x])?.color;
    // The top's middle is the grass; the sides below it darker; the corners empty.
    expect(color(8, 4)).toMatch(/^#(5cc84a|3e9a34)$/);
    expect(block.rows[0][0]).toBe('.');
    expect(block.rows[15][0]).toBe('.');
    const lum = (c: string | undefined) => (c ? parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16) : 0);
    expect(lum(color(4, 10))).toBeLessThan(lum('#3e9a34') + 1);
    expect(lum(color(12, 10))).toBeLessThan(lum(color(4, 10)));
  });

  it('an AI answer drawing a block flat, or restyling an auto-tiled one without its shapes, is sent back', () => {
    const project = createIsometricProject(registry);
    const id = (n: string) => project.definitions.find((d) => d.name === n)!.id;
    const draw = (n: string, art: { palette: { key: string; color: string }[]; rows: string[] }, isoShape: string | null = null): Operation =>
      ({ op: 'draw_sprite', target: 'definition', id: id(n), name: n, palette: art.palette, rows: art.rows, frames: null, fps: null, situation: null, isoShape }) as Operation;
    const flat = isoDrawingProblem(project, [draw('Snow', flatGrass)]);
    expect(flat).toMatch(/Snow was drawn flat/);
    // Grass restyled as a block, but its corners and variation left as they were.
    const shapes = isoDrawingProblem(project, [draw('Grass', ISO_TILES.Grass), draw('Grass', ISO_TILES['Island Corner North'], 'corner_north')]);
    expect(shapes).toMatch(/Grass \(corner_east, corner_south, corner_west, variation\)/);
    expect(shapes).not.toMatch(/flat/);
    // All of it, as blocks: fine.
    const all = ['corner_north', 'corner_east', 'corner_south', 'corner_west', 'variation'].map((k) => draw('Grass', ISO_TILES['Island Corner North'], k));
    expect(isoDrawingProblem(project, [draw('Grass', ISO_TILES.Grass), ...all])).toBeNull();
  });
});
