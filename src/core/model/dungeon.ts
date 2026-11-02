/**
 * Random levels: a level with a generator (Scene.generator) is built anew each time it is played, from a recipe:
 * rooms of a size range placed apart, joined by corridors (a tree, plus extra ones for loops), walls round every
 * floor square, the player put in the first room and the way down in the room farthest from it, and monsters and
 * treasure picked by weight for the floor (deeper: more, and other kinds). The same seed always gives the same
 * dungeon (the editor's example, a play to repeat). Whatever is placed by hand stays where it is: the generator
 * leaves its squares free.
 */
import type { ComponentRegistry } from '../components/registry';
import type { DungeonGenerator, DungeonSpawn, EntityInstance, Id, Project, Scene } from '../types';
import { instantiateDefinition } from './factory';
import { LEVEL_CELL } from './placement';
import { resolveEntity } from './resolve';

export const DEFAULT_GENERATOR: Omit<DungeonGenerator, 'wall' | 'floor' | 'stairs' | 'monsters' | 'loot'> = {
  style: 'rooms',
  seed: null,
  preview: 1,
  previewFloor: 1,
  width: 40,
  height: 28,
  rooms: 8,
  roomMin: 4,
  roomMax: 8,
  corridor: 1,
  loops: 0.2,
  monsterCount: 4,
  monstersPerFloor: 1,
  lootCount: 3,
  lootPerFloor: 0,
};

/** A generator for this game: walls, floor and the way down found among its objects; its monsters and treasure. */
export function defaultGenerator(project: Project): DungeonGenerator {
  const find = (test: (name: string, tags: string[]) => boolean) => project.definitions.find((d) => test(d.name.toLowerCase(), d.tags))?.id ?? null;
  const all = (test: (name: string, tags: string[]) => boolean) => project.definitions.filter((d) => test(d.name.toLowerCase(), d.tags)).map((d) => ({ object: d.id, weight: 1, fromFloor: 1 }));
  return {
    ...DEFAULT_GENERATOR,
    wall: find((n, t) => n === 'wall' || t.includes('wall')) ?? find((_, t) => t.includes('ground') || t.includes('solid')),
    floor: null,
    stairs: find((n, t) => n.includes('stairs') || t.includes('stairs')) ?? find((n, t) => n === 'goal' || t.includes('goal')),
    monsters: all((_, t) => t.includes('enemy')),
    loot: all((n, t) => t.includes('collectible') || t.includes('coin') || n === 'coin' || n === 'key' || n === 'heart'),
  };
}

/** A small, fast, seeded random number source (the same seed, the same numbers). */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dungeon {
  /** The generated things, in level coordinates (the dungeon's top left square is at 0, 0). */
  entities: EntityInstance[];
  start: { x: number; y: number } | null;
  stairs: { x: number; y: number } | null;
  rooms: number;
  /** The rooms (rooms style): middles and sizes in level pixels, the first is the start's. */
  roomList: { x: number; y: number; w: number; h: number }[];
  /** The locked door on the way to the stairs and its key (door and key chosen), where they are. */
  locked: { door: { x: number; y: number }; key: { x: number; y: number } } | null;
  /** What didn't work out ("only 3 of 8 rooms fit"). */
  problems: string[];
}

const center = (i: number) => i * LEVEL_CELL + LEVEL_CELL / 2;

