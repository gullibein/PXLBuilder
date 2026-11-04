/**
 * Isometric block pictures (Sprite.isoLook "iso_floor" / "iso_block"): a 2:1 diamond top (as wide as the picture,
 * half as high) with the block's two sides below it, every corner of the picture empty. A picture drawn flat, as a
 * tile seen from above (a full square), is not one: `looksFlat` tells, and `isoBlockFromFlat` makes a block of it
 * (the drawing laid on the diamond top, its edges continued down the sides, shaded).
 */
import type { PixelArt } from './pixelArt';

const KEYS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** A full square: its four corner pixels are all painted (a block leaves them empty). */
export function looksFlat(art: PixelArt): boolean {
  const rows = art.rows;
  if (!rows.length || !rows[0].length) return false;
  const w = rows[0].length;
  const h = rows.length;
  const painted = (x: number, y: number) => (rows[y]?.[x] ?? '.') !== '.';
  return [painted(0, 0), painted(w - 1, 0), painted(0, h - 1), painted(w - 1, h - 1)].filter(Boolean).length >= 3;
}

function shade(color: string, k: number): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(color);
  if (!m) return color;
  const c = (h: string) => Math.max(0, Math.min(255, Math.round(parseInt(h, 16) * k)))
    .toString(16)
    .padStart(2, '0');
  return `#${c(m[1])}${c(m[2])}${c(m[3])}${m[4] ?? ''}`;
}

/**
 * A block of a flat (seen from above) drawing, as wide as the drawing: the drawing on the diamond top, its south-west
 * and south-east edges continued down the left (darker) and right (darker still) sides, a dark outline round it.
 * Null when it would need more colors than there are palette keys (left as it was).
 */
export function isoBlockFromFlat(art: PixelArt): PixelArt | null {
  const fw = art.rows[0].length;
  const fh = art.rows.length;
  const W = fw;
  const top = W / 2; // (the diamond top's height)
  const side = W / 2; // (the sides' height: a whole square's block)
  const H = Math.round(top + side);
  const color = new Map(art.palette.map((p) => [p.key, p.color]));
  const at = (tx: number, ty: number): string | null => {
    const k = art.rows[Math.max(0, Math.min(fh - 1, Math.floor((ty / W) * fh)))]?.[Math.max(0, Math.min(fw - 1, Math.floor((tx / W) * fw)))] ?? '.';
    return k === '.' ? null : (color.get(k) ?? null);
  };
  const out: (string | null)[][] = [];
  for (let y = 0; y < H; y++) {
    const row: (string | null)[] = [];
    for (let x = 0; x < W; x++) {
      const sx = x + 0.5;
      const sy = y + 0.5;
      // On the top: back to the drawing's own point (screen x = W/2 + (tx - ty) / 2, y = (tx + ty) / 4).
      const tx = sx - W / 2 + 2 * sy;
      const ty = 2 * sy - (sx - W / 2);
      if (tx >= 0 && tx < W && ty >= 0 && ty < W) {
        row.push(at(tx, ty));
        continue;
      }
      // The sides: below the top's lower edges, `side` deep.
      if (sx < W / 2) {
        const edge = W / 4 + sx / 2;
        row.push(sy >= edge && sy < edge + side ? (at(2 * sx, W - 0.5) ? shade(at(2 * sx, W - 0.5)!, 0.72) : null) : null);
      } else {
        const edge = W / 2 - (sx - W / 2) / 2;
        row.push(sy >= edge && sy < edge + side ? (at(W - 0.5, W - 2 * (sx - W / 2)) ? shade(at(W - 0.5, W - 2 * (sx - W / 2))!, 0.52) : null) : null);
      }
    }
    out.push(row);
  }
  // A dark outline: the painted pixels next to an empty one (or the picture's edge).
  const outlined = out.map((row, y) =>
    row.map((c, x) => {
      if (!c) return c;
      const empty = (xx: number, yy: number) => !out[yy]?.[xx];
      return empty(x - 1, y) || empty(x + 1, y) || empty(x, y - 1) || empty(x, y + 1) ? shade(c, 0.3) : c;
    }),
  );
  const keys = new Map<string, string>();
  for (const row of outlined)
    for (const c of row) {
      if (!c || keys.has(c)) continue;
      if (keys.size >= KEYS.length) return null;
      keys.set(c, KEYS[keys.size]);
    }
  return { palette: [...keys].map(([c, key]) => ({ key, color: c })), rows: outlined.map((row) => row.map((c) => (c ? keys.get(c)! : '.')).join('')) };
}
