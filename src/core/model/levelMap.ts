/**
 * The level as a picture in text, one character per 32 px cell, for the AI
 * (and tests): what is in each cell, which free cells the player can stand in
 * and reach, and which standing spots it can't reach. With it the AI places
 * things by looking, the way a person does, instead of guessing coordinates:
 * is the cell free, is there headroom above the platform, can the player get
 * there from a spot it already reaches.
 */
import type { ComponentRegistry } from '../components/registry';
import type { Id, Project, Vec2 } from '../types';
import { getEntitySize } from './geometry';
import { LEVEL_CELL } from './placement';
import { levelReachability } from './reachability';
import { resolveEntity, type ResolvedEntity } from './resolve';

export interface LevelMap {
  /** Column and row of the first character of the first line. */
  origin: { col: number; row: number };
  /** The last digit of each column number, lined up with the rows below it. */
  ruler: string;
  /** One line per row, top to bottom, each prefixed with its row number ("r12 "). */
  rows: string[];
  /** What each character means (only those used), e.g. { "#": "solid: Platform, Stone" }. */
  legend: Record<string, string>;
  /** Set when the level is larger than the map shows. */
  cropped?: string;
}

const MAX_COLS = 140;
const MAX_ROWS = 48;
const MARGIN = 2;

interface Mark {
  ch: string;
  rank: number;
  what: string;
}

/** What a thing looks like on the map; lower rank wins a shared cell. */
function markOf(r: ResolvedEntity, name: string): Mark {
  const c = r.components;
  if (c.CharacterController) return { ch: 'P', rank: 0, what: 'player start' };
  if (c.Openable) return { ch: 'D', rank: 1, what: 'door' };
  if (c.Switch) return { ch: 'S', rank: 1, what: 'switch' };
  if (c.Collectible) return /key/i.test(name) || r.tags.includes('key') ? { ch: 'k', rank: 2, what: 'key' } : { ch: 'c', rank: 2, what: 'item to collect' };
  const moves = c.PhysicsBody?.bodyType === 'dynamic' || c.Patrol || c.MovingPlatform || r.scripts.length > 0;
  if (c.Damage && moves) return { ch: 'E', rank: 3, what: 'enemy' };
  if (c.Damage) return { ch: '^', rank: 3, what: 'hazard (hurts)' };
  if (c.Climbable) return { ch: 'H', rank: 4, what: 'ladder (climb with Up/Down; not solid)' };
  if (c.MovingPlatform) return { ch: '=', rank: 4, what: 'moving platform' };
  const solid = c.Collider && c.Collider.isTrigger !== true && c.PhysicsBody?.bodyType !== 'dynamic';
  if (solid) return { ch: '#', rank: 5, what: 'solid' };
  if (c.Damage === undefined && r.tags.includes('enemy')) return { ch: 'E', rank: 3, what: 'enemy' };
  return { ch: 'o', rank: 6, what: 'other' };
}