/** Builds the dungeon for this seed and floor (the level's hand-placed things are only read, never changed). */
export function generateDungeon(project: Project, scene: Scene, registry: ComponentRegistry, seed: number, floor = 1): Dungeon {
  const g = scene.generator!;
  const rnd = seededRandom(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));
  const W = Math.max(10, Math.min(120, Math.round(g.width)));
  const H = Math.max(10, Math.min(120, Math.round(g.height)));
  const problems: string[] = [];
  const open = new Uint8Array(W * H);
  const at = (i: number, j: number) => j * W + i;
  const carve = (i: number, j: number) => {
    if (i > 0 && j > 0 && i < W - 1 && j < H - 1) open[at(i, j)] = 1;
  };
  // Squares taken by hand-placed things (the generator leaves them free, and builds no wall on them).
  const handPlaced = new Set<number>();
  for (const e of scene.entities) {
    const i = Math.floor(e.transform.position.x / LEVEL_CELL);
    const j = Math.floor(e.transform.position.y / LEVEL_CELL);
    if (i >= 0 && j >= 0 && i < W && j < H) handPlaced.add(at(i, j));
  }

  const rooms: Room[] = [];
  const mid = (r: Room) => ({ i: r.x + Math.floor(r.w / 2), j: r.y + Math.floor(r.h / 2) });
  const style = g.style ?? 'rooms';
  if (style === 'caves') {
    // Caves: rock scattered at random, smoothed (a square becomes rock when most around it is), then only the
    // largest open region kept: winding caverns, all joined.
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) if (rnd() > 0.45) open[at(i, j)] = 1;
    for (let pass = 0; pass < 5; pass++) {
      const next = new Uint8Array(W * H);
      for (let j = 1; j < H - 1; j++)
        for (let i = 1; i < W - 1; i++) {
          let rock = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && !open[at(i + di, j + dj)]) rock++;
          next[at(i, j)] = rock >= 5 ? 0 : rock <= 3 ? 1 : open[at(i, j)];
        }
      open.set(next);
    }
    let best: number[] = [];
    const seen = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) {
      if (!open[k] || seen[k]) continue;
      const region = [k];
      seen[k] = 1;
      for (let q = 0; q < region.length; q++) {
        const c = region[q];
        for (const n of [c + 1, c - 1, c + W, c - W])
          if (open[n] && !seen[n]) {
            seen[n] = 1;
            region.push(n);
          }
      }
      if (region.length > best.length) best = region;
    }
    open.fill(0);
    for (const k of best) open[k] = 1;
    if (best.length < 30) problems.push('the caves came out very small (make the dungeon bigger)');
  } else if (style === 'maze') {
    // A maze: passages one square wide between every other square, dug at random from the corner until all are
    // reached (one way between any two; loops knock a few more walls through).
    const stack: [number, number][] = [[1, 1]];
    open[at(1, 1)] = 1;
    while (stack.length) {
      const [i, j] = stack[stack.length - 1];
      const ways = [
        [2, 0],
        [-2, 0],
        [0, 2],
        [0, -2],
      ].filter(([di, dj]) => i + di > 0 && j + dj > 0 && i + di < W - 1 && j + dj < H - 1 && !open[at(i + di, j + dj)]);
      if (!ways.length) {
        stack.pop();
        continue;
      }
      const [di, dj] = ways[Math.floor(rnd() * ways.length)];
      open[at(i + di / 2, j + dj / 2)] = 1;
      open[at(i + di, j + dj)] = 1;
      stack.push([i + di, j + dj]);
    }
    const loops = Math.max(0, Math.min(1, g.loops));
    for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) if (!open[at(i, j)] && rnd() < loops * 0.15 && ((open[at(i - 1, j)] && open[at(i + 1, j)]) || (open[at(i, j - 1)] && open[at(i, j + 1)]))) open[at(i, j)] = 1;
  } else {
    // Rooms: tried at random places until enough fit (each with a square of rock round it).
    const want = Math.max(1, Math.min(40, Math.round(g.rooms)));
    const lo = Math.max(2, Math.min(g.roomMin, g.roomMax));
    const hi = Math.max(lo, Math.max(g.roomMin, g.roomMax));
    for (let tries = 0; tries < want * 60 && rooms.length < want; tries++) {
      const w = int(lo, Math.min(hi, W - 4));
      const h = int(lo, Math.min(hi, H - 4));
      const r = { x: int(1, W - w - 2), y: int(1, H - h - 2), w, h };
      if (rooms.some((o) => r.x <= o.x + o.w + 1 && o.x <= r.x + r.w + 1 && r.y <= o.y + o.h + 1 && o.y <= r.y + r.h + 1)) continue;
      rooms.push(r);
    }
    if (rooms.length < want) problems.push(`only ${rooms.length} of ${want} rooms fit in ${W}×${H} squares (make the dungeon bigger, or the rooms smaller)`);
    for (const r of rooms) for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) carve(i, j);
    // Corridors: each room to the nearest one before it (all joined), then some extra for loops.
    const cw = Math.max(1, Math.min(3, Math.round(g.corridor)));
    const corridor = (a: Room, b: Room) => {
      const p = mid(a);
      const q = mid(b);
      const across = (j: number, i1: number, i2: number) => {
        for (let i = Math.min(i1, i2); i <= Math.max(i1, i2); i++) for (let k = 0; k < cw; k++) carve(i, j + k);
      };
      const down = (i: number, j1: number, j2: number) => {
        for (let j = Math.min(j1, j2); j <= Math.max(j1, j2); j++) for (let k = 0; k < cw; k++) carve(i + k, j);
      };
      if (rnd() < 0.5) {
        across(p.j, p.i, q.i);
        down(q.i, p.j, q.j);
      } else {
        down(p.i, p.j, q.j);
        across(q.j, p.i, q.i);
      }
    };
    const dist = (a: Room, b: Room) => Math.abs(mid(a).i - mid(b).i) + Math.abs(mid(a).j - mid(b).j);
    for (let n = 1; n < rooms.length; n++) {
      let best = 0;
      for (let k = 1; k < n; k++) if (dist(rooms[n], rooms[k]) < dist(rooms[n], rooms[best])) best = k;
      corridor(rooms[n], rooms[best]);
    }
    const loops = Math.max(0, Math.min(1, g.loops));
    for (let n = 0; n < rooms.length; n++) if (rooms.length > 2 && rnd() < loops) corridor(rooms[n], rooms[int(0, rooms.length - 1)]);
  }
  // Room templates (rooms made by hand in levels of their own: a vault, a shrine, a pillared hall): stamped into
  // rooms that fit them (not the first), now and then. What is solid in them stands in for floor; a template that
  // would cut the dungeon in two is left out of that room.
  const stampedSolid = new Set<number>();
  const stampedAt = new Set<number>();
  const stamps: { thing: EntityInstance; x: number; y: number }[] = [];
  if (rooms.length > 1 && g.templates?.length) {
    const layouts = g.templates.map((id) => project.scenes.find((s) => s.id === id)).flatMap((s) => (s ? [templateLayout(project, s, registry)] : [])).filter((t) => t.things.length);
    const openCount = () => open.reduce((n, v) => n + v, 0);
    const joined = () => {
      const first = open.indexOf(1);
      if (first < 0) return true;
      const seen = new Uint8Array(W * H);
      seen[first] = 1;
      const queue = [first];
      for (let q = 0; q < queue.length; q++)
        for (const n of [queue[q] + 1, queue[q] - 1, queue[q] + W, queue[q] - W])
          if (open[n] && !seen[n]) {
            seen[n] = 1;
            queue.push(n);
          }
      return queue.length === openCount();
    };
    const chance = Math.max(0, Math.min(1, g.templateChance ?? 0.5));
    for (const r of rooms.slice(1)) {
      const fit = layouts.filter((t) => t.w <= r.w && t.h <= r.h);
      if (!fit.length || rnd() >= chance) continue;
      const t = fit[Math.floor(rnd() * fit.length)];
      const ox = r.x + Math.floor((r.w - t.w) / 2);
      const oy = r.y + Math.floor((r.h - t.h) / 2);
      const solid = t.solid.map(([i, j]) => at(ox + i, oy + j));
      for (const c of solid) open[c] = 0;
      if (!joined()) {
        for (const c of solid) open[c] = 1;
        continue;
      }
      for (const c of solid) stampedSolid.add(c);
      for (const s of t.things) {
        stamps.push({ thing: s.thing, x: ox * LEVEL_CELL + s.dx, y: oy * LEVEL_CELL + s.dy });
        stampedAt.add(at(ox + Math.floor(s.dx / LEVEL_CELL), oy + Math.floor(s.dy / LEVEL_CELL)));
      }
    }
  }
  // (Hand-placed things stand on floor: their squares are open too.)
  // (What was dug, before squares are opened for hand-placed things: the start is looked for in it.)
  const dug = open.slice();
  for (const k of handPlaced) open[k] = 1;

  const out: EntityInstance[] = [];
  let made = 0;
  const place = (object: Id | null, i: number, j: number) => {
    const def = object ? project.definitions.find((d) => d.id === object) : undefined;
    if (!def) return;
    const e = instantiateDefinition(def, { x: center(i), y: center(j) });
    e.id = `gen_${made++}`;
    out.push(e);
  };
  if (g.wall && !project.definitions.some((d) => d.id === g.wall)) problems.push('the wall object is no longer in the game');
  if (!g.wall) problems.push('no wall object chosen: the dungeon has no walls');

  // Floor tiles under everything (when chosen), then walls round every open square, then the templates' things.
  if (g.floor) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (open[at(i, j)] || stampedSolid.has(at(i, j))) place(g.floor, i, j);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (open[at(i, j)] || stampedSolid.has(at(i, j))) continue;
      let edge = false;
      for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1 && !edge; di++) edge = i + di >= 0 && j + dj >= 0 && i + di < W && j + dj < H && open[at(i + di, j + dj)] === 1;
      if (edge) place(g.wall, i, j);
    }

  // The start (the first room; in caves and mazes the open square nearest the top left) and the way down (the
  // place the most steps away: the farthest room's middle, or the farthest square).
  let start: Dungeon['start'] = null;
  let locked: Dungeon['locked'] = null;
  let stairs: Dungeon['stairs'] = null;
  for (const s of stamps) {
    const e: EntityInstance = { ...structuredClone(s.thing), id: `gen_${made++}`, transform: { ...s.thing.transform, position: { x: s.x, y: s.y } } };
    out.push(e);
  }
  const taken = new Set<number>([...handPlaced, ...stampedAt]);
  // A room's middle, or the free square nearest it when a template has something there.
  const middle = (r: Room): number => {
    const m = at(mid(r).i, mid(r).j);
    if (open[m] && !taken.has(m)) return m;
    let best = m;
    let bestD = Infinity;
    for (let j = r.y; j < r.y + r.h; j++)
      for (let i = r.x; i < r.x + r.w; i++) {
        const d = Math.abs(i - mid(r).i) + Math.abs(j - mid(r).j);
        if (open[at(i, j)] && !taken.has(at(i, j)) && d < bestD) {
          best = at(i, j);
          bestD = d;
        }
      }
    return best;
  };
  let s0 = -1;
  if (rooms.length) s0 = at(mid(rooms[0]).i, mid(rooms[0]).j);
  else for (let k = 0; k < W * H && s0 < 0; k++) if (dug[(k % H) * W + Math.floor(k / H)]) s0 = (k % H) * W + Math.floor(k / H);
  const steps = new Int32Array(W * H).fill(-1);
  if (s0 >= 0) {
    start = { x: center(s0 % W), y: center(Math.floor(s0 / W)) };
    taken.add(s0);
    steps[s0] = 0;
    const queue = [s0];
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      for (const n of [k + 1, k - 1, k + W, k - W]) {
        if (open[n] && steps[n] < 0) {
          steps[n] = steps[k] + 1;
          queue.push(n);
        }
      }
    }
    let far = -1;
    if (rooms.length > 1) {
      const room = rooms.slice(1).reduce((a, r) => (steps[middle(r)] > steps[middle(a)] ? r : a));
      far = middle(room);
    } else if (!rooms.length) for (let k = 0; k < W * H; k++) if (steps[k] > (far >= 0 ? steps[far] : 0)) far = k;
    if (far >= 0) {
      // Locked: the way down in the farthest room that one door can shut off (with loops not every room can be).
      if (g.door && g.key && floor >= (g.lockFromFloor ?? 1)) {
        const tries = rooms.length > 1 ? rooms.slice(1).map(middle).sort((a, b) => steps[b] - steps[a]) : [far];
        const lockable = tries.find((k) => steps[k] > 0 && doorFor(k) !== null);
        if (lockable === undefined) problems.push('no single way to the stairs to put the locked door on (fewer loops)');
        else {
          far = lockable;
          const { door, key } = doorFor(far)!;
          place(g.door, door % W, Math.floor(door / W));
          place(g.key, key % W, Math.floor(key / W));
          taken.add(door);
          taken.add(key);
          locked = { door: { x: center(door % W), y: center(Math.floor(door / W)) }, key: { x: center(key % W), y: center(Math.floor(key / W)) } };
        }
      }
      if (g.stairs) {
        place(g.stairs, far % W, Math.floor(far / W));
        stairs = { x: center(far % W), y: center(Math.floor(far / W)) };
      }
      taken.add(far);
    } else if (g.stairs) problems.push('only one room: the way down would be in the start room, so there is none');
  }

  /**
   * Where a locked door goes on the only way to `goal` (the square nearest it that, shut, cuts it off from the start:
   * a doorway out of a room or a corridor), and its key: somewhere the player can get to without it, as far from the
   * start as that allows (in a room, when there are rooms). Null when there is no single way (loops).
   */
  function doorFor(goal: number): { door: number; key: number } | null {
    const reach = (shut: number) => {
      const seen = new Uint8Array(W * H);
      seen[s0] = 1;
      const queue = [s0];
      for (let q = 0; q < queue.length; q++)
        for (const n of [queue[q] + 1, queue[q] - 1, queue[q] + W, queue[q] - W])
          if (open[n] && !seen[n] && n !== shut) {
            seen[n] = 1;
            queue.push(n);
          }
      return seen;
    };
    // The way back from the goal to the start, one step nearer each time.
    const way: number[] = [];
    for (let k = goal; steps[k] > 0; ) {
      const back = [k + 1, k - 1, k + W, k - W].find((n) => steps[n] === steps[k] - 1);
      if (back === undefined) break;
      if (back !== s0) way.push(back);
      k = back;
    }
    const inRoom = (c: number) => rooms.slice(1).some((r) => c % W >= r.x && c % W < r.x + r.w && Math.floor(c / W) >= r.y && Math.floor(c / W) < r.y + r.h);
    for (const k of way) {
      if (taken.has(k)) continue;
      const side = reach(k);
      if (side[goal]) continue;
      let best = -1;
      for (const room of [true, false]) {
        for (let c = 0; c < W * H; c++) if (side[c] && c !== s0 && !taken.has(c) && (!room || inRoom(c)) && (best < 0 || steps[c] > steps[best])) best = c;
        if (best >= 0 || !rooms.length) break;
      }
      return best < 0 ? null : { door: k, key: best };
    }
    return null;
  }

  // Monsters and treasure, by weight among those for this floor, on free squares in the rooms (not the first).
  // (Rooms: in the rooms but the first. Caves and mazes: anywhere at least 4 steps from the start.)
  const free: [number, number][] = [];
  if (rooms.length) {
    for (const r of rooms.slice(rooms.length > 1 ? 1 : 0)) for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (!taken.has(at(i, j))) free.push([i, j]);
  } else for (let k = 0; k < W * H; k++) if (open[k] && steps[k] >= 4 && !taken.has(k)) free.push([k % W, Math.floor(k / W)]);
  for (let n = free.length - 1; n > 0; n--) {
    const k = Math.floor(rnd() * (n + 1));
    [free[n], free[k]] = [free[k], free[n]];
  }
  const pick = (list: DungeonSpawn[]) => {
    const ok = list.filter((s) => s.weight > 0 && floor >= (s.fromFloor || 1) && project.definitions.some((d) => d.id === s.object));
    const total = ok.reduce((t, s) => t + s.weight, 0);
    let r = rnd() * total;
    for (const s of ok) if ((r -= s.weight) < 0) return s.object;
    return ok.at(-1)?.object ?? null;
  };
  const spawn = (list: DungeonSpawn[], count: number) => {
    for (let n = 0; n < count; n++) {
      const cell = free.pop();
      const object = pick(list);
      if (!cell || !object) break;
      place(object, cell[0], cell[1]);
    }
  };
  spawn(g.monsters, Math.max(0, Math.round(g.monsterCount + g.monstersPerFloor * (floor - 1))));
  spawn(g.loot, Math.max(0, Math.round(g.lootCount + g.lootPerFloor * (floor - 1))));
  void registry;
  // The rooms, for scripts (room_x…): their middles and sizes in level pixels.
  const roomList = rooms.map((r) => ({ x: (r.x + r.w / 2) * LEVEL_CELL, y: (r.y + r.h / 2) * LEVEL_CELL, w: r.w * LEVEL_CELL, h: r.h * LEVEL_CELL }));
  return { entities: out, start, stairs, rooms: rooms.length, roomList, locked, problems };
}

