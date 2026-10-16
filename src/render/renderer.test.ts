import { describe, expect, it } from 'vitest';
import { cornerCuts, drawEntities, pixelPerfectZoom, tileCorners } from './renderer';


describe('pixel-perfect zoom', () => {
  it('rounds to the zoom where each picture pixel is a whole number of canvas pixels', () => {
    expect(pixelPerfectZoom(1, 1, 1)).toBe(1);
    expect(pixelPerfectZoom(1, 1.25, 1)).toBeCloseTo(0.8); // 125% Windows scaling: 1 device pixel each
    expect(pixelPerfectZoom(1.4, 1.25, 1) * 1.25).toBeCloseTo(2); // 1.75 -> 2
    expect(pixelPerfectZoom(0.85, 1, 1)).toBe(1);
    expect(pixelPerfectZoom(0.45, 1, 1)).toBe(0.5); // smaller than a pixel: a whole fraction of one
    expect(pixelPerfectZoom(1, 1, 4)).toBe(1); // 8×8 pictures on 32-pixel tiles: 4 pixels each
    expect(pixelPerfectZoom(0.9, 1, 4)).toBe(1);
  });
});

describe('things drawn on whole pixels', () => {
  it('keep their size wherever they are (no pixel wider or narrower as they move)', () => {
    const sizes = new Set<string>();
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      setTransform: (a: number, _b: number, _c: number, d: number, e: number, f: number) => {
        sizes.add(`${a * 32}x${d * 32}`);
        expect(Number.isInteger(e - a * 16)).toBe(true); // left edge on a whole pixel
        expect(Number.isInteger(f - d * 16)).toBe(true);
      },
      getTransform: () => ({ a: 3, b: 0, c: 0, d: 3, e: 0.4, f: 0.7 }),
      canvas: { width: 1000, height: 1000 },
      fillRect() {},
      drawImage() {},
      set fillStyle(_v: string) {},
      set globalAlpha(_v: number) {},
      set imageSmoothingEnabled(_v: boolean) {},
    } as unknown as CanvasRenderingContext2D;
    for (let x = 50; x < 52; x += 0.07) {
      const entity = { id: 'e', name: 'e', definitionId: null, tags: [], tile: false, scripts: [], transform: { position: { x, y: x * 1.3 }, rotation: 0, scale: { x: 1, y: 1 } }, components: { Sprite: { assetId: null, width: 32, height: 32, color: '#fff' } } } as never;
      drawEntities(ctx, [entity], () => null, 0, 0);
    }
    expect([...sizes]).toEqual(['96x96']);
  });
});

describe('rounded tile corners', () => {
  it('pixel-art quarter circles', () => {
    expect(cornerCuts(1)).toEqual([1]);
    expect(cornerCuts(2)).toEqual([2, 1]);
    expect(cornerCuts(4)).toEqual([4, 2, 1, 1]);
  });

  it('cuts outside corners and fills the inside corners of a tunnel, each fill once', () => {
    // A block of dirt with a tunnel: "#" dirt, "." dug.
    const map = ['#####', '#...#', '#.###', '#####'];
    const at = (x: number, y: number) => map[y]?.[x] === '#';
    const corners = (x: number, y: number) => tileCorners((dx, dy) => at(x + dx, y + dy));
    // The level's own top-left corner is cut.
    expect(corners(0, 0).cut).toEqual(['tl']);
    // The dirt above the tunnel's start: the dug cell below it gets its top-left corner filled (dirt on its left and above).
    expect(corners(1, 0).fill).toEqual([{ dy: 1, corner: 'tl' }]);
    // Where the tunnel bends, the dirt on the inside of the bend has its corner cut.
    expect(corners(2, 2).cut).toEqual(['tl']);
    // Every empty cell corner with dirt on both sides is filled by exactly one tile.
    const fills = new Map<string, number>();
    for (let y = 0; y < map.length; y++)
      for (let x = 0; x < 5; x++)
        if (at(x, y)) for (const f of corners(x, y).fill) fills.set(`${x},${y + f.dy},${f.corner}`, (fills.get(`${x},${y + f.dy},${f.corner}`) ?? 0) + 1);
    expect([...fills.values()].every((n) => n === 1)).toBe(true);
    expect([...fills.keys()].sort()).toEqual(['1,1,tl', '1,2,bl', '1,2,br', '3,1,tr', '3,1,br'].sort());
  });
});

describe('rounded corners on objects that are not marked as tiles', () => {
  it('an AI-made dirt object (no tile placement) rounds its outside corners too', () => {
    let clips = 0;
    const ctx = {
      save() {},
      restore() {},
      setTransform() {},
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      canvas: { width: 1000, height: 1000 },
      beginPath() {},
      rect() {},
      clip: () => clips++,
      fillRect() {},
      drawImage() {},
      set fillStyle(_v: string) {},
      set globalAlpha(_v: number) {},
      set imageSmoothingEnabled(_v: boolean) {},
    } as unknown as CanvasRenderingContext2D;
    const dirt = (x: number, roundCorners: number) =>
      ({ id: `d${x}`, name: 'Dirt', definitionId: 'dirt', tags: [], tile: false, scripts: [], transform: { position: { x, y: 16 }, rotation: 0, scale: { x: 1, y: 1 } }, components: { Sprite: { assetId: null, width: 32, height: 32, color: '#853', roundCorners } } }) as never;
    drawEntities(ctx, [dirt(16, 2), dirt(48, 2)], () => null, 0, 0);
    expect(clips).toBe(2); // each of the two has two free corners cut
    clips = 0;
    drawEntities(ctx, [dirt(16, 0), dirt(48, 0)], () => null, 0, 0);
    expect(clips).toBe(0);
  });
});
