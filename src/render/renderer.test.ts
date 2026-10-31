import { describe, expect, it } from 'vitest';
import { cornerCuts, drawBackground, drawEntities, pixelPerfectZoom, tileCorners } from './renderer';


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
        // (Back to the level's own transform between things: not a thing being placed.)
        if (a === 3 && d === 3 && e === 0.4 && f === 0.7) return;
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

describe('a placed background picture', () => {
  const recorder = () => {
    const draws: number[][] = [];
    const ctx = {
      setTransform() {},
      fillRect() {},
      drawImage: (_img: unknown, x: number, y: number, w: number, h: number) => draws.push([x, y, w, h]),
      save() {},
      restore() {},
      beginPath() {},
      rect() {},
      clip() {},
      translate() {},
      set fillStyle(_v: string) {},
      set imageSmoothingEnabled(_v: boolean) {},
    } as unknown as CanvasRenderingContext2D;
    return { ctx, draws };
  };
  const world = (parallax: number) =>
    ({ gravity: { x: 0, y: 0 }, backgroundColor: '#000', background: { imageAssetId: 'bg', fit: 'placed', parallax, rect: { x: 100, y: 50, w: 320, h: 180 } } }) as never;
  const images = () => ({ source: { width: 320, height: 180 } as unknown as CanvasImageSource });
  const view = { width: 640, height: 360 };
  const start = { x: 260, y: 140 };

  it('is exactly where it was put when the level starts, whatever its movement', () => {
    for (const parallax of [0, 0.5, 1]) {
      const r = recorder();
      drawBackground(r.ctx, view, 1, world(parallax), { ...start, zoom: 1 }, images, { startCamera: start });
      // The picture's top-left corner (100, 50) seen from a camera at (260, 140) with a 640×360 view.
      expect(r.draws[0]).toEqual([100 - 260 + 320, 50 - 140 + 180, 320, 180]);
    }
  });

  it('"stays on the screen" stays put as the camera moves on; "moves with the level" goes along with the level', () => {
    const fixed = recorder();
    drawBackground(fixed.ctx, view, 1, world(0), { x: start.x + 500, y: start.y + 40, zoom: 1 }, images, { startCamera: start });
    expect(fixed.draws[0]).toEqual([160, 90, 320, 180]);
    const moving = recorder();
    drawBackground(moving.ctx, view, 1, world(1), { x: start.x + 500, y: start.y + 40, zoom: 1 }, images, { startCamera: start });
    expect(moving.draws[0]).toEqual([160 - 500, 90 - 40, 320, 180]);
  });

  it('can stay on the screen as the camera goes left and right, and move with the level up and down', () => {
    const r = recorder();
    const w = { gravity: { x: 0, y: 0 }, backgroundColor: '#000', background: { imageAssetId: 'bg', fit: 'placed', parallax: 0, parallaxY: 1, rect: { x: 100, y: 50, w: 320, h: 180 } } } as never;
    drawBackground(r.ctx, view, 1, w, { x: start.x + 500, y: start.y + 40, zoom: 1 }, images, { startCamera: start });
    // Sideways where it was on the screen; 40 px higher on the screen, as the level is.
    expect(r.draws[0]).toEqual([160, 90 - 40, 320, 180]);
  });

  it('in the editor it shows where it is in the level (to move and resize it)', () => {
    const r = recorder();
    drawBackground(r.ctx, view, 1, world(0), { x: 0, y: 0, zoom: 2 }, images, { editing: true });
    expect(r.draws[0]).toEqual([100 * 2 + 320, 50 * 2 + 180, 640, 360]);
  });
});

describe('backgrounds that move by themselves', () => {
  /** A canvas stand-in that records what is drawn. */
  const recorder = () => {
    const rects: string[] = [];
    const images: string[] = [];
    const ctx = {
      setTransform() {},
      save() {},
      restore() {},
      fillRect: (x: number, y: number, w: number) => rects.push(`${x},${y},${w}`),
      drawImage: (_i: unknown, x: number, y: number) => images.push(`${Math.round(x)},${Math.round(y)}`),
      set fillStyle(_v: string) {},
      set globalAlpha(_v: number) {},
      set imageSmoothingEnabled(_v: boolean) {},
    } as unknown as CanvasRenderingContext2D;
    return { ctx, rects, images };
  };
  const view = { width: 480, height: 270 };
  const world = (bg: Record<string, unknown>) => ({ gravity: { x: 0, y: 0 }, backgroundColor: '#000000', background: { imageAssetId: null, fit: 'cover', parallax: 0.3, ...bg } }) as never;

  it('stars: about as many as asked for, the near ones moving fastest; the same pattern every time', () => {
    const stars = { density: 15, speed: { x: 0, y: 120 }, layers: 3, color: '#ffffff' };
    const at0 = recorder();
    drawBackground(at0.ctx, view, 1, world({ stars }), { x: 0, y: 0, zoom: 1 }, () => null, { time: 0 });
    const again = recorder();
    drawBackground(again.ctx, view, 1, world({ stars }), { x: 0, y: 0, zoom: 1 }, () => null, { time: 0 });
    expect(again.rects).toEqual(at0.rects);
    // (The first rect is the background color.) 15 per 100×100: about 190 on a 480×270 view.
    expect(at0.rects.length - 1).toBeGreaterThan(120);
    expect(at0.rects.length - 1).toBeLessThan(300);
    const later = recorder();
    drawBackground(later.ctx, view, 1, world({ stars }), { x: 0, y: 0, zoom: 1 }, () => null, { time: 1 });
    expect(later.rects).not.toEqual(at0.rects);
    // None in the editor's still frame without a screen box; nothing without stars.
    const none = recorder();
    drawBackground(none.ctx, view, 1, world({}), { x: 0, y: 0, zoom: 1 }, () => null, { time: 1 });
    expect(none.rects.length).toBe(1);
  });

  it('a picture that scrolls by itself moves with play time (and repeats up and down when it scrolls that way)', () => {
    const img = { width: 64, height: 64 } as unknown as CanvasImageSource;
    const draw = (time: number) => {
      const r = recorder();
      drawBackground(r.ctx, view, 1, world({ imageAssetId: 'a', fit: 'tile', scroll: { x: 0, y: 40 } }), { x: 0, y: 0, zoom: 1 }, () => ({ source: img }) as never, { time });
      return r.images;
    };
    const ys = (list: string[]) => [...new Set(list.map((s) => Number(s.split(',')[1])))].sort((a, b) => a - b);
    // 40 px a second: half a second later every row is 20 px further down (the rows repeat every 64).
    const shift = (((ys(draw(0.5))[0] - ys(draw(0))[0]) % 64) + 64) % 64;
    expect(shift).toBe(20);
    expect(ys(draw(0)).length).toBeGreaterThan(4);
  });
});
