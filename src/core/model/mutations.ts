/**
 * Primitive model mutations. Each function mutates the given project in place
 * (callers pass an immer draft) and throws ModelError on invalid input, leaving
 * validation in one place regardless of who calls it: the inspector today, the
 * command/transaction system and AI operations later.
 */
import type { ComponentRegistry } from '../components/registry';
import { validateField } from '../components/schema';
import { generateId } from '../ids';
import type { EntityInstance, Id, ObjectDefinition, Project, Scene, Transform, Vec2, WorldSettings } from '../types';
import { findDefinition, resolveEntity } from './resolve';

export class ModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ModelError';
  }
}

// ---------------------------------------------------------------- lookups

export function getScene(project: Project, sceneId: Id): Scene {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new ModelError(`Scene "${sceneId}" not found`);
  return scene;
}

export function getEntity(project: Project, sceneId: Id, entityId: Id): EntityInstance {
  const entity = getScene(project, sceneId).entities.find((e) => e.id === entityId);
  if (!entity) throw new ModelError(`Entity "${entityId}" not found in scene "${sceneId}"`);
  return entity;
}

export function getDefinition(project: Project, definitionId: Id): ObjectDefinition {
  const def = findDefinition(project, definitionId);
  if (!def) throw new ModelError(`Object definition "${definitionId}" not found`);
  return def;
}

function checkField(registry: ComponentRegistry, type: string, field: string, value: unknown): void {
  const schema = registry.get(type);
  if (!schema) throw new ModelError(`Unknown component type "${type}"`);
  const fieldSchema = schema.fields[field];
  if (!fieldSchema) throw new ModelError(`Component "${type}" has no field "${field}"`);
  const err = validateField(fieldSchema, value);
  if (err) throw new ModelError(`${type}.${field} ${err}`);
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0))];
}

// ---------------------------------------------------------------- project

export function renameProject(project: Project, name: string): void {
  if (!name.trim()) throw new ModelError('Project name cannot be empty');
  project.name = name.trim();
}

export function setGridSize(project: Project, gridSize: number): void {
  if (!Number.isInteger(gridSize) || gridSize < 1) throw new ModelError('Grid size must be a positive integer');
  project.settings.gridSize = gridSize;
}

// ---------------------------------------------------------------- scenes

export function addScene(project: Project, scene: Scene): void {
  if (project.scenes.some((s) => s.id === scene.id)) throw new ModelError(`Scene "${scene.id}" already exists`);
  project.scenes.push(scene);
}

export function renameScene(project: Project, sceneId: Id, name: string): void {
  if (!name.trim()) throw new ModelError('Scene name cannot be empty');
  getScene(project, sceneId).name = name.trim();
}

export function removeScene(project: Project, sceneId: Id): void {
  getScene(project, sceneId);
  if (project.scenes.length <= 1) throw new ModelError('A project must contain at least one scene');
  project.scenes = project.scenes.filter((s) => s.id !== sceneId);
  if (project.startSceneId === sceneId) project.startSceneId = project.scenes[0].id;
}

export function setStartScene(project: Project, sceneId: Id): void {
  getScene(project, sceneId);
  project.startSceneId = sceneId;
}

export function setWorldSettings(project: Project, sceneId: Id, patch: Partial<WorldSettings>): void {
  const scene = getScene(project, sceneId);
  if (patch.gravity && validateField({ kind: 'vec2', default: { x: 0, y: 0 } }, patch.gravity)) {
    throw new ModelError('Gravity must be {x, y} numbers');
  }
  if (patch.backgroundColor !== undefined && validateField({ kind: 'color', default: '#000000' }, patch.backgroundColor)) {
    throw new ModelError('Background color must be a hex color');
  }
  Object.assign(scene.world, cloneValue(patch));
}

// ---------------------------------------------------------------- entities

export function addEntity(project: Project, sceneId: Id, entity: EntityInstance): void {
  const scene = getScene(project, sceneId);
  if (scene.entities.some((e) => e.id === entity.id)) throw new ModelError(`Entity "${entity.id}" already exists`);
  if (entity.definitionId !== null) getDefinition(project, entity.definitionId);
  scene.entities.push(cloneValue(entity));
}

export function removeEntities(project: Project, sceneId: Id, entityIds: Id[]): void {
  const scene = getScene(project, sceneId);
  const ids = new Set(entityIds);
  scene.entities = scene.entities.filter((e) => !ids.has(e.id));
}

