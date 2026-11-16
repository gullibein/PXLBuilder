/**
 * The collision world (F3): every shape things collide with, built from the level's solid entities, and every
 * question asked of them. Moved out of the runtime unchanged (the box lists, ramps, ladders, floor and wall checks),
 * with ramps generalised to slopes of any height (a 45° ramp computes exactly as before), the GeometryQuery
 * interface (probes with surface normals, grid cells), and cells that can be dug out and refill.
 */
import { moveAndCollide, overlaps, standingOn, type Box, type MoveResult } from '../physics';
import { partsOf } from '../parts';
import type { RuntimeEntity } from '../runtime';
import type { CellInfo, GeometryQuery, Ladder, Slope, Surface } from './types';

/** How much of a character must be inside a ladder (horizontally) to climb it. */
const LADDER_GRIP = 0.5;
/** The grid squares cells are counted in. */
export const CELL = 32;

const boxOf = (e: RuntimeEntity): Box | null => (e.collider ? { x: e.x + e.collider.ox, y: e.y + e.collider.oy, hw: e.collider.hw, hh: e.collider.hh } : null);

/** Joins ladder pieces stacked directly on top of each other (same column) into ladders. */
export function ladderColumns(zones: Box[]): Ladder[] {
  const sorted = [...zones].sort((a, b) => a.x - b.x || a.y - b.y);
  const ladders: Ladder[] = [];
  for (const z of sorted) {
    const above = ladders.find((l) => Math.abs(l.x - z.x) < 1 && Math.abs(l.hw - z.hw) < 1 && z.y - z.hh <= l.bottom + 1 && z.y + z.hh > l.bottom);
    if (above) above.bottom = Math.max(above.bottom, z.y + z.hh);
    else ladders.push({ x: z.x, hw: z.hw, top: z.y - z.hh, bottom: z.y + z.hh });
  }
  return ladders;
}

/** The surface's y at x over a slope (its top, rising from lo to hi of its height the way it rises). */
export function slopeSurface(s: Slope, x: number): number {
  const t = Math.max(0, Math.min(1, (x - (s.x - s.hw)) / (2 * s.hw)));
  const u = s.dir === 1 ? t : 1 - t;
  return s.y + s.hh - (s.lo + (s.hi - s.lo) * u) * 2 * s.hh;
}

export class CollisionWorld implements GeometryQuery {
  /** Walls and floors that don't move (rebuilt when something solid changes). */
  staticSolids: Box[] = [];
  /** Jump-through platforms: hold things up from above only. */
  oneWays: Box[] = [];
  slopes: Slope[] = [];
  ladders: Ladder[] = [];
  /** The top of each ladder: a one-way platform to stand on and climb down from. */
  ladderTops: Box[] = [];
  /** Solids that can be pushed, where they are now (asked for when needed: they move). */
  private pushed: () => Box[] = () => [];
  private _version = 0;

  get version(): number {
    return this._version;
  }

  /** Rebuilds the fixed shapes from the level's fixed solid entities and its ladders (their screen areas). */
  rebuild(fixed: RuntimeEntity[], ladderZones: Box[], pushed: () => Box[]): void {
    // (Jump-through platforms and slopes are surfaces of their own, not walls.)
    // (A collider of several boxes: each of them is a wall or floor of its own.)
    this.staticSolids = fixed.filter((e) => !e.collider!.oneWay && !e.collider!.slope).flatMap((e) => partsOf(e).map((b) => ({ ...b, friction: e.friction })));
    this.oneWays = fixed.filter((e) => e.collider!.oneWay).flatMap((e) => partsOf(e).map((b) => ({ ...b, friction: e.friction })));
    this.slopes = fixed.filter((e) => e.collider!.slope).map((e) => ({ ...boxOf(e)!, friction: e.friction, dir: e.collider!.slope!, lo: e.collider!.rise?.[0] ?? 0, hi: e.collider!.rise?.[1] ?? 1 }));
    this.rebuildLadders(ladderZones);
    this.pushed = pushed;
    this._version++;
  }

  rebuildLadders(ladderZones: Box[]): void {
    this.ladders = ladderColumns(ladderZones);
    this.ladderTops = this.ladders.map((l) => ({ x: l.x, y: l.top + 1, hw: l.hw, hh: 1 }));
  }

  /** Solids (walls, floors, and pushable things where they are now). */
  get solids(): readonly Box[] {
    const pushed = this.pushed();
    return pushed.length ? [...this.staticSolids, ...pushed] : this.staticSolids;
  }

  /** Moves a box by (dx, dy) against these surfaces (physics.ts, behind the interface). */
  sweep(box: Box, dx: number, dy: number, surfaces: readonly Box[]): MoveResult {
    return moveAndCollide(box, dx, dy, surfaces as Box[]);
  }

  solidAt(x: number, y: number): boolean {
    return this.solids.some((s) => Math.abs(x - s.x) < s.hw && Math.abs(y - s.y) < s.hh);
  }

