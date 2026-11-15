/**
 * Patterns: small pieces of level design the builder knows how to build (a gap, a pipe run, an enemy guarding a
 * landing…), each sized from the player's own reach and built differently each time (its variants are different
 * constructions, its numbers come from the seed). A pattern builds one section: a stretch of a floor, entered at one
 * ground height and left at another; the builder strings sections together into floors, and floors into a level.
 *
 * Adding a pattern: write one (an object of this shape) and register it (patterns/index.ts). Nothing else changes.
 * Its `version` goes up when it builds differently from the same seed, so a level's record says what built it.
 */
import type { Mechanic, SectionRole } from './blueprint';
import { GridError, type LevelGrid, type Placed } from './grid';
import type { Limits } from './limits';
import type { Random } from './random';
import type { Role, Roles } from './roles';

/** A floor's rows: where its ground normally is, how high it may rise, how deep the ground fills below. */
export interface Band {
  /** The ground's usual top row (the floor's base). */
  slab: number;
  /** How many rows above the slab the ground may rise. */
  maxUp: number;
  /** The highest row anything may be built in (rows above it are another floor or the sky). */
  top: number;
  /** Ground fills down to this row (the bottom of the level, or the floor's own slab). */
  fill: number;
  /** The lowest floor: a pit falls out of the level (else onto the floor below). */
  bottom: boolean;
}

export interface SectionCtx {
  g: LevelGrid;
  rnd: Random;
  lim: Limits;
  /** The player's whole reach (no margin for the difficulty): what a puzzle must be beyond, to be needed. */
  reach: Limits;
  roles: Roles;
  /** 1 (easy) to 5. */
  difficulty: number;
  variant: string;
  /** Which way the player goes through it: +1 right, -1 left. */
  dir: 1 | -1;
  /** The grid column of its first cell (the one the player comes in by). */
  start: number;
  width: number;
  band: Band;
  /** The ground's top row where the player comes in. */
  entry: number;
  /** A ref no other thing in the level has. */
  ref(prefix: string): string;
}

export interface Pattern {
  id: string;
  version: number;
  /** What it is, in a few words (told to the AI). */
  name: string;
  /** The mechanics it is about (a level's focus and escalation choose by these). */
  mechanics: Mechanic[];
  /** The roles of sections it suits. */
  fits: SectionRole[];
  /** The parts it needs (patterns whose parts the game lacks are left out). */
  needs: Role[];
  /** Variants, each a different construction; with extra parts some need. */
  variants: { id: string; needs?: Role[]; bottomOnly?: boolean; minDifficulty?: number }[];
  difficulty: [number, number];
  /** How wide (cells) it can be, at this difficulty, for this variant. */
  width(lim: Limits, difficulty: number, variant: string): [number, number];
  /** Builds the section; returns the ground's top row where the player leaves it. Throws GridError when it can't. */
  build(ctx: SectionCtx): number;
}

export class PatternError extends GridError {}

/** Building in a section by its own columns (0 = where the player comes in), whichever way it goes. */
export class Section {
  constructor(readonly ctx: SectionCtx) {}

  get w(): number {
    return this.ctx.width;
  }

  /** The grid column of the section's column i. */
  col(i: number): number {
    return this.ctx.start + this.ctx.dir * i;
  }

  /** The highest and lowest ground rows allowed here. */
  get highest(): number {
    return this.ctx.band.slab - this.ctx.band.maxUp;
  }
  get lowest(): number {
    return this.ctx.band.slab;
  }

  clampGround(row: number): number {
    return Math.max(this.highest, Math.min(this.lowest, row));
  }

  /** Ground in column i, its top at `row`, down to the band's fill. */
  ground(i: number, row: number, role: Role = 'ground'): void {
    if (row < this.ctx.band.top) throw new PatternError(`ground at row ${row} is above the floor's room`);
    this.ctx.g.fill(role, this.col(i), row, this.col(i), Math.max(row, this.ctx.band.fill));
  }

  /** Ground in columns i0..i1 at one height. */
  flat(i0: number, i1: number, row: number): void {
    for (let i = i0; i <= i1; i++) this.ground(i, row);
  }

  /**
   * A part with its bottom-left cell in column i (in the way the section goes: a part two cells wide covers i and
   * i+1), its bottom row `row`.
   */
  put(role: Role, i: number, row: number): void {
    const w = this.ctx.roles[role]?.cells.w ?? 1;
    const leftmost = this.ctx.dir > 0 ? this.col(i) : this.col(i + w - 1);
    if (row - (this.ctx.roles[role]?.cells.h ?? 1) + 1 < this.ctx.band.top) throw new PatternError(`${role} at row ${row} reaches above the floor's room`);
    this.ctx.g.put(role, leftmost, row);
  }

  /** Something placed by itself (not in the map): a teleporter, a door, a moving platform. */
  place(role: Role, i: number, row: number, ref: string, path?: Placed['path']): void {
    const w = this.ctx.roles[role]?.cells.w ?? 1;
    const leftmost = this.ctx.dir > 0 ? this.col(i) : this.col(i + w - 1);
    // (A path is given in the section's direction; the grid's is left to right.)
    const p = path && { ...path, to: { x: path.to.x * this.ctx.dir, y: path.to.y }, points: path.points?.map((q) => ({ x: q.x * this.ctx.dir, y: q.y })) };
    this.ctx.g.place({ role, col: leftmost, row, ref, ...(p ? { path: p } : {}) });
  }

  has(role: Role): boolean {
    return !!this.ctx.roles[role];
  }

  /** A whole number from lo to hi, leaning higher with the difficulty (1: the low end, 5: the high end). */
  scaled(lo: number, hi: number): number {
    if (hi <= lo) return lo;
    const t = (this.ctx.difficulty - 1) / 4;
    const mid = lo + (hi - lo) * t;
    return Math.max(lo, Math.min(hi, Math.round(mid + (this.ctx.rnd.next() - 0.5) * 1.5)));
  }
}
