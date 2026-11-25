/**
 * Rectangles found by place (docs §30, W1): for the checks that ask, of every thing in a level, "is there another
 * one here?". Asked of every other thing, that is as many looks as the square of the level's size; asked of the
 * things filed near, it is a few. `near` gives every item whose rectangle touches the area asked about, and may
 * give others close by: what is asked of them afterwards is the same test as before, so the answer is the same.
 */
export interface Rect4 {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

const SIZE = 64;
const key = (cx: number, cy: number) => (cx + 0x8000) * 0x10000 + (cy + 0x8000);

export class RectIndex<T> {
  private readonly cells = new Map<number, T[]>();
  /** Too big for the grid, or not a number: always given. */
  private readonly big: T[] = [];

  add(r: Rect4, item: T): void {
    const x0 = Math.floor(r.left / SIZE);
    const x1 = Math.floor(r.right / SIZE);
    const y0 = Math.floor(r.top / SIZE);
    const y1 = Math.floor(r.bottom / SIZE);
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > 1024) {
      this.big.push(item);
      return;
    }
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        const cell = this.cells.get(k);
        if (cell) cell.push(item);
        else this.cells.set(k, [item]);
      }
  }

  /** Every item whose rectangle touches the area (edges count), each once; null: the area is too wide, ask them all. */
  near(r: Rect4): Set<T> | null {
    const x0 = Math.floor(r.left / SIZE);
    const x1 = Math.floor(r.right / SIZE);
    const y0 = Math.floor(r.top / SIZE);
    const y1 = Math.floor(r.bottom / SIZE);
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > 4096) return null;
    const out = new Set<T>(this.big);
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.cells.get(key(cx, cy));
        if (cell) for (const item of cell) out.add(item);
      }
    return out;
  }
}
