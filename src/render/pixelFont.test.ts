import { describe, expect, it } from 'vitest';
import { drawPixelText, fitPixelFont, FONT_10X14, FONT_20X28, FONT_5X7, pixelFontFor, pixelTextSize, scale2x, TINY_FONT } from './pixelFont';
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
  it('has the Icelandic letters: Ð Þ Æ of their own, accents in the row above', () => {
    const draw = (t: string) => {
      const r = recorder(1);
      drawPixelText(r.ctx, t, 0, 10, 1);
      return r.rects;
    };
    for (const ch of ['Ð', 'Þ', 'Æ']) expect(draw(ch)).not.toEqual(draw('?') /* not the unknown box */);
    expect(draw('Ð')).not.toEqual(draw('D'));
    // Á: the A, and one pixel above it; ö as Ö: the O and two.
    expect(draw('Á').filter(([, y]) => y === 9).reduce((n, [, , w]) => n + w, 0)).toBe(1);
    expect(draw('Á').filter(([, y]) => y >= 10)).toEqual(draw('A'));
    expect(draw('ö')).toEqual(draw('Ö'));
    expect(draw('Ö').filter(([, y]) => y === 9).reduce((n, [, , w]) => n + w, 0)).toBe(2);
  });

  it('text a game draws is in the pixel font at any size in Play (big text too)', () => {
    const r = recorder(1);
    const looks = new LookCache({ definitions: [], assets: [], settings: {} } as never, { get: () => undefined } as never);
    drawScreenDrawings(r.ctx, [{ id: 'b', shape: 'text', anchor: 'center', x: 0, y: 0, w: 0, h: 0, text: 'BORÐ 2', size: 28, color: '#fff', object: null, alpha: 1, order: 0 } as never], 'screen', { width: 800, height: 600 }, looks, () => null, 0, { cell: 1, lowRes: false });
    expect(r.texts()).toBe(0);
    expect(r.rects.length).toBeGreaterThan(12);
  });

  it("the game's font fits its sprite size: tiny for 8×8, 5×7 for 16×16, finer (smoothed, twice and four times) for 32 and 64", () => {
    expect([8, 16, 32, 64].map((r) => pixelFontFor(r).name)).toEqual(['tiny 3×5', '5×7', '10×14', '20×28']);
    expect(pixelFontFor(undefined)).toBe(FONT_10X14);
    // The bigger fonts have more detail, not bigger blocks: a curve doubled (Scale2x) is rounded, not a staircase.
    expect(scale2x(['#.', '.#'])).toEqual(['##..', '###.', '.###', '..##']);
    expect(FONT_10X14.bitmap('O').rows).toHaveLength(14);
    expect(FONT_20X28.bitmap('O').rows[0].length).toBe(20);
    // Small letters in the 5×7 font and up (the tiny one draws them as capitals).
    expect(FONT_5X7.bitmap('a').rows).not.toEqual(FONT_5X7.bitmap('A').rows);
    expect(TINY_FONT.bitmap('a').rows).toEqual(TINY_FONT.bitmap('A').rows);
    // Icelandic: þ ð æ and accents in each.
    for (const ch of ['þ', 'ð', 'æ', 'Þ', 'Ð', 'Æ', 'á', 'Ó', 'ö']) expect(FONT_5X7.bitmap(ch).rows).not.toEqual(FONT_5X7.bitmap('?').rows);
    expect(FONT_5X7.bitmap('Á').top).toBe(-3);
    expect(FONT_5X7.bitmap('Ö').top).toBe(-2);
    expect(pixelTextSize('Hi', FONT_5X7)).toEqual({ w: 11, h: 7 });
  });

  it('big text uses the game\'s own font; text too small for it steps down to a smaller one, never below a picture pixel', () => {
    // A 32×32-sprite game, a picture pixel 2 canvas pixels: a 40 px title in the 10×14 font, 2 per font pixel...
    expect(fitPixelFont(40, 2, FONT_10X14)).toEqual({ font: FONT_10X14, scale: 2 });
    // ...a 20 px label in the 5×7 one, a 12 px one in the tiny one; 8×8 sprites: the tiny font whatever the size, in whole picture pixels.
    expect(fitPixelFont(20, 2, FONT_10X14)).toEqual({ font: FONT_5X7, scale: 2 });
    expect(fitPixelFont(12, 2, FONT_10X14)).toEqual({ font: TINY_FONT, scale: 2 });
    expect(fitPixelFont(60, 8, TINY_FONT)).toEqual({ font: TINY_FONT, scale: 8 });
    // Never a more detailed font than the game's own.
    expect(fitPixelFont(200, 1, FONT_5X7).font).toBe(FONT_5X7);
  });

  it('3×5 characters, 4 pixels apart, 6 pixels a line; lower case drawn as capitals', () => {
    expect(pixelTextSize('HI')).toEqual({ w: 7, h: 5 });
    expect(pixelTextSize('ab\ncd')).toEqual({ w: 7, h: 11 });
    const a = recorder(1);
    drawPixelText(a.ctx, 'i', 0, 0, 1);
    const b = recorder(1);
    drawPixelText(b.ctx, 'I', 0, 0, 1);
    expect(a.rects).toEqual(b.rects);
    // "I": a bar on top and bottom and a stem: 3 + 3 + 3 pixels, each one whole pixel.
    expect(a.rects.reduce((n, [, , w]) => n + w, 0)).toBe(9);
    expect(a.rects.every(([, , , h]) => h === 1)).toBe(true);
  });

  it('text that would be a few pixels tall (a game at a low resolution) is drawn in the pixel font; large text is not', () => {
    const drawing = (size: number) => ({ id: 't', shape: 'text', anchor: 'top_left', x: 4, y: 4, w: 0, h: 0, text: 'SCORE 10', size, color: '#fff', object: null, alpha: 1, order: 0 }) as never;
    const looks = new LookCache({ definitions: [] } as never, {} as never);
    // 128 pixels tall on an 860 px screen: about 0.15 canvas pixels per screen pixel.
    const small = recorder(0.15);
    drawScreenDrawings(small.ctx, [drawing(14)], 'screen', { width: 1400, height: 860 }, looks, () => null);
    expect(small.texts()).toBe(0);
    expect(small.rects.length).toBeGreaterThan(12);
    expect(small.rects.every(([x, y, w, h]) => Number.isInteger(x) && Number.isInteger(y) && Number.isInteger(w) && h === 1)).toBe(true);
    const sharp = recorder(1);
    drawScreenDrawings(sharp.ctx, [drawing(14)], 'screen', { width: 1400, height: 860 }, looks, () => null);
    expect(sharp.texts()).toBe(2); // (with its shadow)
  });
});
