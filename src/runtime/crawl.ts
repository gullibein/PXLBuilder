/**
 * Crawling (the "crawl" script statement): a thing that sticks to surfaces (a slime) finds its way to a target
 * over floors, walls, ceilings and ladders, and lets go to drop when that is the way. The level is looked at as a
 * grid of squares (the editor's grid, sized up to fit its body). It can be in a free square with something solid
 * right beside, above or below it, or with a ladder. It only ever moves while holding on:
 *  - to the square beside it along the same surface (both have the floor below, or the wall on the same side…),
 *    along a ladder, or between a ladder and a surface right beside it;
 *  - round an outside corner: from one face of a block over its corner to the next face, in one move (a block
 *    touched only at its corner is never something to hold on to by itself, so it can't hop over gaps);
 *  - or it lets go and falls straight down to where it lands.
 * The way is planned again now and then (replan seconds), each plan with a bit of chance per step (wander), so it
 * doesn't always take the very shortest way; when it is set on an ambush (by chance, ambush) it doesn't drop
 * anywhere but onto its target. Its body moves from square middle to square middle; its picture is drawn turned
 * so its underside faces what it holds on to and moved up against it, only ever in quarter turns (a pixel game has
 * no in-between angles): into an inside corner it turns to the new surface as it gets there; round an outside
 * corner it goes just past the edge and turns over onto the next face halfway round.
 */
import type { RuntimeEntity } from './runtime';

export interface CrawlWorld {
  /** Something solid at this point. */
  solidAt(x: number, y: number): boolean;
  /** A ladder covers this point. */
  ladderAt(x: number, y: number): boolean;
  /** No wall between the two points. */
  canSee(a: { x: number; y: number }, b: { x: number; y: number }): boolean;
  /** 0..1 */
  random(): number;
  time: number;
}

/** A place on its way: where its body goes (a square's middle) and how its picture is drawn there. */
export interface CrawlPose {
  x: number;
  y: number;
  /** It falls to this one (it let go). */
  drop: boolean;
  /** A square it plans from (not the middle of a move round an outside corner). */
  hold: boolean;
  /** The picture's turn (degrees clockwise: 0 on a floor, 90 a wall on its left, 180 a ceiling, 270 a wall on its right). */
  angle: number;
  /** How far along the move here it turns to this angle (0.5 halfway; 1 as it gets here: into an inside corner). */
  turnAt: number;
  /** The picture moved from the body by this much, up against what it holds on to. */
  dx: number;
  dy: number;
  /** It hangs under a ceiling here. */
  ceiling: boolean;
  /** The side it holds on to here (0 below, 1 left, 2 above, 3 right; -1 a ladder), for the next plan. */
  side?: number;
}

export interface CrawlState {
  path: CrawlPose[];
  /** When the way was last planned. */
  planned: number;
  /** Falling (letting go) to the next place. */
  falling: boolean;
  /** How it was drawn when it set off for the next place, and where its body was. */
  from: { angle: number; dx: number; dy: number; x: number; y: number } | null;
  /** Set on an ambush (no drops but onto the target) this time; null: not decided yet (after each landing). */
  ambush: boolean | null;
}

/** How far the plan looks around the crawler and its target, in squares. */
const MARGIN = 10;
/** The most squares looked at in one plan. */
const MAX_CELLS = 12000;
/** The farthest it lets itself fall, in squares. */
const MAX_DROP = 24;
const FALL_ACCEL = 900;
const FALL_MAX = 600;
/** What a drop that doesn't land on the target costs more when it is set on an ambush. */
const AMBUSH_COST = 12;

/** The four sides: below, left, above, right (index × 90 is the picture's turn holding on to that side). */
const SIDES = [
  [0, 1],
  [-1, 0],
  [0, -1],
  [1, 0],
] as const;
const DOWN = 0;
const LADDER = -1;

/** Shortest turn from a to b, degrees (-180..180). */
export const turnBetween = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/**
 * The way from `from` to (as near as it gets to) `to`: Dijkstra over the squares it can hold on in, each move
 * costing 1 plus up to `wander` by chance (round a corner 2; a fall a little less per square, so dropping is
 * worth it, unless ambush). size: its picture's width and height (how it is drawn up against surfaces).
 */
