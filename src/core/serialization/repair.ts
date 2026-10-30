/**
 * Fixing a game file that doesn't load as it is (made by another version of the app, edited by hand, cut off): the
 * parts that are broken are left out, one at a time, until what is left loads, and each one is listed in plain
 * words so the user knows what is gone. Only what doesn't load is left out; everything else stays as it was.
 */
import type { ZodError } from 'zod';
import type { ComponentRegistry } from '../components/registry';
import { checkScript } from '../script/language';
import type { Project } from '../types';

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The lists whose items can be left out on their own (an item of one is a whole thing: a script, a placed thing…). */
const ITEMS: Record<string, string> = {
  scripts: 'script',
  entities: 'placed thing',
  definitions: 'object',
  assets: 'picture or sound',
  relationships: 'connection',
  rules: 'rule',
  scenes: 'level',
};

function nameOf(v: unknown): string {
  const n = (v as { name?: unknown } | null)?.name;
  return typeof n === 'string' && n ? `"${n}"` : '(unnamed)';
}

/**
 * Leaves out what one validation problem is in: the component it is in, or else the smallest whole thing (a script,
 * a placed thing, an object…) that holds it; a broken setting of the game or a level is set back to its default.
 * Returns what was left out, or null when there is nothing to leave out.
 */
function leaveOut(raw: Raw, path: (string | number)[]): string | null {
  // A component: just that component.
  const ci = path.indexOf('components');
  if (ci >= 0 && typeof path[ci + 1] === 'string') {
    const holder = path.slice(0, ci).reduce<Raw | undefined>((o, k) => o?.[k], raw);
    if (holder?.components && path[ci + 1] in holder.components) {
      delete holder.components[path[ci + 1] as string];
      return `the ${path[ci + 1]} settings of ${nameOf(holder)}`;
    }
  }
  // The innermost whole thing holding it.
  for (let i = path.length - 2; i >= 0; i--) {
    const key = path[i];
    if (typeof key !== 'string' || !(key in ITEMS) || typeof path[i + 1] !== 'number') continue;
    const list = path.slice(0, i + 1).reduce<Raw | undefined>((o, k) => o?.[k], raw);
    if (!Array.isArray(list)) continue;
    const [gone] = list.splice(path[i + 1] as number, 1);
    const owner = path.slice(0, i).reduce<Raw | undefined>((o, k) => o?.[k], raw);
    return `the ${ITEMS[key]} ${nameOf(gone)}${owner && owner !== raw ? ` of ${nameOf(owner)}` : ''}`;
  }
  // Anything else (a setting): removed, so its default is used.
  if (path.length) {
    const parent = path.slice(0, -1).reduce<Raw | undefined>((o, k) => o?.[k], raw);
    if (parent && typeof parent === 'object' && path[path.length - 1] in parent) {
      delete parent[path[path.length - 1] as string];
      return `the setting "${path.join('.')}" (back to its default)`;
    }
  }
  return null;
}

/**
 * Leaves out what fails `validate`, one problem at a time (at most `limit` times). Returns the project once it
 * validates, or null when it still doesn't, with what was left out.
 */
export function repairRaw<T>(raw: Raw, validate: (r: Raw) => { success: true; data: T } | { success: false; error: ZodError }, limit = 300): { data: T | null; removed: string[] } {
  const removed: string[] = [];
  for (let n = 0; n < limit; n++) {
    const r = validate(raw);
    if (r.success) return { data: r.data, removed };
    const issue = r.error.issues[0];
    const what = leaveOut(raw, issue.path as (string | number)[]);
    if (!what) return { data: null, removed };
    removed.push(what);
  }
  return { data: null, removed };
}

/**
 * After the file validates: what still can't work is left out too: placed things whose object is missing, scripts
 * that don't check out, components this version doesn't know, and a start level or background that is gone.
 */
export function repairProject(project: Project, registry: ComponentRegistry): string[] {
  const removed: string[] = [];
  const defIds = new Set(project.definitions.map((d) => d.id));
  const seen = new Set<string>();
  const unique = <T extends { id: string; name: string }>(list: T[], what: string) =>
    list.filter((x) => {
      if (!seen.has(x.id)) return seen.add(x.id);
      removed.push(`a second ${what} "${x.name}" with the same id`);
      return false;
    });
  project.definitions = unique(project.definitions, 'object');
  const scripted = (list: Project['definitions'][number]['scripts'], owner: string) =>
    list?.filter((s) => {
      const ok = !('error' in checkScript(s, project));
      if (!ok) removed.push(`the script "${s.name}" of "${owner}" (it doesn't work with this version)`);
      return ok;
    });
  const known = (components: Record<string, unknown>, owner: string) => {
    for (const type of Object.keys(components)) {
      if (registry.has(type)) continue;
      delete components[type];
      removed.push(`the ${type} settings of "${owner}" (not in this version)`);
    }
  };
  for (const d of project.definitions) {
    known(d.components, d.name);
    if (d.scripts) d.scripts = scripted(d.scripts, d.name);
  }
  for (const scene of project.scenes) {
    scene.entities = unique(scene.entities, 'placed thing').filter((e) => {
      if (e.definitionId === null || defIds.has(e.definitionId)) return true;
      removed.push(`the placed thing "${e.name}" in "${scene.name}" (its object is missing)`);
      return false;
    });
    for (const e of scene.entities) {
      known(e.components, e.name);
      if (e.scripts) e.scripts = scripted(e.scripts, e.name);
    }
  }
  const assetIds = new Set(project.assets.map((a) => a.id));
  for (const scene of project.scenes) {
    const img = scene.world.background.imageAssetId;
    if (img !== null && !assetIds.has(img)) {
      scene.world.background.imageAssetId = null;
      removed.push(`the background picture of "${scene.name}" (the picture is missing)`);
    }
  }
  if (project.scenes.length && !project.scenes.some((s) => s.id === project.startSceneId)) {
    project.startSceneId = project.scenes[0].id;
    removed.push('which level the game starts in (it now starts in the first one)');
  }
  return removed;
}
