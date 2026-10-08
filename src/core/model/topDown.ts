/**
 * Whether a level is seen from above (Zelda, Rogue): its player walks in
 * every direction (Character Controller movement "topdown"), or the level has
 * no gravity at all. Up and down the screen are then just directions, so
 * nothing needs ground under it, and the checks and the AI's level building
 * that assume gravity (standing on surfaces, jumping, falling) don't apply.
 */
import type { ComponentRegistry } from '../components/registry';
import type { Project, Scene } from '../types';
import { resolveEntity } from './resolve';

export function isTopDownScene(project: Project, scene: Scene, registry: ComponentRegistry): boolean {
  const g = scene.world.gravity;
  if (g.x === 0 && g.y === 0) return true;
  for (const e of scene.entities) {
    const cc = resolveEntity(project, e, registry).components.CharacterController;
    if (cc) return cc.movement === 'topdown';
  }
  return false;
}
