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

/**
 * A PointGrid/BoxGrid kept from step to step: `sync` looks at every item but only moves those whose box changed
 * (and adds new ones, drops those that went), instead of filing the whole level again. In a big level almost nothing
 * moves (the dirt, the walls), so that is a quick look rather than thousands of grid insertions, every step.
 *
 * Items are kept in the order of the array given to sync, which may only grow between syncs (new things at its
 * end); a different array, or a shorter one, files everything again. Answers are those of a PointGrid/BoxGrid built
 * from the items whose box is not null, in that order.
 */
export class LiveGrid<T> {
  private source: readonly T[] | null = null;
  private entries: (LiveEntry<T> | null)[] = [];
  private readonly cells = new Map<number, LiveEntry<T>[]>();
  private big: LiveEntry<T>[] = [];

  sync(items: readonly T[], boxOf: (item: T) => Box | null): void {
    if (items !== this.source || items.length < this.entries.length) {
      this.source = items;
      this.entries = [];
      this.cells.clear();
      this.big = [];
    }
    for (let order = 0; order < items.length; order++) {
      const box = boxOf(items[order]);
      const ok = !!box && box.hw >= 0 && box.hh >= 0;
      const was = this.entries[order] ?? null;
      if (was && ok && was.box.x === box.x && was.box.y === box.y && was.box.hw === box.hw && was.box.hh === box.hh) continue;
      if (was) this.unfile(was);
      this.entries[order] = ok ? this.file({ order, item: items[order], box: { ...box }, keys: [] }) : null;
    }
  }

  private file(e: LiveEntry<T>): LiveEntry<T> {
    const x0 = Math.floor((e.box.x - e.box.hw) / CELL);
    const x1 = Math.floor((e.box.x + e.box.hw) / CELL);
    const y0 = Math.floor((e.box.y - e.box.hh) / CELL);
    const y1 = Math.floor((e.box.y + e.box.hh) / CELL);
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) {
      insertByOrder(this.big, e);
      return e;
    }
    for (let cx = x0; cx <= x1; cx++)
      for (let cy = y0; cy <= y1; cy++) {
        const k = key(cx, cy);
        e.keys.push(k);
        const list = this.cells.get(k);
        if (list) insertByOrder(list, e);
        else this.cells.set(k, [e]);
      }
    return e;
  }

  private unfile(e: LiveEntry<T>): void {
    if (!e.keys.length) {
      this.big.splice(this.big.indexOf(e), 1);
      return;
    }
    for (const k of e.keys) {
      const list = this.cells.get(k)!;
      list.splice(list.indexOf(e), 1);
      if (!list.length) this.cells.delete(k);
    }
  }

  /** As PointGrid.first. */
  first(x: number, y: number, accept: (item: T) => boolean = () => true): T | null {
    const inside = (e: LiveEntry<T>) => Math.abs(x - e.box.x) < e.box.hw && Math.abs(y - e.box.y) < e.box.hh && accept(e.item);
    const hit = (this.cells.get(key(Math.floor(x / CELL), Math.floor(y / CELL))) ?? []).find(inside) ?? null;
    const bigHit = this.big.length ? (this.big.find(inside) ?? null) : null;
    if (!hit || !bigHit) return (hit ?? bigHit)?.item ?? null;
    return (hit.order < bigHit.order ? hit : bigHit).item;
  }

  /** As BoxGrid.near. */
  near(box: Box): T[] {
    const x0 = Math.floor((box.x - box.hw) / CELL);
    const x1 = Math.floor((box.x + box.hw) / CELL);
    const y0 = Math.floor((box.y - box.hh) / CELL);
    const y1 = Math.floor((box.y + box.hh) / CELL);
    if (!Number.isFinite(x0 + x1 + y0 + y1) || (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_CELLS) return this.entries.filter((e): e is LiveEntry<T> => e !== null).map((e) => e.item);
    const found = new Set<LiveEntry<T>>();
    for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) for (const e of this.cells.get(key(cx, cy)) ?? []) found.add(e);
    for (const e of this.big) found.add(e);
    return [...found].sort((a, b) => a.order - b.order).map((e) => e.item);
  }
}

interface LiveEntry<T> {
  order: number;
  item: T;
  box: Box;
  /** The cells it is filed under (none: with the big ones). */
  keys: number[];
}

/** Into a list kept in order (lists per cell are short). */
function insertByOrder<T>(list: LiveEntry<T>[], e: LiveEntry<T>): void {
  let i = list.length;
  while (i > 0 && list[i - 1].order > e.order) i--;
  list.splice(i, 0, e);
}
