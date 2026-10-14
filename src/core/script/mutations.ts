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

/** One change to part of a script (edit_script): what is at a place in it is replaced, removed, or added before. */
export interface ScriptEdit {
  /** Where: keys and list positions from the script's top, by dots, e.g. "handlers.3", "handlers.3.do.1", "vars". */
  at: string;
  action: 'replace' | 'insert' | 'remove';
  /** replace / insert: the new value (a handler, a statement, a list…). */
  value?: unknown;
  /** Optional check: text (as it appears in the JSON) that what is at the place now must contain. */
  was?: string;
}

/**
 * Changes parts of a script instead of rewriting it: the edits are made in order on a copy, and the result is
 * checked (checkScript) and stored like a whole new script. Nothing changes unless all of them work.
 */
export function editScript(project: Project, owner: ScriptOwner, scriptId: Id, edits: ScriptEdit[]): void {
  const o = ownerOf(project, owner);
  const current = o.scripts.find((s) => s.id === scriptId);
  if (!current) throw new ModelError(`${o.name} has no script "${scriptId}" (its scripts: ${o.scripts.map((s) => `${s.id} "${s.name}"`).join(', ') || 'none'})`);
  if (!Array.isArray(edits) || !edits.length) throw new ModelError('edit_script needs a list of edits');
  const draft = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
  edits.forEach((edit, n) => {
    const where = `edit ${n + 1} (${edit?.at})`;
    if (!edit || typeof edit.at !== 'string' || !edit.at.trim()) throw new ModelError(`edit_script ${where}: "at" must say where, e.g. "handlers.2.do.0"`);
    const path = edit.at.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k));
    if (path[0] === 'id') throw new ModelError(`edit_script ${where}: a script's id can't be changed`);
    let parent: unknown = draft;
    for (const key of path.slice(0, -1)) {
      parent = (parent as Record<string | number, unknown> | null)?.[key];
      if (parent === undefined || parent === null || typeof parent !== 'object') throw new ModelError(`edit_script ${where}: there is nothing at "${edit.at}" in the script`);
    }
    const last = path[path.length - 1];
    const isList = Array.isArray(parent);
    if (isList && typeof last !== 'number') throw new ModelError(`edit_script ${where}: "${last}" is not a position in a list`);
    if (!isList && typeof last === 'number') throw new ModelError(`edit_script ${where}: ${last} is a position, but this is not a list`);
    const list = parent as unknown[];
    const obj = parent as Record<string, unknown>;
    const now = isList ? list[last as number] : obj[last as string];
    if (edit.was !== undefined && edit.was !== null && !JSON.stringify(now ?? null).includes(String(edit.was))) {
      throw new ModelError(`edit_script ${where}: what is there now is not what was expected ("${edit.was}"); it is ${JSON.stringify(now ?? null).slice(0, 200)}`);
    }
    if (edit.action === 'replace') {
      if (edit.value === undefined) throw new ModelError(`edit_script ${where}: replace needs a "value"`);
      if (isList ? (last as number) >= list.length : !(last in obj)) throw new ModelError(`edit_script ${where}: there is nothing at "${edit.at}" to replace (insert adds)`);
      if (isList) list[last as number] = edit.value;
      else obj[last as string] = edit.value;
    } else if (edit.action === 'insert') {
      if (!isList) {
        if (edit.value === undefined) throw new ModelError(`edit_script ${where}: insert needs a "value"`);
        obj[last as string] = edit.value;
      } else {
        if ((last as number) > list.length) throw new ModelError(`edit_script ${where}: the list has only ${list.length} items (insert at ${list.length} adds at the end)`);
        list.splice(last as number, 0, edit.value);
      }
    } else if (edit.action === 'remove') {
      if (isList) {
        if ((last as number) >= list.length) throw new ModelError(`edit_script ${where}: there is nothing at "${edit.at}" to remove`);
        list.splice(last as number, 1);
      } else delete obj[last as string];
    } else throw new ModelError(`edit_script ${where}: action must be replace, insert or remove`);
  });
  setScript(project, owner, draft);
}
