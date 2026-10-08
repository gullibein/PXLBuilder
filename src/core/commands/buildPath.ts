/**
 * Building a level as a route the player follows, not as coordinates.
 *
 * The AI describes the way through ("run 6, jump a 2-cell gap one row up,
 * climb a 3-row ladder, spikes on 2 cells, a key here"); this lays the floor
 * tiles, ladders, hazards and objects. Every jump is checked against what the
 * player can actually jump before anything is placed, climbs get a ladder,
 * and objects stand on the route's floor, so the route is reachable by
 * construction: a step the player couldn't make is refused, with the limits.
 */
import type { ComponentRegistry } from '../components/registry';
import { instantiateDefinition } from '../model/factory';
import { getEntitySize } from '../model/geometry';
import * as m from '../model/mutations';
import { LEVEL_CELL } from '../model/placement';
import { characterReach, type Reach } from '../model/reach';
import { isTopDownScene } from '../model/topDown';
import { jumpDistance, levelReachability } from '../model/reachability';
import { resolveEntity } from '../model/resolve';
import type { Id, ObjectDefinition, Project, Scene } from '../types';

export type PathStep =
  | { do: 'run'; cells: number }
  | { do: 'jump'; gap: number; rise: number }
  | { do: 'climb'; rows: number }
  | { do: 'hazard'; object: string; cells: number }
  | { do: 'put'; object: string; name: string | null; ref: string | null };

export interface BuildPathInput {
  sceneId: Id;
  start: { col: number; row: number } | null;
  /** Which way the route goes from its start. */
  direction: 'right' | 'left';
  floor: string;
  ladder: string | null;
  steps: PathStep[];
}

/** Margin below the player's real jump, so a route never needs a perfect jump. */
const SAFE = 0.85;

/** How far the route's player can jump, in cells: rows up, and the widest gap for a given rise. */
export function pathLimits(reach: Reach): { maxRise: number; maxGap: (rise: number) => number } {
  return {
    maxRise: Math.floor((reach.height * SAFE) / LEVEL_CELL),
    maxGap: (rise: number) => {
      const d = jumpDistance(reach, rise * LEVEL_CELL);
      return d < 0 ? 0 : Math.floor((d * SAFE) / LEVEL_CELL);
    },
  };
}

const cellKey = (c: number, r: number) => `${c},${r}`;

/**
 * Lays the route into the scene (a draft). `def` resolves an object id or a
 * ref made earlier in the same answer; `onPlaced` is told about every new
 * entity (and its ref, for later connections). Throws ModelError, naming the
 * step, when a step can't be built as asked.
 */
