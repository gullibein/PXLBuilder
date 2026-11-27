/**
 * The collision world (F3): every shape things collide with, built from the level's solid entities, and every
 * question asked of them. Moved out of the runtime unchanged (the box lists, ramps, ladders, floor and wall checks),
 * with ramps generalised to slopes of any height (a 45° ramp computes exactly as before), the GeometryQuery
 * interface (probes with surface normals, grid cells), and cells that can be dug out and refill.
 */
import { moveAndCollide, moveNear, overlaps, standingOn, type Box, type MoveResult } from '../physics';
import { BoxGrid } from './boxGrid';
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

/** The boxes a fixed solid thing puts into the level's lists: its parts, each with the thing's friction. */
const boxesOf = (e: RuntimeEntity): Box[] => partsOf(e).map((p) => ({ ...p, friction: e.friction }));
const slopeOf = (e: RuntimeEntity): Slope => ({ ...boxOf(e)!, friction: e.friction, dir: e.collider!.slope!, lo: e.collider!.rise?.[0] ?? 0, hi: e.collider!.rise?.[1] ?? 1 });
/** Which of the three lists a thing with a collider belongs to. */
const listOf = (e: RuntimeEntity): 'solid' | 'oneWay' | 'slope' => (e.collider!.slope ? 'slope' : e.collider!.oneWay ? 'oneWay' : 'solid');

export class CollisionWorld implements GeometryQuery {
  /**
   * Walls and floors that don't move, and jump-through platforms (they hold things up from above only), each
   * kept by place. Every thing that can be one of them has its own places in its list, in the level's order,
   * whether it is in now or out (a tile dug out, a door open): a change to one thing changes its places and
   * nothing else, and the lists stay in the order a list made afresh would have (docs §30, W1.1).
   */
  private solidGrid = new BoxGrid<Box>([]);
  private oneWayGrid = new BoxGrid<Box>([]);
  private placeOf = new Map<RuntimeEntity, { list: 'solid' | 'oneWay' | 'slope'; at: number; n: number }>();
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

  /** Walls and floors that don't move, in the level's order. */
  get staticSolids(): readonly Box[] {
    return this.solidGrid.boxes;
  }
  set staticSolids(list: readonly Box[]) {
    this.solidGrid = new BoxGrid<Box>([...list]);
    this.placeOf.clear();
  }

  /** Jump-through platforms that don't move, in the level's order. */
  get oneWays(): readonly Box[] {
    return this.oneWayGrid.boxes;
  }
  set oneWays(list: readonly Box[]) {
    this.oneWayGrid = new BoxGrid<Box>([...list]);
    this.placeOf.clear();
  }

  /**
   * Makes the fixed shapes afresh. `could`: every thing that can be a fixed solid (it has a collider that
   * blocks, stands still and can't be pushed), in the level's order; `isIn`: whether it is one now (it is in play
   * and not open). Also the level's ladders (their screen areas).
   */
  rebuild(could: readonly RuntimeEntity[], isIn: (e: RuntimeEntity) => boolean, ladderZones: Box[], pushed: () => Box[]): void {
    // (Jump-through platforms and slopes are surfaces of their own, not walls.)
    // (A collider of several boxes: each of them is a wall or floor of its own.)
    const solids: (Box | null)[] = [];
    const oneWays: (Box | null)[] = [];
    this.slopes = [];
    this.placeOf.clear();
    for (const e of could) {
      const list = listOf(e);
      const inNow = isIn(e);
      if (list === 'slope') {
        this.placeOf.set(e, { list, at: -1, n: 0 });
        if (inNow) this.slopes.push(slopeOf(e));
        // (A slope that is also jump-through is in both lists, as it always was. A slope is never changed in place.)
        if (inNow && e.collider!.oneWay) oneWays.push(...boxesOf(e));
        continue;
      }
      const into = list === 'oneWay' ? oneWays : solids;
      const boxes = boxesOf(e);
      this.placeOf.set(e, { list, at: into.length, n: boxes.length });
      for (const b of boxes) into.push(inNow ? b : null);
    }
    this.solidGrid = new BoxGrid<Box>(solids);
    this.oneWayGrid = new BoxGrid<Box>(oneWays);
    this.rebuildLadders(ladderZones);
    this.pushed = pushed;
    this._version++;
  }

