/**
 * Move rules for the route solver (docs/engine-architecture-proposal.md §8.1, F4): each says, for a state the
 * search has reached, which states a move takes the player to. The solver knows none of them: it explores states
 * and the doors, keys, levers, crates and plates that change as it goes; a reach description (core/reach) gives it
 * its rules: the arcade model's (walk, fall, ramps, springs, pushing crates, ladders, swimming, jumps,
 * teleporters: moved here unchanged, in the order they always ran), and those of the player's abilities (wall
 * jumps, dashes).
 */
import type { Limits } from './limits';
import type { Role } from './roles';
import type { Move, World } from './solver';

/** Where the search is: the player's cell, keys and levers (bits), crates, its mode (0 standing; 1, 2 on a wall to its left, right). */
export interface SolverState {
  c: number;
  r: number;
  kh: number;
  so: number;
  cr: number[];
  mode: number;
  /** The state's id (what moves from it are added from). */
  id: string;
  /** The doors and crates as they are here; `away`: with the player off any plate it stands on (in the air). */
  w: World;
  away: World;
}

/** What a rule can ask of the level and do in the search. */
export interface SolverView {
  W: number;
  H: number;
  lim: Limits;
  /** The widest gap any jump clears. */
  maxGap: number;
  role(c: number, r: number): Role | null;
  solidAt(c: number, r: number, w: World): boolean;
  /** Something to stand on in this cell (from above). */
  supportAt(c: number, r: number, w: World): boolean;
  /** Free space (above the level is open sky). */
  freeAt(c: number, r: number, w: World): boolean;
  hurtsAt(c: number, r: number): boolean;
  waterAt(c: number, r: number): boolean;
  ladderAt(c: number, r: number): boolean;
  /** Where the player can be: free, safe, held up (ground, a ladder, water). */
  canBe(c: number, r: number, w: World): boolean;
  /** Falling from a free cell: the row it comes to rest in (null: out of the level, or into something that hurts). */
  fall(c: number, r: number, w: World): number | null;
  crateFall(c: number, r: number, w: World): number | null;
  crateAt(c: number, r: number, w: World): boolean;
  worldOf(kh: number, so: number, cr: number[], pc: number, pr: number): World;
  /** A jump from (c, r) by (dx, rise) clears what is in the way and lands where `land` says (by default: canBe). */
  canJump(c: number, r: number, dx: number, rise: number, w: World, gapOf: (rise: number) => number, land?: (c: number, r: number, w: World) => boolean): boolean;
  /** Every jump from (c, r) (on a spring: its launch), added as moves from state `fromId`. */
  jumpsFrom(c: number, r: number, w: World, fromId: string, onSpring: boolean, extraCost: number): void;
  /** Adds a state reached by a move (cost `step`, in `mode`). */
  push(c: number, r: number, kh: number, so: number, cr: number[], from: string | null, move: Move, step?: number, mode?: number): void;
  teleportFrom(c: number, r: number): { col: number; row: number } | undefined;
}

export interface MoveRule {
  /** The move it makes ("walk", "jump", "wall_jump"…). */
  id: string;
  /** The mechanics it judges (what a reach description's coverage lists). */
  mechanics: string[];
  /**
   * What it adds to the player's reach, in numbers (cells, rows), for whoever builds levels: a level pattern that
   * requires the capability sizes itself from these (levelGen/pattern.ts).
   */
  capability?: { id: string; numbers: Record<string, number> };
  /** The moves it makes that go by another name than its own (a wall jump's rule also makes "wall_slide"). */
  makes?: string[];
  successors(s: SolverState, v: SolverView): void;
}

// ---------------------------------------------------------------- the arcade model's moves (as they always were)

/** Walk left and right (then fall); step up a ramp or onto a spring; push a crate. */
const walk: MoveRule = {
  id: 'walk',
  mechanics: ['walk', 'fall', 'ramp', 'spring', 'crate', 'plate'],
  successors({ c, r, kh, so, cr, mode, id, w }, v) {
    if (mode) return;
    const { H, W } = v;
    for (const dx of [-1, 1]) {
      const nc = c + dx;
      if (v.freeAt(nc, r, w) && !v.hurtsAt(nc, r) && v.role(nc, r) !== 'spring') {
        const y = v.fall(nc, r, w);
        if (y !== null) v.push(nc, y, kh, so, cr, id, y === r ? 'walk' : 'fall');
      } else {
        const x = v.role(nc, r);
        if ((x === 'rampRight' || x === 'rampLeft') && v.canBe(nc, r - 1, w)) v.push(nc, r - 1, kh, so, cr, id, 'walk');
        // (Walking onto a spring bounces: it launches from its top at once, Jump held, wherever that reaches.)
        if (x === 'spring' && v.freeAt(nc, r - 1, w)) v.jumpsFrom(nc, r - 1, w, id, true, 1);
        // Pushing a crate (standing on something, the crate with nothing on top of it): it goes one cell on, if
        // that is free, and falls; the player steps into where it was.
        const ci = cr.indexOf(nc * H + r);
        if (ci >= 0 && v.supportAt(c, r + 1, w) && !v.crateAt(nc, r - 1, w) && v.freeAt(nc + dx, r, w) && nc + dx > 0 && nc + dx < W - 1) {
          const y = v.crateFall(nc + dx, r, w);
          const moved = [...cr];
          moved[ci] = y === null ? -1 : (nc + dx) * H + y;
          const after = v.worldOf(kh, so, moved, nc, r);
          const py = v.fall(nc, r, after);
          if (py !== null) v.push(nc, py, kh, so, moved, id, 'push', 2);
        }
      }
    }
  },
};

