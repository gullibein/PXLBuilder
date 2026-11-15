/**
 * What a level is like, in numbers, to keep a game's levels different: its structure and what it is about, the
 * sections it is made of and which follow which, its shape (where the solid ground is, in a coarse 8 × 4 grid
 * stretched over the level, whatever its size), and how many of each thing it has. Worked out the same way for a
 * level the engine built and for one made by hand or by the AI (from its objects), so every level of the game
 * counts.
 *
 * similarity(a, b) is 0 (nothing alike) … 1 (the same level), a weighted mix of those. A different seed alone
 * changes little of it: two levels of the same sections in the same order, with the same shape, score high
 * whatever their exact numbers.
 */
import type { ComponentRegistry } from '../components/registry';
import { getEntitySize } from '../model/geometry';
import { LEVEL_CELL } from '../model/placement';
import { resolveEntity } from '../model/resolve';
import type { Project, Scene } from '../types';
import { ROLE_CHARS } from './grid';
import { findRoles, type Role } from './roles';

export interface Fingerprint {
  structure: string | null;
  length?: string | null;
  signature: string | null;
  routes: string | null;
  /** role:pattern/variant@difficulty, in order (engine-built levels only). */
  sections: string[];
  /** Solid share of each block of an 8 × 4 grid over the level (row by row, top first), 0..1. */
  shape: number[];
  counts: Record<string, number>;
  size: [number, number];
}

const SHAPE_W = 8;
const SHAPE_H = 4;
const SOLID = new Set(['#', '=', 'b', '?', 'U', '|', '/', '\\', 'C']);
const COUNTED: Record<string, string> = { E: 'enemies', '^': 'hazards', o: 'coins', S: 'springs', H: 'ladders', '~': 'water', w: 'water', '-': 'oneways', '?': 'blocks', b: 'blocks', U: 'pipes', M: 'movers', C: 'crates', T: 'teleporters', D: 'doors', k: 'keys', h: 'hearts', L: 'lava' };

/** The shape and counts of a level drawn as rows of role characters (as LevelGrid.rows writes them). */
export function shapeOfRows(rows: readonly string[]): { shape: number[]; counts: Record<string, number> } {
  const h = rows.length;
  const w = Math.max(1, ...rows.map((r) => r.length));
  const solid = Array(SHAPE_W * SHAPE_H).fill(0);
  const total = Array(SHAPE_W * SHAPE_H).fill(0);
  const counts: Record<string, number> = {};
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x] ?? '.';
      const b = Math.min(SHAPE_H - 1, Math.floor((y / h) * SHAPE_H)) * SHAPE_W + Math.min(SHAPE_W - 1, Math.floor((x / w) * SHAPE_W));
      total[b]++;
      if (SOLID.has(ch)) solid[b]++;
      const c = COUNTED[ch];
      if (c) counts[c] = (counts[c] ?? 0) + 1;
    }
  return { shape: solid.map((s, i) => Math.round((s / Math.max(1, total[i])) * 100) / 100), counts };
}

/** A level as rows of role characters, from its objects (for levels not built by the engine). */
export function rowsOfScene(project: Project, scene: Scene, registry: ComponentRegistry): string[] {
  const roles = findRoles(project, registry);
  const byDef = new Map<string, Role>(Object.entries(roles).map(([role, o]) => [o!.id, role as Role]));
  const cells: { c: number; r: number; ch: string }[] = [];
  for (const e of scene.entities) {
    const role = e.definitionId ? byDef.get(e.definitionId) : undefined;
    const res = resolveEntity(project, e, registry);
    // (Unknown objects: solid ones as ground, others not counted.)
    const ch = role ? ROLE_CHARS[role] : res.components.Collider && !res.components.Collider.isTrigger && res.components.PhysicsBody?.bodyType !== 'dynamic' ? '#' : null;
    if (!ch) continue;
    const size = getEntitySize(res);
    const c0 = Math.floor((e.transform.position.x - size.x / 2) / LEVEL_CELL + 0.01);
    const r0 = Math.floor((e.transform.position.y - size.y / 2) / LEVEL_CELL + 0.01);
    for (let dy = 0; dy < Math.max(1, Math.round(size.y / LEVEL_CELL)); dy++) for (let dx = 0; dx < Math.max(1, Math.round(size.x / LEVEL_CELL)); dx++) cells.push({ c: c0 + dx, r: r0 + dy, ch });
  }
  if (!cells.length) return [];
  const minC = Math.min(...cells.map((x) => x.c));
  const minR = Math.min(...cells.map((x) => x.r));
  const w = Math.max(...cells.map((x) => x.c)) - minC + 1;
  const h = Math.max(...cells.map((x) => x.r)) - minR + 1;
  if (w * h > 200 * 120) return [];
  const grid = Array.from({ length: h }, () => Array<string>(w).fill('.'));
  for (const x of cells) grid[x.r - minR][x.c - minC] = x.ch;
  return grid.map((r) => r.join(''));
}

