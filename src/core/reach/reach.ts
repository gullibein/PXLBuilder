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
import { abilityDefinitions } from '../../abilities/index';
import { ARCADE_MOVES, type MoveRule } from '../levelGen/moves';
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

/** The abilities that have a part in the player's reach (their definitions': src/abilities), by id. */
export const reachAbilityIds = (): string[] => abilityDefinitions().filter((a) => a.reach).map((a) => a.id);

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
  // The abilities this character has that have a part in its reach (their definitions say: src/abilities): each
  // adds its move rule.
  const byMoves: string[] = [];
  const bySimulator: string[] = [];
  const approximate: string[] = [];
  const capabilities: ReachDescription['capabilities'] = {};
  for (const a of abilityDefinitions()) {
    if (!a.reach || !components[a.component.type] || !a.worksWith.includes('arcade')) continue;
    const move = a.reach.move(components, base);
    moves.push(move);
    abilities.push(a.id);
    byMoves.push(...move.mechanics);
    // (Simulated: the route bot plays every move the rule makes, by the ability's own bot part. Without one, a level
    // that needs the ability is never proven playable here: it stays uncertain.)
    const played = a.bot?.moves ?? [];
    if ([move.id, ...(move.makes ?? [])].every((m) => played.includes(m))) bySimulator.push(...move.mechanics);
    if (a.reach.estimated) approximate.push(...move.mechanics);
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