export function planCrawl(
  w: CrawlWorld,
  cell: number,
  from: { x: number; y: number },
  to: { x: number; y: number },
  wander: number,
  opts: { ambush?: boolean; size?: { w: number; h: number }; side?: number } = {},
): CrawlPose[] {
  const size = opts.size ?? { w: cell, h: cell };
  const ci = (v: number) => Math.floor(v / cell);
  const mid = (k: number) => (k + 0.5) * cell;
  const s = { i: ci(from.x), j: ci(from.y) };
  const t = { i: ci(to.x), j: ci(to.y) };
  let i0 = Math.min(s.i, t.i) - MARGIN;
  let i1 = Math.max(s.i, t.i) + MARGIN;
  let j0 = Math.min(s.j, t.j) - MARGIN;
  let j1 = Math.max(s.j, t.j) + MARGIN;
  // (Far apart: the box shrinks round the middle of the two so the plan stays quick.)
  while ((i1 - i0 + 1) * (j1 - j0 + 1) > MAX_CELLS && (i1 - i0 > 2 * MARGIN || j1 - j0 > 2 * MARGIN)) {
    if (i1 - i0 >= j1 - j0) (i0 += 1), (i1 -= 1);
    else (j0 += 1), (j1 -= 1);
  }
  const W = i1 - i0 + 1;
  const H = j1 - j0 + 1;
  const idx = (i: number, j: number) => (j - j0) * W + (i - i0);
  const inside = (i: number, j: number) => i >= i0 && i <= i1 && j >= j0 && j <= j1;
  const solidCache = new Int8Array(W * H).fill(-1);
  const solid = (i: number, j: number): boolean => {
    if (!inside(i, j)) return w.solidAt(mid(i), mid(j));
    const k = idx(i, j);
    if (solidCache[k] < 0) solidCache[k] = w.solidAt(mid(i), mid(j)) ? 1 : 0;
    return solidCache[k] === 1;
  };
  const ladder = (i: number, j: number) => w.ladderAt(mid(i), mid(j));
  const free = (i: number, j: number) => inside(i, j) && !solid(i, j);
  /** Something solid on that side of the square. */
  const on = (i: number, j: number, side: number) => solid(i + SIDES[side][0], j + SIDES[side][1]);
  /** It can hold on in this square: free, with something solid beside, above or below it, or a ladder. */
  const hold = (i: number, j: number) => free(i, j) && (ladder(i, j) || [0, 1, 2, 3].some((n) => on(i, j, n)));
  /** The sides across a move that way (d: the side index of the move): what it can slide along. */
  const across = (d: number) => [(d + 1) % 4, (d + 3) % 4];
  const sideOf = (dx: number, dy: number) => SIDES.findIndex(([x, y]) => x === dx && y === dy);

  // Where it is may be just off a square it can hold on in (mid-fall, pushed): it starts from one beside it; in
  // the air with none, it falls.
  let start = s;
  if (!hold(s.i, s.j)) {
    const near = [0, 1, 3, 2].map((n) => SIDES[n]).find(([di, dj]) => hold(s.i + di, s.j + dj));
    if (near) start = { i: s.i + near[0], j: s.j + near[1] };
    else {
      if (solid(s.i, s.j)) return [];
      let n = s.j;
      while (n - s.j < MAX_DROP * 2 && !solid(s.i, n + 1)) n++;
      return solid(s.i, n + 1) ? [pose(s.i, n, DOWN, DOWN, true)] : [];
    }
  }

  const N = W * H;
  const cost = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  /** How it got there: 0 along a surface or ladder, 1 round an outside corner, 2 a fall. */
  const how = new Uint8Array(N);
  /** Round a corner: the side of the block it went round (from the square it came from) and the way it went. */
  const wrapN = new Int8Array(N);
  const wrapM = new Int8Array(N);
  const done = new Uint8Array(N);
  const heap: [number, number][] = [];
  const push = (c: number, k: number) => {
    heap.push([c, k]);
    let n = heap.length - 1;
    while (n > 0) {
      const p = (n - 1) >> 1;
      if (heap[p][0] <= heap[n][0]) break;
      [heap[p], heap[n]] = [heap[n], heap[p]];
      n = p;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let n = 0;
      for (;;) {
        const l = 2 * n + 1;
        const r = l + 1;
        let m = n;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === n) break;
        [heap[m], heap[n]] = [heap[n], heap[m]];
        n = m;
      }
    }
    return top;
  };
  const k0 = idx(start.i, start.j);
  cost[k0] = 0;
  push(0, k0);
  const step = () => (wander > 0 ? w.random() * wander : 0);
  let best = k0;
  let bestScore = Infinity;
  while (heap.length) {
    const [c, k] = pop();
    if (done[k]) continue;
    done[k] = 1;
    const i = (k % W) + i0;
    const j = Math.floor(k / W) + j0;
    const sc = (Math.abs(i - t.i) + Math.abs(j - t.j)) * 1000 + c;
    if (sc < bestScore) (bestScore = sc), (best = k);
    if (i === t.i && j === t.j) break;
    const relax = (ni: number, nj: number, add: number, kind: number, n = 0, m = 0) => {
      const nk = idx(ni, nj);
      if (done[nk] || c + add >= cost[nk]) return;
      cost[nk] = c + add;
      prev[nk] = k;
      how[nk] = kind;
      wrapN[nk] = n;
      wrapM[nk] = m;
      push(cost[nk], nk);
    };
    const hereLadder = ladder(i, j);
    for (let d = 0; d < 4; d++) {
      const bi = i + SIDES[d][0];
      const bj = j + SIDES[d][1];
      if (!hold(bi, bj)) continue;
      const thereLadder = ladder(bi, bj);
      const sides = across(d);
      const along =
        sides.some((n) => on(i, j, n) && on(bi, bj, n)) ||
        (hereLadder && thereLadder) ||
        (hereLadder && sides.some((n) => on(bi, bj, n))) ||
        (thereLadder && sides.some((n) => on(i, j, n)));
      if (along) relax(bi, bj, 1 + step(), 0);
    }
    // Round an outside corner: from a face of the block beside it (n) over the block's corner to its next face.
    for (let n = 0; n < 4; n++) {
      if (!on(i, j, n)) continue;
      for (const m of across(n)) {
        const bi = i + SIDES[m][0];
        const bj = j + SIDES[m][1];
        const ci2 = bi + SIDES[n][0];
        const cj2 = bj + SIDES[n][1];
        if (free(bi, bj) && free(ci2, cj2)) relax(ci2, cj2, 2 + 2 * step(), 1, n, m);
      }
    }
    // Letting go: falls straight down through free squares to where it lands (or onto the target on the way).
    if (free(i, j + 1) && !ladder(i, j + 1)) {
      let n = j + 1;
      while (n - j < MAX_DROP && free(i, n + 1) && !(i === t.i && n === t.j)) n++;
      const ontoTarget = i === t.i && n === t.j;
      if ((solid(i, n + 1) || ontoTarget) && n > j) relax(i, n, 0.5 * (n - j) + 1 + step() + (opts.ambush && !ontoTarget ? AMBUSH_COST : 0), 2);
    }
  }

  // The squares on the way, and how it got to each.
  const cells: number[] = [];
  for (let k = best; k !== k0 && k >= 0; k = prev[k]) cells.push(k);
  cells.reverse();
  const out: CrawlPose[] = [];
  // Which side it holds on to as it goes: where it was holding on (side), else the floor, else the first it finds.
  const startSides = [0, 1, 3, 2].filter((n) => on(start.i, start.j, n));
  let cur = opts.side !== undefined && (opts.side === LADDER ? ladder(start.i, start.j) : on(start.i, start.j, opts.side)) ? opts.side : ladder(start.i, start.j) ? LADDER : (startSides[0] ?? DOWN);
  if (start !== s) out.push(pose(start.i, start.j, cur, cur, false));
  let pi = start.i;
  let pj = start.j;
  for (let n = 0; n < cells.length; n++) {
    const k = cells[n];
    const i = (k % W) + i0;
    const j = Math.floor(k / W) + j0;
    let arrive = cur;
    if (how[k] === 0) {
      const d = sideOf(i - pi, j - pj);
      const shared = across(d).filter((x) => on(pi, pj, x) && on(i, j, x));
      if (shared.length) arrive = shared.includes(cur) ? cur : shared.includes(DOWN) ? DOWN : shared[0];
      else if (ladder(i, j)) arrive = LADDER;
      else arrive = [DOWN, ...across(d)].find((x) => on(i, j, x)) ?? DOWN;
      // (Setting off: the side it leaves by is the one it slides along.)
      setLeave(out, pi, pj, shared.length ? arrive : ladder(pi, pj) ? LADDER : arrive);
    } else if (how[k] === 1) {
      const nn = wrapN[k];
      const m = wrapM[k];
      setLeave(out, pi, pj, nn);
      // The corner: on its belly over the block's corner, between the two faces.
      out.push(cornerPose(pi + SIDES[m][0], pj + SIDES[m][1], nn, m));
      arrive = (m + 2) % 4;
    } else {
      arrive = DOWN;
    }
    out.push(pose(i, j, arrive, arrive, how[k] === 2));
    cur = arrive;
    pi = i;
    pj = j;
  }
  return out;

  /** The pose of the place before (at pi, pj), now that it is known which side it leaves by: a corner if it turns there. */
  function setLeave(list: CrawlPose[], i: number, j: number, leave: number): void {
    const last = list.at(-1);
    if (!last || last.drop || !last.hold) return;
    const arrived = last.side;
    if (arrived === undefined || leave === LADDER || arrived === LADDER || arrived === leave) return;
    // Two sides at right angles: an inside corner (the floor and the wall it goes up).
    if ((arrived + 2) % 4 !== leave) list[list.length - 1] = pose(i, j, arrived, leave, false);
    else list[list.length - 1] = pose(i, j, leave, leave, false);
  }

  /** Distance from the square's middle to the solid thing that way, along a line (to about a quarter pixel). */
  function probe(x: number, y: number, dx: number, dy: number): number {
    let lo = 0;
    let hi = cell;
    if (!w.solidAt(x + dx * hi, y + dy * hi)) return cell / 2;
    for (let n = 0; n < 8; n++) {
      const m = (lo + hi) / 2;
      if (w.solidAt(x + dx * m, y + dy * m)) hi = m;
      else lo = m;
    }
    return hi;
  }

  /** The pose in square i, j holding on to side a (and b: an inside corner when they are at right angles). */
  function pose(i: number, j: number, a: number, b: number, drop: boolean): CrawlPose {
    const x = mid(i);
    const y = mid(j);
    const base = { x, y, drop, hold: true, ceiling: a === 2 && b === 2, turnAt: 0.5 };
    if (a === LADDER || b === LADDER) return { ...base, angle: 0, dx: 0, dy: 0, side: LADDER };
    if (a === b) {
      const [nx, ny] = SIDES[a];
      const gap = probe(x, y, nx, ny) - size.h / 2;
      return { ...base, angle: a * 90, dx: nx * gap, dy: ny * gap, side: a };
    }
    // An inside corner: turned to the new surface (b) as it gets there, pressed into the corner (its underside
    // against b, a side against a).
    const [ax, ay] = SIDES[a];
    const [bx, by] = SIDES[b];
    const ga = probe(x, y, ax, ay) - size.w / 2;
    const gb = probe(x, y, bx, by) - size.h / 2;
    return { ...base, angle: b * 90, turnAt: 1, dx: ax * ga + bx * gb, dy: ay * ga + by * gb, side: b };
  }

  /**
   * Round an outside corner, in square i, j just past the edge (it went that way, m, from beside the block, on its
   * face n): still on that face (its plane, as from the square before), not turned yet.
   */
  function cornerPose(i: number, j: number, n: number, m: number): CrawlPose {
    const x = mid(i);
    const y = mid(j);
    const [nx, ny] = SIDES[n];
    const gap = probe(x - SIDES[m][0] * cell, y - SIDES[m][1] * cell, nx, ny) - size.h / 2;
    return { x, y, drop: false, hold: false, ceiling: false, angle: n * 90, turnAt: 0.5, dx: nx * gap, dy: ny * gap };
  }
}