/** A room template (a level of its own): its things relative to its top left square, its size and its solid squares. */
function templateLayout(project: Project, scene: Scene, registry: ComponentRegistry): { w: number; h: number; things: { thing: EntityInstance; dx: number; dy: number }[]; solid: [number, number][] } {
  // (Not the player, nor anything steered: a room has no player of its own.)
  const things = scene.entities.filter((e) => !resolveEntity(project, e, registry).components.CharacterController);
  if (!things.length) return { w: 0, h: 0, things: [], solid: [] };
  const cell = (v: number) => Math.floor(v / LEVEL_CELL);
  const i0 = Math.min(...things.map((e) => cell(e.transform.position.x)));
  const j0 = Math.min(...things.map((e) => cell(e.transform.position.y)));
  const i1 = Math.max(...things.map((e) => cell(e.transform.position.x)));
  const j1 = Math.max(...things.map((e) => cell(e.transform.position.y)));
  const solid: [number, number][] = [];
  for (const e of things) {
    const c = resolveEntity(project, e, registry).components;
    const body = c.PhysicsBody?.bodyType;
    if (c.Collider && !c.Collider.isTrigger && (body === undefined || body === 'static')) solid.push([cell(e.transform.position.x) - i0, cell(e.transform.position.y) - j0]);
  }
  return { w: i1 - i0 + 1, h: j1 - j0 + 1, things: things.map((e) => ({ thing: e, dx: e.transform.position.x - i0 * LEVEL_CELL, dy: e.transform.position.y - j0 * LEVEL_CELL })), solid };
}

