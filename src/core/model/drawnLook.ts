/**
 * Whether a new game's objects all got a look of their own (for a game asked with AI-drawn sprites): the objects
 * placed in the level that still show a starter's picture, or are only a box of color, after an answer.
 */
import type { Id, ObjectDefinition, Project } from '../types';

/** What an object looks like, as far as its pictures go (its sprite, its autotile pictures, its situation looks). */
function lookOf(def: ObjectDefinition): string {
  const c = def.components;
  return JSON.stringify([c.Sprite?.assetId ?? null, c.Sprite?.autotileSheet ?? null, c.SpriteStates ?? null]);
}

/** The names of the objects in the level (sceneId of `after`) whose look the answer left as it was, or a plain box. */
export function undrawnObjects(before: Project, after: Project, sceneId: Id): string[] {
  const scene = after.scenes.find((s) => s.id === sceneId);
  if (!scene) return [];
  const placed = new Set(scene.entities.map((e) => e.definitionId).filter((id): id is Id => !!id));
  const out: string[] = [];
  for (const def of after.definitions) {
    if (!placed.has(def.id) || !def.components.Sprite) continue;
    const old = before.definitions.find((d) => d.id === def.id);
    const pictured = !!def.components.Sprite.assetId || !!def.components.Sprite.autotileSheet;
    if (old ? lookOf(old) === lookOf(def) : !pictured) out.push(def.name);
  }
  return out;
}
