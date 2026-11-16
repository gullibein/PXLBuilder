/**
 * The level builder: a blueprint in, a whole level out (as the operations that make it), checked before anything
 * is changed. It picks the level's structure (a run, a climb…), lays out its floors, fills each floor with sections
 * (patterns, picked by the blueprint's focus and the pacing, sized from the player's reach, built from the seed),
 * joins the floors (ladders, holes, springs), and checks the result with the level checker. A level that doesn't
 * check out is built again from the next seed in the same series (so the same blueprint and seed always give the
 * same level); only one that does is returned.
 *
 * Results: "validated" (every check passed), or "uncertain" (nothing failed, but something the checker can't judge,
 * a moving solid, is in the way: said, never passed off as validated). A level that can't be made valid throws
 * LevelGenError with why.
 */
import type { ComponentRegistry } from '../components/registry';
import { produce } from 'immer';
import { applyOperations, type Operation } from '../commands/operations';
import { getEntitySize } from '../model/geometry';
import { LEVEL_CELL } from '../model/placement';
import { resolveEntity } from '../model/resolve';
import type { Id, LevelMadeBy, Project } from '../types';
import { CUSTOM_PARTS, readBlueprint, STRUCTURES, type Blueprint, type CustomSection, type Mechanic, type SectionRole, type SectionSpec, type Structure } from './blueprint';
import { GENRE_BUILDS, type GenreBuild } from './genres';
import { closest, fingerprintOfScene, shapeOfRows, type Fingerprint } from './fingerprint';
import { playerReach, type ReachDescription } from '../reach/reach';
import { runValidators, unneededPuzzles, type Validation, type ValidationTarget } from '../validation/validators';
import { GridError, LevelGrid, type Placed } from './grid';
import type { Limits } from './limits';
import { PatternError, type Band, type Pattern, type SectionCtx } from './pattern';
import { patternById } from './patterns/index';
import { makeRandom, newLevelSeed, type Random } from './random';
import { findRoles, type Role, type Roles } from './roles';

export class LevelGenError extends Error {}

export type LevelState = 'validated' | 'uncertain';

export interface GenerateResult {
  ops: Operation[];
  madeBy: LevelMadeBy;
  /** The level as text, top row first (as the grid has it). */
  rows: string[];
  state: LevelState;
  /** Why it is uncertain, and anything the builder changed from what was asked. */
  notes: string[];
  /** How many builds it took (1: the first one checked out). */
  attempts: number;
}

/** Builds tried before giving up. */
const ATTEMPTS = 12;
/** Checked builds compared against the game's other levels (the least alike is kept). */
export const CANDIDATES = 3;
/** More alike than this (0..1) to another level of the game: more builds are tried (up to MAX_CANDIDATES). */
export const TOO_ALIKE = 0.6;
const MAX_CANDIDATES = 6;
/** Rows inside a floor of a stacked level, under the next floor. */
const ROOM = 5;

interface RunPlan {
  band: Band;
  dir: 1 | -1;
  /** The column the run starts in and how many columns it has. */
  start: number;
  length: number;
  entry: number;
  first: boolean;
  /** What ends it: the goal, the hub's key or locked goal, or a way to the next floor. */
  end: 'goal' | 'key' | 'locked' | 'up' | 'down' | 'none';
  /** The run's section kinds come after the start pad (the hub's two branches share one). */
  afterIntro?: boolean;
}

interface Layout {
  width: number;
  height: number;
  runs: RunPlan[];
}

interface Slot {
  role: SectionRole;
  spec: SectionSpec | null;
}

interface Built {
  pattern: string;
  variant: string;
  role: SectionRole;
  difficulty: number;
}

/** The structures this game can be built as (a hub needs a key and a door; stacked ones a way up). */
function possibleStructures(roles: Roles, lim: Limits): Structure[] {
  const up = !!roles.ladder || (!!roles.oneway && lim.maxRise >= 2) || (!!roles.spring && lim.springRows >= ROOM + 1);
  return STRUCTURES.filter((s) => (s === 'hub' ? !!roles.key && !!roles.door : s === 'climb' || s === 'loop' ? up : true));
}