  /**
   * One thing changed (it moved, went, came back, opened, closed): its own places are brought up to date and
   * nothing else is touched. False: this can't be done in place (it has no places, or its shape or its list
   * changed, or it is a slope): the lists must be made afresh (`rebuild`).
   */
  update(e: RuntimeEntity, could: boolean, inNow: boolean): boolean {
    const place = this.placeOf.get(e);
    // (Not among the fixed solids before and not one now: nothing of it is in the lists.)
    if (!place) return !could;
    if (place.list === 'slope') return false;
    if (!could) inNow = false;
    else if (listOf(e) !== place.list) return false;
    const grid = place.list === 'oneWay' ? this.oneWayGrid : this.solidGrid;
    if (!inNow) {
      for (let k = 0; k < place.n; k++) grid.set(place.at + k, null);
    } else {
      const boxes = boxesOf(e);
      if (boxes.length !== place.n) return false;
      for (let k = 0; k < place.n; k++) grid.set(place.at + k, boxes[k]);
    }
    this._version++;
    return true;
  }

  /**
   * For tests: what differs between the lists as they are and lists made afresh from the level now ('' when
   * nothing does). Changes made in place must leave exactly what `rebuild` would make.
   */
  differsFromFresh(could: readonly RuntimeEntity[], isIn: (e: RuntimeEntity) => boolean, ladderZones: Box[]): string {
    const fresh = new CollisionWorld();
    fresh.rebuild(could, isIn, ladderZones, () => []);
    const same = (name: string, a: readonly unknown[], b: readonly unknown[]): string => {
      if (a.length !== b.length) return `${name}: ${a.length} in place, ${b.length} afresh`;
      for (let i = 0; i < a.length; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return `${name} ${i}: ${JSON.stringify(a[i])} in place, ${JSON.stringify(b[i])} afresh`;
      return '';
    };
    return same('solids', this.staticSolids, fresh.staticSolids) || same('jump-through platforms', this.oneWays, fresh.oneWays) || same('slopes', this.slopes, fresh.slopes) || same('ladders', this.ladders, fresh.ladders);
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

  // ---- by place (docs §30, W1): the same lists, asked only about what is near. Every answer is the whole list's.

  /** The fixed solids by place. */
  private get byPlace(): BoxGrid {
    return this.solidGrid;
  }

  private get oneWaysByPlace(): BoxGrid {
    return this.oneWayGrid;
  }

  /** The fixed solids that can overlap an area, in the order of `staticSolids`. */
  staticsNear(area: Box): readonly Box[] {
    return this.byPlace.near(area);
  }

  /** The fixed jump-through platforms that can overlap an area, in the order of `oneWays`. */
  oneWaysNear(area: Box): readonly Box[] {
    return this.oneWaysByPlace.near(area);
  }

  /** Whether a box overlaps a fixed solid. */
  overlapsStatic(box: Box): boolean {
    return this.byPlace.overlapsAny(box);
  }

  /** Whether a box overlaps anything solid (`solids.some(overlaps)`: the fixed ones, and pushable things where they are now). */
  overlapsSolid(box: Box): boolean {
    return this.byPlace.overlapsAny(box) || this.pushed().some((s) => overlaps(box, s));
  }

  /** A box moved by (dx, dy) against `solids` (moveAndCollide with that list: the same result). */
  moveAgainstSolids(box: Box, dx: number, dy: number): MoveResult {
    const pushed = this.pushed();
    return moveNear(box, dx, dy, (reach) => (pushed.length ? [...this.byPlace.near(reach), ...pushed] : this.byPlace.near(reach)), () => (pushed.length ? [...this.staticSolids, ...pushed] : this.staticSolids));
  }

  /** Moves a box by (dx, dy) against these surfaces (physics.ts, behind the interface). */
  sweep(box: Box, dx: number, dy: number, surfaces: readonly Box[]): MoveResult {
    return moveAndCollide(box, dx, dy, surfaces as Box[]);
  }

  solidAt(x: number, y: number): boolean {
    return this.byPlace.holds(x, y) || this.pushed().some((s) => Math.abs(x - s.x) < s.hw && Math.abs(y - s.y) < s.hh);
  }

  wallBeside(box: Box, dir: 1 | -1): boolean {
    const probe: Box = { x: box.x + dir * (box.hw + 1), y: box.y, hw: 1, hh: box.hh * 0.6 };
    return this.byPlace.overlapsAny(probe);
  }

  /** Floor under this box: something solid, or the top of a ladder (or a jump-through platform, a slope). */
  floorIn(box: Box): boolean {
    return this.overlapsSolid(box) || this.ladderTops.some((t) => overlaps(box, t)) || this.oneWaysByPlace.overlapsAny(box) || this.slopes.some((t) => overlaps(box, t));
  }

  /** Standing on a jump-through platform (and nothing solid besides). */
  onJumpThrough(box: Box): boolean {
    // (standingOn: the box half a pixel lower overlaps one.)
    const probe = { ...box, y: box.y + 0.5 };
    return this.oneWaysByPlace.overlapsAny(probe) && !this.overlapsSolid(probe);
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
    // (Only what the ray can reach, in the lists' order: the first box a point is in is the same one.)
    const ex = from.x + ux * maxDist;
    const ey = from.y + uy * maxDist;
    const along: Box = { x: (from.x + ex) / 2, y: (from.y + ey) / 2, hw: Math.abs(ex - from.x) / 2 + 1, hh: Math.abs(ey - from.y) / 2 + 1 };
    const pushed = this.pushed();
    const solids = Number.isFinite(maxDist) ? (pushed.length ? [...this.byPlace.near(along), ...pushed] : this.byPlace.near(along)) : this.solids;
    const oneWays = Number.isFinite(maxDist) ? this.oneWaysByPlace.near(along) : this.oneWays;
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
        for (const t of oneWays) {
          const top = t.y - t.hh;
          if (Math.abs(x - t.x) < t.hw && y >= top && y - uy * 0.5 < top) return { point: { x, y: top }, normal: { x: 0, y: -1 }, angle: 0, curvature: 0, kind: 'oneWay', friction: t.friction ?? 0.2 };
        }
    }
    return null;
  }

  // ---------------------------------------------------------------- cells (grid squares; tiles that can be dug)

  /** Tiles dug out, by their cell ("col,row"): which entity, and when it comes back (Infinity: never). */
  private readonly dug = new Map<string, { id: string; until: number; fill: 'trap' | 'wait' }>();

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
  markDug(col: number, row: number, id: string, until: number, fill: 'trap' | 'wait' = 'trap'): void {
    this.dug.set(`${col},${row}`, { id, until, fill });
    this._version++;
  }

  /**
   * The cells whose time is up (their tiles come back now), taken off the list. A "wait" cell with something inside
   * (`occupied`) waits on.
   */
  refills(now: number, occupied: (col: number, row: number) => boolean = () => false): { col: number; row: number; id: string; fill: 'trap' | 'wait' }[] {
    const out: { col: number; row: number; id: string; fill: 'trap' | 'wait' }[] = [];
    for (const [k, d] of this.dug)
      if (d.until <= now) {
        const [col, row] = k.split(',').map(Number);
        if (d.fill === 'wait' && occupied(col, row)) continue;
        out.push({ col, row, id: d.id, fill: d.fill });
        this.dug.delete(k);
      }
    if (out.length) this._version++;
    return out;
  }

  /** The tile (by entity id) is the one dug out of some square now. */
  holdsTile(id: string): boolean {
    for (const d of this.dug.values()) if (d.id === id) return true;
    return false;
  }

  isDug(col: number, row: number): boolean {
    return this.dug.has(`${col},${row}`);
  }
}
