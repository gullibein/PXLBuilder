/**
 * For golden tests of the engine's modularization: a project's library with its random ids replaced by stable
 * names (the order they are met), so two projects made the same way compare equal however their ids were drawn.
 */
import type { Project } from '../types';

export function normalizedDefinitions(project: Project): unknown {
  const ids = new Map<string, string>();
  const name = (id: string) => {
    if (!ids.has(id)) ids.set(id, `#${ids.size}`);
    return ids.get(id)!;
  };
  const walk = (v: unknown): unknown => {
    // (Ids, and ids inside paths like "assets/ast_….svg".)
    if (typeof v === 'string') return v.replace(/\b(def|ast|scr|ent|rel|scn|prj|snd|rul|ins|song)_[0-9a-z]+\b/gi, (id) => name(id));
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk({ definitions: project.definitions, assets: project.assets.map((a) => ({ ...a })), scenes: project.scenes.map((s) => ({ ...s })) });
}
