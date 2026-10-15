/**
 * A tiny pixel font, like PICO-8's: every character 3×5 pixels, 4 pixels
 * apart, lines 6 pixels apart. Used for text in a game drawn at a low
 * resolution, where an ordinary font would be 2 or 3 pixels tall and smear
 * into an unreadable blur. Drawn as whole canvas pixels, so it stays sharp.
 * Lower-case letters are drawn as capitals (as on PICO-8).
 */

const W = 3;
const H = 5;
/** Pixels from one character to the next, and from one line to the next. */
export const PIXEL_FONT_ADVANCE = 4;
export const PIXEL_FONT_LINE = 6;

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
};

/** The rows of a glyph (5 of 3, joined); lower case as capitals; unknown characters a small box. */
function glyph(ch: string): string {
  return GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? '####.##.##.####';
}

/** How wide and tall a text is in font pixels (several lines split at "\n"). */
export function pixelTextSize(text: string): { w: number; h: number } {
  const lines = text.split('\n');
  const longest = Math.max(...lines.map((l) => [...l].length));
  return { w: Math.max(0, longest * PIXEL_FONT_ADVANCE - 1), h: lines.length * PIXEL_FONT_LINE - 1 };
}

/**
 * Draws text with its top-left at (x, y), `scale` canvas pixels per font pixel (in the context's current transform,
 * which should map one unit to one canvas pixel for sharp text), in the current fillStyle.
 */
export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number): void {
  const lines = text.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const chars = [...lines[li]];
    for (let ci = 0; ci < chars.length; ci++) {
      const rows = glyph(chars[ci]);
      const gx = x + ci * PIXEL_FONT_ADVANCE * scale;
      const gy = y + li * PIXEL_FONT_LINE * scale;
      for (let r = 0; r < H; r++) {
        for (let c = 0; c < W; c++) if (rows[r * W + c] === '#') ctx.fillRect(gx + c * scale, gy + r * scale, scale, scale);
      }
    }
  }
}
