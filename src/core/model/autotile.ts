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
  // Edges the picture already has (grass painted along its top, a dark bottom, rounded corners): kept where that side
  // is open, and where a tile is next to it replaced by the tile's middle (its pattern continued).
  const edges = pictureEdges(base);
  const frames: string[][] = [];
  for (let index = 0; index < AUTOTILE_COUNT; index++) {
    const open = { up: !(index & AUTOTILE_UP), right: !(index & AUTOTILE_RIGHT), down: !(index & AUTOTILE_DOWN), left: !(index & AUTOTILE_LEFT) };
    const px = withoutEdges(base.rows.map((r) => [...r]), edges, { up: !open.up, right: !open.right, down: !open.down, left: !open.left });
    // The top: a lighter band or grass where nothing is above (unless the picture has a top edge of its own).
    if (open.up && style.top !== 'none' && !edges.top) {
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

/** How many rows (top, bottom) and columns (left, right) of a tile picture are an edge painted into it, not its middle. */
export interface PictureEdges {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * The edges a tile picture has of its own: rows along the top (or bottom) and columns along a side that are mostly
 * colors its middle doesn't have (grass on dirt, a dark outline), or that are cut away (rounded corners). At most a
 * third of the picture each way.
 */
export function pictureEdges(art: PixelArt): PictureEdges {
  const rows = art.rows;
  const h = rows.length;
  const w = rows[0].length;
  const color = new Map(art.palette.map((p) => [p.key, p.color.toLowerCase()]));
  const at = (x: number, y: number) => (rows[y][x] === '.' ? null : (color.get(rows[y][x]) ?? null));
  // The middle's colors (and whether it has see-through pixels of its own).
  const middle = new Set<string>();
  let middleClear = false;
  for (let y = Math.floor(h / 3); y < Math.ceil((2 * h) / 3); y++)
    for (let x = Math.floor(w / 3); x < Math.ceil((2 * w) / 3); x++) {
      const c = at(x, y);
      if (c) middle.add(c);
      else middleClear = true;
    }
  /** A line of pixels is edge when most of it is colors the middle hasn't, or any of it is cut away (a rounded corner). */
  const isEdge = (pixels: (string | null)[]) => {
    let foreign = 0;
    let clear = 0;
    for (const c of pixels) {
      if (c === null) clear++;
      else if (!middle.has(c)) foreign++;
    }
    return foreign > pixels.length / 2 || (!middleClear && clear > 0) || clear > pixels.length / 2;
  };
  const row = (y: number) => Array.from({ length: w }, (_, x) => at(x, y));
  const count = (n: number, line: (i: number) => (string | null)[]) => {
    let k = 0;
    while (k < Math.floor(n / 3) && isEdge(line(k))) k++;
    return k;
  };
  const top = count(h, (i) => row(i));
  const bottom = count(h, (i) => row(h - 1 - i));
  // Columns between the top and bottom edges (their corners belong to those).
  const col = (x: number) => Array.from({ length: h - top - bottom }, (_, i) => at(x, top + i));
  return { top, bottom, left: count(w, (i) => col(i)), right: count(w, (i) => col(w - 1 - i)) };
}

/**
 * The picture with its own edges taken off the joined sides: those rows (columns) are filled with the middle's,
 * continuing its pattern (the same distance further in as the pattern repeats, so a checkerboard stays a checkerboard).
 */
function withoutEdges(px: string[][], edges: PictureEdges, joined: { up: boolean; right: boolean; down: boolean; left: boolean }): string[][] {
  const h = px.length;
  const w = px[0].length;
  const inner = { y0: edges.top, y1: h - edges.bottom, x0: edges.left, x1: w - edges.right };
  const sameRow = (a: number, b: number) => px[a].join('') === px[b].join('');
  // How often the middle repeats, down and across (the whole middle when it doesn't).
  const period = (n0: number, n1: number, same: (a: number, b: number) => boolean) => {
    // (Up to all but a few rows: a pattern that repeats every 8 rows shows in a 13-row middle.)
    for (let p = 1; p <= n1 - n0 - 3; p++) {
      let ok = true;
      for (let i = n0; i + p < n1 && ok; i++) ok = same(i, i + p);
      if (ok) return p;
    }
    return Math.max(1, n1 - n0);
  };
  const py = period(inner.y0, inner.y1, sameRow);
  const fromInside = (i: number, lo: number, hi: number, p: number) => {
    let j = i;
    while (j < lo) j += p;
    while (j >= hi) j -= p;
    return Math.min(hi - 1, Math.max(lo, j));
  };
  const out = px.map((r) => [...r]);
  if (joined.up) for (let y = 0; y < edges.top; y++) out[y] = [...px[fromInside(y, inner.y0, inner.y1, py)]];
  if (joined.down) for (let y = h - edges.bottom; y < h; y++) out[y] = [...px[fromInside(y, inner.y0, inner.y1, py)]];
  // Columns from the picture as it is now (its top and bottom already done).
  const now = out.map((r) => [...r]);
  const sameCol = (a: number, b: number) => now.slice(inner.y0, inner.y1).every((r) => r[a] === r[b]);
  const px_ = period(inner.x0, inner.x1, sameCol);
  if (joined.left) for (let x = 0; x < edges.left; x++) for (let y = 0; y < h; y++) out[y][x] = now[y][fromInside(x, inner.x0, inner.x1, px_)];
  if (joined.right) for (let x = w - edges.right; x < w; x++) for (let y = 0; y < h; y++) out[y][x] = now[y][fromInside(x, inner.x0, inner.x1, px_)];
  // Corners cut away in the picture (rounded) on a joined side: filled from the same row (a grass top runs on into
  // the next tile's).
  const reach = Math.floor(w / 3);
  for (const r of out) {
    if (joined.left) {
      let k = 0;
      while (k < reach && r[k] === '.') k++;
      if (k > 0 && k < reach) for (let x = 0; x < k; x++) r[x] = r[k];
    }
    if (joined.right) {
      let k = 0;
      while (k < reach && r[w - 1 - k] === '.') k++;
      if (k > 0 && k < reach) for (let x = 0; x < k; x++) r[w - 1 - x] = r[w - 1 - k];
    }
  }
  return out;
}

// ---------------------------------------------------------------- one edge for all open sides

/** An edge drawn once for every picture with that side open: the top of tiles with nothing above, the bottom… */
export type AutotileEdge = 'top' | 'bottom';

/** The picture the edge is taken from: joined left and right, open at the top and bottom (a platform's middle). */
export const EDGE_REFERENCE = AUTOTILE_LEFT | AUTOTILE_RIGHT;

/** Which pictures have this side open (they show the edge). */
export function picturesWithOpen(edge: AutotileEdge): number[] {
  const bit = edge === 'top' ? AUTOTILE_UP : AUTOTILE_DOWN;
  return Array.from({ length: AUTOTILE_COUNT }, (_, i) => i).filter((i) => !(i & bit));
}

/** The edge as it is now: `rows` rows along that side of the reference picture (top to bottom). */
export function edgeStrip(frames: string[][], edge: AutotileEdge, rows: number): string[] {
  const ref = frames[EDGE_REFERENCE];
  return edge === 'top' ? ref.slice(0, rows) : ref.slice(ref.length - rows);
}

/**
 * Draws one edge on every picture with that side open: the strip's rows go along that side. Where a picture differs
 * from the reference picture there (its corner cut off, a darker side), that stays: an end's rounded corner stays
 * round under the new grass. Pictures with a tile on that side are left as they are.
 */
export function applyEdgeStrip(frames: string[][], edge: AutotileEdge, strip: string[]): string[][] {
  const ref = frames[EDGE_REFERENCE];
  const h = ref.length;
  const n = Math.min(strip.length, h);
  const out = frames.map((f) => [...f]);
  for (const i of picturesWithOpen(edge)) {
    for (let s = 0; s < n; s++) {
      const y = edge === 'top' ? s : h - n + s;
      const row = [...frames[i][y]];
      for (let x = 0; x < row.length; x++) if (frames[i][y][x] === ref[y][x] || i === EDGE_REFERENCE) row[x] = strip[s][x] ?? row[x];
      out[i][y] = row.join('');
    }
  }
  return out;
}
