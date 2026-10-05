/**
 * Adding, replacing and removing behavior scripts on library objects (every
 * copy) or single entities. Every script is checked (checkScript) before it
 * is stored, whoever wrote it.
 */
import { generateId } from '../ids';
import { getDefinition, ModelError } from '../model/mutations';
import type { BehaviorScript, Id, Project } from '../types';
import { checkScript } from './language';

export type ScriptOwner = { target: 'definition' | 'instance'; id: Id };

function ownerOf(project: Project, owner: ScriptOwner): { name: string; scripts: BehaviorScript[]; set(next: BehaviorScript[]): void } {
  if (owner.target === 'definition') {
    const def = getDefinition(project, owner.id);
    return { name: def.name, scripts: def.scripts ?? [], set: (next) => (def.scripts = next) };
  }
  for (const scene of project.scenes) {
    const e = scene.entities.find((x) => x.id === owner.id);
    if (e) return { name: e.name, scripts: e.scripts ?? [], set: (next) => (e.scripts = next) };
  }
  throw new ModelError(`Entity "${owner.id}" not found`);
}

/**
 * Adds a script, or replaces the one with the same id. A missing id gets a
 * new one. Returns the stored script's id.
 */
export function setScript(project: Project, owner: ScriptOwner, raw: unknown): Id {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new ModelError('Script must be a JSON object');
  const withId = { ...(raw as Record<string, unknown>) };
  if (typeof withId.id !== 'string' || !withId.id) withId.id = generateId('scr');
  const checked = checkScript(withId, project);
  if ('error' in checked) throw new ModelError(checked.error);
  const o = ownerOf(project, owner);
  const i = o.scripts.findIndex((s) => s.id === checked.script.id);
  o.set(i >= 0 ? o.scripts.map((s, j) => (j === i ? checked.script : s)) : [...o.scripts, checked.script]);
  return checked.script.id;
}

export function removeScript(project: Project, owner: ScriptOwner, scriptId: Id): void {
  const o = ownerOf(project, owner);
  if (!o.scripts.some((s) => s.id === scriptId)) throw new ModelError(`${o.name} has no script "${scriptId}"`);
  o.set(o.scripts.filter((s) => s.id !== scriptId));
}

export function setScriptEnabled(project: Project, owner: ScriptOwner, scriptId: Id, enabled: boolean): void {
  const o = ownerOf(project, owner);
  const s = o.scripts.find((x) => x.id === scriptId);
  if (!s) throw new ModelError(`${o.name} has no script "${scriptId}"`);
  s.enabled = enabled;
}
