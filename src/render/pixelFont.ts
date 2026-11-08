/**
 * Pixel fonts for game text, one for each sprite size (pixelFontFor). The tiny one, like PICO-8's: every character
 * 3×5 pixels, 4 pixels apart, lines 7 pixels apart. Used for text in a game drawn at a low
 * resolution, where an ordinary font would be 2 or 3 pixels tall and smear
 * into an unreadable blur. Drawn as whole canvas pixels, so it stays sharp.
 * Lower-case letters are drawn as capitals (as on PICO-8).
 */

import { ACCENTED_5X7, GLYPHS_5X7 } from './pixelFont5x7';

const W = 3;
const H = 5;
/** Pixels from one character to the next, and from one line to the next. */
export const PIXEL_FONT_ADVANCE = 4;
// (7 apart: an accent, in the row above its letter, keeps two empty rows below the line above.)
export const PIXEL_FONT_LINE = 7;

/** Each glyph: its 5 rows of 3 joined ("#" = a pixel). */
const GLYPHS: Record<string, string> = {
  "A": '.#.#.#####.##.#',
  "B": '##.#.###.#.###.',
  "C": '.###..#..#...##',
  "D": '##.#.##.##.###.',
  "E": '####..##.#..###',
  "F": '####..##.#..#..',
  "G": '.###..#.##.#.##',
  "H": '#.##.#####.##.#',
  "I": '###.#..#..#.###',
  "J": '..#..#..##.#.#.',
  "K": '#.##.###.#.##.#',
  "L": '#..#..#..#..###',
  "M": '#.########.##.#',
  "N": '##.#.##.##.##.#',
  "O": '.#.#.##.##.#.#.',
  "P": '##.#.###.#..#..',
  "Q": '.#.#.##.###..##',
  "R": '##.#.###.#.##.#',
  "S": '.###...#...###.',
  "T": '###.#..#..#..#.',
  "U": '#.##.##.##.#.##',
  "V": '#.##.##.#.#..#.',
  "W": '#.##.########.#',
  "X": '#.##.#.#.#.##.#',
  "Y": '#.##.#.#..#..#.',
  "Z": '###..#.#.#..###',
  "0": '####.##.##.####',
  "1": '##..#..#..#.###',
  "2": '###..#####..###',
  "3": '###..#.##..####',
  "4": '#.##.####..#..#',
  "5": '####..###..####',
  "6": '#..#..####.####',
  "7": '###..#..#..#..#',
  "8": '####.#####.####',
  "9": '####.####..#..#',
  " ": '...............',
  ".": '.............#.',
  ",": '..........#.#..',
  ":": '....#.....#....',
  ";": '....#.....#.#..',
  "!": '.#..#..#.....#.',
  "?": '###..#.##....#.',
  "'": '.#..#..........',
  "\"": '#.##.#.........',
  "-": '......###......',
  "+": '....#.###.#....',
  "=": '...###...###...',
  "/": '..#.#..#..#.#..',
  "(": '.#.#..#..#...#.',
  ")": '.#...#..#..#.#.',
  "[": '##.#..#..#..##.',
  "]": '.##..#..#..#.##',
  "<": '..#.#.#...#...#',
  ">": '#...#...#.#.#..',
  "*": '#.#.#.###.#.#.#',
  "#": '#.#####.#####.#',
  "%": '#.#..#.#.#..#.#',
  "&": '##.##..###.#.##',
  "_": '............###',
  "$": '.####..#..####.',
  "@": '.#.#.##.##...##',
  "♥": '#.#######.#....',
  "×": '...#.#.#.#.#...',
  // Icelandic (and Old English, Danish…) letters of their own.
  "Ð": '##.#.#####.###.',
  "Þ": '#..##.#.###.#..',
  "Æ": '.####.#####.#.#',
  "Ø": '.###.#####.###.',
};

/**
 * Letters with an accent: their letter, with the accent drawn in the pixel row above it (in the gap between lines):
 * acute one pixel in the middle, umlaut two, ring and caron as marks of their own.
 */