export function levelMap(project: Project, sceneId: Id, registry: ComponentRegistry): LevelMap | null {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene || !scene.entities.length) return null;
  const things = scene.entities.map((e) => {
    const r = resolveEntity(project, e, registry);
    const s = getEntitySize(r);
    const w = s.x * Math.abs(e.transform.scale.x);
    const h = s.y * Math.abs(e.transform.scale.y);
    const p: Vec2 = e.transform.position;
    // Cells the thing covers (by their centers); something smaller than a cell takes the cell its center is in.
    const c0 = Math.round((p.x - w / 2) / LEVEL_CELL);
    const c1 = Math.max(c0, Math.round((p.x + w / 2) / LEVEL_CELL) - 1);
    const r0 = Math.round((p.y - h / 2) / LEVEL_CELL);
    const r1 = Math.max(r0, Math.round((p.y + h / 2) / LEVEL_CELL) - 1);
    const small = w < LEVEL_CELL * 0.75 || h < LEVEL_CELL * 0.75;
    const cc = Math.floor(p.x / LEVEL_CELL);
    // A short thing resting on a cell's bottom (spikes) belongs to that cell.
    const cr = Math.floor((p.y + h / 2 - 1) / LEVEL_CELL);
    return { mark: markOf(r, e.name), name: e.name, cols: small ? [cc, cc] : [c0, c1], rows: small ? [cr, cr] : [r0, r1] };
  });

  let minC = Math.min(...things.map((t) => t.cols[0])) - MARGIN;
  let maxC = Math.max(...things.map((t) => t.cols[1])) + MARGIN;
  let minR = Math.min(...things.map((t) => t.rows[0])) - MARGIN - 2;
  let maxR = Math.max(...things.map((t) => t.rows[1])) + MARGIN;
  let cropped: string | undefined;
  if (maxC - minC + 1 > MAX_COLS || maxR - minR + 1 > MAX_ROWS) {
    // Keep the part around the player start.
    const start = things.find((t) => t.mark.ch === 'P') ?? things[0];
    if (maxC - minC + 1 > MAX_COLS) {
      minC = Math.max(minC, start.cols[0] - Math.floor(MAX_COLS / 3));
      maxC = minC + MAX_COLS - 1;
    }
    if (maxR - minR + 1 > MAX_ROWS) {
      minR = Math.max(minR, start.rows[0] - Math.floor(MAX_ROWS / 2));
      maxR = minR + MAX_ROWS - 1;
    }
    cropped = `The level is larger; the map shows columns ${minC}..${maxC}, rows ${minR}..${maxR} (around the player start).`;
  }
  const width = maxC - minC + 1;
  const height = maxR - minR + 1;
  const grid: Mark[][] = Array.from({ length: height }, () => Array.from({ length: width }, () => ({ ch: '.', rank: 99, what: '' })));
  const legendNames = new Map<string, { what: string; names: Set<string> }>();
  for (const t of things) {
    for (let r = t.rows[0]; r <= t.rows[1]; r++) {
      for (let c = t.cols[0]; c <= t.cols[1]; c++) {
        const cell = grid[r - minR]?.[c - minC];
        if (!cell || cell.rank <= t.mark.rank) continue;
        grid[r - minR][c - minC] = t.mark;
      }
    }
    const entry = legendNames.get(t.mark.ch) ?? { what: t.mark.what, names: new Set<string>() };
    entry.names.add(t.name);
    legendNames.set(t.mark.ch, entry);
  }

  // Standing spots: the free cell right above each surface. '_' the player reaches, 'x' it doesn't.
  const reach = levelReachability(project, sceneId, registry);
  let reachKnown = false;
  if (reach.status === 'ok') {
    reachKnown = true;
    for (const s of reach.surfaces) {
      const row = Math.round(s.top / LEVEL_CELL) - 1 - minR;
      if (row < 0 || row >= height) continue;
      for (let c = Math.round(s.left / LEVEL_CELL); c < Math.round(s.right / LEVEL_CELL); c++) {
        const cell = grid[row]?.[c - minC];
        if (!cell || cell.ch !== '.') continue;
        grid[row][c - minC] = { ch: s.reached ? '_' : 'x', rank: 98, what: '' };
      }
    }
  }

  const pad = Math.max(String(minR).length, String(maxR).length) + 1;
  const rows = grid.map((line, i) => `r${String(minR + i).padStart(pad - 1)} ${line.map((m) => m.ch).join('')}`);
  const legend: Record<string, string> = { '.': 'empty' };
  if (reachKnown) {
    legend._ = 'empty, and the player can stand here and get here (on top of the cell below)';
    legend.x = 'empty standing spot on a surface the player can NOT get to';
  }
  for (const [ch, { what, names }] of legendNames) legend[ch] = `${what}: ${[...names].slice(0, 6).join(', ')}`;
  const ruler = `${' '.repeat(pad)} ${Array.from({ length: width }, (_, i) => String(((minC + i) % 10 + 10) % 10)).join('')}`;
  return { origin: { col: minC, row: minR }, ruler, rows, legend, ...(cropped ? { cropped } : {}) };
}
