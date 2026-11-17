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
  /**
   * What the player can do beyond running and jumping, in numbers (cells, rows): by capability id, from the move
   * rules that give them. Level builders ask this: a pattern that requires a capability is built only for a player
   * that has it, sized from its numbers.
   */
  capabilities: Record<string, Record<string, number>>;
}

/**
 * An ability's part in a player's reach: when a character has it (by its components), the move rule it adds (with
 * its capability numbers), and whether that rule is exact or an estimate to be confirmed by simulation. Registered
 * once for each ability; the reach description, the route solver, the validators and the level builder find it
 * from there.
 */
export interface ReachAbility {
  id: string;
  has(components: ResolvedEntity['components']): boolean;
  move(components: ResolvedEntity['components'], base: { jumpForce: number; gravity: number; speed: number }): MoveRule;
  /** Its moves are estimated in cells (true: a route through them is confirmed by the simulator before it counts). */
  estimated: boolean;
  /** The simulator plays its moves (false: levels that need it are never proven playable here, and that is said). */
  simulated: boolean;
}

const ABILITIES: ReachAbility[] = [];

export function registerReachAbility(a: ReachAbility): void {
  if (ABILITIES.some((x) => x.id === a.id)) throw new Error(`Two reach abilities with the id "${a.id}"`);
  ABILITIES.push(a);
}
export function unregisterReachAbility(id: string): void {
  const i = ABILITIES.findIndex((x) => x.id === id);
  if (i >= 0) ABILITIES.splice(i, 1);
}
export const reachAbilityIds = (): string[] => ABILITIES.map((a) => a.id);

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** Kept under the estimate, as the jump table is: what a player can count on. */
const MARGIN = 0.92;
const CELL = 32;

// A kick off the wall: up as fast as its jumpY (0: the player's jump), away at jumpX until its top.
registerReachAbility({
  id: 'wall_jump',
  has: (c) => !!c.WallJump,
  move(c, base) {
    const w = c.WallJump!;
    const vy = num(w.jumpY, 0) || base.jumpForce;
    const rise = Math.floor(((vy * vy) / (2 * base.gravity)) * MARGIN / CELL);
    const away = Math.max(1, Math.floor((num(w.jumpX, 260) * (vy / base.gravity) * MARGIN) / CELL));
    return wallJumpMove(Math.max(1, rise), away);
  },
  estimated: true,
  simulated: true,
});
// A dash: its speed for its duration; up too, unless it only goes sideways.
registerReachAbility({
  id: 'dash',
  has: (c) => !!c.Dash,
  move(c) {
    const d = c.Dash!;
    const cells = Math.floor((num(d.speed, 520) * num(d.duration, 0.16) * MARGIN) / CELL);
    return dashMove(cells, d.directions === 'horizontal' ? 0 : cells);
  },
  estimated: true,
  simulated: true,
});

/** The reach of a character with these components, in a world with this gravity (null: it has no controller). */
export function reachOf(components: ResolvedEntity['components'], gravityY: number): ReachDescription | null {
  const cc = components.CharacterController;
  if (!cc) return null;
  const movement = String(cc.movement ?? 'platformer');
  const base = characterReach(components, gravityY);
  if (movement !== 'platformer' || !base) {
    // Seen from above, or without gravity: no jumps to tabulate and no moves (the level checker walks it its own way).
    return { model: movement === 'platformer' ? 'arcade' : 'topdown', abilities: [], table: null, limits: null, moves: null, simulator: null, covers: { table: [], moves: [], simulator: [] }, approximate: [], capabilities: {} };
  }
  const table = jumpTable(components, gravityY)!;
  const abilities = [...(components.DoubleJump ? ['double_jump'] : []), ...(components.LedgeGrab ? ['ledge_grab'] : [])];
  const moves: MoveRule[] = [...ARCADE_MOVES];
  // The abilities registered with the reach model that this character has: each adds its move rule.
  const byMoves: string[] = [];
  const bySimulator: string[] = [];
  const approximate: string[] = [];
  const capabilities: ReachDescription['capabilities'] = {};
  for (const a of ABILITIES) {
    if (!a.has(components)) continue;
    const move = a.move(components, base);
    moves.push(move);
    abilities.push(a.id);
    byMoves.push(...move.mechanics);
    if (a.simulated) bySimulator.push(...move.mechanics);
    if (a.estimated) approximate.push(...move.mechanics);
    if (move.capability) capabilities[move.capability.id] = { ...move.capability.numbers };
  }
  return {
    model: 'arcade',
    abilities,
    table,
    limits: (difficulty) => limitsFrom(table, difficulty),
    moves,
    simulator: 'route_bot',
    covers: {
      // (The table has no closed form for these abilities.)
      table: ARCADE_MECHANICS,
      moves: [...ARCADE_MECHANICS, ...byMoves],
      // (The route bot doesn't ride moving platforms.)
      simulator: [...ARCADE_MECHANICS, ...bySimulator],
    },
    approximate,
    capabilities,
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