const ACCENTED: Record<string, [string, string]> = {
  "Á": ['A', '..#'], "É": ['E', '..#'], "Í": ['I', '..#'], "Ó": ['O', '..#'], "Ú": ['U', '...#'], "Ý": ['Y', '...#'],
  "À": ['A', '..#'], "È": ['E', '..#'], "Ò": ['O', '..#'], "Ù": ['U', '..#'],
  "Ä": ['A', '#.#'], "Ë": ['E', '#.#'], "Ï": ['I', '#.#'], "Ö": ['O', '#.#'], "Ü": ['U', '#.#'],
  "Â": ['A', '#.#'], "Ê": ['E', '#.#'], "Ô": ['O', '#.#'], "Å": ['A', '..#'],
};

/** The rows of a glyph (5 of 3, joined); lower case as capitals; unknown characters a small box. */
function glyph(ch: string): string {
  const accented = ACCENTED[ch] ?? ACCENTED[ch.toUpperCase()];
  if (accented) return GLYPHS[accented[0]];
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? '####.##.##.####';
}

/** The accent above a letter ("#" a pixel, from the letter's left; Ú's and Ý's reach one past it, clear of the letter's right stroke), or null. */
function accentOf(ch: string): string | null {
  return (ACCENTED[ch] ?? ACCENTED[ch.toUpperCase()])?.[1] ?? null;
}

/**
 * A pixel font: each character a bitmap (rows of "#" and ".", the first `top` rows above the line's top: negative
 * for an accent over a capital), `advance` pixels to the next character, `line` pixels to the next line, `h` the
 * capitals' height. The game picks the one that fits its sprites' pixel size (pixelFontFor).
 */
export interface PixelFont {
  name: string;
  w: number;
  h: number;
  advance: number;
  line: number;
  bitmap(ch: string): { rows: string[]; top: number };
}

/** The tiny 3×5 font (PICO-8 like; lower case as capitals), for games of 8×8 sprites. */
export const TINY_FONT: PixelFont = {
  name: 'tiny 3×5',
  w: W,
  h: H,
  advance: PIXEL_FONT_ADVANCE,
  line: PIXEL_FONT_LINE,
  bitmap(ch) {
    const g = glyph(ch);
    const rows = [0, 1, 2, 3, 4].map((r) => g.slice(r * W, r * W + W));
    const accent = accentOf(ch);
    return accent ? { rows: [accent, ...rows], top: -1 } : { rows, top: 0 };
  },
};

const ACUTE = ['...#.', '..#..'];
const UMLAUT = ['.....', '.#.#.'];

/** The 5×7 font with lower case (descenders one pixel below), for games of 16×16 sprites. */
export const FONT_5X7: PixelFont = {
  name: '5×7',
  w: 5,
  h: 7,
  advance: 6,
  // (12 apart: a capital's accent, two rows over it and a row clear, stays two rows below the descenders above.)
  line: 12,
  bitmap(ch) {
    const acc = ACCENTED_5X7[ch];
    if (acc) {
      const base = GLYPHS_5X7[acc[0]];
      const mark = acc[1] === 'acute' ? ACUTE : UMLAUT;
      // A small letter: the accent in its own empty top rows; a capital: above it, with a row between.
      if (acc[0] === acc[0].toLowerCase()) return { rows: [mark[0], mark[1], ...base.slice(2)], top: 0 };
      // (An acute slants up to the right over two rows, so it doesn't read as a dot.)
      return acc[1] === 'acute' ? { rows: ['...#.', '..#..', '.....', ...base], top: -3 } : { rows: ['.#.#.', '.....', ...base], top: -2 };
    }
    const g = GLYPHS_5X7[ch] ?? GLYPHS_5X7[ch.toUpperCase()] ?? GLYPHS_5X7[ch.toLowerCase()] ?? ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'];
    return { rows: g, top: 0 };
  },
};

/**
 * Scale2x (EPX): a bitmap twice as big, its diagonals smoothed instead of stair-stepped (a pixel takes a neighbor's
 * value where two of its neighbors agree and the others don't), so a bigger font has finer curves, not bigger blocks.
 */
