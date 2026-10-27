import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from './factory';
import * as m from './mutations';
import { AUTOTILE_COUNT, autotileIndex, autotileLabel, makeAutotileFrames, pictureEdges, solidTile } from './autotile';

const registry = createBuiltinRegistry();

describe('autotiling', () => {
  it('a tile picks one of 16 pictures from its four neighbours (up 1, right 2, down 4, left 8)', () => {
    const map = ['.##.', '####', '.#..'];
    const at = (x: number, y: number) => map[y]?.[x] === '#';
    const index = (x: number, y: number) => autotileIndex((dx, dy) => at(x + dx, y + dy));
    // The top-left tile of the block: something right and below.
    expect(index(1, 0)).toBe(2 + 4);
    // In the middle row, second: up, right, down, left all there.
    expect(index(1, 1)).toBe(15);
    // The end of the middle row: only something left.
    expect(index(3, 1)).toBe(8);
    expect(index(1, 2)).toBe(1);
    expect(autotileLabel(0)).toBe('on its own');
    expect(autotileLabel(2 + 8)).toBe('joined right and left');
    expect(autotileLabel(15)).toBe('joined all round');
  });

  it('the 16 pictures: open sides get a darker edge, an open top a lighter band, open corners are cut', () => {
    const { palette, frames } = makeAutotileFrames(solidTile('#808080', 8, 8), { edge: 'outline', top: 'light', round: true });
    expect(frames).toHaveLength(AUTOTILE_COUNT);
    const color = (frame: number, x: number, y: number) => {
      const ch = frames[frame][y][x];
      return ch === '.' ? null : palette.find((p) => p.key === ch)!.color;
    };
    // Joined all round: just the tile.
    expect(new Set(frames[15].join(''))).toEqual(new Set(['a']));
    // On its own: a lighter top, darker sides and bottom, cut corners.
    expect(color(0, 3, 0)).toBe('#a6a6a6');
    expect(color(0, 3, 7)).toBe('#535353');
    expect(color(0, 0, 3)).toBe('#535353');
    expect(color(0, 0, 0)).toBeNull();
    expect(color(0, 7, 7)).toBeNull();
    // Joined left and right (a platform's middle): top and bottom edges only, no corners cut, the sides plain.
    expect(color(2 + 8, 0, 0)).toBe('#a6a6a6');
    expect(color(2 + 8, 0, 3)).toBe('#808080');
    // Grass on the open top.
    const grass = makeAutotileFrames(solidTile('#7a5230', 8, 8), { edge: 'none', top: 'grass', round: false });
    expect(grass.palette.find((p) => p.key === grass.frames[4][1][0])!.color).toBe('#5bbd4a');
    expect(grass.frames[1][1][0]).toBe('a');
  });

  it("an object is made to autotile (from its color, at the game's pixel size), and can be turned off and on", () => {
    let project = createProject(registry);
    const platform = project.definitions.find((d) => d.name === 'Platform')!.id;
    project = produce(project, (d) => void m.makeAutotile(d, platform, { edge: 'outline', top: 'light', round: true }, registry));
    const sprite = project.definitions.find((d) => d.id === platform)!.components.Sprite;
    expect(sprite.autotile).toBe(true);
    const sheet = project.assets.find((a) => a.id === sprite.autotileSheet)!;
    expect(sheet).toMatchObject({ autotile: true, kind: 'spritesheet' });
    expect(sheet.pixelArt!.frames).toHaveLength(16);
    expect(sheet.animation).toBeUndefined();
    // Made again in another style: the same sheet, changed in place.
    const again = produce(project, (d) => void m.makeAutotile(d, platform, { edge: 'none', top: 'grass', round: false }, registry));
    expect(again.assets.filter((a) => a.autotile)).toHaveLength(1);
    // Saved by the sprite editor: still not an animation.
    const edited = produce(again, (d) => m.updatePixelArtAsset(d, sheet.id, sheet.pixelArt!.palette, sheet.pixelArt!.frames!, 8));
    expect(edited.assets.find((a) => a.id === sheet.id)!.animation).toBeUndefined();
    const off = produce(again, (d) => m.setAutotile(d, platform, false));
    expect(off.definitions.find((d) => d.id === platform)!.components.Sprite.autotile).toBe(false);
    expect(() => produce(createProject(registry), (d) => m.setAutotile(d, d.definitions.find((x) => x.name === 'Platform')!.id, true))).toThrow(/no autotile pictures/);
  });

  it('the AI draws some or all of the pictures (draw_autotile): the others stay, colors merge, it turns on', () => {
    let project = createProject(registry);
    const platform = project.definitions.find((d) => d.name === 'Platform')!.id;
    project = produce(project, (d) => void m.makeAutotile(d, platform, { edge: 'outline', top: 'light', round: true }, registry));
    const sheetOf = (p: typeof project) => p.assets.find((a) => a.id === p.definitions.find((d) => d.id === platform)!.components.Sprite.autotileSheet)!;
    const before = sheetOf(project).pixelArt!;
    const size = before.rows[0].length;
    // Picture 10 (joined left and right) as stone: two colors, one of them under a key the sheet uses for another color.
    const stone = Array.from({ length: before.rows.length }, (_, y) => (y % 4 === 0 ? 'b' : 'a').repeat(size));
    const after = produce(project, (d) => m.drawAutotileTiles(d, platform, [{ key: 'a', color: '#777788' }, { key: 'b', color: '#444455' }], [{ index: 10, rows: stone }], registry));
    const art = sheetOf(after).pixelArt!;
    const color = (frame: number, x: number, y: number) => art.palette.find((p) => p.key === art.frames![frame][y][x])?.color;
    expect(color(10, 0, 1)).toBe('#777788');
    expect(color(10, 0, 0)).toBe('#444455');
    // The others as they were.
    expect(art.frames![15]).toEqual(before.frames![15].map((r) => [...r].map((ch) => art.palette.find((p) => p.color === before.palette.find((q) => q.key === ch)!.color)!.key).join('')));
    expect(sheetOf(after).animation).toBeUndefined();
    // Wrong size: refused with the size to use.
    expect(() => produce(project, (d) => m.drawAutotileTiles(d, platform, [{ key: 'a', color: '#777788' }], [{ index: 0, rows: ['aa', 'aa'] }], registry))).toThrow(new RegExp(`${size}×${size} pixels`));
    // An object without pictures yet: made first, then drawn; autotiling on.
    const fresh = createProject(registry);
    const stoneDef = fresh.definitions.find((d) => d.name === 'Stone')!.id;
    const drawn = produce(fresh, (d) => m.drawAutotileTiles(d, stoneDef, [{ key: 'a', color: '#777788' }], [{ index: 0, rows: Array.from({ length: size }, () => 'a'.repeat(size)) }], registry));
    expect(drawn.definitions.find((d) => d.id === stoneDef)!.components.Sprite.autotile).toBe(true);
  });

  it("a picture with its own grass on top: the grass only where the top is open, the dirt's pattern continued where a tile is above", () => {
    // 16×16 dirt in a checkerboard of 4-pixel squares, grass painted along the top 3 rows, the top corners rounded.
    const rows = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => {
        if (y < 3) return (y === 0 && (x === 0 || x === 15)) ? '.' : y === 0 ? 'g' : 'G';
        return (Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? 'b' : 'B';
      }).join(''),
    );
    const base = { palette: [{ key: 'g', color: '#7ad05a' }, { key: 'G', color: '#4caf3c' }, { key: 'b', color: '#a0522d' }, { key: 'B', color: '#c06a30' }], rows };
    expect(pictureEdges(base)).toMatchObject({ top: 3, bottom: 0, left: 0, right: 0 });
    // (Even with "grass" chosen: the picture's own grass is the top.)
    const { palette, frames } = makeAutotileFrames(base, { edge: 'none', top: 'grass', round: false });
    const colorOf = (f: number, x: number, y: number) => palette.find((p) => p.key === frames[f][y][x])?.color ?? null;
    const green = (c: string | null) => c === '#7ad05a' || c === '#4caf3c' || c === '#5bbd4a' || (c !== null && c.startsWith('#8'));
    // Open top (0: alone, 10: a platform's middle): its grass.
    expect(colorOf(10, 5, 1)).toBe('#4caf3c');
    expect(colorOf(0, 5, 0)).toBe('#7ad05a');
    // A tile above (1, 5, 15): no grass anywhere, and no cut corners at the top.
    for (const f of [1, 5, 11, 15]) {
      for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) expect(green(colorOf(f, x, y)), `picture ${f} at ${x},${y}`).toBe(false);
      expect(colorOf(f, 0, 0)).not.toBeNull();
    }
    // A platform's middle (10, joined left and right): its grass runs from edge to edge (no cut corners between tiles);
    // on its own (0) the corners stay round.
    expect(frames[10][0]).toMatch(/^g+$/);
    expect(frames[0][0][0]).toBe('.');
    // The checkerboard carries on through where the grass was: row 0 is like row 8 (it repeats every 8 rows).
    expect(frames[15][0]).toBe(frames[15][8]);
    expect(frames[15][2]).toBe(frames[15][10]);
  });
});
