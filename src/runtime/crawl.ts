/**
 * Crawling (the "crawl" script statement): a thing that sticks to every surface (a slime) finds its way to a
 * target over floors, walls, ceilings and ladders, and drops from above when that is the way. The level is looked
 * at as a grid of cells the size of the editor's grid: a cell it can be in is free (nothing solid at its middle)
 * and touches something solid (beside, above, below or at a corner) or has a ladder. From such a cell it goes to
 * the cells beside it that are also such cells, or lets go and falls straight down to where it lands. The way is
 * planned again now and then (replan seconds), and every plan adds a bit of chance to each step (wander), so it
 * doesn't always take the very shortest way. It moves from cell middle to cell middle, nothing pulling it down
 * (its gravity is off while it crawls), turned so its underside faces the surface it holds on to.
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

export interface CrawlState {
  /** The cells still to go (level coordinates of their middles); drop: it falls to this one. */
  path: { x: number; y: number; drop: boolean }[];
  /** When the way was last planned. */
  planned: number;
  /** Falling (letting go) to the next cell. */
  falling: boolean;
}

/** How far the plan looks around the crawler and its target, in cells. */
const MARGIN = 10;
/** The most cells looked at in one plan. */
const MAX_CELLS = 12000;
/** The farthest it lets itself fall, in cells. */
const MAX_DROP = 24;
const FALL_ACCEL = 900;
const FALL_MAX = 600;

type Cell = { i: number; j: number };

/**
 * The cells to go through from `from` to (as near as it gets to) `to`: Dijkstra over the cells it can be in,
 * each step costing 1 plus up to `wander` by chance (a fall a little less per cell, so dropping is worth it).
 */
export function planCrawl(w: CrawlWorld, cell: number, from: { x: number; y: number }, to: { x: number; y: number }, wander: number): CrawlState['path'] {
  const ci = (v: number) => Math.floor(v / cell);
  const mid = (k: number) => (k + 0.5) * cell;
  const s: Cell = { i: ci(from.x), j: ci(from.y) };
  const t: Cell = { i: ci(to.x), j: ci(to.y) };
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
  const holdCache = new Int8Array(W * H).fill(-1);
  /** It can be in this cell: free, and something to hold on to. */
  const hold = (i: number, j: number): boolean => {
    if (!inside(i, j) || solid(i, j)) return false;
    const k = idx(i, j);
    if (holdCache[k] < 0) {
      let h = w.ladderAt(mid(i), mid(j));
      for (let dj = -1; dj <= 1 && !h; dj++) for (let di = -1; di <= 1 && !h; di++) if ((di || dj) && solid(i + di, j + dj)) h = true;
      holdCache[k] = h ? 1 : 0;
    }
    return holdCache[k] === 1;
  };
  // Where it is may be just off a cell it can be in (mid-fall, pushed): it starts from the nearest one about.
  let start = s;
  if (!hold(s.i, s.j)) {
    const near = [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ].find(([di, dj]) => hold(s.i + di, s.j + dj));
    if (near) start = { i: s.i + near[0], j: s.j + near[1] };
    else if (!inside(s.i, s.j) || solid(s.i, s.j)) return [];
  }
  const cost = new Float64Array(W * H).fill(Infinity);
  const prev = new Int32Array(W * H).fill(-1);
  const dropTo = new Uint8Array(W * H);
  const done = new Uint8Array(W * H);
  // A small binary heap of [cost, index].
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
  const step = () => 1 + (wander > 0 ? w.random() * wander : 0);
  let best = k0;
  let bestScore = Infinity;
  const score = (i: number, j: number, c: number) => (Math.abs(i - t.i) + Math.abs(j - t.j)) * 1000 + c;
  while (heap.length) {
    const [c, k] = pop();
    if (done[k]) continue;
    done[k] = 1;
    const i = (k % W) + i0;
    const j = Math.floor(k / W) + j0;
    const sc = score(i, j, c);
    if (sc < bestScore) (bestScore = sc), (best = k);
    if (i === t.i && j === t.j) break;
    const relax = (ni: number, nj: number, add: number, drop: boolean) => {
      const nk = idx(ni, nj);
      if (done[nk] || c + add >= cost[nk]) return;
      cost[nk] = c + add;
      prev[nk] = k;
      dropTo[nk] = drop ? 1 : 0;
      push(cost[nk], nk);
    };
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      if (hold(i + di, j + dj)) relax(i + di, j + dj, step(), false);
    // Letting go: falls straight down through free cells to where it lands (or onto the target on the way).
    if (inside(i, j + 1) && !solid(i, j + 1) && !hold(i, j + 1)) {
      let n = j + 1;
      while (n - j < MAX_DROP && inside(i, n + 1) && !solid(i, n + 1) && !(i === t.i && n === t.j)) n++;
      if ((solid(i, n + 1) || (i === t.i && n === t.j)) && n > j) relax(i, n, 0.5 * (n - j) + step(), true);
    }
  }
  const out: CrawlState['path'] = [];
  for (let k = best; k !== k0 && k >= 0; k = prev[k]) out.push({ x: mid((k % W) + i0), y: mid(Math.floor(k / W) + j0), drop: dropTo[k] === 1 });
  out.reverse();
  // (It was just off the start cell: it goes there first.)
  if (start !== s) out.unshift({ x: mid(start.i), y: mid(start.j), drop: false });
  return out;
}