  wallBeside(box: Box, dir: 1 | -1): boolean {
    const probe: Box = { x: box.x + dir * (box.hw + 1), y: box.y, hw: 1, hh: box.hh * 0.6 };
    return this.staticSolids.some((s) => overlaps(probe, s));
  }

  /** Floor under this box: something solid, or the top of a ladder (or a jump-through platform, a slope). */
  floorIn(box: Box): boolean {
    return this.solids.some((s) => overlaps(box, s)) || this.ladderTops.some((t) => overlaps(box, t)) || this.oneWays.some((t) => overlaps(box, t)) || this.slopes.some((t) => overlaps(box, t));
  }

  /** Standing on a jump-through platform (and nothing solid besides). */
  onJumpThrough(box: Box): boolean {
    return standingOn(box, this.oneWays) && !standingOn(box, this.solids as Box[]);
  }

  /** Standing on solid ground (not on a ladder's top). */
  standingOffLadder(box: Box): boolean {
    return !this.ladderTops.some((t) => standingOn(box, [t]));
  }

  /** The ladder a body (its screen area) is at: at least half of it inside one, its feet not below it. */
  ladderAt(me: Box): Ladder | null {
    const feet = me.y + me.hh;
    let best: Ladder | null = null;
    let bestInside = -1;
    for (const l of this.ladders) {
      const inside = Math.min(me.x + me.hw, l.x + l.hw) - Math.max(me.x - me.hw, l.x - l.hw);
      if (inside >= LADDER_GRIP * me.hw * 2 - 1e-6 && inside > bestInside && feet >= l.top - 1 && me.y <= l.bottom) {
        best = l;
        bestInside = inside;
      }
    }
    return best;
  }

  /**
   * What is in the way of a box whose middle is over a slope: the slope holds its feet, so the ground that carries on
   * from it (right beside its high side, level with its top; or beside its low side, level with its bottom) neither
   * stops it nor holds it up, nor does any low edge it walks over; walls do.
   */
  besideRamps<T extends Box>(box: Box, surfaces: T[]): T[] {
    const bottom = box.y + box.hh;
    const under = this.slopes.filter((s) => Math.abs(box.x - s.x) <= s.hw && bottom >= s.y - s.hh - 2 && bottom <= s.y + s.hh + 2);
    if (!under.length) return surfaces;
    return surfaces.filter((o) => {
      // (Under its middle: the floor it is on.)
      if (o.x - o.hw <= box.x && o.x + o.hw >= box.x) return true;
      const top = o.y - o.hh;
      if (top > bottom + 0.5) return true;
      for (const s of under) {
        const next = Math.abs(o.x - o.hw - (s.x + s.hw)) < 1 || Math.abs(o.x + o.hw - (s.x - s.hw)) < 1;
        // (Its high side's top and its low side's bottom: a 45° ramp's own top and bottom.)
        const high = s.y + s.hh - s.hi * 2 * s.hh;
        const low = s.y + s.hh - s.lo * 2 * s.hh;
        if (next && (Math.abs(top - high) < 1.5 || Math.abs(top - low) < 1.5)) return false;
      }
      return top < bottom - box.hw - 1;
    });
  }

  /**
   * The slope a body's feet are on (or just reached): the surface under its middle, the highest of the slopes there.
   * It lands on one from above (it was on or above the surface a moment ago), and while it walks on slopes (or the
   * ground just before one) it keeps to the surface going down too, instead of hopping off. Returns the surface's y.
   */
  rampUnder(box: Box, vx: number, vy: number, prevBottom: number, stick: boolean, dt: number): { surf: number; friction?: number } | null {
    if (vy < 0) return null;
    const bottom = box.y + box.hh;
    let best: { surf: number; s: Box } | null = null;
    for (const s of this.slopes) {
      // (A little past its ends too, level with them: no hop where it meets the ground.)
      if (Math.abs(box.x - s.x) > s.hw + box.hw / 2) continue;
      const surf = slopeSurface(s, box.x);
      const reach = stick ? Math.abs(vx) * dt + 4 : 0;
      if (bottom < surf - reach || bottom > s.y + s.hh + 1) continue;
      if (!stick && prevBottom > surf + Math.max(4, vy * dt) + 1) continue;
      if (!best || surf < best.surf) best = { surf, s };
    }
    return best ? { surf: best.surf, friction: best.s.friction } : null;
  }