/** The floors and runs of a structure, at a length. */
function layout(structure: Structure, length: 'short' | 'medium' | 'long'): Layout {
  const pickW = (s: number, m: number, l: number) => (length === 'short' ? s : length === 'medium' ? m : l);
  if (structure === 'run' || structure === 'hub') {
    const width = structure === 'run' ? pickW(30, 52, 76) : pickW(40, 52, 64);
    const height = 15;
    const band: Band = { slab: height - 3, maxUp: 4, top: 1, fill: height - 1, bottom: true };
    if (structure === 'run') return { width, height, runs: [{ band, dir: 1, start: 1, length: width - 2, entry: band.slab, first: true, end: 'goal' }] };
    const mid = Math.floor(width / 2);
    // The start pad in the middle (a run of its own), then a branch each way.
    return {
      width,
      height,
      runs: [
        { band, dir: 1, start: mid - 2, length: 5, entry: band.slab, first: true, end: 'none' },
        { band, dir: -1, start: mid - 3, length: mid - 3, entry: band.slab, first: false, end: 'key', afterIntro: true },
        { band, dir: 1, start: mid + 3, length: width - 2 - (mid + 3) + 1, entry: band.slab, first: false, end: 'locked', afterIntro: true },
      ],
    };
  }
  const floors = structure === 'loop' ? 2 : length === 'long' ? 4 : 3;
  const width = structure === 'loop' ? pickW(30, 44, 58) : pickW(24, 30, 34);
  const height = 3 + floors * (ROOM + 1);
  const bandOf = (k: number): Band => {
    const slab = height - 3 - k * (ROOM + 1);
    return { slab, maxUp: 2, top: slab - ROOM, fill: k === 0 ? height - 1 : slab, bottom: k === 0 };
  };
  const runs: RunPlan[] = [];
  const down = structure === 'descent';
  for (let n = 0; n < floors; n++) {
    const k = down ? floors - 1 - n : n;
    const dir: 1 | -1 = n % 2 === 0 ? 1 : -1;
    const last = n === floors - 1;
    // Columns: the outer wall, then (after the first floor) where the player arrives, the run, the way on (3).
    const arrive = n === 0 ? 0 : down ? 0 : 2;
    const zone = last ? 0 : 3;
    const from = dir > 0 ? 1 + arrive : width - 2 - arrive;
    const length = width - 2 - arrive - zone;
    runs.push({ band: bandOf(k), dir, start: from, length, entry: bandOf(k).slab, first: n === 0, end: last ? 'goal' : down ? 'down' : 'up' });
  }
  return { width, height, runs };
}

/** The difficulty of a section of this kind in a level of this difficulty. */
function sectionDifficulty(base: number, role: SectionRole, harder: boolean, progress: number): number {
  const step = role === 'teach' || role === 'rest' || role === 'intro' ? -1 : role === 'twist' ? 1 : 0;
  // (Tests and twists in the last part of the level are a step harder: it builds up to the goal.)
  const late = progress >= 0.6 && (role === 'test' || role === 'twist') ? 1 : 0;
  return Math.max(1, Math.min(5, base + step + late + (harder ? 1 : 0)));
}

interface Choice {
  pattern: Pattern;
  variant: string;
  width: number;
  difficulty: number;
}

/** Variants of a pattern that can be built here. */
function variantsFor(p: Pattern, roles: Roles, band: Band, d: number): string[] {
  return p.variants.filter((v) => (v.needs ?? []).every((r) => roles[r]) && (!v.bottomOnly || band.bottom) && (v.minDifficulty ?? 1) <= d).map((v) => v.id);
}

interface Pick {
  rnd: Random;
  lim: Limits;
  roles: Roles;
  build: GenreBuild;
  bp: Blueprint;
  used: Built[];
  /** How many times each mechanic has come so far (escalation). */
  seen: Map<Mechanic, number>;
  /** Mechanics left out (the blueprint's, and what the game's look rules out). */
  avoid: Set<Mechanic>;
  /** The mechanic this level is built around when the blueprint names none (picked from the seed). */
  signature: Mechanic | null;
}

