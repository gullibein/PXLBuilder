/**
 * Adding, replacing and removing behavior scripts on library objects (every
 * copy) or single entities. Every script is checked (checkScript) before it
 * is stored, whoever wrote it.
 */
import { ENGINE_PART_INFO, type PartOwner } from '../model/engineParts';
import type { EnginePart } from './language';
import { generateId } from '../ids';
import { getDefinition, ModelError } from '../model/mutations';
import type { BehaviorScript, Condition, EntityRef, Id, Project } from '../types';
import { itemNameOf } from '../graph/graph';
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

/**
 * A part of the engine's own code (jumping…) is done by a script for this owner from now on: its ready-made script
 * (exactly what the engine did), or `raw`, a changed one. One taking over the same part already is replaced.
 */
export function useScriptFor(project: Project, owner: ScriptOwner, part: EnginePart, raw: unknown | null): Id {
  const info = ENGINE_PART_INFO[part];
  // What it is made for: the object, or a placed one (its object's components with its own on top).
  let made: PartOwner;
  let matches: (ref: EntityRef) => boolean;
  if (owner.target === 'definition') {
    const def = getDefinition(project, owner.id);
    made = { name: def.name, components: def.components };
    matches = (ref) => (ref.kind === 'object' && ref.id === def.id) || (ref.kind === 'tag' && def.tags.includes(ref.tag));
  } else {
    const e = project.scenes.flatMap((sc) => sc.entities).find((x) => x.id === owner.id);
    if (!e) throw new ModelError(`Entity "${owner.id}" not found`);
    const def = e.definitionId ? project.definitions.find((d) => d.id === e.definitionId) : undefined;
    made = { name: def?.name ?? e.name, components: { ...(def?.components ?? {}), ...e.components } };
    const tags = [...(def?.tags ?? []), ...e.tags];
    matches = (ref) => (ref.kind === 'entity' && ref.id === e.id) || (ref.kind === 'object' && ref.id === e.definitionId) || (ref.kind === 'tag' && tags.includes(ref.tag));
  }
  // Its key connections ("Door requires Key"), in every level, for a lock made from them.
  made.requires = project.scenes
    .flatMap((sc) => sc.relationships)
    .filter((r) => r.type === 'requires' && matches(r.source))
    .map((r) => ({ item: itemOfRef(project, r.target), consume: r.params.consume === true, conditions: r.conditions }))
    .filter((r): r is { item: string; consume: boolean; conditions: Condition[] } => r.item !== null);
  if (!made.components[info.component]) throw new ModelError(`${made.name} has no ${info.component}, so there is no ${info.label} to take over`);
  const script = raw === null ? info.script(made) : { ...(raw as Record<string, unknown>), takesOver: part };
  const o = ownerOf(project, owner);
  const before = o.scripts;
  o.set(o.scripts.filter((s) => s.takesOver !== part));
  try {
    return setScript(project, owner, script);
  } catch (e) {
    o.set(before);
    throw e;
  }
}

/** The item a "requires" target stands for (as the engine reads it): what that object gives when collected, or the tag. */
function itemOfRef(project: Project, ref: EntityRef): string | null {
  if (ref.kind === 'tag') return ref.tag;
  const objectId = ref.kind === 'object' ? ref.id : ref.kind === 'entity' ? project.scenes.flatMap((s) => s.entities).find((x) => x.id === ref.id)?.definitionId : null;
  const def = objectId ? project.definitions.find((d) => d.id === objectId) : undefined;
  if (ref.kind === 'object') return def ? (itemNameOf(def.components, def.name) ?? def.name.toLowerCase()) : null;
  if (ref.kind === 'entity') {
    const e = project.scenes.flatMap((s) => s.entities).find((x) => x.id === ref.id);
    if (!e) return null;
    const name = def?.name ?? e.name;
    return itemNameOf({ ...(def?.components ?? {}), ...e.components }, name) ?? name.toLowerCase();
  }
  return null;
}

export function removeScript(project: Project, owner: ScriptOwner, scriptId: Id): void {
  const o = ownerOf(project, owner);
  if (!o.scripts.some((s) => s.id === scriptId)) throw new ModelError(`${o.name} has no script "${scriptId}"`);
  o.set(o.scripts.filter((s) => s.id !== scriptId));
}

/** What one of its variables starts at (a setting changed in Details). */
export function setScriptVar(project: Project, owner: ScriptOwner, scriptId: Id, name: string, value: number | boolean | string): void {
  const o = ownerOf(project, owner);
  const s = o.scripts.find((x) => x.id === scriptId);
  if (!s) throw new ModelError(`${o.name} has no script "${scriptId}"`);
  const v = s.vars.find((x) => x.name === name);
  if (!v) throw new ModelError(`Script ${s.name} has no variable "${name}"`);
  if (typeof value !== typeof v.value) throw new ModelError(`${name} needs ${typeof v.value === 'number' ? 'a number' : typeof v.value === 'boolean' ? 'on or off' : 'text'}`);
  v.value = value;
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
    let last = path[path.length - 1];
    // Inserting into a list named by itself ("handlers.0.do"): adds a statement (or handler…) at its end.
    if (edit.action === 'insert' && !Array.isArray(parent) && Array.isArray((parent as Record<string, unknown>)[last as string]) && !Array.isArray(edit.value)) {
      parent = (parent as Record<string, unknown>)[last as string];
      last = (parent as unknown[]).length;
    }
    const isList = Array.isArray(parent);
    if (isList && typeof last !== 'number') throw new ModelError(`edit_script ${where}: "${last}" is not a position in a list`);
    if (!isList && typeof last === 'number') throw new ModelError(`edit_script ${where}: ${last} is a position, but this is not a list`);
    const list = parent as unknown[];
    const obj = parent as Record<string, unknown>;
    const now = isList ? list[last as number] : obj[last as string];
    // (Adding at a list's end: nothing is there to compare with, whatever "was" says.)
    const atEnd = edit.action === 'insert' && isList && last === list.length;
    if (!atEnd && edit.was !== undefined && edit.was !== null && !JSON.stringify(now ?? null).includes(String(edit.was))) {
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
