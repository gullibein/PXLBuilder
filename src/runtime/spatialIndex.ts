/**
 * Where things are, by grid cell, for scripts' point questions ("what is at
 * x, y", "is a wall at x, y") and tag lookups ("player"): without it each
 * question looks at every thing in the level, which a level of hundreds of
 * boulders, each asking a dozen questions a step, can't afford. Built from
 * the level as it is when first asked, and valid only until something moves,
 * appears, goes or changes its tags (the script system drops it then).
 * Answers are exactly those of looking at everything in order: the first
 * match in the level's order is the one found.
 */
import type { Box } from './physics';

const CELL = 64;
/** A box covering more cells than this is kept apart and always checked (a huge background thing). */
const MAX_CELLS = 64;

const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768);

interface Entry<T> {
  order: number;
  item: T;
  box: Box;
}

/** Items with boxes, found by a point. */
export class PointGrid<T> {
  private readonly cells = new Map<number, Entry<T>[]>();
  private readonly big: Entry<T>[] = [];
  private readonly items: readonly T[];

  constructor(items: readonly T[], boxOf: (item: T) => Box | null) {
    this.items = items;
    items.forEach((item, order) => {
      const box = boxOf(item);
      if (!box || !(box.hw >= 0) || !(box.hh >= 0)) return;
      const entry = { order, item, box };
      const x0 = Math.floor((box.x - box.hw) / CELL);
      const x1 = Math.floor((box.x + box.hw) / CELL);
      const y0 = Math.floor((box.y - box.hh) / CELL);
      const y1 = Math.floor((box.y + box.hh) / CELL);
      if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
        this.big.push(entry);
        return;
      }
      for (let cx = x0; cx <= x1; cx++)
        for (let cy = y0; cy <= y1; cy++) {
          const k = key(cx, cy);
          const list = this.cells.get(k);
          if (list) list.push(entry);
          else this.cells.set(k, [entry]);
        }
    });
  }

  protected cellAt(cx: number, cy: number): readonly Entry<T>[] {
    return this.cells.get(key(cx, cy)) ?? [];
  }

  protected bigOnes(): readonly Entry<T>[] {
    return this.big;
  }

  protected all(): T[] {
    return [...this.items];
  }

  /** The first item (in the given order) whose box holds the point strictly inside and that `accept` takes. */
  first(x: number, y: number, accept: (item: T) => boolean = () => true): T | null {
    const inside = (e: Entry<T>) => Math.abs(x - e.box.x) < e.box.hw && Math.abs(y - e.box.y) < e.box.hh && accept(e.item);
    const list = this.cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? [];
    const hit = list.find(inside) ?? null;
    if (!this.big.length) return hit?.item ?? null;
    const bigHit = this.big.find(inside) ?? null;
    if (!hit || !bigHit) return (hit ?? bigHit)?.item ?? null;
    return (hit.order < bigHit.order ? hit : bigHit).item;
  }
}

/** Items with boxes, found by a box: those in the cells it covers (whose boxes may touch it), in the given order. */
export class BoxGrid<T> extends PointGrid<T> {
  near(box: Box): T[] {
    const found = new Set<Entry<T>>();
    const x0 = Math.floor((box.x - box.hw) / CELL);
    const x1 = Math.floor((box.x + box.hw) / CELL);
    const y0 = Math.floor((box.y - box.hh) / CELL);
    const y1 = Math.floor((box.y + box.hh) / CELL);
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) return this.all();
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) for (const e of this.cellAt(cx, cy)) found.add(e);
    for (const e of this.bigOnes()) found.add(e);
    return [...found].sort((a, b) => a.order - b.order).map((e) => e.item);
  }
}

/** Things grouped by tag, in the level's order. */
export function byTag<T extends { tags: readonly string[] }>(items: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items)
    for (const tag of item.tags) {
      const list = out.get(tag);
      if (list) list.push(item);
      else out.set(tag, [item]);
    }
  return out;
}
