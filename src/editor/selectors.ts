import { componentRegistry } from '../core/components/builtin';
import { resolveEntity, type ResolvedEntity } from '../core/model/resolve';
import type { Id, Project } from '../core/types';

const cache = new WeakMap<Project, Map<Id, ResolvedEntity[]>>();

/** Resolved entities of a scene, memoized per (immutable) project version. */
export function resolveSceneEntities(project: Project, sceneId: Id): ResolvedEntity[] {
  let perScene = cache.get(project);
  if (!perScene) {
    perScene = new Map();
    cache.set(project, perScene);
  }
  let resolved = perScene.get(sceneId);
  if (!resolved) {
    const scene = project.scenes.find((s) => s.id === sceneId);
    resolved = scene ? scene.entities.map((e) => resolveEntity(project, e, componentRegistry)) : [];
    perScene.set(sceneId, resolved);
  }
  return resolved;
}
