/**
 * Primitive model mutations. Each function mutates the given project in place
 * (callers pass an immer draft) and throws ModelError on invalid input, leaving
 * validation in one place regardless of who calls it: the inspector today, the
 * command/transaction system and AI operations later.
 */
import type { ComponentRegistry } from '../components/registry';
import { checkCamera, type CameraSettings } from './camera';
import { validateField } from '../components/schema';
import { generateId } from '../ids';
import { createStarterAssets, createStarterDefinitions, type StarterAssets } from './factory';
import { validateGrid } from './spriteGrid';
import type { AssetRecord, BackgroundSettings, EntityInstance, SpriteGrid, Id, ObjectDefinition, Project, Scene, Transform, Vec2, WorldSettings } from '../types';
import { findDefinition, resolveEntity } from './resolve';
import { pruneLogic } from '../logic/refs';

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

export function setBackground(project: Project, sceneId: Id, patch: Partial<BackgroundSettings>): void {
  const scene = getScene(project, sceneId);
  if (patch.imageAssetId !== undefined && patch.imageAssetId !== null) {
    const asset = project.assets.find((a) => a.id === patch.imageAssetId);
    if (!asset) throw new ModelError(`Image "${patch.imageAssetId}" not found`);
    if (asset.kind !== 'image') throw new ModelError(`"${asset.name}" is not an image`);
  }
  if (patch.fit !== undefined && patch.fit !== 'cover' && patch.fit !== 'tile') throw new ModelError('Background fit must be "cover" or "tile"');
  if (patch.parallax !== undefined && !(Number.isFinite(patch.parallax) && patch.parallax >= 0 && patch.parallax <= 1)) {
    throw new ModelError('Background movement must be between 0 and 1');
  }
  Object.assign(scene.world.background, patch);
}

// ---------------------------------------------------------------- assets

/** Changes some camera settings of a level; the result is checked as a whole. */
export function setCameraSettings(project: Project, sceneId: Id, patch: Partial<CameraSettings>): void {
  const scene = getScene(project, sceneId);
  const unknown = Object.keys(patch).find((k) => !(k in scene.camera));
  if (unknown) throw new ModelError(`Camera has no setting "${unknown}"`);
  const checked = checkCamera({ ...scene.camera, ...cloneValue(patch) });
  if ('error' in checked) throw new ModelError(checked.error);
  scene.camera = checked.camera;
}

export function addAsset(project: Project, asset: AssetRecord): void {
  if (project.assets.some((a) => a.id === asset.id)) throw new ModelError(`Asset "${asset.id}" already exists`);
  if (!asset.data.startsWith('data:')) throw new ModelError('Asset data must be a data URL');
  project.assets.push(cloneValue(asset));
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
  // Relationships and rules about a deleted entity go with it (undo brings them back).
  pruneLogic(scene, (ref) => ref.kind === 'entity' && ids.has(ref.id));
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
/**
 * Fields that move together. While Collider.matchSprite is on, the sprite's
 * size and the collider's size are the same thing: changing one changes the
 * other, and turning the link back on snaps the collider to the sprite.
 */
export function linkedWrites(components: Record<string, Record<string, unknown>>, type: string, field: string, value: unknown): [string, string, unknown][] {
  const sprite = components.Sprite;
  const collider = components.Collider;
  if (!sprite || !collider) return [];
  if (type === 'Collider' && field === 'matchSprite') {
    return value === true ? [['Collider', 'size', { x: sprite.width, y: sprite.height }]] : [];
  }
  if (collider.matchSprite === false) return [];
  if (type === 'Sprite' && (field === 'width' || field === 'height')) {
    return [['Collider', 'size', { x: field === 'width' ? value : sprite.width, y: field === 'height' ? value : sprite.height }]];
  }
  if (type === 'Collider' && field === 'size') {
    const size = value as Vec2;
    return [
      ['Sprite', 'width', Math.max(0, size.x)],
      ['Sprite', 'height', Math.max(0, size.y)],
    ];
  }
  return [];
}

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
  writeEntityField(project, entity, resolved.components, type, field, value);
  for (const [t, f, v] of linkedWrites(resolved.components, type, field, value)) {
    checkField(registry, t, f, v);
    writeEntityField(project, entity, resolveEntity(project, entity, registry).components, t, f, v);
  }
}

