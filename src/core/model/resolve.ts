import type { ComponentRegistry } from '../components/registry';
import type { ComponentMap, EntityInstance, Id, ObjectDefinition, Project, Transform } from '../types';

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
  };
}
