import { describe, expect, it } from 'vitest';
import { drawPixelText, pixelTextSize } from './pixelFont';
import { drawScreenDrawings, LookCache } from './screen';

/** A context that records the squares filled (and whether any ordinary text was drawn). */
function recorder(scale: number) {
  const rects: number[][] = [];
  let text = 0;
  let t = { a: scale, b: 0, c: 0, d: scale, e: 0, f: 0 };
  const ctx = {
    save() {},
    restore() {},
    getTransform: () => t,
    setTransform: (a: number, b: number, c: number, d: number, e: number, f: number) => (t = { a, b, c, d, e, f }),
    fillRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
    fillText: () => text++,
    beginPath() {},
    ellipse() {},
    fill() {},
    set fillStyle(_v: string) {},
    set font(_v: string) {},
    set textAlign(_v: string) {},
    set textBaseline(_v: string) {},
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
  return { ctx, rects, texts: () => text };
}

describe('the pixel font', () => {
  it('3×5 characters, 4 pixels apart, 6 pixels a line; lower case drawn as capitals', () => {
    expect(pixelTextSize('HI')).toEqual({ w: 7, h: 5 });
    expect(pixelTextSize('ab\ncd')).toEqual({ w: 7, h: 11 });
    const a = recorder(1);
    drawPixelText(a.ctx, 'i', 0, 0, 1);
    const b = recorder(1);
    drawPixelText(b.ctx, 'I', 0, 0, 1);
    expect(a.rects).toEqual(b.rects);
    // "I": a bar on top and bottom and a stem: 3 + 3 + 3 pixels, each one whole pixel.
    expect(a.rects).toHaveLength(9);
    expect(a.rects.every(([, , w, h]) => w === 1 && h === 1)).toBe(true);
  });

  it('text that would be a few pixels tall (a game at a low resolution) is drawn in the pixel font; large text is not', () => {
    const drawing = (size: number) => ({ id: 't', shape: 'text', anchor: 'top_left', x: 4, y: 4, w: 0, h: 0, text: 'SCORE 10', size, color: '#fff', object: null, alpha: 1, order: 0 }) as never;
    const looks = new LookCache({ definitions: [] } as never, {} as never);
    // 128 pixels tall on an 860 px screen: about 0.15 canvas pixels per screen pixel.
    const small = recorder(0.15);
    drawScreenDrawings(small.ctx, [drawing(14)], 'screen', { width: 1400, height: 860 }, looks, () => null);
    expect(small.texts()).toBe(0);
    expect(small.rects.length).toBeGreaterThan(20);
    expect(small.rects.every(([x, y, w, h]) => Number.isInteger(x) && Number.isInteger(y) && w === 1 && h === 1)).toBe(true);
    const sharp = recorder(1);
    drawScreenDrawings(sharp.ctx, [drawing(14)], 'screen', { width: 1400, height: 860 }, looks, () => null);
    expect(sharp.texts()).toBe(2); // (with its shadow)
  });
});