function writeEntityField(project: Project, entity: EntityInstance, resolvedComponents: Record<string, Record<string, unknown>>, type: string, field: string, value: unknown): void {
  const resolved = { components: resolvedComponents };

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
  // Its object's scripts become its own.
  if (resolved.scripts.length) entity.scripts = cloneValue(resolved.scripts);
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

export function setDefinitionCategory(project: Project, definitionId: Id, category: string): void {
  if (!category.trim()) throw new ModelError('Category cannot be empty');
  getDefinition(project, definitionId).metadata.category = category.trim();
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
  const before = Object.fromEntries(Object.entries(def.components).map(([t, p]) => [t, registry.has(t) ? registry.createDefault(t, p) : p]));
  props[field] = cloneValue(value);
  for (const [t, f, v] of linkedWrites(before, type, field, value)) {
    checkField(registry, t, f, v);
    def.components[t][f] = cloneValue(v);
  }
}

// ---------------------------------------------------------------- starter objects

/** The starter key of a definition (set on starters; older projects match by name), or null for user-made objects. */
export function starterKeyOf(def: ObjectDefinition, starters: ObjectDefinition[]): string | null {
  const key = typeof def.metadata.starter === 'string' ? def.metadata.starter : def.name;
  return starters.some((s) => s.name === key) ? key : null;
}

/** Fresh starter definitions whose image assets reuse identical ones already in the project. */
function freshStarters(project: Project, registry: ComponentRegistry): { defs: ObjectDefinition[]; newAssets: AssetRecord[] } {
  const fresh = createStarterAssets();
  const newAssets: AssetRecord[] = [];
  const reuse = (a: AssetRecord) => {
    const existing = project.assets.find((x) => x.data === a.data);
    if (!existing) newAssets.push(a);
    return existing ?? a;
  };
  const assets: StarterAssets = { ladder: reuse(fresh.ladder), lever: reuse(fresh.lever), player: reuse(fresh.player), enemy: reuse(fresh.enemy), hazard: reuse(fresh.hazard) };
  return { defs: createStarterDefinitions(registry, assets), newAssets };
}

function applyStarter(project: Project, def: ObjectDefinition, starter: ObjectDefinition, newAssets: AssetRecord[]): void {
  def.components = cloneValue(starter.components);
  def.tags = [...starter.tags];
  def.description = starter.description;
  def.metadata = cloneValue(starter.metadata);
  const assetId = def.components.Sprite?.assetId;
  for (const a of newAssets) if (a.id === assetId && !project.assets.some((x) => x.id === a.id)) project.assets.push(cloneValue(a));
  // Placed copies keep their place and name but lose their own tweaks.
  forEachInstance(project, def.id, (e) => {
    e.components = {};
    e.removedComponents = [];
  });
}

/** Puts one starter object (Player, Platform, ...) back to how it ships. Its id stays, so placed copies stay linked. */
export function resetStarterDefinition(project: Project, definitionId: Id, registry: ComponentRegistry): void {
  const def = getDefinition(project, definitionId);
  const { defs, newAssets } = freshStarters(project, registry);
  const key = starterKeyOf(def, defs);
  if (!key) throw new ModelError(`"${def.name}" is not a built-in object, so it has no default to go back to`);
  applyStarter(project, def, defs.find((s) => s.name === key)!, newAssets);
  def.name = key;
}

/** Resets every starter object and re-adds deleted ones. Objects the user created are left alone. Returns how many were reset/added. */
export function resetAllStarterDefinitions(project: Project, registry: ComponentRegistry): { reset: number; added: number } {
  const { defs, newAssets } = freshStarters(project, registry);
  let reset = 0;
  let added = 0;
  for (const starter of defs) {
    const def = project.definitions.find((d) => starterKeyOf(d, defs) === starter.name);
    if (def) {
      applyStarter(project, def, starter, newAssets);
      def.name = starter.name;
      reset++;
    } else {
      const assetId = starter.components.Sprite?.assetId;
      for (const a of newAssets) if (a.id === assetId && !project.assets.some((x) => x.id === a.id)) project.assets.push(cloneValue(a));
      project.definitions.push(cloneValue(starter));
      added++;
    }
  }
  return { reset, added };
}

// ---------------------------------------------------------------- sprites

/** A sprite an object can use: a whole image, or one numbered cell of a sprite sheet. */
export interface SpriteRef {
  assetId: Id;
  frame: number;
}

/** The sprites collected for an object (its sprite choices), kept in definition metadata. */
export function getDefinitionSprites(def: ObjectDefinition): SpriteRef[] {
  const list = def.metadata.sprites;
  return Array.isArray(list) ? list.filter((r): r is SpriteRef => typeof r?.assetId === 'string' && typeof r?.frame === 'number') : [];
}

export function addDefinitionSprite(project: Project, definitionId: Id, ref: SpriteRef): void {
  const def = getDefinition(project, definitionId);
  if (!project.assets.some((a) => a.id === ref.assetId)) throw new ModelError(`Image "${ref.assetId}" not found`);
  const list = getDefinitionSprites(def);
  if (!list.some((r) => r.assetId === ref.assetId && r.frame === ref.frame)) def.metadata.sprites = [...list, { ...ref }];
}

export function removeDefinitionSprite(project: Project, definitionId: Id, ref: SpriteRef): void {
  const def = getDefinition(project, definitionId);
  def.metadata.sprites = getDefinitionSprites(def).filter((r) => !(r.assetId === ref.assetId && r.frame === ref.frame));
}

/** Makes a sprite the one the object is drawn with (adding a Sprite component if needed). Its size is kept: the image stretches to it. */
export function useDefinitionSprite(project: Project, definitionId: Id, ref: SpriteRef, registry: ComponentRegistry): void {
  addDefinitionSprite(project, definitionId, ref);
  const def = getDefinition(project, definitionId);
  if (!def.components.Sprite) def.components.Sprite = registry.createDefault('Sprite');
  def.components.Sprite.assetId = ref.assetId;
  def.components.Sprite.frame = ref.frame;
}

export function setAssetGrid(project: Project, assetId: Id, grid: SpriteGrid): void {
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new ModelError(`Image "${assetId}" not found`);
  const errors = validateGrid(grid, asset.width, asset.height);
  if (errors.length) throw new ModelError(`Sprite grid: ${errors[0]}`);
  asset.kind = 'spritesheet';
  asset.grid = { ...grid };
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
  for (const scene of project.scenes) pruneLogic(scene, (ref) => ref.kind === 'object' && ref.id === definitionId);
}

export function countInstances(project: Project, definitionId: Id): number {
  let n = 0;
  forEachInstance(project, definitionId, () => n++);
  return n;
}

function forEachInstance(project: Project, definitionId: Id, fn: (e: EntityInstance, s: Scene) => void): void {
  for (const scene of project.scenes) for (const e of scene.entities) if (e.definitionId === definitionId) fn(e, scene);
}

