/**
 * A route solver for levels the engine builds: from the player's start, cell by cell, can it get to the goal (and
 * to every key, switch, coin and heart)? It walks, falls, jumps (within the player's reach, with room overhead and
 * nothing solid in the way of the jump), climbs ladders, swims, bounces on springs and takes teleporters; spikes and
 * lava are never stood in; a door is a wall until the key it needs is held (or the switch that opens it is on, or
 * a pressure plate it is joined to is held down, by the player or a crate). Crates are pushed along, fall, and are
 * stood on.
 *
 * It explores states (where the player is, which keys it holds, which switches are on, where the crates are), so a level whose key is only
 * reachable through the door it opens fails, and a puzzle that has to be done in some order passes only when there
 * is such an order. Stricter than the level checker in what stands in the way (walls, ceilings, doors), simpler in
 * how the player moves (one cell at a time, jumps as a table): both have to pass.
 */
import type { LevelGrid } from './grid';
import type { Limits } from './limits';
import { ARCADE_MOVES, type MoveRule, type SolverState, type SolverView } from './moves';
import type { Role } from './roles';

const SOLID = new Set<Role>(['ground', 'ledge', 'brick', 'block', 'pipeTop', 'pipe', 'crate', 'rampRight', 'rampLeft']);
const HURTS = new Set<Role>(['hazard', 'lava']);
const WATER = new Set<Role>(['water', 'deepWater']);

export interface SolveResult {
  /** The goal reached (with the keys and switches it took, in some order). */
  goal: boolean;
  /** Things the player can never get to (keys, switches, coins, hearts, the goal), by role and cell. */
  unreached: { role: Role; col: number; row: number }[];
  /** States looked at (how much searching it took). */
  states: number;
  /** The way to the goal, cell by cell (where the player stands after each move), when found. */
  path: { col: number; row: number; move: Move; mode?: number }[];
}

/** How the player got into a cell: 'start', or a move rule's move ('walk', 'jump', 'wall_jump', 'dash'…). */
export type Move = 'start' | 'walk' | 'fall' | 'jump' | 'climb' | 'swim' | 'spring' | 'teleport' | 'push' | 'wall_slide' | 'wall_jump' | 'dash';

const MAX_STATES = 400000;

interface Cellish {
  get(col: number, row: number): Role | null;
}

/**
 * What changes as the player goes: the keys it holds and the levers it has pulled (bits), where each crate is (its
 * cell, col × height + row; -1: gone, pushed out of the level), and where the player is (a pressure plate is held
 * down by the player standing on it or by a crate).
 */
export interface World {
  kh: number;
  so: number;
  cr: number[];
  /** Crate cells, for looking up. */
  crates: Set<number>;
  /** Doors open now. */
  open: Set<string>;
}

/** What the solver needs of the player's reach: its limits, and the move rules (by default the arcade model's). */
export interface SolverReach {
  limits: Limits;
  moves: readonly MoveRule[];
}

/**
 * Solves a level as the grid has it (moving platforms already turned into still bridges along their paths), with
 * the player's reach: its limits alone (the arcade model's moves), or a reach description's limits and move rules.
 */
