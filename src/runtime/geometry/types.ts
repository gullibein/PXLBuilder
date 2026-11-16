/**
 * World geometry behind one query interface (docs/engine-architecture-proposal.md §7.1, F3): what is solid, what
 * holds things up, which way a surface faces, what a grid cell holds. Movement models, abilities, enemies, scripts
 * and the runtime's own physics ask these questions; none of them walks the shape lists itself. Each kind of shape
 * (boxes, jump-through platforms, slopes of any height, ladders, cells that can be dug) answers its part.
 */
import type { Box } from '../physics';

/** A surface met by a probe: where, which way it faces, how steep and how curved. */
export interface Surface {
  point: { x: number; y: number };
  /** Unit normal, pointing out of the surface: (0, -1) a flat floor, (1, 0) a wall facing right. */
  normal: { x: number; y: number };
  /** Radians from flat (0 floor, π/2 wall), from the normal. */
  angle: number;
  /** 1 / radius (0: flat or straight). */
  curvature: number;
  kind: 'solid' | 'slope' | 'oneWay';
  friction: number;
}

/** A slope: a tile whose top rises from one side to the other, from `lo` to `hi` of its height (a 45° ramp: 0 → 1; gentle ones: 0 → 0.5, 0.5 → 1). */
export interface Slope extends Box {
  /** Which way it rises: 1 to the right, -1 to the left. */
  dir: 1 | -1;
  lo: number;
  hi: number;
}

export interface Ladder {
  x: number;
  hw: number;
  top: number;
  bottom: number;
}

/** What a grid square (32 px) holds: for boards (falling blocks, matching), grid movement, digging, generators and scripts. */
export interface CellInfo {
  solid: boolean;
  /** "dug" while a dug-out tile is gone (until it refills at `until`), else null. */
  state: 'dug' | null;
  until: number | null;
  /** The tags of what is in it (its middle in the square): a board's pieces, a dungeon's units. */
  things: string[];
}

export interface GeometryQuery {
  /** Something solid at this point (walls, floors, pushable things). */
  solidAt(x: number, y: number): boolean;
  /** A ray from a point: the first surface along it within maxDist (sensors for running along curves, ledges, enemies). */
  probe(from: { x: number; y: number }, dir: { x: number; y: number }, maxDist: number): Surface | null;
  /** Something solid right beside a box, along most of its height, on that side. */
  wallBeside(box: Box, dir: 1 | -1): boolean;
  /** The grid square at (col, row). */
  cell(col: number, row: number): CellInfo;
  /** Changes whenever the geometry does (a tile dug or refilled, a door opened, something solid moved). */
  readonly version: number;
}
