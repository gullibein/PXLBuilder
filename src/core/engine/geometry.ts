/**
 * Which geometry a game has, in four steps (docs/engine-architecture-proposal.md §18.1):
 * - registered: a geometry module exists (GEOMETRY below, registered in engine/modules.ts);
 * - selected: the game's profile lists it;
 * - supported: selected, and what it requires is given by the profile's other modules (a ramp needs a side view);
 * - active: what the runtime and the level checker actually do. Active = supported. A shape the game uses whose
 *   geometry isn't active works in its module's lesser way instead (`without`: ramps block like walls), and the
 *   compatibility report says so: the report and the runtime read the same answer from here.
 *
 * Data only (no starter sets), so the runtime and the exported player can ask it.
 */
import { rampOf } from '../model/ramps';
import type { GameType } from '../types';
import { inferProfileFromObjects } from './infer';
import { gameProfileSchema, type GameProfile } from './profileSchema';

export interface GeometryKind {
  id: string;
  version: number;
  describe: string;
  requires: string[];
  /** For a required tag that isn't met: what happens instead. */
  fallback?: Record<string, string>;
  /** What the game's shapes of this kind do when it isn't active (not selected, or not supported). */
  without: string;
}

export const GEOMETRY: GeometryKind[] = [
  { id: 'box', version: 1, describe: 'Square tiles and solid boxes', requires: [], without: 'nothing is solid' },
  { id: 'one_way', version: 1, describe: 'Jump-through platforms', requires: ['view:side'], fallback: { 'view:side': 'seen from above, jump-through platforms block like walls' }, without: 'jump-through platforms block like walls' },
  { id: 'ramp', version: 2, describe: 'Ramps: 45° and gentle (half a square per square)', requires: ['view:side'], fallback: { 'view:side': 'seen from above, ramps block like walls' }, without: 'ramps block like walls' },
  {
    id: 'cells',
    version: 1,
    describe: 'Grid squares: what is in each (boards), tiles dug out that fill in again',
    requires: [],
    without: "nothing can be dug and squares can't be asked (dig, dug_at and in_cell are refused, with a script error)",
  },
];

export interface GeometryStatus {
  registered: string[];
  selected: string[];
  /** Selected and with what it needs. */
  supported: string[];
  /** What the runtime and the level checker use (the supported ones). */
  active: string[];
  /** Selected but not supported: why (the module's fallback). */
  unsupported: { id: string; why: string }[];
  /** Selected, but there is no such geometry. */
  unknown: string[];
}

/**
 * The capability tags a profile's modules give, by the convention every module follows (it provides "kind:id"). The
 * registry's own tags may say more (engine/modules.ts); a test checks the geometry answer is the same either way.
 */
export function profileTags(p: GameProfile): Set<string> {
  return new Set([`view:${p.view}`, `time:${p.time}`, `locomotion:${p.movement.model}`, ...p.movement.abilities.map((a) => `ability:${a}`), ...p.geometry.map((g) => `geometry:${g}`), ...p.camera.map((c) => `camera:${c}`), ...(p.turns ?? []).map((t) => `turns:${t}`), ...p.kits.map((k) => `kit:${k}`)]);
}

const met = (tag: string, provided: ReadonlySet<string>) => tag.split('|').some((t) => provided.has(t.trim()));

/** The four steps for one system's kinds (geometry, camera): what of the selected ids is supported, so active. */
export function statusOf(kinds: readonly GeometryKind[], selectedIds: readonly string[], provided: ReadonlySet<string>): GeometryStatus {
  const registered = kinds.map((g) => g.id);
  const selected = [...selectedIds];
  const unknown = selected.filter((id) => !registered.includes(id));
  const unsupported: { id: string; why: string }[] = [];
  const supported: string[] = [];
  for (const id of selected) {
    const g = kinds.find((x) => x.id === id);
    if (!g) continue;
    const missing = g.requires.filter((t) => !met(t, provided));
    if (missing.length) unsupported.push({ id, why: missing.map((t) => g.fallback?.[t] ?? `it needs ${t}`).join('; ') });
    else supported.push(id);
  }
  return { registered, selected, supported, active: supported, unsupported, unknown };
}

/** The four steps for a profile's geometry (`provided`: the capability tags its modules give; by default, profileTags). */
export function geometryStatus(p: GameProfile, provided: ReadonlySet<string> = profileTags(p)): GeometryStatus {
  return statusOf(GEOMETRY, p.geometry, provided);
}

/** The geometry the runtime and the level checker use for a profile. */
export function activeGeometry(p: GameProfile): ReadonlySet<string> {
  return new Set(geometryStatus(p).active);
}

type Def = { name: string; components: Record<string, unknown>; scripts?: unknown };

/** The geometry a game's objects and scripts use (whatever its profile says), with the objects using each. */
export function geometryUsed(definitions: readonly Def[]): Map<string, string[]> {
  const used = new Map<string, string[]>();
  const add = (id: string, name: string) => {
    const list = used.get(id) ?? [];
    if (!list.includes(name)) list.push(name);
    used.set(id, list);
  };
  for (const d of definitions) {
    const col = d.components.Collider as { shape?: unknown; oneWay?: unknown; isTrigger?: unknown } | undefined;
    if (col && col.isTrigger !== true) {
      if (rampOf(col.shape)) add('ramp', d.name);
      else if (col.oneWay === true) add('one_way', d.name);
    }
    if (/"do":"dig"|\bdug_at\(|\bin_cell\(/.test(JSON.stringify(d.scripts ?? []))) add('cells', d.name);
  }
  return used;
}

/**
 * What the game's objects use that its profile doesn't make active, and what they do instead: said to the user and
 * the AI, and exactly what the runtime does.
 */
export function geometryNotes(p: GameProfile, definitions: readonly Def[], provided?: ReadonlySet<string>): string[] {
  const status = geometryStatus(p, provided);
  const notes: string[] = [];
  for (const [id, names] of geometryUsed(definitions)) {
    if (status.active.includes(id)) continue;
    const g = GEOMETRY.find((x) => x.id === id)!;
    const why = status.unsupported.find((u) => u.id === id)?.why ?? `the game's profile doesn't select geometry "${id}"`;
    notes.push(`${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}: ${why}, so ${g.without}`);
  }
  return notes;
}

/** The active geometry of a game: its stored profile's, else the one worked out from its objects (as profileOf). */
export function gameGeometry(project: { definitions: Def[]; settings: { profile?: unknown; gameType?: GameType } }): ReadonlySet<string> {
  const stored = gameProfileSchema.safeParse(project.settings.profile);
  return activeGeometry(stored.success ? stored.data : inferProfileFromObjects(project as Parameters<typeof inferProfileFromObjects>[0]));
}