/** The levels used as room templates by random levels (they are not played as levels of their own). */
export function templateLevels(project: Project): Set<Id> {
  return new Set(project.scenes.flatMap((s) => s.generator?.templates ?? []));
}

/** The level played after this one (in the game's order; room templates are skipped). */
export function nextLevel(project: Project, sceneId: Id): Scene | undefined {
  const skip = templateLevels(project);
  return project.scenes.slice(project.scenes.findIndex((s) => s.id === sceneId) + 1).find((s) => !skip.has(s.id));
}

/**
 * The level as it is played with this seed: what is placed by hand, the player moved to the start, and the
 * generated dungeon around it (under what is placed by hand).
 */
export function withDungeon(project: Project, scene: Scene, registry: ComponentRegistry, seed: number, floor = 1): Scene {
  return buildLevel(project, scene, registry, seed, floor).scene;
}

/** The level as played, and the dungeon built for it (its rooms, start and way down, for scripts). */
export function buildLevel(project: Project, scene: Scene, registry: ComponentRegistry, seed: number, floor = 1): { scene: Scene; dungeon: Dungeon | null } {
  if (!scene.generator) return { scene, dungeon: null };
  const d = generateDungeon(project, scene, registry, seed, floor);
  const isPlayer = (e: EntityInstance) => !!resolveEntity(project, e, registry).components.CharacterController;
  const own = scene.entities.map((e) => (d.start && isPlayer(e) ? { ...e, transform: { ...e.transform, position: { ...d.start } } } : e));
  return { scene: { ...scene, entities: [...d.entities, ...own] }, dungeon: d };
}

/** A new seed for a play (or a reroll). */
export function newSeed(): number {
  return 1 + Math.floor(Math.random() * 999999);
}
