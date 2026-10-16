import { describe, expect, it } from 'vitest';
import { componentRegistry } from '../core/components/builtin';
import { drawBuiltinHud } from './hud';
import { drawScreenDrawings, LookCache, onGrid } from './screen';

/** A context that records what is drawn: filled boxes and pictures, in canvas pixels. */
function recorder() {
  const rects: number[][] = [];
  const pictures: number[][] = [];
  let texts = 0;
  let t = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const stack: (typeof t)[] = [];
  const ctx = {
    save: () => stack.push(t),
    restore: () => (t = stack.pop() ?? t),
    getTransform: () => t,
    setTransform: (a: number | object, b = 0, c = 0, d = 1, e = 0, f = 0) => (t = typeof a === 'object' ? (a as typeof t) : { a, b, c, d, e, f }),
    fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
    drawImage: (...a: number[]) => {
      const [x, y, w, h] = a.slice(-4);
      pictures.push([x * t.a + t.e, y * t.d + t.f, w * t.a, h * t.d]);
    },
    fillText: () => texts++,
    beginPath() {},
    ellipse() {},
    fill() {},
    clip() {},
    rect() {},
    translate() {},
    rotate() {},
    scale() {},
    canvas: { width: 220, height: 130 },
    globalAlpha: 1,
    set fillStyle(_v: string) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    set imageSmoothingEnabled(_v: boolean) {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, pictures, texts: () => texts, setT: (m: typeof t) => (t = m) };
}

const art8 = { source: { width: 8, height: 8 } as unknown as CanvasImageSource };
const project = { definitions: [{ id: 'heart', name: 'Heart', tags: [], metadata: {}, components: { Sprite: { assetId: 'h', width: 32, height: 32, color: '#f00' } }, scripts: [] }], assets: [], settings: {} } as never;

describe("everything over the game keeps to the game's pixel grid", () => {
  it('a picture is drawn a whole number of grid cells per picture pixel, whatever size was asked', () => {
    expect(onGrid(8, 37, 1)).toBe(40); // 8×8 at 5 canvas pixels per picture pixel
    expect(onGrid(8, 3, 1)).toBe(8); // never smaller than one cell per pixel
    expect(onGrid(16, 50, 2)).toBe(64);
  });

  it("script drawings in a low-resolution game: pictures on the grid, boxes in whole cells, text in the pixel font", () => {
    const looks = new LookCache(project, componentRegistry);
    const r = recorder();
    // 128 game pixels on an 860 px tall screen: 0.149 canvas pixels per screen pixel.
    r.setT({ a: 0.149, b: 0, c: 0, d: 0.149, e: 0, f: 0 });
    const d = (shape: string, extra: object) => ({ id: shape, shape, anchor: 'top_left', x: 16, y: 16, w: 50, h: 50, text: 'SCORE', size: 40, color: '#fff', object: 'heart', alpha: 1, order: 0, ...extra }) as never;
    drawScreenDrawings(r.ctx, [d('sprite', {}), d('rect', { w: 33, h: 9 }), d('text', {})], 'screen', { width: 1400, height: 860 }, looks, () => art8, 0, { cell: 1, lowRes: true });
    expect(r.texts()).toBe(0); // (40 px text too: the pixel font in a game with its own resolution)
    expect(r.pictures.length).toBe(1);
    const [, , w, h] = r.pictures[0];
    expect([w, h]).toEqual([8, 8]); // 50 screen px ≈ 7.5 game pixels: the 8×8 picture at one game pixel each
    expect(r.rects.every(([x, y, rw, rh]) => [x, y, rw, rh].every(Number.isInteger))).toBe(true);
  });

  it("the player's hearts are the Heart object, drawn the size it is in the level, on the grid", () => {
    const looks = new LookCache(project, componentRegistry);
    const heart = looks.get('heart');
    const r = recorder();
    // An 8-pixel game: 32 level pixels a tile, a quarter canvas pixel per level pixel → one canvas pixel per picture pixel.
    drawBuiltinHud(r.ctx, { health: { current: 2, max: 3 }, items: [], message: null, banner: null }, { width: 220, height: 130, grid: { cell: 1, lowRes: true }, levelScale: 0.25, cssPx: 0.149 }, heart, () => art8);
    expect(r.pictures.length).toBe(3);
    expect(r.pictures.map((p) => p.slice(2))).toEqual([[8, 8], [8, 8], [8, 8]]);
    // In a row, one game pixel apart.
    expect(r.pictures.map((p) => p[0])).toEqual([2, 11, 20]);
  });
});
