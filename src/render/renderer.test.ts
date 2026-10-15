import { describe, expect, it } from 'vitest';
import { drawEntities, pixelPerfectZoom } from './renderer';


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