/** The pattern, variant and width for a slot, within `room` columns (null: nothing fits). */
function choose(slot: Slot, room: number, band: Band, k: Pick, progress: number, failed: ReadonlySet<string> = new Set()): Choice | null {
  const focus = k.bp.focus ?? [];
  const avoid = k.avoid;
  const named0 = slot.spec?.pattern ? patternById(slot.spec.pattern) : undefined;
  // (A named pattern the game lacks the parts for can't be built: another is picked, and that is said.)
  if (named0 && (!named0.needs.every((r) => k.roles[r]) || failed.has(named0.id))) return null;
  const named = named0;
  const pool: Pattern[] = named
    ? [named]
    : Object.entries(k.build.weights)
        .filter(([, w]) => (w[slot.role] ?? 0) > 0)
        .map(([id]) => patternById(id)!)
        .filter((p) => p && p.needs.every((r) => k.roles[r]) && !p.mechanics.some((m) => avoid.has(m) && m !== 'coins') && !failed.has(p.id));
  const options: { p: Pattern; w: number }[] = [];
  for (const p of pool) {
    let w = named ? 1 : (k.build.weights[p.id]?.[slot.role] ?? 0);
    if (p.mechanics.some((m) => focus.includes(m))) w *= slot.role === 'rest' ? 1.5 : 5;
    if (k.bp.escalate && p.mechanics.includes(k.bp.escalate)) w *= 3;
    if (k.signature && p.mechanics.includes(k.signature) && slot.role !== 'rest') w *= 3;
    const last = k.used.at(-1);
    if (last?.pattern === p.id) w *= 0.12;
    const times = k.used.filter((u) => u.pattern === p.id).length;
    if (times >= 2) w *= 0.4;
    options.push({ p, w });
  }
  for (let tries = 0; tries < options.length * 2 && options.some((o) => o.w > 0); tries++) {
    const pick = k.rnd.weighted(options, (o) => o.w);
    const p = pick.p;
    let d = sectionDifficulty(k.bp.difficulty, slot.role, !!slot.spec?.harder, progress);
    const esc = k.bp.escalate && p.mechanics.includes(k.bp.escalate) ? k.bp.escalate : null;
    // (Escalating: easier the first time, a step harder each time after.)
    if (esc) d = Math.max(1, Math.min(5, k.bp.difficulty - 1 + (k.seen.get(esc) ?? 0)));
    d = Math.max(p.difficulty[0], Math.min(p.difficulty[1], d));
    // (A variant asked for by name is built at the difficulty it needs.)
    const asked = slot.spec?.variant ? p.variants.find((v) => v.id === slot.spec!.variant) : undefined;
    if (asked && variantsFor(p, k.roles, band, 5).includes(asked.id)) d = Math.max(d, asked.minDifficulty ?? 1);
    const vs = variantsFor(p, k.roles, band, d);
    const wanted = slot.spec?.variant && vs.includes(slot.spec.variant) ? [slot.spec.variant] : vs;
    // (A variant the level used already is less likely.)
    const variant = wanted.length ? k.rnd.weighted(wanted, (v) => (k.used.some((u) => u.pattern === p.id && u.variant === v) ? 0.3 : 1)) : null;
    if (variant) {
      const [lo, hi] = p.width(k.lim, d, variant);
      if (lo <= room) return { pattern: p, variant, width: k.rnd.int(lo, Math.min(hi, room)), difficulty: d };
    }
    pick.w = 0;
  }
  return null;
}

/** A custom section (drawn as a small map) into the grid; returns where its ground is at its far end. */
function buildCustom(ctx: SectionCtx, custom: CustomSection): number {
  const parts = new Map<string, Role>();
  for (const [ch, part] of Object.entries(custom.legend)) {
    if (!CUSTOM_PARTS.includes(part as Role)) throw new LevelGenError(`A custom section's "${ch}" is "${part}", not a part a section can have (${CUSTOM_PARTS.join(', ')})`);
    if (!ctx.roles[part as Role]) throw new LevelGenError(`A custom section uses "${part}", but the game has no object for it`);
    parts.set(ch, part as Role);
  }
  const h = custom.rows.length;
  const w = Math.max(...custom.rows.map((r) => r.length));
  const bottom = ctx.band.slab;
  if (bottom - h + 1 < ctx.band.top) throw new LevelGenError(`A custom section ${h} rows tall doesn't fit in a floor (${ctx.band.slab - ctx.band.top + 1} rows)`);
  const flip = (r: Role): Role => (ctx.dir > 0 ? r : r === 'rampRight' ? 'rampLeft' : r === 'rampLeft' ? 'rampRight' : r);
  let exit = bottom;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const ch = custom.rows[y][x] ?? '.';
      if (ch === '.' || ch === ' ') continue;
      const part = parts.get(ch);
      if (!part) throw new LevelGenError(`A custom section's legend doesn't say what "${ch}" is`);
      const row = bottom - (h - 1 - y);
      const col = ctx.start + ctx.dir * x;
      if (part === 'ground') ctx.g.fill('ground', col, row, col, y === h - 1 ? ctx.band.fill : row);
      else ctx.g.put(flip(part), col, row, true);
    }
  // (Where the player leaves: the top of what stands in its last column.)
  const lastCol = ctx.start + ctx.dir * (w - 1);
  for (let row = ctx.band.top; row <= bottom; row++) {
    const r = ctx.g.get(lastCol, row);
    if (r && r !== 'coin' && r !== 'enemy' && r !== 'hazard' && r !== 'heart') {
      exit = row;
      break;
    }
  }
  return exit;
}

