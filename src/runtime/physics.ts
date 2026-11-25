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
  /** A surface's PhysicsBody.friction (how much grip things standing on it get); missing = the default. */
  friction?: number;
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
export function moveAndCollide(box: Box, dx: number, dy: number, solids: readonly Box[], went?: Went): MoveResult {
  let { x, y } = box;
  let hitX = false;
  let hitY = false;
  let grounded = false;
  let hitCeiling = false;
  if (went) note(went, x, y);

  for (const s of solids) {
    if (!overlaps({ ...box, x, y }, s)) continue;
    const sunk = y + box.hh - (s.y - s.hh);
    if (y < s.y && sunk > 0 && sunk <= MAX_SINK) {
      y -= sunk;
      grounded = true;
      if (went) note(went, x, y);
    }
  }
  const start = { ...box, x, y };
  if (dx !== 0) {
    x += dx;
    if (went) note(went, x, y);
    for (const s of solids) {
      if (overlaps(start, s) || !overlaps({ ...box, x, y }, s)) continue;
      x = dx > 0 ? s.x - s.hw - box.hw : s.x + s.hw + box.hw;
      hitX = true;
      if (went) note(went, x, y);
    }
  }
  if (dy !== 0) {
    y += dy;
    if (went) note(went, x, y);
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
      if (went) note(went, x, y);
    }
  }
  return { x, y, hitX, hitY, grounded, hitCeiling };
}

/**
 * Everywhere a box's middle was while a move was worked out (it is put on top of what it sank into, moved, set
 * back against what it ran into): the corners of the area that holds them all. A move worked out against only the
 * surfaces near a box is the move against all of them exactly when the box never left the area "near" was asked
 * for: a surface that overlaps the box anywhere it was is then among those looked at, in its place in the order
 * (docs §30, W1). `moveNear` does that and, when the box did leave, asks again with all of them.
 */
export interface Went {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export const nowhere = (): Went => ({ x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });

function note(w: Went, x: number, y: number): void {
  if (x < w.x0) w.x0 = x;
  if (x > w.x1) w.x1 = x;
  if (y < w.y0) w.y0 = y;
  if (y > w.y1) w.y1 = y;
}

/** How far round a moving box surfaces are looked up (pixels beyond where the move takes it). */
export const NEAR = 48;

/** The area to look surfaces up in for a box moving by (dx, dy). */
export function reachOf(box: Box, dx: number, dy: number): Box {
  return { x: box.x + dx / 2, y: box.y + dy / 2, hw: box.hw + Math.abs(dx) / 2 + NEAR, hh: box.hh + Math.abs(dy) / 2 + NEAR };
}

/** Whether a box of this size stayed inside the area looked up, everywhere it was (with a pixel to spare, for the checks under its feet that follow). */
export function stayedIn(w: Went, box: Box, reach: Box): boolean {
  return w.x0 - box.hw >= reach.x - reach.hw + 1 && w.x1 + box.hw <= reach.x + reach.hw - 1 && w.y0 - box.hh >= reach.y - reach.hh + 1 && w.y1 + box.hh <= reach.y + reach.hh - 1;
}

/** Whether a box lies inside the area looked up, with a pixel to spare. */
export function liesIn(box: Box, reach: Box): boolean {
  return box.x - box.hw >= reach.x - reach.hw + 1 && box.x + box.hw <= reach.x + reach.hw - 1 && box.y - box.hh >= reach.y - reach.hh + 1 && box.y + box.hh <= reach.y + reach.hh - 1;
}

/**
 * moveAndCollide against the surfaces `near(reach)` gives (those that can overlap the area, in the full list's
 * order), with exactly the result the full list gives: when the box left the area on the way (pushed far out of
 * something it was deep inside), it is worked out again against `all()`.
 */
export function moveNear(box: Box, dx: number, dy: number, near: (reach: Box) => readonly Box[], all: () => readonly Box[]): MoveResult {
  const reach = reachOf(box, dx, dy);
  const went = nowhere();
  const r = moveAndCollide(box, dx, dy, near(reach), went);
  return stayedIn(went, box, reach) ? r : moveAndCollide(box, dx, dy, all());
}

/** True when a solid is directly under the box (within `gap` px), e.g. standing still on a platform. */
/** What a box stands on: of the surfaces right under it, the one under its middle (else the first). */
export function groundUnder(box: Box, solids: readonly Box[], gap = 0.5): Box | null {
  const probe = { ...box, y: box.y + gap };
  let first: Box | null = null;
  for (const s of solids) {
    if (!overlaps(probe, s)) continue;
    if (Math.abs(box.x - s.x) <= s.hw) return s;
    first ??= s;
  }
  return first;
}

export function standingOn(box: Box, solids: readonly Box[], gap = 0.5): boolean {
  const probe = { ...box, y: box.y + gap };
  return solids.some((s) => overlaps(probe, s));
}
