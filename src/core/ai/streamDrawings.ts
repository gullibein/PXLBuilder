/**
 * The sprites the AI has finished drawing, read from its answer while it is still being written (the answer is one
 * JSON object that comes in bit by bit: a whole game's can take minutes). Each draw_sprite operation is a JSON
 * object of its own inside it: once its closing brace has come, it is complete and can be shown (the building
 * window shows them while the rest of the game is still being written). Fed the whole answer so far each time;
 * it only reads what is new.
 */
export interface StreamedDrawing {
  /** The object it is for (its id, or the ref a create_definition gave it), when said. */
  id?: string;
  name: string;
  palette: { key: string; color: string }[];
  rows: string[];
}

export class DrawingScanner {
  private pos = 0;
  /** Where each object still open began. */
  private open: number[] = [];
  private inString = false;
  private escaped = false;
  private seen = new Set<string>();

  constructor(private readonly found: (drawing: StreamedDrawing) => void) {}

  /** The whole answer so far (each time a bit longer). */
  feed(text: string): void {
    // (Not a continuation of what came before: a new answer, read from its start.)
    if (text.length < this.pos) this.reset();
    for (let i = this.pos; i < text.length; i++) {
      const c = text[i];
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') this.inString = false;
        continue;
      }
      if (c === '"') this.inString = true;
      else if (c === '{') this.open.push(i);
      else if (c === '}') {
        const start = this.open.pop();
        if (start !== undefined) this.closed(text.slice(start, i + 1));
      }
    }
    this.pos = text.length;
  }

  private reset(): void {
    this.pos = 0;
    this.open = [];
    this.inString = false;
    this.escaped = false;
  }

  private closed(json: string): void {
    // (Cheap test first: most objects are anything but a drawing.)
    if (!json.includes('draw_sprite')) return;
    let v: unknown;
    try {
      v = JSON.parse(json);
    } catch {
      return;
    }
    const o = v as Record<string, unknown>;
    // A picture for a situation (running, hurt…) is not the object's own look.
    if (o?.op !== 'draw_sprite' || (typeof o.situation === 'string' && o.situation !== '') || typeof o.name !== 'string') return;
    if (!Array.isArray(o.rows) || !o.rows.length || !o.rows.every((r) => typeof r === 'string')) return;
    if (!Array.isArray(o.palette) || !o.palette.every((p) => p && typeof (p as { key?: unknown }).key === 'string' && typeof (p as { color?: unknown }).color === 'string')) return;
    const key = `${o.name}\n${(o.rows as string[]).join('\n')}`;
    if (this.seen.has(key)) return;
    this.seen.add(key);
    this.found({ ...(typeof o.id === 'string' ? { id: o.id } : {}), name: o.name, palette: o.palette as StreamedDrawing['palette'], rows: o.rows as string[] });
  }
}

/** A level map the AI is writing (draw_map): what each character is, and the rows written so far. */
export interface LevelSketch {
  legend: { char: string; object: string }[];
  rows: string[];
  /** Objects it made in the answer so far: their ref and name (a legend may name either). */
  names: Record<string, string>;
}

const STRING = '"((?:[^"\\\\]|\\\\.)*)"';

/**
 * The level map being written in the answer so far: the last draw_map whose rows have begun, with the rows that are
 * complete (a row still being written is left out). Null before there is one.
 */
export function levelSketch(text: string): LevelSketch | null {
  const starts = [...text.matchAll(/"op"\s*:\s*"draw_map"/g)].map((m) => m.index!);
  const names: Record<string, string> = {};
  for (const m of text.matchAll(new RegExp(`"op"\\s*:\\s*"create_definition"[^{}]*?"ref"\\s*:\\s*${STRING}[^{}]*?"name"\\s*:\\s*${STRING}`, 'g'))) names[unescape(m[1])] = unescape(m[2]);
  for (let k = starts.length - 1; k >= 0; k--) {
    // (Its own part of the answer: up to the next operation.)
    const from = text.lastIndexOf('{', starts[k]);
    const next = text.indexOf('"op"', starts[k] + 10);
    const part = text.slice(Math.max(0, from), next < 0 ? undefined : next);
    const rowsAt = part.search(/"rows"\s*:\s*\[/);
    if (rowsAt < 0) continue;
    const rows = completeStrings(part, part.indexOf('[', rowsAt) + 1);
    const legend: LevelSketch['legend'] = [];
    for (const m of part.matchAll(new RegExp(`"char"\\s*:\\s*${STRING}\\s*,\\s*"object"\\s*:\\s*${STRING}`, 'g'))) legend.push({ char: unescape(m[1]), object: unescape(m[2]) });
    for (const m of part.matchAll(new RegExp(`"object"\\s*:\\s*${STRING}\\s*,\\s*"char"\\s*:\\s*${STRING}`, 'g'))) legend.push({ char: unescape(m[2]), object: unescape(m[1]) });
    if (!rows.length) continue;
    return { legend, rows, names };
  }
  return null;
}

/** The strings of a JSON list from `at` (just after its "["), as far as they are complete (one still being written is left out). */
function completeStrings(text: string, at: number): string[] {
  const out: string[] = [];
  let i = at;
  for (;;) {
    while (i < text.length && /[\s,]/.test(text[i])) i++;
    if (i >= text.length || text[i] !== '"') return out;
    let j = i + 1;
    while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
    if (j >= text.length) return out;
    out.push(unescape(text.slice(i + 1, j)));
    i = j + 1;
  }
}

function unescape(s: string): string {
  try {
    return JSON.parse(`"${s}"`) as string;
  } catch {
    return s;
  }
}