/** The way from the end of one floor to the next: a ladder (or jump-through ledges, or a spring) up, a hole down. */
function connect(g: LevelGrid, run: RunPlan, exitRow: number, next: RunPlan, roles: Roles, lim: Limits, rnd: Random): void {
  // The 3 columns past the run: flat ground at the run's exit height.
  const zone = [0, 1, 2].map((j) => run.start + run.dir * (run.length + j));
  for (const c of zone) g.fill('ground', c, exitRow, c, run.band.fill);
  if (run.end === 'down') {
    // A hole in the floor's ground (two cells): down onto the floor below.
    for (const c of zone.slice(1)) g.clear(c, run.band.top, c, run.band.fill);
    return;
  }
  const col = zone[1];
  const top = next.band.slab;
  const rise = exitRow - top;
  const ways: string[] = [];
  if (roles.ladder) ways.push('ladder', 'ladder');
  if (roles.oneway && lim.maxRise >= 2) ways.push('ledges');
  if (roles.spring && lim.springRows >= rise) ways.push('spring');
  const way = rnd.pick(ways);
  // (Beside the way up, on the floor above: ground, so the top isn't a hole.)
  if (way !== 'spring') g.fill('ground', zone[2], top, zone[2], top);
  if (way === 'ladder') g.fill('ladder', col, top, col, exitRow - 1);
  else if (way === 'spring') {
    g.put('spring', col, exitRow - 1);
    g.clear(col, top, col, top);
    g.clear(zone[2], top, zone[2], top);
  } else {
    const step = Math.min(lim.maxRise, 2);
    for (let r = exitRow - step; ; r -= step) {
      const row = Math.max(r, top);
      g.fill('oneway', col, row, col, row);
      if (row === top) break;
    }
  }
}

/** Builds one level from a random source; throws GridError/PatternError when this build doesn't work out. */
/** How a level's mechanics lean its structure (a level about springs or ladders climbs; one about gaps runs…). */
const STRUCTURE_LEAN: Partial<Record<Mechanic, Partial<Record<Structure, number>>>> = {
  spring: { climb: 2, descent: 1.3 },
  ladder: { climb: 2.5, loop: 1.5 },
  stairs: { climb: 1.5 },
  mover: { run: 1.5, loop: 1.5 },
  gap: { run: 1.5, descent: 1.3 },
  floating: { run: 1.3, loop: 1.3 },
  enemy: { hub: 1.6, run: 1.2 },
  water: { run: 1.6 },
  ramp: { run: 1.6, loop: 1.3 },
  pipe: { run: 1.4 },
};

/** The mechanics this game's patterns can build (with their parts, not left out). */
function buildableMechanics(build: GenreBuild, roles: Roles, avoid: Set<Mechanic>): Mechanic[] {
  const out = new Set<Mechanic>();
  for (const id of Object.keys(build.weights)) {
    const p = patternById(id);
    if (!p || !p.needs.every((r) => roles[r])) continue;
    for (const m of p.mechanics) if (m !== 'coins' && !avoid.has(m)) out.add(m);
  }
  return [...out];
}

