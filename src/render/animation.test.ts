import { describe, expect, it } from 'vitest';
import { createAnimatedPixelArtAsset, pixelArtFields } from '../core/model/factory';
import { animationFrame } from '../core/model/spriteGrid';
import { drawEntities, type ImageLookup } from './renderer';

const palette = [{ key: 'a', color: '#ff0000' }];
const f1 = ['a.', '.a'];
const f2 = ['.a', 'a.'];

describe('animated sprites', () => {
  it('animationFrame loops through the cells at fps', () => {
    const anim = { frames: [3, 4, 5], fps: 10 };
    expect(animationFrame(anim, 0)).toBe(3);
    expect(animationFrame(anim, 0.15)).toBe(4);
    expect(animationFrame(anim, 0.25)).toBe(5);
    expect(animationFrame(anim, 0.35)).toBe(3);
    expect(animationFrame({ frames: [2], fps: 0 }, 9)).toBe(2);
  });

  it('one frame of pixel art is a plain image; several are a sheet of frames side by side that plays', () => {
    const one = pixelArtFields(palette, [f1]);
    expect(one.kind).toBe('image');
    expect(one.animation).toBeUndefined();
    const two = createAnimatedPixelArtAsset('Blink', palette, [f1, f2], 6);
    expect(two.kind).toBe('spritesheet');
    expect([two.width, two.height]).toEqual([4, 2]);
    expect(two.grid).toMatchObject({ columns: 2, rows: 1, cellWidth: 2, cellHeight: 2 });
    expect(two.animation).toEqual({ frames: [1, 2], fps: 6 });
    expect(two.pixelArt!.frames).toEqual([f1, f2]);
    expect(two.pixelArt!.rows).toEqual(f1);
  });

  it('the renderer draws the cell for the clock, and Sprite.frame when not animated', () => {
    const drawn: number[] = [];
    const ctx = {
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      setTransform() {},
      getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
      canvas: { width: 1000, height: 1000 },
      fillRect() {},
      drawImage: (_s: unknown, sx: number) => drawn.push(sx),
      set fillStyle(_v: string) {},
      set globalAlpha(_v: number) {},
      set imageSmoothingEnabled(_v: boolean) {},
    } as unknown as CanvasRenderingContext2D;
    const grid = { columns: 4, rows: 1, cellWidth: 10, cellHeight: 10, offsetX: 0, offsetY: 0, spacingX: 0, spacingY: 0 };
    const entity = { id: 'e', name: 'e', definitionId: null, tags: [], tile: false, scripts: [], transform: { position: { x: 50, y: 50 }, rotation: 0, scale: { x: 1, y: 1 } }, components: { Sprite: { assetId: 'a', width: 10, height: 10, frame: 2 } } } as never;
    const animated: ImageLookup = () => ({ source: {} as CanvasImageSource, grid, animation: { frames: [1, 2, 3, 4], fps: 4 } });
    drawEntities(ctx, [entity], animated, 0, 0);
    drawEntities(ctx, [entity], animated, 0, 0.6);
    const still: ImageLookup = () => ({ source: {} as CanvasImageSource, grid });
    drawEntities(ctx, [entity], still, 0, 0.6);
    // Cell x offsets: frame 1 → 0, frame 3 → 20; not animated: Sprite.frame 2 → 10.
    expect(drawn).toEqual([0, 20, 10]);
  });
});
