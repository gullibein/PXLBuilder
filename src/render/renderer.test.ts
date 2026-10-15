import { describe, expect, it } from 'vitest';
import { pixelPerfectZoom } from './renderer';


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
