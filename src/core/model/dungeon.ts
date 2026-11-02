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

  // Rooms: tried at random places until enough fit (each with a square of rock round it).
  const want = Math.max(1, Math.min(40, Math.round(g.rooms)));
  const lo = Math.max(2, Math.min(g.roomMin, g.roomMax));
  const hi = Math.max(lo, Math.max(g.roomMin, g.roomMax));
  const rooms: Room[] = [];
  for (let tries = 0; tries < want * 60 && rooms.length < want; tries++) {
    const w = int(lo, Math.min(hi, W - 4));
    const h = int(lo, Math.min(hi, H - 4));
    const r = { x: int(1, W - w - 2), y: int(1, H - h - 2), w, h };
    if (rooms.some((o) => r.x <= o.x + o.w + 1 && o.x <= r.x + r.w + 1 && r.y <= o.y + o.h + 1 && o.y <= r.y + r.h + 1)) continue;
    rooms.push(r);
  }
  if (rooms.length < want) problems.push(`only ${rooms.length} of ${want} rooms fit in ${W}×${H} squares (make the dungeon bigger, or the rooms smaller)`);
  for (const r of rooms) for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) carve(i, j);
  const mid = (r: Room) => ({ i: r.x + Math.floor(r.w / 2), j: r.y + Math.floor(r.h / 2) });

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
  // (Hand-placed things stand on floor: their squares are open too.)
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
  if (!g.wall) problems.push('no wall object chosen: the rooms have no walls');

  // Floor tiles under everything (when chosen), then walls round every open square.
  if (g.floor) for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) if (open[at(i, j)]) place(g.floor, i, j);
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      if (open[at(i, j)]) continue;
      let edge = false;
      for (let dj = -1; dj <= 1 && !edge; dj++) for (let di = -1; di <= 1 && !edge; di++) edge = i + di >= 0 && j + dj >= 0 && i + di < W && j + dj < H && open[at(i + di, j + dj)] === 1;
      if (edge) place(g.wall, i, j);
    }

  // The start (the first room) and the way down (the room the most steps away).
  let start: Dungeon['start'] = null;
  let stairs: Dungeon['stairs'] = null;
  const taken = new Set<number>(handPlaced);
  if (rooms.length) {
    const s = mid(rooms[0]);
    start = { x: center(s.i), y: center(s.j) };
    taken.add(at(s.i, s.j));
    const steps = new Int32Array(W * H).fill(-1);
    steps[at(s.i, s.j)] = 0;
    const queue = [at(s.i, s.j)];
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q];
      const i = k % W;
      const j = Math.floor(k / W);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = at(i + di, j + dj);
        if (open[n] && steps[n] < 0) {
          steps[n] = steps[k] + 1;
          queue.push(n);
        }
      }
    }
    if (rooms.length > 1) {
      const far = rooms.slice(1).reduce((a, r) => (steps[at(mid(r).i, mid(r).j)] > steps[at(mid(a).i, mid(a).j)] ? r : a));
      const m = mid(far);
      if (g.stairs) {
        place(g.stairs, m.i, m.j);
        stairs = { x: center(m.i), y: center(m.j) };
      }
      taken.add(at(m.i, m.j));
    } else if (g.stairs) problems.push('only one room: the way down would be in the start room, so there is none');
  }

  // Monsters and treasure, by weight among those for this floor, on free squares in the rooms (not the first).
  const free: [number, number][] = [];
  for (const r of rooms.slice(rooms.length > 1 ? 1 : 0)) for (let j = r.y; j < r.y + r.h; j++) for (let i = r.x; i < r.x + r.w; i++) if (!taken.has(at(i, j))) free.push([i, j]);
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
  return { entities: out, start, stairs, rooms: rooms.length, problems };
}

/**
 * The level as it is played with this seed: what is placed by hand, the player moved to the start, and the
 * generated dungeon around it (under what is placed by hand).
 */
export function withDungeon(project: Project, scene: Scene, registry: ComponentRegistry, seed: number, floor = 1): Scene {
  if (!scene.generator) return scene;
  const d = generateDungeon(project, scene, registry, seed, floor);
  const isPlayer = (e: EntityInstance) => !!resolveEntity(project, e, registry).components.CharacterController;
  const own = scene.entities.map((e) => (d.start && isPlayer(e) ? { ...e, transform: { ...e.transform, position: { ...d.start } } } : e));
  return { ...scene, entities: [...d.entities, ...own] };
}

/** A new seed for a play (or a reroll). */
export function newSeed(): number {
  return 1 + Math.floor(Math.random() * 999999);
}
