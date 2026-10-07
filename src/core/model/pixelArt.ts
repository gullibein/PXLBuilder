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
/**
 * Forgives the usual slips in a drawing from an AI, so a good drawing isn't
 * thrown away over notation: "." given a color (it is transparent anyway),
 * spaces for empty pixels, "transparent"/"none" as a color, colors without
 * "#", short (#f80) or with alpha (#ff880000: fully clear = transparent).
 * Anything else is left for checkPixelArt to report.
 */
export function normalizePixelArt(art: PixelArt): PixelArt {
  const clear = new Set<string>();
  const palette: PixelArt['palette'] = [];
  for (const p of art.palette) {
    if (p.key === '.') continue;
    let color = p.color.trim();
    if (/^(transparent|none|clear)$/i.test(color)) {
      clear.add(p.key);
      continue;
    }
    if (/^[0-9a-f]{3}([0-9a-f]{3}([0-9a-f]{2})?)?$/i.test(color)) color = `#${color}`;
    if (/^#[0-9a-f]{3}$/i.test(color)) color = `#${[...color.slice(1)].map((c) => c + c).join('')}`;
    if (/^#[0-9a-f]{8}$/i.test(color)) {
      if (/00$/.test(color)) {
        clear.add(p.key);
        continue;
      }
      color = color.slice(0, 7);
    }
    palette.push({ key: p.key, color });
  }
  if (!palette.some((p) => p.key === ' ')) clear.add(' ');
  const rows = clear.size ? art.rows.map((r) => [...r].map((ch) => (clear.has(ch) ? '.' : ch)).join('')) : [...art.rows];
  return { palette, rows };
}

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

/**
 * Makes art fit an object's proportions instead of rejecting it: a strip
 * whose bottom row runs edge to edge (a row of spikes, a tile) and
 * fits a whole number of times is repeated sideways (an 8×8 spike for a 4:1
 * hazard becomes a row of four); anything else, a character for instance,
 * gets transparent space around it (centered sideways, standing on the
 * bottom), never copies of itself. Art that would get too big
 * is resampled to the suggested grid. Well-proportioned art is returned as is.
 */
export function fitPixelArt(art: PixelArt, size: { x: number; y: number }): PixelArt {
  const w = art.rows[0].length;
  const h = art.rows.length;
  const fits = (cw: number, ch: number) => Math.abs((cw * size.y) / size.x - ch) <= 1;
  if (fits(w, h)) return art;
  const target = size.x / size.y;
  const ratio = w / h;
  let rows: string[] | null = null;
  if (target > ratio) {
    const k = Math.round(target / ratio);
    // A strip has a base running edge to edge along the bottom (spikes, tiles); a character stands on its feet.
    const base = art.rows[h - 1];
    const edgeToEdge = base[0] !== '.' && base[w - 1] !== '.';
    if (edgeToEdge && k >= 2 && w * k <= MAX_PIXEL_SIDE && fits(w * k, h)) rows = art.rows.map((r) => r.repeat(k));
    else {
      const nw = Math.round(h * target);
      if (nw <= MAX_PIXEL_SIDE) {
        const left = Math.floor((nw - w) / 2);
        rows = art.rows.map((r) => '.'.repeat(left) + r + '.'.repeat(nw - w - left));
      }
    }
  } else {
    const nh = Math.round(w / target);
    if (nh <= MAX_PIXEL_SIDE) rows = [...Array.from({ length: nh - h }, () => '.'.repeat(w)), ...art.rows];
  }
  if (!rows) {
    // Too big to pad: sample it onto the suggested grid.
    const g = suggestedGrid(size);
    rows = Array.from({ length: g.height }, (_, y) => {
      const sy = Math.min(h - 1, Math.floor((y * h) / g.height));
      return Array.from({ length: g.width }, (_, x) => art.rows[sy][Math.min(w - 1, Math.floor((x * w) / g.width))]).join('');
    });
  }
  return { palette: art.palette, rows };
}
