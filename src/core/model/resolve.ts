import { current, isDraft, original } from 'immer';
import type { ComponentRegistry } from '../components/registry';
import type { ComponentDefinition } from '../components/schema';
import type { BehaviorScript, ComponentMap, EntityInstance, Id, ObjectDefinition, Project, Transform } from '../types';

/** An entity with its definition applied: the effective state the editor and runtime use. */
export interface ResolvedEntity {
  id: Id;
  name: string;
  definitionId: Id | null;
  transform: Transform;
  components: ComponentMap;
  tags: string[];
  /** "Component.field" keys whose value comes from an instance override. */
  overriddenFields: Set<string>;
  /** Component types added on the instance that the definition does not have. */
  instanceOnlyComponents: Set<string>;
  /** Placed on a tile grid (see placement.ts): snaps to whole cells and is drawn as part of a continuous surface. */
  tile: boolean;
  /** Behavior scripts: the object's, then the entity's own. */
  scripts: BehaviorScript[];
}

/** What every plain copy of an object resolves to (frozen: shared by all of them, so never to be changed in place). */
interface Shared {
  registry: ComponentRegistry;
  /** The component types as they were registered when this was worked out (one registered since, or gone: worked out again). */
  types: (ComponentDefinition | undefined)[];
  components: ComponentMap;
  tags: string[];
  tile: boolean;
  scripts: BehaviorScript[];
}

const shared = new WeakMap<ObjectDefinition, Shared>();

function isPlainCopy(entity: EntityInstance): boolean {
  if (entity.removedComponents.length || entity.tags.length || (entity.scripts && entity.scripts.length)) return false;
  for (const _ in entity.components) return false;
  return true;
}

function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const k of Object.keys(v)) deepFreeze((v as Record<string, unknown>)[k]);
  }
  return v;
}

/**
 * The shared resolution of an object, when the object can't change under it: it is frozen (a game as the editor
 * and the saved file hold it), or a draft of one that nothing has changed yet. Otherwise null: worked out the long way.
 */
function sharedFor(def: ObjectDefinition, registry: ComponentRegistry): Shared | null {
  let key = def;
  if (isDraft(def)) {
    // (An untouched draft's current state is the frozen object it was made from; a changed one's is a new copy.)
    key = current(def);
    if (key !== original(def)) return null;
  }
  if (!Object.isFrozen(key)) return null;
  const types = Object.keys(key.components);
  const was = shared.get(key);
  if (was && was.registry === registry && was.types.length === types.length && types.every((t, i) => registry.get(t) === was.types[i])) return was;
  const components: ComponentMap = {};
  for (const type of types) {
    const props = key.components[type];
    components[type] = registry.has(type) ? registry.createDefault(type, { ...props }) : { ...props };
  }
  // (Values inside are the object's own, frozen already, or fresh defaults: all frozen, as nothing may change them.)
  const made: Shared = {
    registry,
    types: types.map((t) => registry.get(t)),
    components: deepFreeze(components),
    tags: Object.freeze([...new Set(key.tags)]) as string[],
    tile: key.metadata.placement === 'tile',
    scripts: Object.freeze([...(key.scripts ?? [])]) as BehaviorScript[],
  };
  shared.set(key, made);
  return made;
}

export function findDefinition(project: Project, id: Id | null): ObjectDefinition | undefined {
  if (id === null) return undefined;
  return project.definitions.find((d) => d.id === id);
}

/**
 * Applies the instance's definition (if any) and fills missing fields from the
 * component registry defaults. Pure: never mutates its inputs.
 */
export function resolveEntity(project: Project, entity: EntityInstance, registry: ComponentRegistry): ResolvedEntity {
  const def = findDefinition(project, entity.definitionId);
  // A plain copy of an object (nothing of its own: no component changed, none removed, no tags, no scripts) is the
  // object: worked out once per object, not once per copy (docs §30, W1: a level is mostly such copies).
  if (def && isPlainCopy(entity)) {
    const made = sharedFor(def, registry);
    if (made)
      return {
        id: entity.id,
        name: entity.name,
        definitionId: entity.definitionId,
        transform: entity.transform,
        components: made.components,
        tags: made.tags,
        overriddenFields: new Set<string>(),
        instanceOnlyComponents: new Set<string>(),
        tile: made.tile || entity.metadata.placement === 'tile',
        scripts: made.scripts,
      };
  }
  const components: ComponentMap = {};
  const overriddenFields = new Set<string>();
  const instanceOnlyComponents = new Set<string>();

  if (def) {
    for (const [type, props] of Object.entries(def.components)) {
      if (entity.removedComponents.includes(type)) continue;
      const override = entity.components[type] ?? {};
      for (const field of Object.keys(override)) overriddenFields.add(`${type}.${field}`);
      components[type] = { ...props, ...override };
    }
    for (const [type, props] of Object.entries(entity.components)) {
      if (type in def.components) continue;
      instanceOnlyComponents.add(type);
      components[type] = { ...props };
    }
  } else {
    for (const [type, props] of Object.entries(entity.components)) components[type] = { ...props };
  }

  for (const [type, props] of Object.entries(components)) {
    if (registry.has(type)) components[type] = registry.createDefault(type, props);
  }

  const tags = [...new Set([...(def?.tags ?? []), ...entity.tags])];
  return {
    id: entity.id,
    name: entity.name,
    definitionId: entity.definitionId,
    transform: entity.transform,
    components,
    tags,
    overriddenFields,
    instanceOnlyComponents,
    tile: def?.metadata.placement === 'tile' || entity.metadata.placement === 'tile',
    scripts: [...(def?.scripts ?? []), ...(entity.scripts ?? [])],
  };
}
