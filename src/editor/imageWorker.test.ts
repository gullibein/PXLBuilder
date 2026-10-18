import { describe, expect, it } from 'vitest';
import { backgroundPixels, paletteFor, toPalette, validWorkerUrl } from './imageWorker';

describe('generated backgrounds at the game\'s pixels', () => {
  it("are as tall as the game's resolution, or the screen in the game's picture pixels", () => {
    expect(backgroundPixels(128, 8)).toBe(128);
    expect(backgroundPixels(null, 8)).toBe(180); // 8×8 sprites: 4 level pixels each
    expect(backgroundPixels(null, 32)).toBe(720);
  });

  it('are brought down to a small palette of their own most common colors', () => {
    // A smooth gradient of 256 grays, and some red.
    const data = new Uint8ClampedArray(300 * 4);
    for (let i = 0; i < 256; i++) data.set([i, i, i, 255], i * 4);
    for (let i = 256; i < 300; i++) data.set([220, 30, 30, 255], i * 4);
    const palette = paletteFor(data, 8);
    expect(palette.length).toBeLessThanOrEqual(8);
    toPalette(data, palette);
    const colors = new Set<string>();
    for (let i = 0; i < data.length; i += 4) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    expect(colors.size).toBeLessThanOrEqual(8);
    expect(colors.has(palette.find((c) => c[0] > 150 && c[1] < 80)!.join(','))).toBe(true); // the red kept
  });

  it('only take a real web address for the generator', () => {
    expect(validWorkerUrl('https://pxl-image.example.workers.dev')).toBe(true);
    expect(validWorkerUrl('http://localhost:8787')).toBe(true);
    expect(validWorkerUrl('http://example.com')).toBe(false);
    expect(validWorkerUrl('not a url')).toBe(false);
  });
});
