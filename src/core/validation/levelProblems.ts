/**
 * What the editor and the AI are told about a hand-made level's reach: the level checker's problems, as the
 * validators choose (core/validation/validators.ts, §8.4). The checker judges with the jump table; a player with
 * abilities the table doesn't cover (wall jumps, dashes) may get where the table says it can't, so then "can't get
 * to" is not said: the level's reach is said to be unjudged instead (uncertain, never a false alarm).
 */
import type { ComponentRegistry } from '../components/registry';
import { reachabilityProblems } from '../model/reachability';
import { resolveEntity } from '../model/resolve';
import { reachOf, type ReachDescription } from '../reach/reach';
import type { Id, Project } from '../types';

/** The reach of the level's player (the first placed character with a controller), or null. */
export function levelPlayerReach(project: Project, sceneId: Id, registry: ComponentRegistry): ReachDescription | null {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) return null;
  for (const e of scene.entities) {
    const r = resolveEntity(project, e, registry);
    if (r.components.CharacterController) return reachOf(r.components, scene.world.gravity.y);
  }
  return null;
}

export function levelReachProblems(project: Project, sceneId: Id, registry: ComponentRegistry): { key: string; text: string; entityIds: Id[] }[] {
  const problems = reachabilityProblems(project, sceneId, registry);
  const reach = levelPlayerReach(project, sceneId, registry);
  const beyond = reach?.table ? reach.abilities.filter((a) => !reach.covers.table.includes(a)) : [];
  if (!beyond.length) return problems;
  const kept = problems.filter((p) => !p.key.startsWith('reach-things:') && !p.key.startsWith('reach-platforms:'));
  if (kept.length === problems.length) return problems;
  const words: Record<string, string> = { wall_jump: 'wall jumps', dash: 'dashes' };
  return [
    ...kept,
    {
      key: 'reach-unjudged',
      text: `Not checked: whether the player gets everywhere. Its ${beyond.map((a) => words[a] ?? a).join(' and ')} aren't judged by the jump checker, which alone can't get it to everything; play it to see.`,
      entityIds: [],
    },
  ];
}
