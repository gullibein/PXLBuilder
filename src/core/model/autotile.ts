/**
 * Autotiling: an object laid out in a grid (ground, platforms, walls) that
 * draws each tile with the picture that fits the tiles around it, so a row of
 * platforms gets ends, a block of ground gets edges and corners, without
 * picking pictures by hand.
 *
 * Each tile looks at its four sides (a tile of the same object above, to the
 * right, below, to the left) and draws one of 16 pictures: number
 * up 1 + right 2 + down 4 + left 8 for the sides that have a neighbour (0: a
 * tile on its own, 15: one with neighbours all round). The 16 pictures are
 * kept as one pixel-art sheet (16 frames, in that order), made from the
 * object's own picture (or its color) with edges in a chosen style, and can be
 * redrawn one by one in the sprite editor.
 */
import type { PixelArt } from './pixelArt';

export const AUTOTILE_UP = 1;
export const AUTOTILE_RIGHT = 2;
export const AUTOTILE_DOWN = 4;
export const AUTOTILE_LEFT = 8;
/** How many pictures an autotile has (one per combination of the four sides). */
export const AUTOTILE_COUNT = 16;

/** Which picture a tile uses, from whether a tile of its kind is next to it (`has(dx, dy)`, in tiles; up is dy -1). */
export function autotileIndex(has: (dx: number, dy: number) => boolean): number {
  return (has(0, -1) ? AUTOTILE_UP : 0) | (has(1, 0) ? AUTOTILE_RIGHT : 0) | (has(0, 1) ? AUTOTILE_DOWN : 0) | (has(-1, 0) ? AUTOTILE_LEFT : 0);
}

/** In words, what picture `index` is for (the sides that have a neighbour), e.g. "joined left and right". */
export function autotileLabel(index: number): string {
  const sides = [index & AUTOTILE_UP && 'up', index & AUTOTILE_RIGHT && 'right', index & AUTOTILE_DOWN && 'down', index & AUTOTILE_LEFT && 'left'].filter(Boolean) as string[];
  if (!sides.length) return 'on its own';
  if (sides.length === 4) return 'joined all round';
  return `joined ${sides.join(', ').replace(/, ([^,]*)$/, ' and $1')}`;
}

export interface AutotileStyle {
  /** The open sides (no tile next to them): a darker border ("outline"), or none. */
  edge: 'outline' | 'none';
  /** The open top: a lighter band ("light"), grass ("grass"), or as the rest. */
  top: 'light' | 'grass' | 'none';
  /** Corners where two open sides meet are rounded off. */
  round: boolean;
}

export const DEFAULT_AUTOTILE_STYLE: AutotileStyle = { edge: 'outline', top: 'light', round: true };

const GRASS = '#5bbd4a';

/** The 16 pictures (index = autotileIndex), from one picture of the tile, in the given style; one palette for all. */
export function makeAutotileFrames(base: PixelArt, style: AutotileStyle = DEFAULT_AUTOTILE_STYLE): { palette: PixelArt['palette']; frames: string[][] } {
  const w = base.rows[0].length;
  const h = base.rows.length;
  // How thick an edge is, in picture pixels: 1 for small tiles, more for detailed ones (a 32-pixel tile: 3).
  const t = Math.max(1, Math.round(Math.min(w, h) / 10));
  const colors = new Map(base.palette.map((p) => [p.key, p.color]));
  const palette = base.palette.map((p) => ({ ...p }));
  const used = new Set(palette.map((p) => p.key));
  const keyFor = new Map<string, string>();
  for (const p of palette) keyFor.set(p.color.toLowerCase(), p.key);
  const FREE = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  /** The palette key of a color (added to the palette the first time). */
  const key = (color: string): string => {
    const c = color.toLowerCase();
    const k = keyFor.get(c);
    if (k) return k;
    const free = [...FREE].find((ch) => !used.has(ch));
    // (Out of keys: the nearest one there is, the first.)
    if (!free) return palette[0]?.key ?? '.';
    used.add(free);
    keyFor.set(c, free);
    palette.push({ key: free, color: c });
    return free;
  };
  const colorAt = (ch: string) => colors.get(ch) ?? null;
  const frames: string[][] = [];
  for (let index = 0; index < AUTOTILE_COUNT; index++) {
    const open = { up: !(index & AUTOTILE_UP), right: !(index & AUTOTILE_RIGHT), down: !(index & AUTOTILE_DOWN), left: !(index & AUTOTILE_LEFT) };
    const px = base.rows.map((r) => [...r]);
    // The top: a lighter band or grass where nothing is above.
    if (open.up && style.top !== 'none') {
      const band = style.top === 'grass' ? t * 2 : t;
      for (let y = 0; y < Math.min(band, h); y++)
        for (let x = 0; x < w; x++) {
          const c = colorAt(px[y][x]);
          if (!c) continue;
          if (style.top === 'grass') {
            // A ragged lower edge: every other column one pixel shorter.
            if (y === band - 1 && x % 2 === 1) continue;
            px[y][x] = key(y === 0 ? mix(GRASS, '#ffffff', 0.25) : GRASS);
          } else px[y][x] = key(mix(c, '#ffffff', 0.3));
        }
    }
    // Open sides: the outermost pixels darker.
    if (style.edge === 'outline') {
      const darken = (x: number, y: number) => {
        const c = colorAt(px[y][x]) ?? palette.find((p) => p.key === px[y][x])?.color ?? null;
        if (c) px[y][x] = key(mix(c, '#000000', 0.35));
      };
      for (let i = 0; i < t; i++) {
        for (let x = 0; x < w; x++) {
          if (open.up && style.top === 'none') darken(x, i);
          if (open.down) darken(x, h - 1 - i);
        }
        for (let y = 0; y < h; y++) {
          if (open.left) darken(i, y);
          if (open.right) darken(w - 1 - i, y);
        }
      }
    }
    // Corners where two open sides meet: cut off in a little staircase.
    if (style.round) {
      const r = Math.max(1, t);
      for (let i = 0; i < r; i++) {
        const cut = r - i;
        for (let j = 0; j < cut; j++) {
          if (open.up && open.left) px[i][j] = '.';
          if (open.up && open.right) px[i][w - 1 - j] = '.';
          if (open.down && open.left) px[h - 1 - i][j] = '.';
          if (open.down && open.right) px[h - 1 - i][w - 1 - j] = '.';
        }
      }
    }
    frames.push(px.map((r) => r.join('')));
  }
  return { palette, frames };
}

/** A plain tile of one color (`width` × `height` pixels), for an object without a picture of its own. */
export function solidTile(color: string, width: number, height: number): PixelArt {
  return { palette: [{ key: 'a', color: /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : '#888888' }], rows: Array.from({ length: height }, () => 'a'.repeat(width)) };
}

/** Mixes a #rrggbb color toward another by `amount` (0..1); a color with see-through (#rrggbbaa) keeps it. */
function mix(a: string, b: string, amount: number): string {
  const p = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a);
  const [r2, g2, b2] = p(b);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * amount).toString(16).padStart(2, '0');
  return `#${ch(r1, r2)}${ch(g1, g2)}${ch(b1, b2)}${a.length === 9 ? a.slice(7) : ''}`;
}
