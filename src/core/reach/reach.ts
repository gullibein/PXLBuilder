/**
 * Reach descriptions (docs/engine-architecture-proposal.md §8.1, F4): what a player's movement setup (its
 * locomotion model and abilities) offers level validation. Up to three representations, each optional:
 * - table: closed-form numbers (the jump table and the builder's limits), for sizing levels and the level checker;
 * - moves: move rules for the route solver's search over cells and states;
 * - simulator: a policy that plays the real runtime (the route bot).
 * And which mechanics each covers soundly; `approximate`: mechanics the moves only estimate (a route through them
 * is confirmed by simulation before it counts).
 */
import type { ComponentRegistry } from '../components/registry';
import { limitsFrom, type Limits } from '../levelGen/limits';
import { ARCADE_MOVES, dashMove, wallJumpMove, type MoveRule } from '../levelGen/moves';
import type { SolverReach } from '../levelGen/solver';
import { instantiateDefinition } from '../model/factory';
import { characterReach } from '../model/reach';
import { jumpTable, type JumpTable } from '../model/reachability';
import { resolveEntity, type ResolvedEntity } from '../model/resolve';
import type { Id, Project } from '../types';

/** What the arcade model's movement and objects make up (each judged by the table, the moves and the route bot alike). */
export const ARCADE_MECHANICS = ['walk', 'fall', 'jump', 'ramp', 'oneway', 'ladder', 'water', 'spring', 'teleporter', 'crate', 'plate', 'key', 'switch', 'door', 'hazard', 'double_jump', 'ledge_grab'];

export interface ReachDescription {
  /** The locomotion model it describes ("arcade", "topdown"). */
  model: string;
  /** The abilities it includes (by module id). */
  abilities: string[];
  table: JumpTable | null;
  /** The builder's limits at a difficulty (1-5; 5: the whole reach), from the table. */
  limits: ((difficulty: number) => Limits) | null;
  moves: MoveRule[] | null;
  /** The simulator that plays a route on the runtime ("route_bot"), or none. */
  simulator: string | null;
  covers: { table: string[]; moves: string[]; simulator: string[] };
  /** Mechanics the moves cover only approximately: a route through them counts once simulation confirms it. */
  approximate: string[];
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Kept under the estimate, as the jump table is: what a player can count on. */
const MARGIN = 0.92;
const CELL = 32;

/** The reach of a character with these components, in a world with this gravity (null: it has no controller). */
export function reachOf(components: ResolvedEntity['components'], gravityY: number): ReachDescription | null {
  const cc = components.CharacterController;
  if (!cc) return null;
  const movement = String(cc.movement ?? 'platformer');
  const base = characterReach(components, gravityY);
  if (movement !== 'platformer' || !base) {
    // Seen from above, or without gravity: no jumps to tabulate and no moves (the level checker walks it its own way).
    return { model: movement === 'platformer' ? 'arcade' : 'topdown', abilities: [], table: null, limits: null, moves: null, simulator: null, covers: { table: [], moves: [], simulator: [] }, approximate: [] };
  }
  const table = jumpTable(components, gravityY)!;
  const abilities = [...(components.DoubleJump ? ['double_jump'] : []), ...(components.LedgeGrab ? ['ledge_grab'] : [])];
  const moves: MoveRule[] = [...ARCADE_MOVES];
  const extra: string[] = [];
  if (components.WallJump) {
    // A kick off the wall: up as fast as its jumpY (0: the player's jump), away at jumpX until its top.
    const w = components.WallJump;
    const vy = num(w.jumpY, 0) || base.jumpForce;
    const rise = Math.floor(((vy * vy) / (2 * base.gravity)) * MARGIN / CELL);
    const away = Math.max(1, Math.floor((num(w.jumpX, 260) * (vy / base.gravity) * MARGIN) / CELL));
    moves.push(wallJumpMove(Math.max(1, rise), away));
    abilities.push('wall_jump');
    extra.push('wall_jump');
  }
  if (components.Dash) {
    const d = components.Dash;
    const cells = Math.floor((num(d.speed, 520) * num(d.duration, 0.16) * MARGIN) / CELL);
    const up = d.directions === 'horizontal' ? 0 : cells;
    moves.push(dashMove(cells, up));
    abilities.push('dash');
    extra.push('dash');
  }
  return {
    model: 'arcade',
    abilities,
    table,
    limits: (difficulty) => limitsFrom(table, difficulty),
    moves,
    simulator: 'route_bot',
    covers: {
      // (The table has no closed form for wall jumps or dashes.)
      table: ARCADE_MECHANICS,
      moves: [...ARCADE_MECHANICS, ...extra],
      // (The route bot doesn't ride moving platforms.)
      simulator: [...ARCADE_MECHANICS, ...extra],
    },
    approximate: extra,
  };
}

/** The solver's view of a reach description (its whole reach). */
export function solverReach(reach: ReachDescription): SolverReach | null {
  return reach.limits && reach.moves ? { limits: reach.limits(5), moves: reach.moves } : null;
}

/** The reach of the game's player object in a level (its gravity; a player placed there may have its own changes). */
export function playerReach(project: Project, sceneId: Id, playerId: Id, registry: ComponentRegistry): ReachDescription | null {
  const scene = project.scenes.find((s) => s.id === sceneId);
  const def = project.definitions.find((d) => d.id === playerId);
  if (!scene || !def) return null;
  const placed = scene.entities.find((e) => e.definitionId === playerId);
  return reachOf(resolveEntity(project, placed ?? instantiateDefinition(def, { x: 0, y: 0 }), registry).components, scene.world.gravity.y);
}