function buildOnce(bp: Blueprint, rnd: Random, roles: Roles, lim: Limits, reach: Limits, build: GenreBuild, notes: string[], opts: GenerateOptions = {}): { grid: LevelGrid; built: Built[]; structure: Structure; length: string; signature: Mechanic | null } {
  const avoidStructures = opts.avoidStructures ?? [];
  const avoid = new Set<Mechanic>([...(bp.avoid ?? []), ...(opts.avoidMechanics ?? [])]);
  // A level the blueprint says nothing about is still about something: one mechanic, picked from the seed (another
  // than the game's last levels were about, when there are others), comes up more than the rest.
  const signature = !bp.focus?.length && !bp.sections?.length ? (() => {
    const all = buildableMechanics(build, roles, avoid);
    const core = all.filter((m) => build.core?.includes(m));
    const can = core.length ? core : all;
    return can.length ? rnd.weighted(can, (m) => (opts.recentSignatures?.includes(m) ? 0.15 : 1)) : null;
  })() : null;
  const leaning = [...(bp.focus ?? []), ...(signature ? [signature] : [])];
  const possible = possibleStructures(roles, lim);
  if (bp.structure && !possible.includes(bp.structure)) throw new LevelGenError(`A ${bp.structure} level needs ${bp.structure === 'hub' ? 'a key and a door' : 'a way up (a ladder, or jump-through ledges for a higher jump)'}, and the game has none`);
  // (Structures the game's last levels had are passed over when there are others.)
  const fresh = possible.filter((s) => !avoidStructures.includes(s) && (build.structures[s] ?? 0) > 0);
  const lean = (st: Structure) => leaning.reduce((w, m) => w * (STRUCTURE_LEAN[m]?.[st] ?? 1), 1);
  const structure = bp.structure ?? rnd.weighted(fresh.length ? fresh : possible, (st) => (build.structures[st] ?? 0) * lean(st));
  const length = bp.length ?? rnd.weighted(['short', 'medium', 'long'] as const, (l) => (l === 'medium' ? 3 : l === 'short' ? 2 : 1));
  const plan = layout(structure, length);
  const grid = new LevelGrid(plan.width, plan.height, roles);
  // Walls at both ends, the whole height.
  for (const c of [0, plan.width - 1]) grid.fill('ground', c, 0, c, plan.height - 1);
  const pacing = rnd.pick(build.pacings);
  const counter = { i: 0 };
  const specs = bp.sections ? [...bp.sections] : null;
  const k: Pick = { rnd, lim, roles, build, bp, used: [], seen: new Map(), avoid, signature };
  // Two ways through (a choice, a risky shortcut): sections of their own in place of tests and twists.
  const twoWays = bp.routes === 'choice' || bp.routes === 'risky_shortcut' ? bp.routes : null;
  let routes = twoWays && roles.oneway ? (length === 'long' ? 2 : 1) : 0;
  if (twoWays && !roles.oneway) notes.push(`a ${twoWays === 'choice' ? 'choice of ways' : 'risky shortcut'} needs jump-through platforms, and the game has none`);
  const built: Built[] = [];
  let refs = 0;
  let hubEntry = 0;
  // Bonus sections the blueprint asks for (secrets, a route above): put among the sections.
  let bonuses = (bp.secrets ?? 0) + (bp.routes === 'bonus_above' ? 1 : 0);
  for (let ri = 0; ri < plan.runs.length; ri++) {
    const run = plan.runs[ri];
    let entry = run.afterIntro ? hubEntry : run.entry;
    // The run's sections: the start (first run), then the blueprint's sections in order, else sections picked by
    // the pacing until the run is full; then what ends it (the goal, the hub's key or locked goal).
    const ending: Slot | null =
      run.end === 'goal' ? { role: 'finale', spec: null }
      : run.end === 'key' || run.end === 'locked' ? { role: 'finale', spec: { role: 'finale', pattern: run.end === 'key' ? 'key_end' : 'locked_goal', variant: null, harder: null, custom: null } }
      : null;
    const queue: Slot[] = run.first ? [{ role: 'intro', spec: null }] : [];
    const reserve = ending ? 5 : 0;
    let used = 0;
    const nextSlot = (): Slot | null => {
      if (queue.length) return queue.shift()!;
      if (run.length - used - reserve < 3) return null;
      // (Sections the blueprint names come in its order; after them, the builder only fills with rests.)
      if (specs && specs.length) return { role: specs[0].role ?? pacing[counter.i++ % pacing.length], spec: specs.shift()! };
      const role: SectionRole = specs ? 'rest' : pacing[counter.i++ % pacing.length];
      if ((role === 'test' || role === 'twist') && routes > 0) {
        routes--;
        return { role, spec: { role, pattern: 'split', variant: twoWays, harder: null, custom: null } };
      }
      // (Bonus caches the blueprint asks for take the place of rests.)
      if (role === 'rest' && bonuses > 0 && roles.coin) {
        bonuses--;
        return { role, spec: { role, pattern: 'bonus', variant: null, harder: null, custom: null } };
      }
      return { role, spec: null };
    };
    const buildSlot = (slot: Slot, room: number, isEnding: boolean): boolean => {
      const ctxBase = (width: number, difficulty: number, variant: string): SectionCtx => ({
        g: grid, rnd: rnd.fork(), lim, reach, roles, difficulty, variant, dir: run.dir, start: run.start + run.dir * used, width, band: run.band, entry,
        ref: (p) => `${p}${++refs}`,
      });
      if (slot.spec?.custom) {
        const w = Math.max(...slot.spec.custom.rows.map((r) => r.length));
        if (w > room) {
          notes.push(`a custom section ${w} cells wide didn't fit (room for ${room}); left out`);
          return false;
        }
        entry = buildCustom(ctxBase(w, k.bp.difficulty, 'custom'), slot.spec.custom);
        built.push({ pattern: 'custom', variant: 'custom', role: slot.role, difficulty: k.bp.difficulty });
        used += w;
        return true;
      }
      // (How far through the level this is: later tests and twists are a step harder.)
      const progress = (ri + used / Math.max(1, run.length)) / plan.runs.length;
      // A pattern that can't be built here (no room for it at this height…) is undone and another picked: only
      // this section is tried again, not the whole level.
      const failed = new Set<string>();
      for (let tries = 0; tries < 4; tries++) {
        let choice = choose(slot, room, run.band, k, progress, failed);
        if (!choice && slot.spec?.pattern) {
          if (!notes.some((n) => n.startsWith(`pattern "${slot.spec!.pattern}"`))) notes.push(`pattern "${slot.spec.pattern}" can't be built here (missing parts or room); another was used`);
          choice = choose({ role: slot.role, spec: null }, room, run.band, k, progress, failed);
        }
        if (!choice && !isEnding) choice = choose({ role: 'rest', spec: null }, room, run.band, k, progress, failed);
        if (!choice) return false;
        if (slot.spec?.variant && choice.variant !== slot.spec.variant) notes.push(`variant "${slot.spec.variant}" of "${choice.pattern.id}" can't be built here (missing parts, or not on this floor); "${choice.variant}" was used`);
        // The ending takes up what is left of the run (the goal at its very end).
        if (isEnding) choice.width = room;
        const before = grid.clone();
        const refsBefore = refs;
        try {
          entry = choice.pattern.build(ctxBase(choice.width, choice.difficulty, choice.variant));
        } catch (e) {
          if (!(e instanceof PatternError)) throw e;
          grid.restore(before);
          refs = refsBefore;
          failed.add(choice.pattern.id);
          continue;
        }
        built.push({ pattern: choice.pattern.id, variant: choice.variant, role: slot.role, difficulty: choice.difficulty });
        k.used.push(built[built.length - 1]);
        for (const m of choice.pattern.mechanics) k.seen.set(m, (k.seen.get(m) ?? 0) + 1);
        used += choice.width;
        return true;
      }
      return false;
    };
    for (let guard = 0; guard < 40; guard++) {
      const slot = nextSlot();
      if (!slot) break;
      const room = run.length - used - reserve;
      if (room < 3) break;
      if (!buildSlot(slot, room, false) && !specs) break;
    }
    if (ending && !buildSlot(ending, run.length - used, true)) throw new PatternError(`no room was left for the ${run.end === 'key' ? 'key' : 'goal'}`);
    // What is left of the run: flat ground on to its end.
    for (let c = used; c < run.length; c++) {
      const col = run.start + run.dir * c;
      grid.fill('ground', col, entry, col, run.band.fill);
    }
    if (run.first && plan.runs.length === 3 && structure === 'hub') hubEntry = entry;
    if (run.end === 'up' || run.end === 'down') connect(grid, run, entry, plan.runs[ri + 1], roles, lim, rnd);
  }
  if (structure === 'hub') {
    grid.link({ type: 'requires', from: 'door', to: 'key' });
  }
  if (!grid.rows().some((r) => r.includes('G'))) throw new PatternError('no room was left for the goal');
  return { grid, built, structure, length, signature };
}