/** Copies entities (with new ids) offset by `offset`. Returns the new ids in order. */
export function duplicateEntities(project: Project, sceneId: Id, entityIds: Id[], offset: Vec2): Id[] {
  const scene = getScene(project, sceneId);
  const created: Id[] = [];
  for (const id of entityIds) {
    const source = getEntity(project, sceneId, id);
    const copy = cloneValue(source);
    copy.id = generateId('ent');
    copy.transform.position = { x: source.transform.position.x + offset.x, y: source.transform.position.y + offset.y };
    scene.entities.push(copy);
    created.push(copy.id);
  }
  return created;
}

export function setEntityTransform(project: Project, sceneId: Id, entityId: Id, patch: Partial<Transform>): void {
  const entity = getEntity(project, sceneId, entityId);
  const vec = { kind: 'vec2', default: { x: 0, y: 0 } } as const;
  if (patch.position && validateField(vec, patch.position)) throw new ModelError('Position must be {x, y} numbers');
  if (patch.scale && validateField(vec, patch.scale)) throw new ModelError('Scale must be {x, y} numbers');
  if (patch.rotation !== undefined && !Number.isFinite(patch.rotation)) throw new ModelError('Rotation must be a number');
  Object.assign(entity.transform, cloneValue(patch));
}

export function moveEntities(project: Project, sceneId: Id, entityIds: Id[], delta: Vec2): void {
  for (const id of entityIds) {
    const t = getEntity(project, sceneId, id).transform;
    t.position = { x: t.position.x + delta.x, y: t.position.y + delta.y };
  }
}

export function renameEntity(project: Project, sceneId: Id, entityId: Id, name: string): void {
  if (!name.trim()) throw new ModelError('Entity name cannot be empty');
  getEntity(project, sceneId, entityId).name = name.trim();
}

export function setEntityTags(project: Project, sceneId: Id, entityId: Id, tags: string[]): void {
  getEntity(project, sceneId, entityId).tags = normalizeTags(tags);
}

/**
 * Sets one component field on an entity. For definition-backed entities the
 * value is stored as an instance override (and dropped again if it equals the
 * inherited value); otherwise it is stored directly.
 */
export function setEntityComponentField(
  project: Project,
  sceneId: Id,
  entityId: Id,
  type: string,
  field: string,
  value: unknown,
  registry: ComponentRegistry,
): void {
  checkField(registry, type, field, value);
  const entity = getEntity(project, sceneId, entityId);
  const resolved = resolveEntity(project, entity, registry);
  if (!(type in resolved.components)) throw new ModelError(`Entity "${entity.name}" has no ${type} component`);

  const inherited = findDefinition(project, entity.definitionId)?.components[type];
  if (inherited && !entity.removedComponents.includes(type)) {
    const override = (entity.components[type] ??= {});
    if (field in inherited && sameValue(inherited[field], value)) {
      delete override[field];
      if (Object.keys(override).length === 0) delete entity.components[type];
    } else {
      override[field] = cloneValue(value);
    }
  } else {
    entity.components[type] = { ...resolved.components[type], ...entity.components[type], [field]: cloneValue(value) };
  }
}

/** Removes an instance override so the field inherits from the definition again. */
export function revertEntityComponentField(project: Project, sceneId: Id, entityId: Id, type: string, field: string): void {
  const entity = getEntity(project, sceneId, entityId);
  const def = findDefinition(project, entity.definitionId);
  if (!def || !(type in def.components)) throw new ModelError(`${type} is not inherited from a definition`);
  const override = entity.components[type];
  if (!override) return;
  delete override[field];
  if (Object.keys(override).length === 0) delete entity.components[type];
}

export function addEntityComponent(project: Project, sceneId: Id, entityId: Id, type: string, registry: ComponentRegistry, props: Record<string, unknown> = {}): void {
  if (!registry.has(type)) throw new ModelError(`Unknown component type "${type}"`);
  const errors = registry.validate(type, props, { partial: true });
  if (errors.length) throw new ModelError(`${type}.${errors[0].field} ${errors[0].message}`);
  const entity = getEntity(project, sceneId, entityId);
  const resolved = resolveEntity(project, entity, registry);
  if (type in resolved.components) throw new ModelError(`Entity "${entity.name}" already has a ${type} component`);

  const def = findDefinition(project, entity.definitionId);
  if (def && type in def.components) {
    // Re-enable an inherited component that was removed on this instance.
    entity.removedComponents = entity.removedComponents.filter((t) => t !== type);
    if (Object.keys(props).length) entity.components[type] = cloneValue(props);
  } else {
    entity.components[type] = registry.createDefault(type, cloneValue(props));
  }
}