/** How the picture is drawn partway (t 0..1) from one pose to the next: slid along, turned at once (a quarter turn) at the pose's turnAt. */
function between(from: NonNullable<CrawlState['from']>, to: CrawlPose, t: number): { angle: number; dx: number; dy: number } {
  const u = Math.max(0, Math.min(1, t));
  return { angle: u >= to.turnAt ? to.angle : from.angle, dx: from.dx + (to.dx - from.dx) * u, dy: from.dy + (to.dy - from.dy) * u };
}

export interface CrawlOptions {
  cell: number;
  speed: number;
  wander: number;
  replan: number;
  dropOn: boolean;
  /** The chance (0-1) it sets itself on an ambush each time it lands: no drops but onto the target. */
  ambush: number;
  size: { w: number; h: number };
  dt: number;
}

/**
 * One step of crawling toward `target`: plans the way when it has none, and again at each square it gets to once
 * `replan` seconds have gone by; hanging under a ceiling with the target straight below and nothing between, it
 * lets go and drops onto it (dropOn); then heads for the next place, or keeps falling to it. Gives how to draw it.
 */
export function crawlStep(w: CrawlWorld, e: RuntimeEntity, state: CrawlState, target: { x: number; y: number; hw: number }, o: CrawlOptions): { angle: number; dx: number; dy: number } {
  const { speed, dt } = o;
  state.from ??= { angle: e.angle, dx: e.nudge?.x ?? 0, dy: e.nudge?.y ?? 0, x: e.x, y: e.y };
  if (!state.path.length) plan(w, e, state, target, o);
  const next = state.path[0];
  if (!next) {
    e.vx = 0;
    e.vy = 0;
    return { angle: state.from.angle, dx: state.from.dx, dy: state.from.dy };
  }
  const from = state.from;
  if (next.drop || state.falling) {
    state.falling = true;
    e.vx = Math.max(-speed, Math.min(speed, (next.x - e.x) / Math.max(dt, 1e-3)));
    e.vy = Math.min(FALL_MAX, Math.max(0, e.vy) + FALL_ACCEL * dt);
    const span = Math.max(1, next.y - from.y);
    if (e.y >= next.y - 0.5 || w.solidAt(e.x, e.y + o.cell / 2 + 1)) {
      state.falling = false;
      state.ambush = null;
      e.vx = 0;
      e.vy = 0;
      e.x = next.x;
      if (Math.abs(e.y - next.y) < o.cell) e.y = next.y;
      return arrive(w, e, state, target, o);
    }
    return between(from, next, (e.y - from.y) / span);
  }
  const dx = next.x - e.x;
  const dy = next.y - e.y;
  const d = Math.hypot(dx, dy);
  if (Math.abs(dx) > 0.5) e.facing = dx < 0 ? -1 : 1;
  if (d <= speed * dt + 0.01) {
    e.x = next.x;
    e.y = next.y;
    return arrive(w, e, state, target, o);
  }
  e.vx = (dx / d) * speed;
  e.vy = (dy / d) * speed;
  const span = Math.hypot(next.x - from.x, next.y - from.y);
  return between(from, next, span > 0 ? 1 - d / span : 1);
}