/** The same level with each moving platform's ride as a still bridge along its path (what the checker can judge). */
function asStill(grid: LevelGrid, roles: Roles): LevelGrid {
  const still = grid.clone();
  const bridge: Role = roles.ledge ? 'ledge' : 'ground';
  for (const p of grid.placed) {
    if (!p.path) continue;
    still.unplace(p.ref);
    const steps = Math.max(Math.abs(p.path.to.x), Math.abs(p.path.to.y));
    for (let s = 0; s <= steps; s++) {
      const c = p.col + Math.round((p.path.to.x * s) / Math.max(1, steps));
      const r = p.row + Math.round((p.path.to.y * s) / Math.max(1, steps));
      if (still.isEmpty(c, r)) still.put(bridge, c, r);
    }
  }
  return still;
}

// (Moved to the puzzle_needed validator: core/validation/validators.ts.)
export { unneededPuzzles };

interface Check {
  state: 'validated' | 'uncertain' | 'invalid';
  problems: string[];
}

/** A level built by these operations, validated by these validators (on a copy: the project is not changed). */
function validateBuilt(project: Project, sceneId: Id, ops: Operation[], stillOps: Operation[] | null, registry: ComponentRegistry, ids: readonly string[], rest: Omit<ValidationTarget, 'project' | 'sceneId' | 'registry' | 'judged'>): Validation {
  let after: Project;
  try {
    after = produce(project, (d) => void applyOperations(d, ops, registry));
  } catch (e) {
    return { state: 'invalid', problems: [`it couldn't be made: ${(e as Error).message}`], verdicts: {}, uncertain: [] };
  }
  let judged: Project | undefined;
  if (stillOps) {
    try {
      judged = produce(project, (d) => void applyOperations(d, stillOps, registry));
    } catch (e) {
      return { state: 'invalid', problems: [`its still version couldn't be made: ${(e as Error).message}`], verdicts: {}, uncertain: [] };
    }
  }
  return runValidators(ids, { project: after, sceneId, registry, judged, ...rest });
}

/**
 * Checks a level built by these operations (on a copy: the project is not changed): the layout and the level checker
 * (validators layout and checker).
 */
export function checkBuilt(project: Project, sceneId: Id, ops: Operation[], stillOps: Operation[] | null, registry: ComponentRegistry, reach: ReachDescription | null = null): Check {
  const v = validateBuilt(project, sceneId, ops, stillOps, registry, ['layout', 'checker'], { reach, mechanics: [] });
  if (v.state === 'invalid') return { state: 'invalid', problems: v.problems };
  return v.state === 'uncertain' ? { state: 'uncertain', problems: v.uncertain } : { state: 'validated', problems: [] };
}

