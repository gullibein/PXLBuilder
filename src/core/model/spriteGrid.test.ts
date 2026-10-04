import { describe, expect, it } from 'vitest';
import { cellCount, cellRect, detectGrid, validateGrid, type PixelData } from './spriteGrid';

/** Builds an RGBA image; `paint` returns [r,g,b,a] per pixel. */
function image(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]): PixelData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(paint(x, y), (y * width + x) * 4);
  return { width, height, data };
}
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];
const RED: [number, number, number, number] = [220, 40, 40, 255];

describe('sprite grid detection', () => {
  it('finds a 4x2 grid of 16px cells with smaller, centered sprites on transparency', () => {
    const img = image(64, 32, (x, y) => {
      const cx = x % 16;
      const cy = y % 16;
      const size = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 8 : 10; // sprites of different sizes
      const pad = (16 - size) / 2;
      return cx >= pad && cx < pad + size && cy >= pad && cy < pad + size ? RED : CLEAR;
    });
    expect(detectGrid(img)).toEqual({ columns: 4, rows: 2, cellWidth: 16, cellHeight: 16, offsetX: 0, offsetY: 0, spacingX: 0, spacingY: 0 });
  });

  it('handles sprites of different sizes alternating along a row', () => {
    const img = image(64, 32, (x, y) => {
      const i = Math.floor(x / 16) + 4 * Math.floor(y / 16);
      const size = i % 2 ? 8 : 12;
      const pad = (16 - size) / 2;
      return x % 16 >= pad && x % 16 < pad + size && y % 16 >= pad && y % 16 < pad + size ? RED : CLEAR;
    });
    expect(detectGrid(img)).toMatchObject({ columns: 4, rows: 2, cellWidth: 16, cellHeight: 16, offsetX: 0, offsetY: 0 });
  });

  it('finds cells separated by spacing, with a margin', () => {
    // 3 columns of 10px sprites, 2px apart, 1px margin, on an opaque background color.
    const BG: [number, number, number, number] = [255, 0, 255, 255];
    const img = image(35, 12, (x, y) => {
      const inX = x >= 1 && (x - 1) % 12 < 10 && x < 35 - 0;
      const inY = y >= 1 && y < 11;
      return inX && inY && x <= 33 ? RED : BG;
    });
    const g = detectGrid(img);
    expect(g).toMatchObject({ columns: 3, rows: 1, cellWidth: 10, cellHeight: 10, offsetX: 1, offsetY: 1, spacingX: 2 });
  });

  it('falls back to square cells for a strip with no gaps', () => {
    const img = image(96, 32, (x) => [x * 2, 100, 50, 255]);
    expect(detectGrid(img)).toMatchObject({ columns: 3, rows: 1, cellWidth: 32, cellHeight: 32 });
  });

  it('treats a single picture as one cell', () => {
    const img = image(50, 30, (x, y) => [x, y, 0, 255]);
    expect(cellCount(detectGrid(img))).toBe(1);
  });
});

describe('cells', () => {
  const grid = { columns: 3, rows: 2, cellWidth: 10, cellHeight: 8, offsetX: 1, offsetY: 2, spacingX: 2, spacingY: 1 };
  it('numbers cells from 1, across then down', () => {
    expect(cellRect(grid, 1)).toEqual({ x: 1, y: 2, w: 10, h: 8 });
    expect(cellRect(grid, 3)).toEqual({ x: 25, y: 2, w: 10, h: 8 });
    expect(cellRect(grid, 4)).toEqual({ x: 1, y: 11, w: 10, h: 8 });
    expect(cellRect(grid, 99)).toEqual(cellRect(grid, 6));
  });
  it('validates that the grid fits the image', () => {
    expect(validateGrid(grid, 35, 19)).toEqual([]);
    expect(validateGrid(grid, 30, 19)[0]).toMatch(/wide/);
    expect(validateGrid({ ...grid, columns: 0 }, 35, 19)[0]).toMatch(/columns/);
  });
});