/** The way its underside should face, by what it holds on to here (degrees: 0 floor, 180 ceiling, 90 a wall on its left, 270 on its right). */
export function crawlAngle(w: CrawlWorld, cell: number, x: number, y: number, current: number): number {
  if (w.ladderAt(x, y)) return 0;
  if (w.solidAt(x, y + cell)) return 0;
  if (w.solidAt(x - cell, y)) return 90;
  if (w.solidAt(x + cell, y)) return 270;
  if (w.solidAt(x, y - cell)) return 180;
  return current;
}

/**
 * One step of crawling toward `target` at `speed`: plans the way when it has none, and again at each cell it gets
 * to once `replan` seconds have gone by; at a cell right under a ceiling with the target straight below and nothing
 * between, it lets go and drops onto it (dropOn); then heads for the next cell, or keeps falling to it.
 */
export function crawlStep(
  w: CrawlWorld,
  e: RuntimeEntity,
  state: CrawlState,
  target: { x: number; y: number; hw: number },
  o: { cell: number; speed: number; wander: number; replan: number; dropOn: boolean; dt: number },
): { angle: number | null } {
  const { cell, speed, dt } = o;
  if (state.falling) {
    const next = state.path[0];
    e.vx = next ? Math.max(-speed, Math.min(speed, (next.x - e.x) / Math.max(dt, 1e-3))) : 0;
    e.vy = Math.min(FALL_MAX, Math.max(0, e.vy) + FALL_ACCEL * dt);
    if (!next || e.y >= next.y - 0.5 || w.solidAt(e.x, e.y + cell / 2 + 1)) {
      state.falling = false;
      e.vy = 0;
      e.vx = 0;
      if (next) {
        e.x = next.x;
        if (Math.abs(e.y - next.y) < cell) e.y = next.y;
        state.path.shift();
      }
      return arrived(w, e, state, target, o);
    }
    return { angle: null };
  }
  if (!state.path.length) return arrived(w, e, state, target, o);
  const next = state.path[0];
  if (next.drop) return letGo(e, state);
  const dx = next.x - e.x;
  const dy = next.y - e.y;
  const d = Math.hypot(dx, dy);
  if (Math.abs(dx) > 0.5) e.facing = dx < 0 ? -1 : 1;
  if (d <= speed * dt + 0.01) {
    e.x = next.x;
    e.y = next.y;
    state.path.shift();
    return arrived(w, e, state, target, o);
  }
  e.vx = (dx / d) * speed;
  e.vy = (dy / d) * speed;
  return { angle: null };
}

function letGo(e: RuntimeEntity, state: CrawlState): { angle: number | null } {
  state.falling = true;
  e.vx = 0;
  e.vy = 0;
  return { angle: null };
}

/** At a cell's middle: drops onto the target below, plans again when it is time, and sets off for the next cell. */
function arrived(
  w: CrawlWorld,
  e: RuntimeEntity,
  state: CrawlState,
  target: { x: number; y: number; hw: number },
  o: { cell: number; speed: number; wander: number; replan: number; dropOn: boolean },
): { angle: number | null } {
  const { cell, speed } = o;
  if (o.dropOn && w.solidAt(e.x, e.y - cell) && !w.solidAt(e.x, e.y + cell) && target.y > e.y + cell / 2 && Math.abs(target.x - e.x) < target.hw + cell / 2 && w.canSee(e, target)) {
    state.path = [{ x: e.x, y: target.y, drop: true }];
    return letGo(e, state);
  }
  if (!state.path.length || w.time - state.planned >= o.replan) {
    state.path = planCrawl(w, cell, e, target, o.wander);
    state.planned = w.time;
  }
  const angle = crawlAngle(w, cell, e.x, e.y, e.angle);
  const next = state.path[0];
  if (!next) {
    e.vx = 0;
    e.vy = 0;
    return { angle };
  }
  if (next.drop) {
    letGo(e, state);
    return { angle };
  }
  const dx = next.x - e.x;
  const dy = next.y - e.y;
  const d = Math.hypot(dx, dy) || 1;
  e.vx = (dx / d) * speed;
  e.vy = (dy / d) * speed;
  if (Math.abs(dx) > 0.5) e.facing = dx < 0 ? -1 : 1;
  return { angle };
}