export function solveLevel(grid: LevelGrid, reach: Limits | SolverReach): SolveResult {
  const lim: Limits = 'limits' in reach ? reach.limits : reach;
  const rules: readonly MoveRule[] = 'limits' in reach ? reach.moves : ARCADE_MOVES;
  const W = grid.width;
  const H = grid.height;
  // Things placed by themselves: doors (walls until opened), keys, levers, pressure plates, teleporters.
  const doors = grid.placed.filter((p) => p.role === 'door');
  const keys = grid.placed.filter((p) => p.role === 'key');
  const switches = grid.placed.filter((p) => p.role === 'switch');
  const plates = grid.placed.filter((p) => p.role === 'plate');
  const teleporters = grid.placed.filter((p) => p.role === 'teleporter');
  const doorKey = new Map<string, number>(); // door ref → key index (requires)
  const doorSwitch = new Map<string, number>(); // door ref → lever index (controls)
  const doorPlates = new Map<string, number[]>(); // door ref → plate cells (controls: open while one is held down)
  for (const l of grid.links) {
    if (l.type === 'requires') doorKey.set(l.from, keys.findIndex((k) => k.ref === l.to));
    if (l.type === 'controls') {
      const plate = plates.find((q) => q.ref === l.from);
      if (plate) doorPlates.set(l.to, [...(doorPlates.get(l.to) ?? []), plate.col * H + plate.row]);
      else doorSwitch.set(l.to, switches.findIndex((q) => q.ref === l.from));
    }
  }
  const tele = new Map<string, { col: number; row: number }>();
  for (const l of grid.links)
    if (l.type === 'teleports_to') {
      const a = teleporters.find((t) => t.ref === l.from);
      const b = teleporters.find((t) => t.ref === l.to);
      if (a && b) tele.set(`${a.col},${a.row}`, { col: b.col, row: b.row });
    }
  // A door's cells (1 wide, 2 tall from its bottom cell up).
  const doorAt = new Map<string, string>();
  for (const d of doors) for (let k = 0; k < 2; k++) doorAt.set(`${d.col},${d.row - k}`, d.ref);
  // Crates move: out of the map, into the state.
  const crateStart: number[] = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid.get(c, r) === 'crate') crateStart.push(c * H + r);

  const cells: Cellish = grid;
  const role = (c: number, r: number): Role | null => {
    if (c < 0 || c >= W || r < 0 || r >= H) return r >= H ? null : 'ground';
    const x = cells.get(c, r);
    return x === 'crate' ? null : x;
  };
  const worldOf = (kh: number, so: number, cr: number[], pc: number, pr: number): World => {
    const crates = new Set(cr.filter((x) => x >= 0));
    const open = new Set<string>();
    for (const d of doors) {
      const k = doorKey.get(d.ref);
      const sw = doorSwitch.get(d.ref);
      const pl = doorPlates.get(d.ref);
      if ((k !== undefined && k >= 0 && (kh & (1 << k)) !== 0) || (sw !== undefined && sw >= 0 && (so & (1 << sw)) !== 0) || (pl && pl.some((cell) => crates.has(cell) || cell === pc * H + pr))) open.add(d.ref);
    }
    return { kh, so, cr, crates, open };
  };
  const crateAt = (c: number, r: number, w: World) => c >= 0 && c < W && r >= 0 && r < H && w.crates.has(c * H + r);
  const solidAt = (c: number, r: number, w: World) => {
    const d = doorAt.get(`${c},${r}`);
    if (d && !w.open.has(d)) return true;
    if (crateAt(c, r, w)) return true;
    const x = role(c, r);
    return !!x && SOLID.has(x);
  };
  /** Something to stand on in this cell (from above). */
  const supportAt = (c: number, r: number, w: World) => {
    if (r >= H) return false;
    if (solidAt(c, r, w)) return true;
    const x = role(c, r);
    return x === 'oneway' || x === 'mover' || x === 'spring' || x === 'ladder';
  };
  // (Above the level is open sky.)
  const freeAt = (c: number, r: number, w: World) => c >= 0 && c < W && (r < 0 || !solidAt(c, r, w));
  const hurtsAt = (c: number, r: number) => {
    const x = role(c, r);
    return !!x && HURTS.has(x);
  };
  const waterAt = (c: number, r: number) => {
    const x = role(c, r);
    return !!x && WATER.has(x);
  };
  const ladderAt = (c: number, r: number) => role(c, r) === 'ladder';
  /** Where the player can be: in free space, not in anything that hurts, held up (ground, a ladder, water). */
  // (Not inside a spring: walking into one stands you on it, and it bounces you.)
  const canBe = (c: number, r: number, w: World) =>
    r >= 0 && r < H && freeAt(c, r, w) && !hurtsAt(c, r) && role(c, r) !== 'spring' && (supportAt(c, r + 1, w) || ladderAt(c, r) || waterAt(c, r));
  /** Falling from a free cell: where it comes to rest (null: out of the level, or into something that hurts). */
  const fall = (c: number, r: number, w: World): number | null => {
    for (let y = r; y < H; y++) {
      if (!freeAt(c, y, w) || hurtsAt(c, y)) return null;
      if (canBe(c, y, w)) return y;
    }
    return null;
  };
  /** Where a crate let go in this cell comes to rest (through water, spikes and lava; on what holds it up); null: out of the level. */
  const crateFall = (c: number, r: number, w: World): number | null => {
    for (let y = r; y < H; y++) {
      if (y + 1 >= H) return null;
      if (solidAt(c, y + 1, w) || role(c, y + 1) === 'oneway' || role(c, y + 1) === 'mover' || role(c, y + 1) === 'spring') return y;
    }
    return null;
  };

  const start = (() => {
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (role(c, r) === 'player') return { c, r };
    return null;
  })();
  const goals: { col: number; row: number }[] = [];
  const wanted: { role: Role; col: number; row: number }[] = [];
  for (let r = 0; r < H; r++)
    for (let c = 0; c < W; c++) {
      const x = role(c, r);
      if (x === 'goal') goals.push({ col: c, row: r });
      if (x === 'goal' || x === 'coin' || x === 'heart') wanted.push({ role: x, col: c, row: r });
    }
  for (const k of keys) wanted.push({ role: 'key', col: k.col, row: k.row });
  for (const s of switches) wanted.push({ role: 'switch', col: s.col, row: s.row });
  for (const s of plates) wanted.push({ role: 'plate', col: s.col, row: s.row });
  if (!start) return { goal: false, unreached: wanted, states: 0, path: [] };

  const maxGap = Math.max(0, ...Array.from({ length: lim.maxRise + 9 }, (_, i) => lim.gap(lim.maxRise - i)));
  // (A mode other than standing: on a wall, sliding; written only then, so a level without such moves searches as ever.)
  const key = (c: number, r: number, kh: number, so: number, cr: number[], mode = 0) => `${c},${r},${kh},${so},${cr.join('.')}${mode ? `,m${mode}` : ''}`;
  const seen = new Map<string, string | null>(); // state → state it came from (null for the start)
  const costOf = new Map<string, number>();
  const moveOf = new Map<string, Move>();
  const reachedCells = new Set<string>();
  /** Cells the player passes through in the air (jumping), where it takes coins on the way. */
  const touched = new Set<string>();
  // (Cheapest first: walking costs little, a jump more, a long one more still, so the way found is the one a
  // player would take, not one long leap after another.)
  const heap: [number, string][] = [];
  const heapPush = (cost: number, id: string) => {
    heap.push([cost, id]);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const heapPop = (): [number, string] | undefined => {
    if (!heap.length) return undefined;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  const stateOf = new Map<string, [number, number, number, number, number[], number]>();
  const push = (c: number, r: number, kh: number, so: number, cr: number[], from: string | null, move: Move, step = 1, mode = 0) => {
    // (Picking up keys and pressing switches where it is.)
    keys.forEach((k, i) => {
      if (k.col === c && k.row === r) kh |= 1 << i;
    });
    switches.forEach((s, i) => {
      if (s.col === c && s.row === r) so |= 1 << i;
    });
    const id = key(c, r, kh, so, cr, mode);
    const cost = (from !== null ? costOf.get(from)! : 0) + step;
    if ((costOf.has(id) && costOf.get(id)! <= cost) || seen.size >= MAX_STATES) return;
    seen.set(id, from);
    costOf.set(id, cost);
    moveOf.set(id, move);
    stateOf.set(id, [c, r, kh, so, cr, mode]);
    reachedCells.add(`${c},${r}`);
    heapPush(cost, id);
  };
  const s0 = fall(start.c, start.r, worldOf(0, 0, crateStart, start.c, start.r));
  if (s0 === null) return { goal: false, unreached: wanted, states: 0, path: [] };
  push(start.c, s0, 0, 0, crateStart, null, 'start');

  /** A jump from (c, r) to stand at (c + dx, r - rise): room overhead, nothing solid in the way, within reach. */
  const canJump = (c: number, r: number, dx: number, rise: number, w: World, gapOf: (rise: number) => number, land: (c: number, r: number, w: World) => boolean = canBe): boolean => {
    const tc = c + dx;
    const tr = r - rise;
    if (!land(tc, tr, w)) return false;
    const between = Math.abs(dx) - 1;
    if (between > gapOf(rise)) return false;
    // (A wall right in front at body height: no run-up, the jump goes up first: only about half as far.)
    if (dx !== 0 && solidAt(c + Math.sign(dx), r, w) && between > Math.max(1, Math.floor(gapOf(rise) / 2))) return false;
    // (Off the top of a crate, a single loose cell: no run-up; up from it only onto what is right beside it.)
    if (dx !== 0 && crateAt(c, r + 1, w) && between > (rise > 0 ? 0 : Math.max(1, Math.floor(gapOf(rise) / 2)))) return false;
    const high = Math.min(r, tr);
    // Up out of where it stands: room for the rise and a row over the higher of the two.
    const apex = high - 1;
    for (let y = r - 1; y >= apex; y--) if (!freeAt(c, y, w) && role(c, y) !== 'oneway') return false;
    // Across: the row over the higher stand free; the stand row free of solids (spikes there are jumped over).
    let overHurt = 0;
    const step = Math.sign(dx);
    for (let x = c + step; x !== tc; x += step) {
      if (!freeAt(x, apex, w) && role(x, apex) !== 'oneway') return false;
      if (solidAt(x, high, w)) return false;
      if (hurtsAt(x, high)) overHurt++;
    }
    // (Over spikes at the height of the body: no wider than the player clears with its whole body above them.)
    if (overHurt > 0 && between > Math.max(lim.spikeCells, 0) + (rise < 0 ? 1 : 0)) return false;
    // Coming down onto the landing: its column free from the apex down.
    for (let y = apex; y < tr; y++) if (!freeAt(tc, y, w) && role(tc, y) !== 'oneway') return false;
    return true;
  };

  /** Every jump from (c, r) (on a spring: its launch), each added as a move from state `fromId`. */
  const jumpsFrom = (c: number, r: number, w: World, fromId: string, onSpring: boolean, extraCost: number) => {
    const reach = onSpring ? Math.max(lim.maxRise, lim.springRows - 1) : lim.maxRise;
    const gapOf = onSpring ? (rise: number) => (rise > lim.maxRise ? 2 : lim.gap(Math.min(rise, lim.maxRise))) : lim.gap;
    for (let rise = reach; rise >= -10; rise--)
      for (let dx = -(maxGap + 1); dx <= maxGap + 1; dx++) {
        if (dx === 0 && rise <= 0) continue;
        if (!canJump(c, r, dx, rise, w, gapOf)) continue;
        // (A spring's launch is wild: taken to get up, not to get past it; hopping over it is cheaper.)
        push(c + dx, r - rise, w.kh, w.so, w.cr, fromId, onSpring ? 'spring' : 'jump', extraCost + 3 + 1.5 * Math.max(0, Math.abs(dx) - 1) + Math.max(0, rise) + (rise < -2 ? 1 : 0) + (onSpring ? 6 : 0));
        // (On the way: the cells over its path, up to as high as it jumps.)
        const high = Math.min(r, r - rise);
        const up = Math.max(1, Math.ceil(lim.maxRise + 1));
        for (let x = c; x !== c + dx + Math.sign(dx || 1); x += Math.sign(dx || 1)) for (let y = high; y >= high - up; y--) touched.add(`${x},${y}`);
      }
  };

  const view: SolverView = { W, H, lim, maxGap, role, solidAt, supportAt, freeAt, hurtsAt, waterAt, ladderAt, canBe, fall, crateFall, crateAt, worldOf, canJump, jumpsFrom, push, teleportFrom: (c, r) => tele.get(`${c},${r}`) };
  let goalId: string | null = null;
  const done = new Set<string>();
  for (let next = heapPop(); next; next = heapPop()) {
    const [cost, id] = next;
    if (done.has(id) || cost > costOf.get(id)!) continue;
    done.add(id);
    const [c, r, kh, so, cr, mode] = stateOf.get(id)!;
    const w = worldOf(kh, so, cr, c, r);
    // (Inside a door that shut once the player stepped off its plate: not a place to be.)
    const inDoor = doorAt.get(`${c},${r}`);
    if (inDoor && !w.open.has(inDoor)) continue;
    // (In the air, the player no longer holds a plate down: a jump off one is judged with its doors as they are then.)
    const away = plates.some((q) => q.col === c && q.row === r) ? worldOf(kh, so, cr, -1, -1) : w;
    if (goals.some((g) => g.col === c && g.row === r)) {
      if (goalId === null) goalId = id;
    }
    // The moves: each rule adds the states it reaches from here (the arcade model's, then its abilities').
    const st: SolverState = { c, r, kh, so, cr, mode, id, w, away };
    for (const rule of rules) rule.successors(st, view);
  }

  const path: SolveResult['path'] = [];
  if (goalId !== null) {
    for (let id: string | null = goalId; id !== null; id = seen.get(id)!) {
      const [c, r, , , , mode] = stateOf.get(id)!;
      path.unshift({ col: c, row: r, move: moveOf.get(id)!, ...(mode ? { mode } : {}) });
    }
  }
  // (A thing counts as reached when the player stands in its cell or right under it, or passes through it jumping;
  // a coin, also from two cells under it: a jump from there takes it.)
  const unreached = wanted.filter((w) => !reachedCells.has(`${w.col},${w.row}`) && !reachedCells.has(`${w.col},${w.row + 1}`) && !touched.has(`${w.col},${w.row}`) && !(w.role !== 'goal' && w.role !== 'key' && w.role !== 'switch' && reachedCells.has(`${w.col},${w.row + 2}`)));
  return { goal: goalId !== null, unreached, states: seen.size, path };
}
