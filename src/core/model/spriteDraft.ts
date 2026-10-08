/**
 * A sprite being drawn in the sprite editor: its size, palette, frames and
 * speed, as plain data, with the edits the editor makes (each returns a new
 * draft, so the editor's own undo is a list of drafts). Saved as pixel art
 * (pixelArtFields): one frame is a picture, several an animation.
 */
import type { AssetRecord } from '../types';
import { MAX_PIXEL_SIDE, type PixelArt } from './pixelArt';

export interface SpriteDraft {
  width: number;
  height: number;
  palette: PixelArt['palette'];
  /** Each frame: `height` rows of `width` palette keys ("." = transparent). */
  frames: string[][];
  fps: number;
}

/** Keys new colors get, in order. */
const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
export const MAX_COLORS = KEYS.length;

export function blankDraft(width: number, height: number): SpriteDraft {
  const w = clampSide(width);
  const h = clampSide(height);
  // A few clear colors to start with (more can be added), the first one bright so the first strokes show.
  const palette = ['#4fa3ff', '#ffffff', '#1b1430', '#e5534b', '#5fd068', '#f2c94c'].map((color, i) => ({ key: KEYS[i], color }));
  return { width: w, height: h, palette, frames: [Array.from({ length: h }, () => '.'.repeat(w))], fps: 8 };
}

const clampSide = (n: number) => Math.max(1, Math.min(MAX_PIXEL_SIDE, Math.round(n) || 1));

/** The draft for a pixel-art asset (all its frames), or null if it has no pixels to edit. */
export function draftFromAsset(asset: AssetRecord): SpriteDraft | null {
  const art = asset.pixelArt;
  if (!art || !art.rows.length) return null;
  const frames = art.frames?.length ? art.frames : [art.rows];
  return { width: frames[0][0].length, height: frames[0].length, palette: art.palette.map((p) => ({ ...p })), frames: frames.map((f) => [...f]), fps: asset.animation?.fps ?? 8 };
}

/**
 * The draft for an ordinary image's pixels (an imported PNG): each color
 * becomes a palette entry, mostly-transparent pixels are transparent. Null
 * with the reason when it is too big or has too many colors to edit as
 * pixel art.
 */
export function draftFromPixels(data: Uint8ClampedArray, width: number, height: number): SpriteDraft | { error: string } {
  if (width > MAX_PIXEL_SIDE || height > MAX_PIXEL_SIDE) return { error: `It is ${width}×${height}; the sprite editor works on pictures up to ${MAX_PIXEL_SIDE}×${MAX_PIXEL_SIDE} pixels` };
  const keyOf = new Map<string, string>();
  const palette: PixelArt['palette'] = [];
  const rows: string[] = [];
  for (let y = 0; y < height; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (data[i + 3] < 128) {
        row += '.';
        continue;
      }
      const color = `#${[data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      let key = keyOf.get(color);
      if (!key) {
        if (palette.length >= MAX_COLORS) return { error: `It has more than ${MAX_COLORS} colors; the sprite editor edits pixel art with fewer colors` };
        key = KEYS[palette.length];
        keyOf.set(color, key);
        palette.push({ key, color });
      }
      row += key;
    }
    rows.push(row);
  }
  return { width, height, palette, frames: [rows], fps: 8 };
}

const put = (row: string, x: number, key: string) => row.slice(0, x) + key + row.slice(x + 1);

/** Sets one pixel ("." erases). */
export function setPixel(d: SpriteDraft, frame: number, x: number, y: number, key: string): SpriteDraft {
  if (x < 0 || y < 0 || x >= d.width || y >= d.height || d.frames[frame]?.[y]?.[x] === key) return d;
  const frames = d.frames.slice();
  const rows = frames[frame].slice();
  rows[y] = put(rows[y], x, key);
  frames[frame] = rows;
  return { ...d, frames };
}

/** Sets the pixels on the straight line between two points (a quick drag leaves no gaps). */
export function drawLine(d: SpriteDraft, frame: number, x0: number, y0: number, x1: number, y1: number, key: string): SpriteDraft {
  let out = d;
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
  for (let i = 0; i <= n; i++) out = setPixel(out, frame, Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), key);
  return out;
}

/** Fills the area of same-colored pixels around (x, y) that touch side by side. */
export function fill(d: SpriteDraft, frame: number, x: number, y: number, key: string): SpriteDraft {
  const rows = d.frames[frame].map((r) => [...r]);
  const from = rows[y]?.[x];
  if (from === undefined || from === key) return d;
  const stack: [number, number][] = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop()!;
    if (cx < 0 || cy < 0 || cx >= d.width || cy >= d.height || rows[cy][cx] !== from) continue;
    rows[cy][cx] = key;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  const frames = d.frames.slice();
  frames[frame] = rows.map((r) => r.join(''));
  return { ...d, frames };
}

/** Adds a color (or finds it if it is already there); returns its key. */
export function addColor(d: SpriteDraft, color: string): { draft: SpriteDraft; key: string } | { error: string } {
  const c = color.toLowerCase();
  const existing = d.palette.find((p) => p.color.toLowerCase() === c);
  if (existing) return { draft: d, key: existing.key };
  const key = [...KEYS].find((k) => !d.palette.some((p) => p.key === k));
  if (!key) return { error: `At most ${MAX_COLORS} colors` };
  return { draft: { ...d, palette: [...d.palette, { key, color: c }] }, key };
}

/** Changes a palette color: every pixel of it changes, in every frame. */
export function recolor(d: SpriteDraft, key: string, color: string): SpriteDraft {
  return { ...d, palette: d.palette.map((p) => (p.key === key ? { ...p, color: color.toLowerCase() } : p)) };
}

/** A new frame after `after`: a copy of it (to change a little), or empty. */
export function addFrame(d: SpriteDraft, after: number, copy: boolean): SpriteDraft {
  const frame = copy ? [...d.frames[after]] : Array.from({ length: d.height }, () => '.'.repeat(d.width));
  const frames = d.frames.slice();
  frames.splice(after + 1, 0, frame);
  return { ...d, frames };
}

export function removeFrame(d: SpriteDraft, i: number): SpriteDraft {
  if (d.frames.length <= 1) return d;
  return { ...d, frames: d.frames.filter((_, j) => j !== i) };
}

/** Moves frame i one place earlier (-1) or later (+1). */
export function moveFrame(d: SpriteDraft, i: number, by: -1 | 1): SpriteDraft {
  const j = i + by;
  if (j < 0 || j >= d.frames.length) return d;
  const frames = d.frames.slice();
  [frames[i], frames[j]] = [frames[j], frames[i]];
  return { ...d, frames };
}

/** A new size: pixels keep their place from the top left; new space is transparent. */
export function resize(d: SpriteDraft, width: number, height: number): SpriteDraft {
  const w = clampSide(width);
  const h = clampSide(height);
  const frames = d.frames.map((f) => Array.from({ length: h }, (_, y) => (f[y] ?? '').slice(0, w).padEnd(w, '.')));
  return { ...d, width: w, height: h, frames };
}

/** Only the colors the frames use (saved art stays small and clean). */
export function usedPalette(d: SpriteDraft): PixelArt['palette'] {
  const used = new Set(d.frames.flatMap((f) => f.flatMap((r) => [...r])));
  return d.palette.filter((p) => used.has(p.key));
}
