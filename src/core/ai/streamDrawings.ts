/**
 * The sprites the AI has finished drawing, read from its answer while it is still being written (the answer is one
 * JSON object that comes in bit by bit: a whole game's can take minutes). Each draw_sprite operation is a JSON
 * object of its own inside it: once its closing brace has come, it is complete and can be shown (the building
 * window shows them while the rest of the game is still being written). Fed the whole answer so far each time;
 * it only reads what is new.
 */
export interface StreamedDrawing {
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
    this.found({ name: o.name, palette: o.palette as StreamedDrawing['palette'], rows: o.rows as string[] });
  }
}
