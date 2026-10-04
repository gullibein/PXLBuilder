/**
 * Arcade physics for a 2D platformer: axis-aligned boxes, no rotation.
 *
 * Moving bodies move one axis at a time and stop at the first solid they
 * would enter, so they land exactly on top of tiles and never snag on the
 * seams between neighbouring tiles (touching is not overlapping).
 */
export interface Box {
  x: number; // center
  y: number;
  hw: number; // half width
  hh: number; // half height
}

const EPS = 1e-6;

export function overlaps(a: Box, b: Box): boolean {
  return Math.abs(a.x - b.x) < a.hw + b.hw - EPS && Math.abs(a.y - b.y) < a.hh + b.hh - EPS;
}

export interface MoveResult {
  x: number;
  y: number;
  hitX: boolean;
  hitY: boolean;
  /** Landed on something while moving down. */
  grounded: boolean;
  hitCeiling: boolean;
}

/** Moves `box` by (dx, dy) against static `solids`, x first, then y. */
export function moveAndCollide(box: Box, dx: number, dy: number, solids: readonly Box[]): MoveResult {
  let { x, y } = box;
  let hitX = false;
  let hitY = false;
  let grounded = false;
  let hitCeiling = false;

  if (dx !== 0) {
    x += dx;
    for (const s of solids) {
      if (!overlaps({ ...box, x, y }, s)) continue;
      x = dx > 0 ? s.x - s.hw - box.hw : s.x + s.hw + box.hw;
      hitX = true;
    }
  }
  if (dy !== 0) {
    y += dy;
    for (const s of solids) {
      if (!overlaps({ ...box, x, y }, s)) continue;
      if (dy > 0) {
        y = s.y - s.hh - box.hh;
        grounded = true;
      } else {
        y = s.y + s.hh + box.hh;
        hitCeiling = true;
      }
      hitY = true;
    }
  }
  return { x, y, hitX, hitY, grounded, hitCeiling };
}

/** True when a solid is directly under the box (within `gap` px), e.g. standing still on a platform. */
export function standingOn(box: Box, solids: readonly Box[], gap = 0.5): boolean {
  const probe = { ...box, y: box.y + gap };
  return solids.some((s) => overlaps(probe, s));
}
