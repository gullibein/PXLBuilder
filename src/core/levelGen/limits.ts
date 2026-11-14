/**
 * How far the player gets, in cells, for building levels: the level checker's own numbers (jumpTable), so a level
 * built within them is one the checker passes, and with a margin that shrinks as the difficulty goes up (an easy
 * level never asks for the player's longest jump; the hardest asks for exactly it, never more).
 */
import type { ComponentRegistry } from '../components/registry';
import { instantiateDefinition } from '../model/factory';
import { jumpTable, type JumpTable } from '../model/reachability';
import { resolveEntity } from '../model/resolve';
import type { Id, Project } from '../types';

export interface Limits {
  /** Rows higher a floor may be and still be jumped up onto. */
  maxRise: number;
  /** The widest gap of empty cells it clears, landing `rise` rows higher (negative: lower). 0: can't. */
  gap(rise: number): number;
  /** Rows above its floor a launch from a spring gets the player up onto (0: no spring jumps). */
  springRows: number;
  /** Rows a crate to stand on adds. */
  crateRows: number;
  /** Empty rows between a floor and a ladder's lowest piece, still caught by a jump. */
  ladderGapRows: number;
  /** The widest run of floor spikes (half a cell tall) it jumps over from the same floor. */
  spikeCells: number;
  /** Free rows kept over every floor the player walks on. */
  headroom: number;
}

/** The limits from a jump table, with the margin for a difficulty from 1 (easy) to 5 (as far as it goes). */
export function limitsFrom(table: JumpTable, difficulty: number): Limits {
  const d = Math.max(1, Math.min(5, Math.round(difficulty)));
  // (Cells under the longest jump: easy levels leave room for a short one.)
  const gapMargin = d <= 1 ? 2 : d <= 3 ? 1 : 0;
  const lowest = table.gaps.length ? Math.min(...table.gaps.map((g) => g.rise)) : 0;
  const cellsAt = (rise: number) => table.gaps.find((g) => g.rise === Math.max(rise, lowest))?.cells ?? 0;
  return {
    maxRise: table.maxRiseRows,
    gap: (rise) => {
      const c = cellsAt(rise);
      return c <= 0 ? 0 : Math.max(1, c - gapMargin);
    },
    springRows: Math.max(0, table.springRows - (d <= 3 ? 1 : 0)),
    crateRows: table.crateRows,
    ladderGapRows: d <= 2 ? 0 : table.ladderGapRows,
    spikeCells: Math.max(table.spikeCells.halfCellTall > 0 ? 1 : 0, table.spikeCells.halfCellTall - (d <= 2 ? 1 : 0)),
    headroom: 2,
  };
}

/**
 * The limits of the game's player in a level (its gravity), at a difficulty. `playerId`: the player's object (from
 * the roles). Null when there is no player that jumps (a top-down game, no gravity).
 */
export function playerLimits(project: Project, sceneId: Id, playerId: Id, registry: ComponentRegistry, difficulty: number): Limits | null {
  const scene = project.scenes.find((s) => s.id === sceneId);
  const def = project.definitions.find((d) => d.id === playerId);
  if (!scene || !def) return null;
  // (A player placed in the level may have its own changes: those count.)
  const placed = scene.entities.find((e) => e.definitionId === playerId);
  const components = resolveEntity(project, placed ?? instantiateDefinition(def, { x: 0, y: 0 }), registry).components;
  const table = jumpTable(components, scene.world.gravity.y);
  return table ? limitsFrom(table, difficulty) : null;
}
