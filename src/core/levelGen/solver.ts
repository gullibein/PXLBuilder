/**
 * A route solver for levels the engine builds: from the player's start, cell by cell, can it get to the goal (and
 * to every key, switch, coin and heart)? It walks, falls, jumps (within the player's reach, with room overhead and
 * nothing solid in the way of the jump), climbs ladders, swims, bounces on springs and takes teleporters; spikes and
 * lava are never stood in; a door is a wall until the key it needs is held (or the switch that opens it is on).
 *
 * It explores states (where the player is, which keys it holds, which switches are on), so a level whose key is only
 * reachable through the door it opens fails, and a puzzle that has to be done in some order passes only when there
 * is such an order. Stricter than the level checker in what stands in the way (walls, ceilings, doors), simpler in
 * how the player moves (one cell at a time, jumps as a table): both have to pass.
 */
import type { LevelGrid } from './grid';
import type { Limits } from './limits';
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
  path: { col: number; row: number; move: Move }[];
}

export type Move = 'start' | 'walk' | 'fall' | 'jump' | 'climb' | 'swim' | 'spring' | 'teleport';

const MAX_STATES = 400000;

interface Cellish {
  get(col: number, row: number): Role | null;
}

/** Solves a level as the grid has it (moving platforms already turned into still bridges along their paths). */
export function solveLevel(grid: LevelGrid, lim: Limits): SolveResult {
  const W = grid.width;
  const H = grid.height;
  // Things placed by themselves: doors (walls until opened), keys, switches, teleporters.
  const doors = grid.placed.filter((p) => p.role === 'door');
  const keys = grid.placed.filter((p) => p.role === 'key');
  const switches = grid.placed.filter((p) => p.role === 'switch');
  const teleporters = grid.placed.filter((p) => p.role === 'teleporter');
  const doorKey = new Map<string, number>(); // door ref → key index (requires)
  const doorSwitch = new Map<string, number>(); // door ref → switch index (controls)
  for (const l of grid.links) {
    if (l.type === 'requires') doorKey.set(l.from, keys.findIndex((k) => k.ref === l.to));
    if (l.type === 'controls') doorSwitch.set(l.to, switches.findIndex((s) => s.ref === l.from));
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

  const cells: Cellish = grid;
  const role = (c: number, r: number): Role | null => (c < 0 || c >= W || r < 0 || r >= H ? (r >= H ? null : 'ground') : cells.get(c, r));
  const isOpen = (ref: string, keysHeld: number, switchesOn: number) => {
    const k = doorKey.get(ref);
    if (k !== undefined && k >= 0) return (keysHeld & (1 << k)) !== 0;
    const s = doorSwitch.get(ref);
    if (s !== undefined && s >= 0) return (switchesOn & (1 << s)) !== 0;
    return false;
  };
  const solidAt = (c: number, r: number, kh: number, so: number) => {
    const d = doorAt.get(`${c},${r}`);
    if (d && !isOpen(d, kh, so)) return true;
    const x = role(c, r);
    return !!x && SOLID.has(x);
  };
  /** Something to stand on in this cell (from above). */
  const supportAt = (c: number, r: number, kh: number, so: number) => {
    if (r >= H) return false;
    if (solidAt(c, r, kh, so)) return true;
    const x = role(c, r);
    return x === 'oneway' || x === 'mover' || x === 'spring' || x === 'ladder';
  };
  // (Above the level is open sky.)
  const freeAt = (c: number, r: number, kh: number, so: number) => c >= 0 && c < W && (r < 0 || !solidAt(c, r, kh, so));
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
  const canBe = (c: number, r: number, kh: number, so: number) =>
    r >= 0 && r < H && freeAt(c, r, kh, so) && !hurtsAt(c, r) && role(c, r) !== 'spring' && (supportAt(c, r + 1, kh, so) || ladderAt(c, r) || waterAt(c, r));
  /** Falling from a free cell: where it comes to rest (null: out of the level, or into something that hurts). */
  const fall = (c: number, r: number, kh: number, so: number): number | null => {
    for (let y = r; y < H; y++) {
      if (!freeAt(c, y, kh, so) || hurtsAt(c, y)) return null;
      if (canBe(c, y, kh, so)) return y;
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
  if (!start) return { goal: false, unreached: wanted, states: 0, path: [] };

  const maxGap = Math.max(0, ...Array.from({ length: lim.maxRise + 9 }, (_, i) => lim.gap(lim.maxRise - i)));
  const key = (c: number, r: number, kh: number, so: number) => ((c * 4096 + r) * 256 + kh) * 256 + so;
  const seen = new Map<number, number>(); // state → state it came from (-1 for the start)
  const costOf = new Map<number, number>();
  const moveOf = new Map<number, Move>();
  const reachedCells = new Set<string>();
  /** Cells the player passes through in the air (jumping), where it takes coins on the way. */
  const touched = new Set<string>();
  // (Cheapest first: walking costs little, a jump more, a long one more still, so the way found is the one a
  // player would take, not one long leap after another.)
  const heap: [number, number][] = [];
  const heapPush = (cost: number, id: number) => {
    heap.push([cost, id]);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const heapPop = (): [number, number] | undefined => {
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
  const stateOf = new Map<number, [number, number, number, number]>();
  const push = (c: number, r: number, kh: number, so: number, from: number, move: Move, step = 1) => {
    // (Picking up keys and pressing switches where it is.)
    keys.forEach((k, i) => {
      if (k.col === c && k.row === r) kh |= 1 << i;
    });
    switches.forEach((s, i) => {
      if (s.col === c && s.row === r) so |= 1 << i;
    });
    const id = key(c, r, kh, so);
    const cost = (from >= 0 ? costOf.get(from)! : 0) + step;
    if ((costOf.has(id) && costOf.get(id)! <= cost) || seen.size >= MAX_STATES) return;
    seen.set(id, from);
    costOf.set(id, cost);
    moveOf.set(id, move);
    stateOf.set(id, [c, r, kh, so]);
    reachedCells.add(`${c},${r}`);
    heapPush(cost, id);
  };
  const s0 = fall(start.c, start.r, 0, 0);
  if (s0 === null) return { goal: false, unreached: wanted, states: 0, path: [] };
  push(start.c, s0, 0, 0, -1, 'start');

  /** A jump from (c, r) to stand at (c + dx, r - rise): room overhead, nothing solid in the way, within reach. */
  const canJump = (c: number, r: number, dx: number, rise: number, kh: number, so: number, gapOf: (rise: number) => number): boolean => {
    const tc = c + dx;
    const tr = r - rise;
    if (!canBe(tc, tr, kh, so)) return false;
    const between = Math.abs(dx) - 1;
    if (between > gapOf(rise)) return false;
    // (A wall right in front at body height: no run-up, the jump goes up first: only about half as far.)
    if (dx !== 0 && solidAt(c + Math.sign(dx), r, kh, so) && between > Math.max(1, Math.floor(gapOf(rise) / 2))) return false;
    const high = Math.min(r, tr);
    // Up out of where it stands: room for the rise and a row over the higher of the two.
    const apex = high - 1;
    for (let y = r - 1; y >= apex; y--) if (!freeAt(c, y, kh, so) && role(c, y) !== 'oneway') return false;
    // Across: the row over the higher stand free; the stand row free of solids (spikes there are jumped over).
    let overHurt = 0;
    const step = Math.sign(dx);
    for (let x = c + step; x !== tc; x += step) {
      if (!freeAt(x, apex, kh, so) && role(x, apex) !== 'oneway') return false;
      if (solidAt(x, high, kh, so)) return false;
      if (hurtsAt(x, high)) overHurt++;
    }
    // (Over spikes at the height of the body: no wider than the player clears with its whole body above them.)
    if (overHurt > 0 && between > Math.max(lim.spikeCells, 0) + (rise < 0 ? 1 : 0)) return false;
    // Coming down onto the landing: its column free from the apex down.
    for (let y = apex; y < tr; y++) if (!freeAt(tc, y, kh, so) && role(tc, y) !== 'oneway') return false;
    return true;
  };

  /** Every jump from (c, r) (on a spring: its launch), each added as a move from state `fromId`. */
  const jumpsFrom = (c: number, r: number, kh: number, so: number, fromId: number, onSpring: boolean, extraCost: number) => {
    const reach = onSpring ? Math.max(lim.maxRise, lim.springRows - 1) : lim.maxRise;
    const gapOf = onSpring ? (rise: number) => (rise > lim.maxRise ? 2 : lim.gap(Math.min(rise, lim.maxRise))) : lim.gap;
    for (let rise = reach; rise >= -10; rise--)
      for (let dx = -(maxGap + 1); dx <= maxGap + 1; dx++) {
        if (dx === 0 && rise <= 0) continue;
        if (!canJump(c, r, dx, rise, kh, so, gapOf)) continue;
        // (A spring's launch is wild: taken to get up, not to get past it; hopping over it is cheaper.)
        push(c + dx, r - rise, kh, so, fromId, onSpring ? 'spring' : 'jump', extraCost + 3 + 1.5 * Math.max(0, Math.abs(dx) - 1) + Math.max(0, rise) + (rise < -2 ? 1 : 0) + (onSpring ? 6 : 0));
        // (On the way: the cells over its path, up to as high as it jumps.)
        const high = Math.min(r, r - rise);
        const up = Math.max(1, Math.ceil(lim.maxRise + 1));
        for (let x = c; x !== c + dx + Math.sign(dx || 1); x += Math.sign(dx || 1)) for (let y = high; y >= high - up; y--) touched.add(`${x},${y}`);
      }
  };

  let goalId = -1;
  const done = new Set<number>();
  for (let next = heapPop(); next; next = heapPop()) {
    const [cost, id] = next;
    if (done.has(id) || cost > costOf.get(id)!) continue;
    done.add(id);
    const [c, r, kh, so] = stateOf.get(id)!;
    if (goals.some((g) => g.col === c && g.row === r)) {
      if (goalId < 0) goalId = id;
    }
    // Walk left and right (then fall); step up a ramp or onto a spring.
    for (const dx of [-1, 1]) {
      const nc = c + dx;
      if (freeAt(nc, r, kh, so) && !hurtsAt(nc, r) && role(nc, r) !== 'spring') {
        const y = fall(nc, r, kh, so);
        if (y !== null) push(nc, y, kh, so, id, y === r ? 'walk' : 'fall');
      } else {
        const x = role(nc, r);
        if ((x === 'rampRight' || x === 'rampLeft') && canBe(nc, r - 1, kh, so)) push(nc, r - 1, kh, so, id, 'walk');
        // (Walking onto a spring bounces: it launches from its top at once, Jump held, wherever that reaches.)
        if (x === 'spring' && freeAt(nc, r - 1, kh, so)) jumpsFrom(nc, r - 1, kh, so, id, true, 1);
      }
    }
    // Ladders: up and down.
    if (ladderAt(c, r) || ladderAt(c, r + 1)) {
      if (ladderAt(c, r - 1) || (ladderAt(c, r) && freeAt(c, r - 1, kh, so))) {
        const up = r - 1;
        if (canBe(c, up, kh, so)) push(c, up, kh, so, id, 'climb');
        else {
          // (Off the top of a ladder: stepping onto the ground beside it.)
          for (const dx of [-1, 1]) if (canBe(c + dx, up, kh, so)) push(c + dx, up, kh, so, id, 'climb');
        }
      }
      if (ladderAt(c, r + 1) && freeAt(c, r + 1, kh, so)) push(c, r + 1, kh, so, id, 'climb');
      // (From the top of a ladder sticking out of the floor, onto the floor beside.)
      for (const dx of [-1, 1]) if (ladderAt(c, r) && canBe(c + dx, r, kh, so)) push(c + dx, r, kh, so, id, 'climb');
    }
    // Swimming: any way through water; up out of it at the surface.
    if (waterAt(c, r)) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dx;
        const nr = r + dy;
        if (freeAt(nc, nr, kh, so) && !hurtsAt(nc, nr)) {
          if (waterAt(nc, nr) || canBe(nc, nr, kh, so)) push(nc, nr, kh, so, id, 'swim');
          else {
            const y = fall(nc, nr, kh, so);
            if (y !== null) push(nc, y, kh, so, id, 'swim');
          }
        }
      }
    }
    // Jumps (from the ground, a ladder, or the water's surface).
    const standing = supportAt(c, r + 1, kh, so) || ladderAt(c, r) || (waterAt(c, r) && !waterAt(c, r - 1));
    if (standing) jumpsFrom(c, r, kh, so, id, role(c, r + 1) === 'spring', 0);
    // Teleporters.
    const to = tele.get(`${c},${r}`);
    if (to) {
      const y = fall(to.col, to.row, kh, so);
      if (y !== null) push(to.col, y, kh, so, id, 'teleport');
    }
  }

  const path: SolveResult['path'] = [];
  if (goalId >= 0) {
    for (let id = goalId; id !== -1; id = seen.get(id)!) {
      const [c, r] = stateOf.get(id)!;
      path.unshift({ col: c, row: r, move: moveOf.get(id)! });
    }
  }
  // (A thing counts as reached when the player stands in its cell or right under it, or passes through it jumping;
  // a coin, also from two cells under it: a jump from there takes it.)
  const unreached = wanted.filter((w) => !reachedCells.has(`${w.col},${w.row}`) && !reachedCells.has(`${w.col},${w.row + 1}`) && !touched.has(`${w.col},${w.row}`) && !(w.role !== 'goal' && w.role !== 'key' && w.role !== 'switch' && reachedCells.has(`${w.col},${w.row + 2}`)));
  return { goal: goalId >= 0, unreached, states: seen.size, path };
}