/** The fingerprint of any level of the game: its record if the engine built it, else worked out from its objects. Null for an empty level. */
export function fingerprintOfScene(project: Project, scene: Scene, registry: ComponentRegistry): Fingerprint | null {
  const made = scene.madeBy?.fingerprint as Partial<Fingerprint> | null | undefined;
  if (made?.shape && made.counts) return made as Fingerprint;
  const rows = rowsOfScene(project, scene, registry);
  if (!rows.length) return null;
  const { shape, counts } = shapeOfRows(rows);
  return {
    structure: made?.structure ?? null,
    signature: made?.signature ?? null,
    routes: made?.routes ?? null,
    sections: made?.sections ?? [],
    shape,
    counts,
    size: [rows[0].length, rows.length],
  };
}

const patternsOf = (sections: readonly string[]) => sections.filter((x) => !/^(intro|finale):/.test(x)).map((x) => x.split(':')[1]?.split('@')[0] ?? x);

/** How alike two section lists are (0..1): edit distance, the same pattern with another variant half a change. */
function sequenceSimilarity(a: string[], b: string[]): number {
  const n = a.length;
  const m = b.length;
  if (!n && !m) return 1;
  const d = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)]);
  for (let j = 1; j <= m; j++) d[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : a[i - 1].split('/')[0] === b[j - 1].split('/')[0] ? 0.5 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub);
    }
  return 1 - d[n][m] / Math.max(n, m);
}

/** Which patterns follow which (pattern ids, in pairs): how alike two levels' combinations are (Jaccard). */
function pairSimilarity(a: string[], b: string[]): number {
  const pairs = (x: string[]) => new Set(x.slice(1).map((p, i) => `${x[i].split('/')[0]}>${p.split('/')[0]}`));
  const pa = pairs(a);
  const pb = pairs(b);
  if (!pa.size && !pb.size) return 1;
  let both = 0;
  for (const p of pa) if (pb.has(p)) both++;
  return both / (pa.size + pb.size - both);
}

export const SIMILARITY_WEIGHTS = { sections: 0.3, pairs: 0.15, shape: 0.25, kind: 0.15, counts: 0.15 };

/** How alike two levels are, 0 … 1, and how much each part of them adds (for saying why). */
export function similarity(a: Fingerprint, b: Fingerprint): { score: number; parts: Record<string, number> } {
  const parts: Record<string, number> = {};
  const weights: Record<string, number> = { ...SIMILARITY_WEIGHTS };
  const sa = patternsOf(a.sections);
  const sb = patternsOf(b.sections);
  if (sa.length && sb.length) {
    parts.sections = sequenceSimilarity(sa, sb);
    parts.pairs = pairSimilarity(sa, sb);
  } else {
    // (A level made by hand has no sections: judged by the rest.)
    delete weights.sections;
    delete weights.pairs;
  }
  parts.shape = 1 - a.shape.reduce((s, v, i) => s + Math.abs(v - (b.shape[i] ?? 0)), 0) / Math.max(1, a.shape.length);
  const kinds: [unknown, unknown, number][] = [
    [a.structure, b.structure, 0.5],
    [a.signature, b.signature, 0.3],
    [a.routes, b.routes, 0.2],
  ];
  const known = kinds.filter(([x, y]) => x != null && y != null);
  if (known.length) parts.kind = known.reduce((s, [x, y, w]) => s + (x === y ? w : 0), 0) / known.reduce((s, [, , w]) => s + w, 0);
  else delete weights.kind;
  const keys = new Set([...Object.keys(a.counts), ...Object.keys(b.counts)]);
  parts.counts = keys.size ? [...keys].reduce((s, k) => s + 1 - Math.abs((a.counts[k] ?? 0) - (b.counts[k] ?? 0)) / Math.max(1, a.counts[k] ?? 0, b.counts[k] ?? 0), 0) / keys.size : 1;
  const total = Object.values(weights).reduce((s, w) => s + w, 0);
  const score = Object.entries(weights).reduce((s, [k, w]) => s + w * (parts[k] ?? 0), 0) / total;
  return { score: Math.round(score * 1000) / 1000, parts };
}

/** The most alike level in a list (its index and score), or null for an empty list. */
export function closest(fp: Fingerprint, others: readonly Fingerprint[]): { index: number; score: number } | null {
  let best: { index: number; score: number } | null = null;
  others.forEach((o, index) => {
    const { score } = similarity(fp, o);
    if (!best || score > best.score) best = { index, score };
  });
  return best;
}
