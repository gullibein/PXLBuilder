/**
 * Boxes found by place (docs §30, W1): the level's walls and floors in a grid of cells, so a question about one
 * spot looks at the boxes near it and not at every box in the level. What it answers is exactly what looking at
 * the whole list in its order answers: `near` gives the boxes that can overlap a region as a sub-list IN THE LIST'S
 * ORDER (collision resolves against boxes one after another, so order is part of the answer), and `some` / `first`
 * are the list's own, asked of that sub-list.
 */
import { overlaps, type Box } from '../physics';

/** Grid squares, in pixels (four tiles). */
const SIZE = 128;
/** A box covering more squares than this is kept apart and always looked at (a huge wall, a floor a level long). */
const MAX_SQUARES = 256;

const key = (cx: number, cy: number) => (cx + 0x8000) * 0x10000 + (cy + 0x8000);

export class BoxGrid<T extends Box = Box> {
  private readonly cells = new Map<number, number[]>();
  /** Indices of the boxes too big for the grid, in order. */
  private readonly big: number[] = [];
  private readonly seen: Uint32Array;
  private stamp = 0;

  constructor(readonly boxes: readonly T[]) {
    this.seen = new Uint32Array(boxes.length);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      const x0 = Math.floor((b.x - b.hw) / SIZE);
      const x1 = Math.floor((b.x + b.hw) / SIZE);
      const y0 = Math.floor((b.y - b.hh) / SIZE);
      const y1 = Math.floor((b.y + b.hh) / SIZE);
      // (A box with no size, or one not a number, overlaps nothing: found nowhere, as in the list.)
      if (!(x1 >= x0) || !(y1 >= y0)) continue;
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_SQUARES || !Number.isFinite(x0 + x1 + y0 + y1)) {
        this.big.push(i);
        continue;
      }
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = key(cx, cy);
          const cell = this.cells.get(k);
          if (cell) cell.push(i);
          else this.cells.set(k, [i]);
        }
    }
  }

  /** Indices of the boxes whose squares the region touches, in the list's order. Null: too wide a region (ask the list). */
  private indices(x0: number, y0: number, x1: number, y1: number): number[] | null {
    const cx0 = Math.floor(x0 / SIZE);
    const cx1 = Math.floor(x1 / SIZE);
    const cy0 = Math.floor(y0 / SIZE);
    const cy1 = Math.floor(y1 / SIZE);
    if (!Number.isFinite(cx0 + cx1 + cy0 + cy1) || (cx1 - cx0 + 1) * (cy1 - cy0 + 1) > 4096) return null;
    if (++this.stamp === 0xffffffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const out: number[] = [];
    for (const i of this.big) out.push(i);
    for (let cx = cx0; cx <= cx1; cx++)
      for (let cy = cy0; cy <= cy1; cy++) {
        const cell = this.cells.get(key(cx, cy));
        if (!cell) continue;
        for (const i of cell)
          if (this.seen[i] !== this.stamp) {
            this.seen[i] = this.stamp;
            out.push(i);
          }
      }
    if (out.length > 1) out.sort((a, b) => a - b);
    return out;
  }

  /**
   * The boxes that can overlap the region (its middle and half sizes), in the list's order: every box of the list
   * that overlaps it is among them (others near it may be too).
   */
  near(region: Box): readonly T[] {
    const ids = this.indices(region.x - region.hw, region.y - region.hh, region.x + region.hw, region.y + region.hh);
    if (!ids) return this.boxes;
    const out = new Array<T>(ids.length);
    for (let k = 0; k < ids.length; k++) out[k] = this.boxes[ids[k]];
    return out;
  }

  /** Whether any box of the list overlaps the box (physics.ts `overlaps`, the same test: touching edges don't). */
  overlapsAny(box: Box): boolean {
    const ids = this.indices(box.x - box.hw, box.y - box.hh, box.x + box.hw, box.y + box.hh);
    if (!ids) return this.boxes.some((s) => overlaps(box, s));
    for (const i of ids) if (overlaps(box, this.boxes[i])) return true;
    return false;
  }

  /** Whether the point is inside any box of the list. */
  holds(x: number, y: number): boolean {
    const ids = this.indices(x, y, x, y);
    if (!ids) return this.boxes.some((s) => Math.abs(x - s.x) < s.hw && Math.abs(y - s.y) < s.hh);
    for (const i of ids) {
      const s = this.boxes[i];
      if (Math.abs(x - s.x) < s.hw && Math.abs(y - s.y) < s.hh) return true;
    }
    return false;
  }
}
