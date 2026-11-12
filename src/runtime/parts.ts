/** Colliders made of several boxes (Collider shape "boxes"): what an entity is made of, and touching by its parts. */
import { overlaps, type Box } from './physics';
import type { RuntimeEntity } from './runtime';
/** The boxes it is made of where it is now: its parts (a collider of several boxes), else its one box. */
export function partsOf(e: RuntimeEntity): Box[] {
  const c = e.collider;
  if (!c) return [];
  if (c.parts?.length) return c.parts.map((p) => ({ x: e.x + p.ox, y: e.y + p.oy, hw: p.hw, hh: p.hh }));
  return [{ x: e.x + c.ox, y: e.y + c.oy, hw: c.hw, hh: c.hh }];
}

/** `box` (grown by `slop` each way) overlaps one of what `e` is made of. */
export function touchesParts(box: Box, e: RuntimeEntity, slop = 0): boolean {
  const b = slop ? { ...box, hw: box.hw + slop, hh: box.hh + slop } : box;
  return partsOf(e).some((p) => overlaps(b, p));
}

/** Two things touch: one of the parts of each overlaps (the first grown by `slop`). */
export function partsTouch(a: RuntimeEntity, b: RuntimeEntity, slop = 0): boolean {
  return partsOf(a).some((p) => touchesParts(p, b, slop));
}
