/**
 * Progression (docs/engine-architecture-proposal.md §22.7): how a game's levels hang together. A progression model
 * says where the game starts and what follows a level when it is won; the game session (runtime/session.ts) carries
 * that out, with what scripts ask on top (go_to_level, visit_level and return_level, restart_game), which are the
 * same for every model. The game's profile selects the model (profile.progression.model); a model that isn't
 * registered is no model: a won level is then followed by nothing, and the compatibility report says so.
 *
 * `stages` is the engine's: levels one after another, in their order. (Worlds of connected rooms, stage select and
 * ability gates are other models, for slices V5 and V6.)
 *
 * Which levels are played on their own is asked of the generators: a level a generator uses as a part (a room
 * template) is not a stage.
 */
import type { GeometryKind } from '../engine/geometry';
import { inferProfileFromObjects } from '../engine/infer';
import { gameProfileSchema } from '../engine/profileSchema';
import { partLevels } from '../generation/playGenerators';
import type { GameType, Id, Project, Scene } from '../types';

export interface ProgressionModel {
  id: string;
  /** The level that follows this one when it is won (null: none: the game is finished). */
  next(project: Project, sceneId: Id): Scene | null;
}

/** The levels of a game that are played on their own, in order (not the ones generators use as parts). */
export function stagesOf(project: Project): Scene[] {
  const parts = partLevels(project);
  return project.scenes.filter((s) => !parts.has(s.id));
}

const stages: ProgressionModel = {
  id: 'stages',
  next(project, sceneId) {
    const parts = partLevels(project);
    return project.scenes.slice(project.scenes.findIndex((s) => s.id === sceneId) + 1).find((s) => !parts.has(s.id)) ?? null;
  },
};

/** The engine's progression models, declared (what each requires; what happens without one). */
export const PROGRESSIONS: GeometryKind[] = [
  { id: 'stages', version: 1, describe: 'Levels one after another, in their order (go_to_level for branches and secret exits, visit_level for a battle or a room and back)', requires: [], without: 'a won level is followed by nothing: the game stops there' },
];

const MODELS = new Map<string, ProgressionModel>([[stages.id, stages]]);

/** Another progression model (its module, registered beside it, is what a profile can select and what it requires). */
export function registerProgression(model: ProgressionModel): void {
  MODELS.set(model.id, model);
}
export function unregisterProgression(id: string): void {
  MODELS.delete(id);
}
export const progressionIds = (): string[] => [...MODELS.keys()];

type Game = Pick<Project, 'definitions' | 'scenes'> & { settings: { profile?: unknown; gameType?: GameType } };

/** The progression model the game's profile selects (stored, else worked out), by id. */
export function selectedProgression(project: Game): string {
  const stored = gameProfileSchema.safeParse(project.settings.profile);
  return (stored.success ? stored.data : inferProfileFromObjects(project as Parameters<typeof inferProfileFromObjects>[0])).progression.model;
}

/** The game's progression model: the one its profile selects, when there is such a model; else null. */
export function gameProgression(project: Game): ProgressionModel | null {
  return MODELS.get(selectedProgression(project)) ?? null;
}

/** The level after this one in the game (null: none, or no progression model). */
export function nextLevel(project: Project, sceneId: Id): Scene | null {
  return gameProgression(project)?.next(project, sceneId) ?? null;
}
