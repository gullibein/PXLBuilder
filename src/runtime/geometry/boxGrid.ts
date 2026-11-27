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
  /**
   * The list, each box in its own place: `null` where a box is out for now (a tile dug out, a door open). The
   * order of the places is the list's order, so a box put back is found where it was. `boxes` is the list itself.
   */
  private readonly slots: (T | null)[];
  private dense: readonly T[] | null;

  constructor(list: readonly (T | null)[]) {
    this.slots = list as (T | null)[];
    this.dense = list.includes(null) ? null : (list as readonly T[]);
    this.seen = new Uint32Array(list.length);
    for (let i = 0; i < list.length; i++) if (list[i]) this.file(i, list[i]!, false);
  }

  /** The list: every box that is in, in order. */
  get boxes(): readonly T[] {
    return (this.dense ??= this.slots.filter((b): b is T => b !== null));
  }

  /** How many places the list has (boxes in and out). */
  get places(): number {
    return this.slots.length;
  }

  /** The box in place `i` is now this one (moved, changed), or out (`null`). Everything else stays as it is. */
  set(i: number, box: T | null): void {
    const was = this.slots[i];
    if (was) this.unfile(i, was);
    this.slots[i] = box;
    if (box) this.file(i, box, true);
    this.dense = null;
  }

  private squares(b: Box): [number, number, number, number] | 'none' | 'big' {
    const x0 = Math.floor((b.x - b.hw) / SIZE);
    const x1 = Math.floor((b.x + b.hw) / SIZE);
    const y0 = Math.floor((b.y - b.hh) / SIZE);
    const y1 = Math.floor((b.y + b.hh) / SIZE);
    // (A box with no size, or one not a number, overlaps nothing: found nowhere, as in the list.)
    if (!(x1 >= x0) || !(y1 >= y0)) return 'none';
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_SQUARES || !Number.isFinite(x0 + x1 + y0 + y1)) return 'big';
    return [x0, y0, x1, y1];
  }

  /** `sorted`: the place may come before ones already filed (a box put back): kept in order. */
  private file(i: number, b: T, sorted: boolean): void {
    const sq = this.squares(b);
    if (sq === 'none') return;
    if (sq === 'big') {
      if (sorted) insertSorted(this.big, i);
      else this.big.push(i);
      return;
    }
    for (let cx = sq[0]; cx <= sq[2]; cx++)
      for (let cy = sq[1]; cy <= sq[3]; cy++) {
        const k = key(cx, cy);
        const cell = this.cells.get(k);
        if (!cell) this.cells.set(k, [i]);
        else if (sorted) insertSorted(cell, i);
        else cell.push(i);
      }
  }

  private unfile(i: number, b: T): void {
    const sq = this.squares(b);
    if (sq === 'none') return;
    if (sq === 'big') {
      const at = this.big.indexOf(i);
      if (at >= 0) this.big.splice(at, 1);
      return;
    }
    for (let cx = sq[0]; cx <= sq[2]; cx++)
      for (let cy = sq[1]; cy <= sq[3]; cy++) {
        const cell = this.cells.get(key(cx, cy));
        if (!cell) continue;
        const at = cell.indexOf(i);
        if (at >= 0) cell.splice(at, 1);
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
    for (let k = 0; k < ids.length; k++) out[k] = this.slots[ids[k]]!;
    return out;
  }

  /** Whether any box of the list overlaps the box (physics.ts `overlaps`, the same test: touching edges don't). */
  overlapsAny(box: Box): boolean {
    const ids = this.indices(box.x - box.hw, box.y - box.hh, box.x + box.hw, box.y + box.hh);
    if (!ids) return this.boxes.some((s) => overlaps(box, s));
    for (const i of ids) if (overlaps(box, this.slots[i]!)) return true;
    return false;
  }

  /** Whether the point is inside any box of the list. */
  holds(x: number, y: number): boolean {
    const ids = this.indices(x, y, x, y);
    if (!ids) return this.boxes.some((s) => Math.abs(x - s.x) < s.hw && Math.abs(y - s.y) < s.hh);
    for (const i of ids) {
      const s = this.slots[i]!;
      if (Math.abs(x - s.x) < s.hw && Math.abs(y - s.y) < s.hh) return true;
    }
    return false;
  }
}

/** `i` put into a list of numbers kept in rising order (a short list: a grid square's, or the few big boxes). */
function insertSorted(list: number[], i: number): void {
  let at = list.length;
  while (at > 0 && list[at - 1] > i) at--;
  list.splice(at, 0, i);
}