/** Removes what the level had outside the new map's area (draw_map clears inside it). */
function clearOutside(project: Project, sceneId: Id, width: number, height: number, registry: ComponentRegistry): Operation[] {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene || !scene.entities.length) return [];
  let l = 0;
  let t = 0;
  let r = width;
  let b = height;
  for (const e of scene.entities) {
    const size = getEntitySize(resolveEntity(project, e, registry));
    l = Math.min(l, Math.floor((e.transform.position.x - size.x / 2) / LEVEL_CELL));
    t = Math.min(t, Math.floor((e.transform.position.y - size.y / 2) / LEVEL_CELL));
    r = Math.max(r, Math.ceil((e.transform.position.x + size.x / 2) / LEVEL_CELL));
    b = Math.max(b, Math.ceil((e.transform.position.y + size.y / 2) / LEVEL_CELL));
  }
  // (Only outside the map, in strips round it: inside, the map clears what is there and keeps the player.)
  const out: Operation[] = [];
  const strip = (col: number, row: number, w: number, h: number) => w > 0 && h > 0 && out.push({ op: 'erase_area', sceneId, col, row, width: w, height: h, definitionRef: null });
  strip(l, t, -l, b - t);
  strip(width, t, r - width, b - t);
  strip(0, t, width, -t);
  strip(0, height, width, b - height);
  return out;
}

/**
 * Builds a level from a blueprint into a level of the game: the operations that make it (applied by the caller, as
 * one step), checked first. `genre`: the builder to use (only "classic" so far).
 */
export interface GenerateOptions {
  /** Structures to pass over when the blueprint leaves the structure open (the game's last levels'). */
  avoidStructures?: Structure[];
  /** Mechanics left out besides the blueprint's (what the game's look rules out: no water in a space station). */
  avoidMechanics?: Mechanic[];
  /** What the game's last levels were built around (a new one is about something else, when it can be). */
  recentSignatures?: Mechanic[];
  /** How many checked builds to compare against the game's other levels (default CANDIDATES; 1: the first). */
  candidates?: number;
  /** The validators its levels go through (default: the sections generator's: layout, checker, cell_solver, and puzzle_needed for puzzles). */
  validators?: string[];
  /** Told about every checked build's grid (its moving platforms as bridges), for tools and tests. */
  onBuilt?: (grid: LevelGrid) => void;
}

