/**
 * Sprite sheets: detecting the cell grid and addressing cells by number.
 *
 * Cells are numbered from 1, left to right, then top to bottom, so "sprite 5"
 * means the same thing to the user, the inspector, and the AI.
 */
import type { SpriteGrid } from '../types';

export interface PixelData {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel (ImageData.data). */
  data: Uint8ClampedArray | Uint8Array;
}

export function cellCount(grid: SpriteGrid): number {
  return grid.columns * grid.rows;
}

/** Source rectangle of cell `n` (1-based). Out-of-range numbers clamp to the nearest cell. */
/** Which cell an animation shows `t` seconds in (looping). */
export function animationFrame(animation: { frames: number[]; fps: number }, t: number): number {
  const n = animation.frames.length;
  if (!n) return 1;
  if (!(animation.fps > 0) || !Number.isFinite(t)) return animation.frames[0];
  const i = Math.floor(Math.max(0, t) * animation.fps) % n;
  return animation.frames[i];
}

export function cellRect(grid: SpriteGrid, n: number): { x: number; y: number; w: number; h: number } {
  const i = Math.min(Math.max(1, Math.round(n)), cellCount(grid)) - 1;
  const col = i % grid.columns;
  const row = Math.floor(i / grid.columns);
  return {
    x: grid.offsetX + col * (grid.cellWidth + grid.spacingX),
    y: grid.offsetY + row * (grid.cellHeight + grid.spacingY),
    w: grid.cellWidth,
    h: grid.cellHeight,
  };
}

/** Problems with a grid for an image of the given size (empty when it fits). */
export function validateGrid(grid: SpriteGrid, width: number, height: number): string[] {
  const errors: string[] = [];
  for (const k of ['columns', 'rows'] as const) if (!Number.isInteger(grid[k]) || grid[k] < 1) errors.push(`${k} must be a whole number of at least 1`);
  for (const k of ['cellWidth', 'cellHeight'] as const) if (!(grid[k] > 0)) errors.push(`${k} must be more than 0`);
  for (const k of ['offsetX', 'offsetY', 'spacingX', 'spacingY'] as const) if (!(grid[k] >= 0)) errors.push(`${k} cannot be negative`);
  if (errors.length) return errors;
  const right = grid.offsetX + grid.columns * grid.cellWidth + (grid.columns - 1) * grid.spacingX;
  const bottom = grid.offsetY + grid.rows * grid.cellHeight + (grid.rows - 1) * grid.spacingY;
  if (right > width + 0.5) errors.push(`the grid is ${Math.round(right)}px wide but the image is ${width}px`);
  if (bottom > height + 0.5) errors.push(`the grid is ${Math.round(bottom)}px tall but the image is ${height}px`);
  return errors;
}

type Run = [start: number, end: number];

function runs(filled: boolean[]): Run[] {
  const out: Run[] = [];
  let start = -1;
  filled.forEach((f, i) => {
    if (f && start < 0) start = i;
    if (!f && start >= 0) {
      out.push([start, i]);
      start = -1;
    }
  });
  if (start >= 0) out.push([start, filled.length]);
  return out;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Cell layout along one axis from the runs of non-empty columns (or rows). */
function axisLayout(rs: Run[], size: number): { count: number; cell: number; offset: number; spacing: number } | null {
  if (rs.length < 2) return null;
  const starts = rs.map((r) => r[0]);
  const lengths = rs.map((r) => r[1] - r[0]);
  // Measure spacing between sprite centers: sprites of different sizes centered in equal cells start at irregular positions.
  const centers = rs.map((r) => (r[0] + r[1]) / 2);
  const pitches = centers.slice(1).map((c, i) => c - centers[i]);
  const pitch = median(pitches);
  if (!pitches.every((p) => Math.abs(p - pitch) <= 2)) return null; // irregular: not a grid
  const len = Math.max(...lengths);
  // Evenly divided sheet (the most common layout): each cell is one pitch, including any padding.
  if (pitch * rs.length === size) return { count: rs.length, cell: pitch, offset: 0, spacing: 0 };
  if (lengths.every((l) => Math.abs(l - len) <= 1)) {
    // Sprites fill their cells; the gaps are spacing between cells.
    return { count: rs.length, cell: len, offset: starts[0], spacing: Math.max(0, pitch - len) };
  }
  // Sprites of different sizes centered in equal cells: cells are one pitch wide.
  const offset = Math.max(0, Math.round(starts[0] + lengths[0] / 2 - pitch / 2));
  const count = Math.max(rs.length, Math.min(Math.floor((size - offset) / pitch), rs.length + 1));
  return { count, cell: pitch, offset, spacing: 0 };
}

/**
 * Guesses the grid of a sprite sheet:
 * 1. Empty columns/rows (transparent, or the background color of the top-left
 *    pixel) separate the sprites; their regular spacing gives the cells.
 * 2. Otherwise square cells: a horizontal or vertical strip, or the largest
 *    common size that divides the image.
 * The result is a starting point; the user can adjust every value.
 */
export function detectGrid(img: PixelData): SpriteGrid {
  const { width: w, height: h, data } = img;
  let transparent = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 16) {
      transparent = true;
      break;
    }
  }
  const bg = [data[0], data[1], data[2]];
  const empty = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    if (transparent) return data[i + 3] < 16;
    return Math.abs(data[i] - bg[0]) + Math.abs(data[i + 1] - bg[1]) + Math.abs(data[i + 2] - bg[2]) < 24;
  };
  const colFilled = Array.from({ length: w }, (_, x) => {
    for (let y = 0; y < h; y++) if (!empty(x, y)) return true;
    return false;
  });
  const rowFilled = Array.from({ length: h }, (_, y) => {
    for (let x = 0; x < w; x++) if (!empty(x, y)) return true;
    return false;
  });
  const xRuns = runs(colFilled);
  const yRuns = runs(rowFilled);
  let x = axisLayout(xRuns, w);
  let y = axisLayout(yRuns, h);

  // One axis found, the other is a single band: a strip of sprites.
  if (x && !y && yRuns.length === 1) y = { count: 1, cell: yRuns[0][1] - yRuns[0][0], offset: yRuns[0][0], spacing: 0 };
  if (y && !x && xRuns.length === 1) x = { count: 1, cell: xRuns[0][1] - xRuns[0][0], offset: xRuns[0][0], spacing: 0 };
  if (x && y) {
    return { columns: x.count, rows: y.count, cellWidth: x.cell, cellHeight: y.cell, offsetX: x.offset, offsetY: y.offset, spacingX: x.spacing, spacingY: y.spacing };
  }
  return squareGrid(w, h);
}

function squareGrid(w: number, h: number): SpriteGrid {
  const grid = (cw: number, ch: number): SpriteGrid => ({ columns: Math.max(1, Math.floor(w / cw)), rows: Math.max(1, Math.floor(h / ch)), cellWidth: cw, cellHeight: ch, offsetX: 0, offsetY: 0, spacingX: 0, spacingY: 0 });
  if (w > h && w % h === 0) return grid(h, h);
  if (h > w && h % w === 0) return grid(w, w);
  for (const size of [128, 96, 64, 48, 32, 24, 16, 8]) {
    if (w % size === 0 && h % size === 0 && (w / size) * (h / size) >= 2) return grid(size, size);
  }
  return grid(w, h);
}
