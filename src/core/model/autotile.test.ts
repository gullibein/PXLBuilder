import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from './factory';
import * as m from './mutations';
import { AUTOTILE_COUNT, autotileIndex, autotileLabel, makeAutotileFrames, solidTile } from './autotile';

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
});