export function removeEntityComponent(project: Project, sceneId: Id, entityId: Id, type: string): void {
  const entity = getEntity(project, sceneId, entityId);
  const def = findDefinition(project, entity.definitionId);
  delete entity.components[type];
  if (def && type in def.components && !entity.removedComponents.includes(type)) entity.removedComponents.push(type);
}

/** Converts an instance into a standalone entity carrying its fully resolved components. */
export function unlinkEntity(project: Project, sceneId: Id, entityId: Id, registry: ComponentRegistry): void {
  const entity = getEntity(project, sceneId, entityId);
  if (entity.definitionId === null) return;
  const resolved = resolveEntity(project, entity, registry);
  entity.components = cloneValue(resolved.components);
  entity.tags = [...resolved.tags];
  entity.removedComponents = [];
  entity.definitionId = null;
}

// ---------------------------------------------------------------- definitions

export function addDefinition(project: Project, def: ObjectDefinition, registry: ComponentRegistry): void {
  if (project.definitions.some((d) => d.id === def.id)) throw new ModelError(`Definition "${def.id}" already exists`);
  for (const [type, props] of Object.entries(def.components)) {
    const errors = registry.validate(type, props);
    if (errors.length) throw new ModelError(`${type}.${errors[0].field} ${errors[0].message}`);
  }
  project.definitions.push(cloneValue({ ...def, tags: normalizeTags(def.tags) }));
}

export function renameDefinition(project: Project, definitionId: Id, name: string): void {
  if (!name.trim()) throw new ModelError('Object name cannot be empty');
  getDefinition(project, definitionId).name = name.trim();
}

export function setDefinitionDescription(project: Project, definitionId: Id, description: string): void {
  getDefinition(project, definitionId).description = description;
}

export function setDefinitionTags(project: Project, definitionId: Id, tags: string[]): void {
  getDefinition(project, definitionId).tags = normalizeTags(tags);
}

export function setDefinitionComponentField(
  project: Project,
  definitionId: Id,
  type: string,
  field: string,
  value: unknown,
  registry: ComponentRegistry,
): void {
  checkField(registry, type, field, value);
  const def = getDefinition(project, definitionId);
  const props = def.components[type];
  if (!props) throw new ModelError(`Object "${def.name}" has no ${type} component`);
  props[field] = cloneValue(value);
}

export function addDefinitionComponent(project: Project, definitionId: Id, type: string, registry: ComponentRegistry, props: Record<string, unknown> = {}): void {
  if (!registry.has(type)) throw new ModelError(`Unknown component type "${type}"`);
  const def = getDefinition(project, definitionId);
  if (type in def.components) throw new ModelError(`Object "${def.name}" already has a ${type} component`);
  const full = registry.createDefault(type, cloneValue(props));
  const errors = registry.validate(type, full);
  if (errors.length) throw new ModelError(`${type}.${errors[0].field} ${errors[0].message}`);
  def.components[type] = full;
}

/**
 * Removes a component from a definition. Instance overrides for it are
 * dropped too, since there is no longer anything to override.
 */
export function removeDefinitionComponent(project: Project, definitionId: Id, type: string): void {
  const def = getDefinition(project, definitionId);
  delete def.components[type];
  forEachInstance(project, definitionId, (entity) => {
    delete entity.components[type];
    entity.removedComponents = entity.removedComponents.filter((t) => t !== type);
  });
}

/** Deletes a definition. Existing instances are unlinked (baked) so scenes keep working. */
export function deleteDefinition(project: Project, definitionId: Id, registry: ComponentRegistry): void {
  getDefinition(project, definitionId);
  for (const scene of project.scenes) {
    for (const entity of scene.entities) {
      if (entity.definitionId === definitionId) unlinkEntity(project, scene.id, entity.id, registry);
    }
  }
  project.definitions = project.definitions.filter((d) => d.id !== definitionId);
}

export function countInstances(project: Project, definitionId: Id): number {
  let n = 0;
  forEachInstance(project, definitionId, () => n++);
  return n;
}

function forEachInstance(project: Project, definitionId: Id, fn: (e: EntityInstance, s: Scene) => void): void {
  for (const scene of project.scenes) for (const e of scene.entities) if (e.definitionId === definitionId) fn(e, scene);
}

