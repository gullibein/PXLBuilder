/**
 * Simple pixel-art sprites drawn by the AI (or anything else) as data: a
 * palette of one-character keys and rows of those keys. They become SVG
 * images (one rectangle per run of equal pixels), so they stay crisp at any
 * size and are ordinary image assets the renderer, the Sprites panel and the
 * project files already handle.
 */

export interface PixelArt {
  /** One-character keys to "#rrggbb" colors. "." is always transparent and need not be listed. */
  palette: { key: string; color: string }[];
  /** Equal-length rows, top to bottom, of palette keys. */
  rows: string[];
}

export const MAX_PIXEL_SIDE = 64;
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * The grid size to draw for an object of this size: the same proportions,
 * with the longer side at most 32 pixels (one art pixel per screen pixel for
 * the 32 px tiles, chunkier for bigger things).
 */
export function suggestedGrid(size: { x: number; y: number }, maxSide = 32): { width: number; height: number } {
  const w = Math.max(1, size.x);
  const h = Math.max(1, size.y);
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** Error message, or null if the art is well formed and fits an object of `size` (same proportions, within 1 pixel). */
export function checkPixelArt(art: PixelArt, size?: { x: number; y: number }): string | null {
  const { rows, palette } = art;
  if (!rows.length) return 'The sprite has no rows';
  const width = rows[0].length;
  if (!width) return 'The sprite rows are empty';
  if (rows.some((r) => r.length !== width)) return 'All sprite rows must be the same length';
  if (width > MAX_PIXEL_SIDE || rows.length > MAX_PIXEL_SIDE) return `Sprites can be at most ${MAX_PIXEL_SIDE}×${MAX_PIXEL_SIDE} pixels`;
  const keys = new Map<string, string>();
  for (const p of palette) {
    if ([...p.key].length !== 1) return `Palette key "${p.key}" must be one character`;
    if (p.key === '.') return '"." is transparent and cannot be given a color';
    if (!HEX.test(p.color)) return `Palette color "${p.color}" must be like #ff8800`;
    keys.set(p.key, p.color);
  }
  for (const row of rows) for (const ch of row) if (ch !== '.' && !keys.has(ch)) return `"${ch}" is used in the rows but not in the palette`;
  if (size) {
    // Proportions must match the object, or the sprite would be stretched.
    const expectedHeight = (width * size.y) / size.x;
    if (Math.abs(expectedHeight - rows.length) > 1) {
      const g = suggestedGrid(size);
      return `The sprite is ${width}×${rows.length} but the object is ${size.x}×${size.y}; draw it ${g.width}×${g.height} (same proportions)`;
    }
  }
  return null;
}

/** SVG markup: one rectangle per horizontal run of the same color. */
export function pixelArtToSvg(art: PixelArt): string {
  const colors = new Map(art.palette.map((p) => [p.key, p.color]));
  const width = art.rows[0].length;
  const height = art.rows.length;
  const rects: string[] = [];
  art.rows.forEach((row, y) => {
    let x = 0;
    while (x < width) {
      const ch = row[x];
      let end = x + 1;
      while (end < width && row[end] === ch) end++;
      if (ch !== '.') rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${colors.get(ch)}"/>`);
      x = end;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges">${rects.join('')}</svg>`;
}