export function buildPath(
  project: Project,
  input: BuildPathInput,
  registry: ComponentRegistry,
  def: (idOrRef: string) => ObjectDefinition,
  onPlaced: (id: Id, ref: string | null) => void,
): void {
  const scene: Scene = m.getScene(project, input.sceneId);
  const resolved = scene.entities.map((e) => ({ e, r: resolveEntity(project, e, registry) }));
  const player = resolved.find(({ r }) => r.components.CharacterController);
  if (!player) throw new m.ModelError('build_path: this level has no player yet: place_instance the Player object first (earlier in the same answer), then build the route from it');
  if (isTopDownScene(project, scene, registry)) {
    throw new m.ModelError('build_path builds platforming routes (floors, jumps, ladders) and this level is seen from above (top-down): draw walls and rooms with draw_tiles and put things with place_instance instead; the level map shows the floor the player can walk to as "_"');
  }
  const base = characterReach(player.r.components, scene.world.gravity.y);
  if (!base) throw new m.ModelError("build_path: the player can't jump (no Character Controller jump)");
  const limits = pathLimits(base);

  // What is in each cell now: solid (blocks), or something else (an object).
  const solid = new Set<string>();
  const taken = new Map<string, string>();
  for (const { e, r } of resolved) {
    const s = getEntitySize(r);
    const p = e.transform.position;
    const c0 = Math.round((p.x - s.x / 2) / LEVEL_CELL);
    const c1 = Math.max(c0, Math.round((p.x + s.x / 2) / LEVEL_CELL) - 1);
    const r0 = Math.round((p.y - s.y / 2) / LEVEL_CELL);
    const r1 = Math.max(r0, Math.round((p.y + s.y / 2) / LEVEL_CELL) - 1);
    const isSolid = !!r.components.Collider && r.components.Collider.isTrigger !== true && r.components.PhysicsBody?.bodyType !== 'dynamic';
    for (let c = c0; c <= c1; c++) {
      for (let rr = r0; rr <= r1; rr++) {
        if (isSolid) solid.add(cellKey(c, rr));
        if (e.id !== player.e.id) taken.set(cellKey(c, rr), e.name);
      }
    }
  }

  // The cursor: the cell the player stands in, and whether there is floor under it.
  const pp = player.e.transform.position;
  const ps = getEntitySize(player.r);
  let col = input.start?.col ?? Math.floor(pp.x / LEVEL_CELL);
  let row = input.start?.row ?? Math.floor((pp.y + ps.y / 2 - 1) / LEVEL_CELL);
  if (input.start) {
    // A route must begin where the player can already get to (or where it starts).
    const atPlayer = input.start.col === Math.floor(pp.x / LEVEL_CELL) && input.start.row === Math.floor((pp.y + ps.y / 2 - 1) / LEVEL_CELL);
    const reach = levelReachability(project, input.sceneId, registry);
    const x = (input.start.col + 0.5) * LEVEL_CELL;
    const reachable = reach.status === 'ok' && reach.surfaces.some((s) => s.reached && Math.abs(s.top - (input.start!.row + 1) * LEVEL_CELL) < 2 && x > s.left && x < s.right);
    if (!atPlayer && !reachable) throw new m.ModelError(`build_path: the start (${input.start.col},${input.start.row}) is not a spot the player can get to; start on a "_" cell of the level map, or leave start null to begin at the player`);
  }
  let onFloor = solid.has(cellKey(col, row + 1));
  // Where the current stretch of floor began (objects are put on it, rightmost free cell first).
  let stretchStart = col;
  // Where the last floor tile went (objects are put there); the route goes right, so the first run starts at the cursor.
  let lastFloor: number | null = onFloor ? col : null;
  let started = false;
  const dx = input.direction === 'left' ? -1 : 1;

  const floorDef = def(input.floor);
  const place = (d: ObjectDefinition, c: number, r: number, ref: string | null = null, name: string | null = null) => {
    const s = getEntitySize(resolveEntity(project, instantiateDefinition(d, { x: 0, y: 0 }), registry));
    // Centered on its cells, resting on the bottom of its cell row (spikes on the floor, a door standing on it).
    const cellsW = Math.max(1, Math.round(s.x / LEVEL_CELL));
    const entity = instantiateDefinition(d, { x: c * LEVEL_CELL + (cellsW * LEVEL_CELL) / 2, y: (r + 1) * LEVEL_CELL - s.y / 2 }, name ?? d.name);
    m.addEntity(project, input.sceneId, entity);
    onPlaced(entity.id, ref);
    return Math.max(1, Math.round(s.y / LEVEL_CELL));
  };
  const free = (c: number, r: number, what: string, step: number) => {
    const there = taken.get(cellKey(c, r));
    if (there) throw new m.ModelError(`build_path step ${step + 1}: ${what} at cell (${c},${r}) is already taken by ${there}; start the route elsewhere or pick another direction`);
  };
  const lay = (c: number, r: number, step: number) => {
    if (solid.has(cellKey(c, r))) return; // already floor there
    free(c, r, 'the floor', step);
    place(floorDef, c, r);
    solid.add(cellKey(c, r));
    taken.set(cellKey(c, r), floorDef.name);
  };
  const headroom = (c: number, r: number, step: number) => {
    // The player (one cell tall) stands in r; one more free cell above lets it jump.
    for (const rr of [r, r - 1]) if (solid.has(cellKey(c, rr))) throw new m.ModelError(`build_path step ${step + 1}: no room to stand at cell (${c},${rr}) (something solid is there); the route needs two free rows above its floor`);
  };

  input.steps.forEach((step, i) => {
    switch (step.do) {
      case 'run': {
        if (step.cells < 1 || step.cells > 200) throw new m.ModelError(`build_path step ${i + 1}: run 1 to 200 cells`);
        // The route continues right of the last floor (or starts at the cursor).
        const from = started || lastFloor === null ? col : col + dx;
        if (!onFloor || lastFloor === null) stretchStart = from;
        for (let k = 0; k < step.cells; k++) {
          headroom(from + k * dx, row, i);
          lay(from + k * dx, row + 1, i);
        }
        col = from + (step.cells - 1) * dx;
        lastFloor = col;
        onFloor = true;
        started = true;
        break;
      }
      case 'jump': {
        if (!onFloor) throw new m.ModelError(`build_path step ${i + 1}: a jump needs floor to jump from: put a run before it`);
        const rise = step.rise;
        if (rise > limits.maxRise) {
          throw new m.ModelError(`build_path step ${i + 1}: the player can jump at most ${limits.maxRise} row${limits.maxRise === 1 ? '' : 's'} up, not ${rise}; use a climb step (a ladder) for higher`);
        }
        const most = limits.maxGap(rise);
        // A gap of 0 is a step down (the landing right next to the edge, lower).
        if (step.gap < (rise < 0 ? 0 : 1) || step.gap > most) {
          throw new m.ModelError(`build_path step ${i + 1}: a gap of ${step.gap} cells ${rise > 0 ? `${rise} row up` : rise < 0 ? `${-rise} rows down` : 'at the same height'} is too wide; the player clears at most ${most} cells there`);
        }
        col = col + (step.gap + 1) * dx;
        row = row - rise;
        onFloor = false;
        started = true;
        // The landing: one floor cell (more come with the next run).
        headroom(col, row, i);
        lay(col, row + 1, i);
        lastFloor = col;
        stretchStart = col;
        onFloor = true;
        break;
      }
      case 'climb': {
        if (!onFloor) throw new m.ModelError(`build_path step ${i + 1}: a ladder needs floor under it: put a run before it`);
        if (step.rows < 1 || step.rows > 30) throw new m.ModelError(`build_path step ${i + 1}: climb 1 to 30 rows`);
        const ladderDef = def(input.ladder ?? 'Ladder');
        // The ladder stands on the floor in the next column; its top cell is level with the new platform's floor.
        const lc = col + dx;
        lay(lc, row + 1, i);
        for (let r = row; r > row - step.rows; r--) {
          free(lc, r, 'the ladder', i);
          place(ladderDef, lc, r);
          taken.set(cellKey(lc, r), ladderDef.name);
        }
        row -= step.rows;
        // The platform the ladder leads to starts right beside its top.
        col = lc + dx;
        headroom(col, row, i);
        lay(col, row + 1, i);
        lastFloor = col;
        stretchStart = col;
        onFloor = true;
        started = true;
        break;
      }
      case 'hazard': {
        if (!onFloor) throw new m.ModelError(`build_path step ${i + 1}: hazards need floor before them: put a run before it`);
        const most = limits.maxGap(0) - 1;
        if (step.cells < 1 || step.cells > most) throw new m.ModelError(`build_path step ${i + 1}: the player can safely jump over at most ${most} cells of hazards; use ${most} or fewer (put a run between groups)`);
        const hd = def(step.object);
        for (let k = 1; k <= step.cells; k++) {
          const c = col + k * dx;
          headroom(c, row, i);
          lay(c, row + 1, i);
          free(c, row, 'the hazard', i);
          place(hd, c, row);
          taken.set(cellKey(c, row), hd.name);
        }
        // Safe floor right after it, to land on.
        col += (step.cells + 1) * dx;
        headroom(col, row, i);
        lay(col, row + 1, i);
        lastFloor = col;
        stretchStart = col;
        break;
      }
      case 'put': {
        if (lastFloor === null) throw new m.ModelError(`build_path step ${i + 1}: put needs floor: put a run before it`);
        const d = def(step.object);
        const s = getEntitySize(resolveEntity(project, instantiateDefinition(d, { x: 0, y: 0 }), registry));
        const tall = Math.max(1, Math.round(s.y / LEVEL_CELL));
        // The rightmost cell of the current stretch with room for it (not on hazards, not on something else).
        const fits = (c: number) => solid.has(cellKey(c, row + 1)) && [...Array(tall).keys()].every((k) => !taken.has(cellKey(c, row - k)));
        let at: number | null = null;
        for (let c = lastFloor; dx > 0 ? c >= stretchStart : c <= stretchStart; c -= dx) {
          if (fits(c)) {
            at = c;
            break;
          }
        }
        if (at === null) throw new m.ModelError(`build_path step ${i + 1}: no free floor cell on this stretch for ${d.name}; add a run before it`);
        // Its bottom on the floor: resting on the bottom of the standing row (a tall door reaches up from there).
        place(d, at, row, step.ref, step.name);
        for (let k = 0; k < tall; k++) taken.set(cellKey(at, row - k), d.name);
        break;
      }
    }
  });
}