  /**
   * A ray from a point: the first surface it meets within maxDist (walls, floors, slopes, and from above, jump-through
   * platforms), with the surface's normal and angle. Marched in small steps (exact enough for sensors; shapes are
   * boxes and straight slopes).
   */
  probe(from: { x: number; y: number }, dir: { x: number; y: number }, maxDist: number): Surface | null {
    const len = Math.hypot(dir.x, dir.y) || 1;
    const ux = dir.x / len;
    const uy = dir.y / len;
    const solids = this.solids;
    for (let d = 0; d <= maxDist; d += 0.5) {
      const x = from.x + ux * d;
      const y = from.y + uy * d;
      for (const s of this.slopes) {
        if (Math.abs(x - s.x) > s.hw || y > s.y + s.hh) continue;
        const surf = slopeSurface(s, x);
        if (y >= surf) {
          // (The slope's top: rising (hi - lo) × its height over its width, the way it rises.)
          const rise = ((s.hi - s.lo) * 2 * s.hh) / (2 * s.hw);
          const nx = -s.dir * rise;
          const n = Math.hypot(nx, 1);
          return { point: { x, y: surf }, normal: { x: nx / n, y: -1 / n }, angle: Math.atan(rise), curvature: 0, kind: 'slope', friction: s.friction ?? 0.2 };
        }
      }
      for (const b of solids) {
        if (Math.abs(x - b.x) >= b.hw || Math.abs(y - b.y) >= b.hh) continue;
        // (The face it came in through: the side of the box nearest the point it entered.)
        const px = b.hw - Math.abs(x - b.x);
        const py = b.hh - Math.abs(y - b.y);
        const normal = px < py ? { x: Math.sign(x - b.x) || -ux, y: 0 } : { x: 0, y: Math.sign(y - b.y) || -uy };
        // (On the face itself, not the half step past it.)
        const point = normal.x !== 0 ? { x: b.x + normal.x * b.hw, y } : { x, y: b.y + normal.y * b.hh };
        return { point, normal, angle: normal.y !== 0 ? (normal.y < 0 ? 0 : Math.PI) : Math.PI / 2, curvature: 0, kind: 'solid', friction: b.friction ?? 0.2 };
      }
      if (uy > 0)
        for (const t of this.oneWays) {
          const top = t.y - t.hh;
          if (Math.abs(x - t.x) < t.hw && y >= top && y - uy * 0.5 < top) return { point: { x, y: top }, normal: { x: 0, y: -1 }, angle: 0, curvature: 0, kind: 'oneWay', friction: t.friction ?? 0.2 };
        }
    }
    return null;
  }

  // ---------------------------------------------------------------- cells (grid squares; tiles that can be dug)

  /** Tiles dug out, by their cell ("col,row"): which entity, and when it comes back (Infinity: never). */
  private readonly dug = new Map<string, { id: string; until: number }>();

  /** What is where, by square, for this step (made when first asked; things move, so it is dropped every step). */
  private occupancy: Map<string, string[][]> | null = null;
  private things: () => readonly { x: number; y: number; tags: readonly string[]; alive: boolean }[] = () => [];

  /** Where the things to count in squares come from (the level's entities). */
  watch(things: () => readonly { x: number; y: number; tags: readonly string[]; alive: boolean }[]): void {
    this.things = things;
  }

  /** A new step: things may have moved. */
  moved(): void {
    this.occupancy = null;
  }

  private tagsIn(col: number, row: number): string[][] {
    if (!this.occupancy) {
      const map = new Map<string, string[][]>();
      for (const t of this.things()) {
        if (!t.alive) continue;
        const k = `${Math.floor(t.x / CELL)},${Math.floor(t.y / CELL)}`;
        const list = map.get(k);
        if (list) list.push(t.tags as string[]);
        else map.set(k, [t.tags as string[]]);
      }
      this.occupancy = map;
    }
    return this.occupancy.get(`${col},${row}`) ?? [];
  }

  /** Something with this tag is in the square (its middle in it). */
  hasIn(col: number, row: number, tag: string): boolean {
    return this.tagsIn(col, row).some((tags) => tags.includes(tag));
  }

  cell(col: number, row: number): CellInfo {
    const d = this.dug.get(`${col},${row}`);
    const x = col * CELL + CELL / 2;
    const y = row * CELL + CELL / 2;
    return { solid: !d && this.solidAt(x, y), state: d ? 'dug' : null, until: d ? (Number.isFinite(d.until) ? d.until : null) : null, things: [...new Set(this.tagsIn(col, row).flat())] };
  }

  /** A new level, or the level again: nothing dug. */
  clearCells(): void {
    if (this.dug.size) this._version++;
    this.dug.clear();
    this.occupancy = null;
  }

  /** Records a tile dug out of its cell until `until` (or for good); the runtime takes the tile out of play meanwhile. */
  markDug(col: number, row: number, id: string, until: number): void {
    this.dug.set(`${col},${row}`, { id, until });
    this._version++;
  }

  /** The cells whose time is up (their tiles come back now), taken off the list. */
  refills(now: number): { col: number; row: number; id: string }[] {
    const out: { col: number; row: number; id: string }[] = [];
    for (const [k, d] of this.dug)
      if (d.until <= now) {
        const [col, row] = k.split(',').map(Number);
        out.push({ col, row, id: d.id });
        this.dug.delete(k);
      }
    if (out.length) this._version++;
    return out;
  }

  isDug(col: number, row: number): boolean {
    return this.dug.has(`${col},${row}`);
  }
}