export function generateLevel(project: Project, sceneId: Id, blueprint: unknown, registry: ComponentRegistry, genre = 'classic', options: GenerateOptions = {}): GenerateResult {
  const bp = readBlueprint(blueprint);
  const build = GENRE_BUILDS[genre] ?? null;
  if (!build) throw new LevelGenError(`There is no level builder for "${genre}" (there is: ${Object.keys(GENRE_BUILDS).join(', ')})`);
  if (!project.scenes.some((s) => s.id === sceneId)) throw new LevelGenError(`There is no level ${sceneId}`);
  const roles = findRoles(project, registry);
  for (const r of ['player', 'ground', 'goal'] as Role[]) if (!roles[r]) throw new LevelGenError(`The game needs a ${r} object to build a level`);
  // The player's reach, as its movement setup publishes it: the builder sizes sections from its table, the route
  // solver searches with its moves.
  const description = playerReach(project, sceneId, roles.player!.id, registry);
  const lim = description?.limits?.(bp.difficulty) ?? null;
  if (!description || !lim) throw new LevelGenError("The player doesn't jump here (no gravity, or no Character Controller): levels to jump through can't be built");
  // (The route solver uses the player's whole reach, as the level checker does: any jump within it is fair.)
  const reach = description.limits!(5);
  // The validators its levels go through: the generator module's (layout, checker, cell_solver, puzzle_needed for
  // puzzles), as given; the generator's own section check sits between the route search and the puzzle check.
  const validators = options.validators ?? ['layout', 'checker', 'cell_solver', ...(build.id === 'puzzle' ? ['puzzle_needed'] : [])];
  const before = validators.filter((id) => id !== 'puzzle_needed');
  const after = validators.filter((id) => id === 'puzzle_needed');
  const seed = bp.seed ?? newLevelSeed();
  const notes: string[] = [];
  // The game's other levels: a new one is to be unlike them (not just another seed).
  const history = project.scenes
    .filter((s) => s.id !== sceneId && !s.generator)
    .map((s) => ({ name: s.name, fp: fingerprintOfScene(project, s, registry) }))
    .filter((h): h is { name: string; fp: Fingerprint } => !!h.fp);
  // With other levels to be unlike, a few checked builds are compared and the least alike kept; alone, the first.
  const wanted = history.length ? (options.candidates ?? CANDIDATES) : 1;
  const found: { result: GenerateResult; score: number; closestName: string | null }[] = [];
  let uncertain: (GenerateResult & { why: string[] }) | null = null;
  let lastProblems: string[] = [];
  // (Still too like another level after those: a few more builds, while there are tries left.)
  const enough = () => found.length >= wanted && (found.length >= MAX_CANDIDATES || !history.length || Math.min(...found.map((f) => f.score)) < TOO_ALIKE);
  for (let attempt = 0; attempt < ATTEMPTS && !enough(); attempt++) {
    const rnd = makeRandom((seed ^ Math.imul(attempt, 0x9e3779b1)) >>> 0);
    const tried: string[] = [];
    let out: ReturnType<typeof buildOnce>;
    try {
      out = buildOnce(bp, rnd, roles, lim, reach, build, tried, options);
    } catch (e) {
      if (e instanceof LevelGenError) throw e;
      if (!(e instanceof GridError)) throw e;
      lastProblems = [e.message];
      continue;
    }
    const ops = [...clearOutside(project, sceneId, out.grid.width, out.grid.height, registry), ...out.grid.toOperations(sceneId)];
    const moving = out.grid.placed.some((p: Placed) => p.path);
    // The layout, the level checker, then the route solver (walls, ceilings and doors in the way, keys before the
    // doors they open, every coin).
    const still = moving ? asStill(out.grid, roles) : out.grid;
    const checked = validateBuilt(project, sceneId, ops, moving ? [...ops.filter((o) => o.op === 'erase_area'), ...asStill(out.grid, roles).toOperations(sceneId)] : null, registry, before, { reach: description, mechanics: [], grid: still });
    if (checked.state === 'invalid') {
      lastProblems = checked.problems;
      continue;
    }
    const check: { state: 'validated' | 'uncertain'; problems: string[] } = checked.state === 'uncertain' ? { state: 'uncertain', problems: checked.uncertain } : { state: 'validated', problems: [] };
    const route = checked.verdicts.cell_solver?.evidence?.route ?? [];
    // A level of a genre with core mechanics (a puzzle level) has at least one section about one (a hub's key counts).
    if (build.core && out.structure !== 'hub' && !out.built.some((b) => patternById(b.pattern)?.mechanics.some((m) => build.core!.includes(m)))) {
      lastProblems = [`it has no ${build.core.join(', ')} section`];
      continue;
    }
    // A puzzle level: every puzzle in it is needed (without its lever, key, crate or teleporter, no way to the goal).
    if (after.length) {
      const needed = runValidators(after, { project, sceneId, registry, reach: description, mechanics: [], grid: still });
      if (needed.state === 'invalid') {
        lastProblems = needed.problems;
        continue;
      }
    }
    options.onBuilt?.(still);
    const patterns: Record<string, number> = {};
    for (const b of out.built) patterns[b.pattern] = patternById(b.pattern)?.version ?? 1;
    const rows = out.grid.rows();
    const { shape, counts } = shapeOfRows(rows);
    for (const p of out.grid.placed) {
      const key = p.path ? 'movers' : p.role === 'teleporter' ? 'teleporters' : p.role === 'door' ? 'doors' : p.role === 'key' ? 'keys' : p.role === 'switch' ? 'levers' : p.role === 'plate' ? 'plates' : null;
      if (key) counts[key] = (counts[key] ?? 0) + 1;
    }
    const fingerprint: Fingerprint = { structure: out.structure, length: out.length, size: [out.grid.width, out.grid.height], signature: out.signature, routes: bp.routes ?? 'one', sections: out.built.map((b) => `${b.role}:${b.pattern}/${b.variant}@${b.difficulty}`), shape, counts };
    const near = closest(fingerprint, history.map((h) => h.fp));
    const result: GenerateResult = {
      ops,
      rows,
      state: check.state,
      notes: [...notes, ...tried, `the route solver got to the goal in ${route.length - 1} moves`, ...(moving && check.state === 'validated' ? ['moving platforms were checked as bridges along their paths'] : [])],
      attempts: attempt + 1,
      madeBy: {
        generator: build.id,
        version: build.version,
        seed,
        blueprint: Object.fromEntries(Object.entries({ ...bp, seed }).filter(([, v]) => v !== null)),
        patterns,
        fingerprint: { ...fingerprint, ...(near ? { closest: history[near.index].name, similarity: near.score } : {}) },
      },
    };
    if (check.state === 'validated') found.push({ result, score: near?.score ?? 0, closestName: near ? history[near.index].name : null });
    // Uncertain: kept, in case nothing better comes (said so).
    else if (!uncertain) uncertain = { ...result, notes: [...result.notes, `not proven playable: ${check.problems.join('; ')}`], why: check.problems };
  }
  if (found.length) {
    // The least like the game's other levels (the first of equals).
    const best = found.reduce((a, b) => (b.score < a.score ? b : a));
    if (best.closestName) best.result.notes.push(`${best.score >= TOO_ALIKE ? 'still quite like' : 'most like'} ${best.closestName} (similarity ${best.score.toFixed(2)}${found.length > 1 ? `, the least alike of ${found.length} builds` : ''})`);
    return best.result;
  }
  if (uncertain) return uncertain;
  throw new LevelGenError(`No level could be built that checks out (${ATTEMPTS} tries): ${lastProblems.join('; ')}`);
}