/** Ladders: up and down, off the top to the side. */
const climb: MoveRule = {
  id: 'climb',
  mechanics: ['ladder'],
  successors({ c, r, kh, so, cr, mode, id, w }, v) {
    if (mode || !(v.ladderAt(c, r) || v.ladderAt(c, r + 1))) return;
    if (v.ladderAt(c, r - 1) || (v.ladderAt(c, r) && v.freeAt(c, r - 1, w))) {
      const up = r - 1;
      if (v.canBe(c, up, w)) v.push(c, up, kh, so, cr, id, 'climb');
      else {
        // (Off the top of a ladder: stepping onto the ground beside it.)
        for (const dx of [-1, 1]) if (v.canBe(c + dx, up, w)) v.push(c + dx, up, kh, so, cr, id, 'climb');
      }
    }
    if (v.ladderAt(c, r + 1) && v.freeAt(c, r + 1, w)) v.push(c, r + 1, kh, so, cr, id, 'climb');
    // (From the top of a ladder sticking out of the floor, onto the floor beside.)
    for (const dx of [-1, 1]) if (v.ladderAt(c, r) && v.canBe(c + dx, r, w)) v.push(c + dx, r, kh, so, cr, id, 'climb');
  },
};

/** Swimming: any way through water; up out of it at the surface. */
const swim: MoveRule = {
  id: 'swim',
  mechanics: ['water'],
  successors({ c, r, kh, so, cr, mode, id, w }, v) {
    if (mode || !v.waterAt(c, r)) return;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nc = c + dx;
      const nr = r + dy;
      if (v.freeAt(nc, nr, w) && !v.hurtsAt(nc, nr)) {
        if (v.waterAt(nc, nr) || v.canBe(nc, nr, w)) v.push(nc, nr, kh, so, cr, id, 'swim');
        else {
          const y = v.fall(nc, nr, w);
          if (y !== null) v.push(nc, y, kh, so, cr, id, 'swim');
        }
      }
    }
  },
};

/** Standing (on the ground, a ladder, the water's surface): where the player can jump from. */
/** Standing somewhere a move starts from: on something, on a ladder, at the water's surface (and in no other mode). */
export const standing = ({ c, r, mode, w }: SolverState, v: SolverView) => !mode && (v.supportAt(c, r + 1, w) || v.ladderAt(c, r) || (v.waterAt(c, r) && !v.waterAt(c, r - 1)));

/** Jumps (from the ground, a ladder, or the water's surface; from a spring, its launch). */
const jump: MoveRule = {
  id: 'jump',
  mechanics: ['jump', 'hazard', 'oneway', 'double_jump', 'ledge_grab'],
  successors(s, v) {
    if (standing(s, v)) v.jumpsFrom(s.c, s.r, s.away, s.id, v.role(s.c, s.r + 1) === 'spring', 0);
  },
};

/** Teleporters. */
const teleport: MoveRule = {
  id: 'teleport',
  mechanics: ['teleporter'],
  successors({ c, r, kh, so, cr, mode, id, w }, v) {
    const to = mode ? undefined : v.teleportFrom(c, r);
    if (!to) return;
    const y = v.fall(to.col, to.row, w);
    if (y !== null) v.push(to.col, y, kh, so, cr, id, 'teleport');
  },
};

/** The arcade model's moves, in the order the solver always tried them. */
export const ARCADE_MOVES: readonly MoveRule[] = [walk, climb, swim, jump, teleport];

// ---------------------------------------------------------------- for the abilities' move rules (src/abilities)
// (An ability's own rule is in its definition; these are what such rules share: holding a wall is a mode of the
// search that any of them may end a move in.)

/** A free, safe cell with a wall right beside it on side `side` (-1 left, 1 right): where the player can hold a wall. */
export const onWall = (c: number, r: number, side: -1 | 1, w: World, v: SolverView) => r >= 0 && r < v.H && v.freeAt(c, r, w) && !v.hurtsAt(c, r) && v.solidAt(c + side, r, w) && c + side >= 0 && c + side < v.W;
/** The goal's cell, touched in the air (a kick or a dash ends there: in play, touching it is enough). */
export const goalAt = (c: number, r: number, v: SolverView) => v.role(c, r) === 'goal';
/** The mode for holding a wall on side `side`. */
export const wallMode = (side: -1 | 1) => (side === -1 ? 1 : 2);