export function scale2x(rows: string[]): string[] {
  const h = rows.length;
  const w = Math.max(0, ...rows.map((r) => r.length));
  const at = (x: number, y: number) => (rows[y]?.[x] ?? '.') === '#';
  const out: string[][] = Array.from({ length: h * 2 }, () => Array(w * 2).fill('.'));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = at(x, y);
      const a = at(x, y - 1);
      const b = at(x + 1, y);
      const c = at(x - 1, y);
      const d = at(x, y + 1);
      const e1 = c === a && c !== d && a !== b ? a : p;
      const e2 = a === b && a !== c && b !== d ? b : p;
      const e3 = d === c && d !== b && c !== a ? c : p;
      const e4 = b === d && b !== a && d !== c ? d : p;
      out[2 * y][2 * x] = e1 ? '#' : '.';
      out[2 * y][2 * x + 1] = e2 ? '#' : '.';
      out[2 * y + 1][2 * x] = e3 ? '#' : '.';
      out[2 * y + 1][2 * x + 1] = e4 ? '#' : '.';
    }
  return out.map((r) => r.join(''));
}

/** A font twice the size of `base`, smoothed (Scale2x): for games of finer sprites. */
function doubled(base: PixelFont, name: string): PixelFont {
  const cache = new Map<string, { rows: string[]; top: number }>();
  return {
    name,
    w: base.w * 2,
    h: base.h * 2,
    advance: base.advance * 2,
    line: base.line * 2,
    bitmap(ch) {
      let b = cache.get(ch);
      if (!b) {
        const g = base.bitmap(ch);
        b = { rows: scale2x(g.rows), top: g.top * 2 };
        cache.set(ch, b);
      }
      return b;
    },
  };
}

/** 10×14, for games of 32×32 sprites. */
export const FONT_10X14 = doubled(FONT_5X7, '10×14');
/** 20×28, for games of 64×64 sprites. */
export const FONT_20X28 = doubled(FONT_10X14, '20×28');

/**
 * The pixel font for a game whose sprites are `resolution` pixels a square (its sprite size: 8, 16, 32 or 64): the
 * finer the sprites, the more detailed the letters, each of their pixels one of the game's.
 */
export function pixelFontFor(resolution: number | undefined): PixelFont {
  const r = resolution ?? 32;
  return r <= 8 ? TINY_FONT : r <= 16 ? FONT_5X7 : r <= 32 ? FONT_10X14 : FONT_20X28;
}

/** How wide and tall a text is in font pixels (several lines split at "\n"). */
export function pixelTextSize(text: string, font: PixelFont = TINY_FONT): { w: number; h: number } {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => [...l].length));
  return { w: Math.max(0, longest * font.advance - (font.advance - font.w)), h: lines.length * font.line - (font.line - font.h) };
}

/**
 * Draws text with its top-left at (x, y), `scale` canvas pixels per font pixel (in the context's current transform,
 * which should map one unit to one canvas pixel for sharp text), in the current fillStyle.
 */
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, font: PixelFont = TINY_FONT): void {
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const chars = [...lines[li]];
    for (let ci = 0; ci < chars.length; ci++) {
      const { rows, top } = font.bitmap(chars[ci]);
      const gx = x + ci * font.advance * scale;
      const gy = y + (li * font.line + top) * scale;
      for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        // (Runs of pixels as one rectangle: far fewer calls for the big fonts.)
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== '#') continue;
          let e = c;
          while (row[e + 1] === '#') e++;
          ctx.fillRect(gx + c * scale, gy + r * scale, (e - c + 1) * scale, scale);
          c = e;
        }
      }
    }
  }
}

/** The fonts from the most detailed down: text too small for a game's own font steps down to a smaller one. */
const FAMILY = [FONT_20X28, FONT_10X14, FONT_5X7, TINY_FONT];

/**
 * The font and scale for text meant to be `tall` canvas pixels, in a game whose font is `font` and whose picture
 * pixels are `cell` canvas pixels: that font (whole cells per font pixel) when it fits, else the next smaller one
 * that does (never finer than a picture pixel), the tiny one at the least.
 */
export function fitPixelFont(tall: number, cell: number, font: PixelFont = TINY_FONT): { font: PixelFont; scale: number } {
  const cap = tall * 0.7;
  for (const f of FAMILY.slice(Math.max(0, FAMILY.indexOf(font)))) {
    if (f.h * cell <= cap * 1.25 || f === TINY_FONT) return { font: f, scale: cell * Math.max(1, Math.round(cap / f.h / cell)) };
  }
  return { font: TINY_FONT, scale: cell };
}
