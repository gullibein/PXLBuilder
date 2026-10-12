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

/** A body sunk at most this far into the top of a floor is lifted back onto it. */
const MAX_SINK = 4;

/**
 * Moves `box` by (dx, dy) against static `solids`, x first, then y.
 *
 * A body that starts a step a little inside something (sunk a pixel or two into a floor: placed so, resized, or
 * put there by a script) is first lifted out onto it, and moving sideways never snaps it to the far side of a
 * solid it already overlaps (that used to throw it to the end of a whole row of floor tiles).
 */
export function moveAndCollide(box: Box, dx: number, dy: number, solids: readonly Box[]): MoveResult {
  let { x, y } = box;
  let hitX = false;
  let hitY = false;
  let grounded = false;
  let hitCeiling = false;

  for (const s of solids) {
    if (!overlaps({ ...box, x, y }, s)) continue;
    const sunk = y + box.hh - (s.y - s.hh);
    if (y < s.y && sunk > 0 && sunk <= MAX_SINK) {
      y -= sunk;
      grounded = true;
    }
  }
  const start = { ...box, x, y };
  if (dx !== 0) {
    x += dx;
    for (const s of solids) {
      if (overlaps(start, s) || !overlaps({ ...box, x, y }, s)) continue;
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
