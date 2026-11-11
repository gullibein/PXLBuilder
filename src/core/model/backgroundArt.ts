/**
 * Backgrounds the engine draws itself, as pixel art at the game's own pixel size: scenery that fills the screen's
 * height and repeats sideways (a sky with clouds, hills, mountains, a forest, a city, a night sky) and walls and
 * patterns that repeat both ways (checks, diamonds, chevrons, stripes, dots, bricks, stone blocks, cave rock, wood
 * planks, square tiles). The AI (or the user) only names the kind, a few colors and a variant: no pixels to send.
 * Everything repeats seamlessly (scenery left to right, patterns both ways), and the same settings always make the
 * same picture.
 */

export type BackgroundKind =
  | 'sky'
  | 'hills'
  | 'mountains'
  | 'forest'
  | 'city'
  | 'night'
  | 'checker'
  | 'diamonds'
  | 'chevrons'
  | 'stripes'
  | 'dots'
  | 'bricks'
  | 'stone'
  | 'cave'
  | 'planks'
  | 'tiles';

/** Each kind: how it fills the screen, what its colors are for (in order), and its own colors when none are given. */
export const BACKGROUND_KINDS: Record<BackgroundKind, { fit: 'cover' | 'tile'; colors: string[]; defaults: string[]; what: string }> = {
  sky: { fit: 'cover', colors: ['sky top', 'sky bottom', 'clouds'], defaults: ['#5ec2f2', '#b8ecff', '#fdfdf6'], what: 'a sky fading in bands, with clouds' },
  hills: { fit: 'cover', colors: ['sky top', 'sky bottom', 'clouds', 'far hills', 'near hills'], defaults: ['#5ec2f2', '#c4f0ff', '#fdfdf6', '#7fd0c4', '#4aa88a'], what: 'a sky with clouds over two rows of rolling hills' },
  mountains: { fit: 'cover', colors: ['sky top', 'sky bottom', 'clouds', 'mountains', 'snow', 'near hills'], defaults: ['#4fa8e8', '#bfe6ff', '#fdfdf6', '#7d8fb8', '#f4f7ff', '#5b9a6e'], what: 'a sky with clouds, snowy mountains and hills in front' },
  forest: { fit: 'cover', colors: ['sky top', 'sky bottom', 'far trees', 'near trees'], defaults: ['#7cc8e8', '#e2f5d8', '#6fae8a', '#3d7a5a'], what: 'a sky over two rows of tree tops' },
  city: { fit: 'cover', colors: ['sky top', 'sky bottom', 'far buildings', 'near buildings', 'windows'], defaults: ['#1d2a44', '#3b5072', '#2c3a55', '#141c2c', '#f4d36b'], what: 'a city skyline with lit windows, at dusk or night' },
  night: { fit: 'cover', colors: ['sky top', 'sky bottom', 'stars', 'moon'], defaults: ['#0d1028', '#2a2f5c', '#fff7d6', '#f1efd9'], what: 'a night sky with stars and a moon' },
  checker: { fit: 'tile', colors: ['squares', 'other squares'], defaults: ['#d9cfe8', '#c6bad8'], what: 'big soft checks (a tile each)' },
  diamonds: { fit: 'tile', colors: ['diamonds', 'between'], defaults: ['#e9d6b5', '#dcc49c'], what: 'diamonds' },
  chevrons: { fit: 'tile', colors: ['zigzag', 'between'], defaults: ['#d8b8a0', '#c9a589'], what: 'zigzag chevron bands' },
  stripes: { fit: 'tile', colors: ['stripes', 'between'], defaults: ['#2f3b52', '#28324a'], what: 'diagonal stripes' },
  dots: { fit: 'tile', colors: ['dots', 'between'], defaults: ['#f0e2c8', '#e4d2b0'], what: 'polka dots' },
  bricks: { fit: 'tile', colors: ['bricks', 'mortar'], defaults: ['#7a4a3a', '#4a2c24'], what: 'a brick wall' },
  stone: { fit: 'tile', colors: ['stone', 'gaps'], defaults: ['#3a3f4c', '#1d2028'], what: 'a dungeon wall of uneven stone blocks' },
  cave: { fit: 'tile', colors: ['rock', 'dark'], defaults: ['#3b3442', '#221d28'], what: 'a rough cave wall' },
  planks: { fit: 'tile', colors: ['wood', 'gaps'], defaults: ['#8a5a36', '#4e3220'], what: 'wooden planks' },
  tiles: { fit: 'tile', colors: ['tiles', 'grout'], defaults: ['#9aa6b8', '#5c6678'], what: 'square wall tiles' },
};