function plan(w: CrawlWorld, e: RuntimeEntity, state: CrawlState, target: { x: number; y: number }, o: CrawlOptions, side?: number): void {
  if (state.ambush === null) state.ambush = w.random() < o.ambush;
  state.path = planCrawl(w, o.cell, e, target, o.wander, { ambush: state.ambush, size: o.size, side });
  state.planned = w.time;
}

/** At the next place: drawn as it is there; drops onto the target below, plans again when it is time, and sets off. */
function arrive(w: CrawlWorld, e: RuntimeEntity, state: CrawlState, target: { x: number; y: number; hw: number }, o: CrawlOptions): { angle: number; dx: number; dy: number } {
  const here = state.path.shift()!;
  state.from = { angle: here.angle, dx: here.dx, dy: here.dy, x: e.x, y: e.y };
  const look = { angle: here.angle, dx: here.dx, dy: here.dy };
  e.vx = 0;
  e.vy = 0;
  if (!here.hold) return look;
  const { cell } = o;
  if (o.dropOn && here.ceiling && w.solidAt(e.x, e.y - cell) && !w.solidAt(e.x, e.y + cell) && target.y > e.y + cell / 2 && Math.abs(target.x - e.x) < target.hw + cell / 2 && w.canSee(e, target)) {
    state.path = [{ x: e.x, y: target.y, drop: true, hold: true, ceiling: false, angle: 0, turnAt: 0.5, dx: 0, dy: 0 }];
    state.falling = true;
    return look;
  }
  if (!state.path.length || w.time - state.planned >= o.replan) {
    plan(w, e, state, target, o, here.side);
    // (A fresh plan starts where it is: the first place may be this square again when it was just off it.)
    if (state.path[0] && Math.abs(state.path[0].x - e.x) < 0.5 && Math.abs(state.path[0].y - e.y) < 0.5 && !state.path[0].drop) state.path.shift();
  }
  return look;
}
