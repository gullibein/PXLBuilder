/**
 * Platformers of the regression suite. Mario-style: a level built by the engine's classic level builder (the
 * platformer preset), won by the route bot along the solver's route; and a small level drawn as a map to check
 * stomping an enemy and bumping a ? block for its coin.
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../../core/components/registry';
import { applyOperations } from '../../core/commands/operations';
import { projectFromPreset, setGameProfile } from '../../core/engine/profile';
import { applyBuilt, buildLevel } from '../../core/levelGen/build';
import { LevelGrid, ROLE_CHARS } from '../../core/levelGen/grid';
import { findRoles, type Role } from '../../core/levelGen/roles';
import type { Project } from '../../core/types';

/** A level of the classic builder (fixed blueprint and seed), and the grid it was checked on. */
export function marioLevel(registry: ComponentRegistry, seed: number): { project: Project; grid: LevelGrid } {
  // (Its look chosen: a game without one gets it from its random id, and the look rules some patterns out.)
  const base = produce(projectFromPreset('classic-platformer', registry, 'Mario-style'), (d) => void setGameProfile(d, { theme: 'forest' }, registry));
  let grid: LevelGrid | null = null;
  const built = buildLevel(base, base.scenes[0].id, { difficulty: 3, structure: 'run', length: 'short', seed, avoid: ['enemy', 'mover'] }, registry, { onBuilt: (g) => (grid = g), candidates: 1 });
  return { project: produce(base, (d) => void applyBuilt(d, d.scenes[0].id, built, registry)), grid: grid! };
}

/** A level drawn as a map of role characters (P player, # ground, E enemy, ? block…), on the platformer preset. */
/** The cell grid of a level drawn as a map (what the route solver searches), with the game's roles. */
export function mapGrid(project: Project, registry: ComponentRegistry, rows: string[]): LevelGrid {
  const byChar = new Map(Object.entries(ROLE_CHARS).map(([r, ch]) => [ch, r as Role]));
  const g = new LevelGrid(rows[0].length, rows.length, findRoles(project, registry));
  rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && g.fill(byChar.get(ch)!, c, r, c, r)));
  return g;
}

export function mapLevel(registry: ComponentRegistry, rows: string[]): Project {
  const base = projectFromPreset('platformer', registry, 'Map');
  const roles = findRoles(base, registry);
  const byChar = new Map(Object.entries(ROLE_CHARS).map(([r, ch]) => [ch, r as Role]));
  const g = new LevelGrid(rows[0].length, rows.length, roles);
  rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && g.fill(byChar.get(ch)!, c, r, c, r)));
  return produce(base, (d) => void applyOperations(d, g.toOperations(d.scenes[0].id), registry));
}