// ---------------------------------------------------------------- colors

const rgb = (hex: string): [number, number, number] => {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = (c: [number, number, number]) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
/** a toward b by t (0..1). */
export const mix = (a: string, b: string, t: number) => {
  const x = rgb(a);
  const y = rgb(b);
  return hexOf([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
};
const lighter = (c: string, t: number) => mix(c, '#ffffff', t);
const darker = (c: string, t: number) => mix(c, '#000000', t);

// ---------------------------------------------------------------- the picture

/** A picture being drawn: its size in art pixels and one palette index per pixel. */
class Art {
  readonly data: Uint16Array;
  readonly palette: string[] = [];
  private index = new Map<string, number>();
  constructor(
    readonly w: number,
    readonly h: number,
  ) {
    this.data = new Uint16Array(w * h);
  }
  color(c: string): number {
    let i = this.index.get(c);
    if (i === undefined) {
      i = this.palette.length;
      this.palette.push(c);
      this.index.set(c, i);
    }
    return i;
  }
  /** Sets a pixel; x wraps round (everything repeats sideways), y outside is left out. */
  set(x: number, y: number, c: number): void {
    if (y < 0 || y >= this.h) return;
    const xx = ((Math.round(x) % this.w) + this.w) % this.w;
    this.data[Math.round(y) * this.w + xx] = c;
  }
  /** Sets a pixel wrapping both ways (patterns). */
  wrap(x: number, y: number, c: number): void {
    const xx = ((Math.round(x) % this.w) + this.w) % this.w;
    const yy = ((Math.round(y) % this.h) + this.h) % this.h;
    this.data[yy * this.w + xx] = c;
  }
  get(x: number, y: number): number {
    const xx = ((x % this.w) + this.w) % this.w;
    const yy = ((y % this.h) + this.h) % this.h;
    return this.data[yy * this.w + xx];
  }
  fill(c: number): void {
    this.data.fill(c);
  }
  /** Fills a column from row y to the bottom. */
  column(x: number, y: number, c: number): void {
    for (let yy = Math.max(0, Math.ceil(y)); yy < this.h; yy++) this.set(x, yy, c);
  }
}

/** The same random numbers for the same settings (mulberry32). */
function randomFrom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth line that repeats every `w` pixels: the sum of a few waves that fit it exactly. */
function wavy(w: number, rand: () => number, waves: number[], amp: number): (x: number) => number {
  const parts = waves.map((k) => ({ k, a: (0.4 + rand() * 0.6) / k, p: rand() * Math.PI * 2 }));
  const total = parts.reduce((n, p) => n + p.a, 0);
  return (x) => (parts.reduce((n, p) => n + p.a * Math.sin((2 * Math.PI * p.k * x) / w + p.p), 0) / total) * amp;
}

/** Bands of color from the top to the bottom (a sky). */
function bands(art: Art, top: string, bottom: string, n: number, upTo = art.h): void {
  for (let y = 0; y < art.h; y++) {
    const t = Math.min(1, y / Math.max(1, upTo - 1));
    const c = art.color(mix(top, bottom, Math.floor(t * n) / Math.max(1, n - 1)));
    for (let x = 0; x < art.w; x++) art.set(x, y, c);
  }
}

/** Puffy clouds: a few round lumps on a flat bottom, a shade along the bottom. */
function clouds(art: Art, color: string, rand: () => number, count: number, band: [number, number]): void {
  const c = art.color(color);
  const shade = art.color(darker(color, 0.1));
  for (let i = 0; i < count; i++) {
    const cx = (art.w * (i + rand() * 0.6)) / count;
    const base = band[0] + rand() * (band[1] - band[0]);
    const size = art.h * (0.05 + rand() * 0.05);
    const lumps = 3 + Math.floor(rand() * 3);
    for (let l = 0; l < lumps; l++) {
      const lx = cx + (l - (lumps - 1) / 2) * size * 0.9;
      const r = size * (l === Math.floor(lumps / 2) ? 1.1 : 0.6 + rand() * 0.4);
      for (let y = Math.floor(base - r * 1.6); y <= base; y++)
        for (let x = Math.floor(lx - r); x <= lx + r; x++) {
          const dy = (y - (base - r * 0.6)) / r;
          const dx = (x - lx) / r;
          if (dx * dx + dy * dy <= 1) art.set(x, y, y >= base - Math.max(1, size * 0.18) ? shade : c);
        }
    }
  }
}

/** Ground shapes: everything under the line `top(x)` in one color, with a lighter rim along its top. */
function ground(art: Art, top: (x: number) => number, color: string, rim = true): void {
  const c = art.color(color);
  const edge = art.color(lighter(color, 0.12));
  for (let x = 0; x < art.w; x++) {
    const y = Math.round(top(x));
    art.column(x, y, c);
    if (rim) art.set(x, y, edge);
  }
}

// ---------------------------------------------------------------- scenery (fills the screen's height)

function scenery(kind: BackgroundKind, cs: string[], w: number, h: number, rand: () => number): Art {
  const art = new Art(w, h);
  const [top, bottom] = cs;
  if (kind === 'night') {
    bands(art, top, bottom, 7);
    const star = art.color(cs[2]);
    const dim = art.color(mix(cs[2], bottom, 0.5));
    for (let i = 0; i < (w * h) / 600; i++) art.set(rand() * w, rand() * h * 0.8, rand() < 0.3 ? star : dim);
    const moon = art.color(cs[3]);
    const mx = w * (0.2 + rand() * 0.6);
    const my = h * 0.22;
    const r = h * 0.07;
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r) art.set(mx + x, my + y, moon);
    const hill = wavy(w, rand, [1, 3, 5], h * 0.04);
    ground(art, (x) => h * 0.86 + hill(x), darker(bottom, 0.5), false);
    return art;
  }
  bands(art, top, bottom, kind === 'city' ? 6 : 7, Math.round(h * 0.85));
  if (kind === 'sky') {
    clouds(art, cs[2], rand, 5, [h * 0.2, h * 0.8]);
    return art;
  }
  if (kind === 'hills') {
    clouds(art, cs[2], rand, 4, [h * 0.15, h * 0.45]);
    const far = wavy(w, rand, [1, 2, 3], h * 0.08);
    ground(art, (x) => h * 0.6 + far(x), cs[3]);
    const near = wavy(w, rand, [1, 3, 4], h * 0.07);
    ground(art, (x) => h * 0.76 + near(x), cs[4]);
    return art;
  }
  if (kind === 'mountains') {
    clouds(art, cs[2], rand, 3, [h * 0.12, h * 0.32]);
    // Peaks, each a triangle; the snow on the top of each.
    const peaks = Array.from({ length: 5 }, (_, i) => ({ x: (w * (i + rand() * 0.7)) / 5, top: h * (0.3 + rand() * 0.18) }));
    const height = (x: number) => {
      let best = h;
      for (const p of peaks) for (const shift of [-w, 0, w]) best = Math.min(best, p.top + Math.abs(x - p.x - shift) * 0.9);
      return best;
    };
    const rock = art.color(cs[3]);
    const shade = art.color(darker(cs[3], 0.12));
    const snow = art.color(cs[4]);
    for (let x = 0; x < w; x++) {
      const y = Math.round(height(x));
      for (let yy = y; yy < h; yy++) {
        // Snow on the top; the right side of each slope in shade.
        const isSnow = peaks.some((p) => yy < p.top + h * 0.06 && Math.abs(x - p.x) < h * 0.2);
        const slope = height(x + 1) > height(x);
        art.set(x, yy, isSnow && yy < y + h * 0.05 ? snow : slope ? shade : rock);
      }
    }
    const near = wavy(w, rand, [2, 3, 5], h * 0.05);
    ground(art, (x) => h * 0.78 + near(x), cs[5]);
    return art;
  }
  if (kind === 'forest') {
    // Rows of tree tops: pointed (pines) far away, round near.
    for (const [layer, color] of [
      [0, cs[2]],
      [1, cs[3]],
    ] as const) {
      const c = art.color(color);
      const base = h * (layer === 0 ? 0.6 : 0.74);
      const size = h * (layer === 0 ? 0.06 : 0.09);
      const trees = Math.round(w / (size * 1.2));
      const tops = Array.from({ length: trees }, () => size * (0.8 + rand() * 0.7));
      for (let x = 0; x < w; x++) {
        let best = h;
        for (let i = 0; i < trees; i++) {
          const tx = ((i + 0.5) * w) / trees;
          for (const shift of [-w, 0, w]) {
            const d = Math.abs(x - tx - shift);
            const y = layer === 0 ? base - tops[i] * 1.6 + d * 1.6 : base - Math.sqrt(Math.max(0, tops[i] * tops[i] - d * d));
            if (d < size * 0.8 || layer === 0) best = Math.min(best, y);
          }
        }
        art.column(x, Math.max(best, base - size * 2.5), c);
      }
    }
    return art;
  }
  // city: two rows of buildings, the near ones with lit windows.
  for (const layer of [0, 1]) {
    const c = art.color(layer === 0 ? cs[2] : cs[3]);
    const lit = art.color(cs[4]);
    let x = 0;
    while (x < w) {
      const bw = Math.max(4, Math.round(h * (0.06 + rand() * 0.08)));
      const bh = h * (layer === 0 ? 0.25 + rand() * 0.3 : 0.15 + rand() * 0.25);
      const y0 = Math.round(h - bh - (layer === 0 ? h * 0.12 : 0));
      for (let xx = x; xx < Math.min(w, x + bw); xx++) art.column(xx, y0, c);
      if (layer === 1) {
        // (Only the lit windows are drawn: the dark ones are the building itself.)
        for (let wy = y0 + 2; wy < h - 2; wy += 4)
          for (let wx = x + 1; wx < Math.min(w, x + bw) - 1; wx += 3) if (rand() < 0.22) art.set(wx, wy, lit);
      }
      x += bw + (rand() < 0.3 ? 1 : 0);
    }
  }
  return art;
}

// ---------------------------------------------------------------- patterns (repeat both ways)

function pattern(kind: BackgroundKind, cs: string[], cell: number, rand: () => number): Art {
  const [a, b] = cs;
  const c2 = cell * 2;
  if (kind === 'checker' || kind === 'diamonds' || kind === 'chevrons' || kind === 'stripes' || kind === 'dots') {
    const art = new Art(c2, c2);
    const A = art.color(a);
    const B = art.color(b);
    for (let y = 0; y < c2; y++)
      for (let x = 0; x < c2; x++) {
        let on = false;
        if (kind === 'checker') on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
        else if (kind === 'diamonds') on = Math.abs((x % cell) - cell / 2 + 0.5) + Math.abs((y % cell) - cell / 2 + 0.5) < cell / 2;
        else if (kind === 'chevrons') on = (y + Math.abs((x % cell) - cell / 2)) % cell < cell / 2;
        else if (kind === 'stripes') on = (x + y) % cell < cell / 2;
        else {
          // Dots in a staggered grid.
          const ox = Math.floor(y / cell) % 2 ? cell / 2 : 0;
          const dx = ((x + ox) % cell) - cell / 2 + 0.5;
          const dy = (y % cell) - cell / 2 + 0.5;
          on = dx * dx + dy * dy <= (cell / 5) * (cell / 5);
        }
        art.wrap(x, y, on ? A : B);
      }
    return art;
  }
  if (kind === 'bricks' || kind === 'tiles') {
    const bw = cell;
    const bh = kind === 'bricks' ? Math.max(2, cell / 2) : cell;
    const art = new Art(bw * 2, bh * 2);
    const mortar = art.color(b);
    const shades = [a, lighter(a, 0.06), darker(a, 0.07)].map((x) => art.color(x));
    const hi = art.color(lighter(a, 0.18));
    const lo = art.color(darker(a, 0.2));
    for (let row = 0; row < 2; row++) {
      const off = kind === 'bricks' && row % 2 ? bw / 2 : 0;
      for (let i = -1; i < 3; i++) {
        const x0 = i * bw + off;
        const face = shades[Math.floor(rand() * shades.length)];
        for (let y = 0; y < bh; y++)
          for (let x = 0; x < bw; x++) {
            const gap = x === bw - 1 || y === bh - 1;
            const c = gap ? mortar : y === 0 || x === 0 ? hi : y === bh - 2 || x === bw - 2 ? lo : face;
            if (x0 + x >= -bw && x0 + x < bw * 3) art.wrap(x0 + x, row * bh + y, c);
          }
      }
    }
    return art;
  }
  if (kind === 'planks') {
    const art = new Art(c2, c2);
    const gap = art.color(b);
    const grain = art.color(darker(a, 0.12));
    const hi = art.color(lighter(a, 0.1));
    const pw = Math.max(3, Math.round(cell / 2));
    for (let x = 0; x < c2; x++) {
      const k = Math.floor(x / pw);
      const face = art.color(k % 2 ? a : darker(a, 0.05));
      for (let y = 0; y < c2; y++) {
        const end = (y + k * 7) % c2 === 0;
        const c = x % pw === pw - 1 || end ? gap : x % pw === 0 ? hi : (x * 3 + y * 7 + k) % 23 === 0 ? grain : face;
        art.wrap(x, y, c);
      }
    }
    return art;
  }
  if (kind === 'stone') {
    // Uneven blocks: rows of different heights, blocks of different widths, each its own shade, gaps between.
    const size = cell * 4;
    const art = new Art(size, size);
    const gap = art.color(b);
    const shades = [a, lighter(a, 0.07), darker(a, 0.08), lighter(a, 0.03)].map((x) => art.color(x));
    const hi = art.color(lighter(a, 0.16));
    const lo = art.color(darker(a, 0.18));
    const unit = Math.max(2, Math.round(cell / 2));
    const units = size / unit;
    let y0 = 0;
    while (y0 < units) {
      const rh = Math.min(units - y0, 1 + Math.floor(rand() * 2));
      let x0 = Math.floor(rand() * 2);
      const start = x0;
      while (x0 < units + start) {
        const bwu = Math.min(units + start - x0, 1 + Math.floor(rand() * 3));
        const face = shades[Math.floor(rand() * shades.length)];
        const bw = bwu * unit;
        const bh = rh * unit;
        for (let y = 0; y < bh; y++)
          for (let x = 0; x < bw; x++) {
            const edge = x === bw - 1 || y === bh - 1;
            const c = edge ? gap : y === 0 || x === 0 ? hi : y === bh - 2 || x === bw - 2 ? lo : (x * 5 + y * 3) % 17 === 0 && rand() < 0.5 ? lo : face;
            art.wrap(x0 * unit + x, y0 * unit + y, c);
          }
        x0 += bwu;
      }
      y0 += rh;
    }
    return art;
  }
  // cave: rough rock, smooth noise that repeats both ways, in a few shades, with dark cracks.
  const size = cell * 4;
  const art = new Art(size, size);
  const shades = [darker(a, 0.12), a, lighter(a, 0.08), lighter(a, 0.16)].map((x) => art.color(x));
  const crack = art.color(b);
  const grid = 4;
  const g = Array.from({ length: grid * grid }, () => rand());
  const g2 = Array.from({ length: grid * 2 * grid * 2 }, () => rand());
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const noise = (vals: number[], n: number, x: number, y: number) => {
    const fx = (x / size) * n;
    const fy = (y / size) * n;
    const ix = Math.floor(fx);
    const iy = Math.floor(fy);
    const at = (i: number, j: number) => vals[(((j % n) + n) % n) * n + (((i % n) + n) % n)];
    const tx = smooth(fx - ix);
    const ty = smooth(fy - iy);
    const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
    const bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
    return top + (bot - top) * ty;
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = noise(g, grid, x, y) * 0.65 + noise(g2, grid * 2, x, y) * 0.35;
      const ridge = Math.abs(noise(g2, grid * 2, x + size / 3, y) - 0.5);
      art.wrap(x, y, ridge < 0.025 ? crack : shades[Math.min(3, Math.floor(v * 4))]);
    }
  return art;
}

// ---------------------------------------------------------------- out

/** The picture as an SVG: one path per color of its runs of pixels, `px` level pixels to a picture pixel. */
function svgOf(art: Art, px: number): string {
  const paths = art.palette.map(() => [] as string[]);
  for (let y = 0; y < art.h; y++) {
    let x = 0;
    while (x < art.w) {
      const c = art.data[y * art.w + x];
      let e = x + 1;
      while (e < art.w && art.data[y * art.w + e] === c) e++;
      paths[c].push(`M${x} ${y}h${e - x}v1h${x - e}z`);
      x = e;
    }
  }
  const body = art.palette.map((c, i) => (paths[i].length ? `<path fill="${c}" d="${paths[i].join('')}"/>` : '')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${art.w * px}" height="${art.h * px}" viewBox="0 0 ${art.w} ${art.h}" shape-rendering="crispEdges">${body}</svg>`;
}

export interface MadeBackground {
  /** The picture (an SVG data URL), its size in level pixels, and how it fills the screen. */
  data: string;
  width: number;
  height: number;
  fit: 'cover' | 'tile';
}

/**
 * Draws a background of a kind. `colors`: its colors in the kind's order (missing ones are its own); `resolution`:
 * the game's sprite size (art pixels per 32 px tile: the picture's pixels are the game's); `variant`: another one of
 * the same kind (other clouds, other blocks).
 */
export function makeBackground(kind: BackgroundKind, colors: readonly string[], resolution: number, variant = 1): MadeBackground {
  const info = BACKGROUND_KINDS[kind];
  const cs = info.defaults.map((d, i) => (typeof colors[i] === 'string' && /^#[0-9a-f]{6}$/i.test(colors[i]) ? colors[i] : d));
  const res = [8, 16, 32, 64].includes(resolution) ? resolution : 32;
  const px = 32 / res;
  const rand = randomFrom(variant * 7919 + kind.length * 104729 + kind.charCodeAt(0) * 31);
  if (info.fit === 'cover') {
    // About a screen's height in game pixels (a little coarser for the finest sprites, to keep the picture small).
    const rows = Math.max(68, Math.min(270, Math.round(540 / px)));
    const art = scenery(kind, cs, rows * 2, rows, rand);
    return { data: `data:image/svg+xml;utf8,${encodeURIComponent(svgOf(art, 1))}`, width: art.w, height: art.h, fit: 'cover' };
  }
  const art = pattern(kind, cs, res, rand);
  return { data: `data:image/svg+xml;utf8,${encodeURIComponent(svgOf(art, px))}`, width: art.w * px, height: art.h * px, fit: 'tile' };
}
