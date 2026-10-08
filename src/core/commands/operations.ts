/**
 * Structured, serializable game operations.
 *
 * This is the vocabulary the AI (and later scripted tools) use to change a
 * project. Operations reference things by stable id, carry values as JSON so
 * they survive any transport, and are applied through the same validated
 * mutation functions the inspector uses. A list of operations is applied
 * all-or-nothing inside one transaction.
 */
import { produce } from 'immer';
import { z } from 'zod';
import type { ComponentRegistry } from '../components/registry';
import { createDefinition, createImageAsset, instantiateDefinition, svgDataUrl } from '../model/factory';
import { buildPath } from './buildPath';
import { parseSoundRecipe, soundDataUrl } from '../audio/sound';
import { generateId } from '../ids';
import { checkPixelArt, fitPixelArt, normalizePixelArt, pixelArtToSvg } from '../model/pixelArt';
import * as logic from '../logic/mutations';
import * as scripts from '../script/mutations';
import { getEntitySize } from '../model/geometry';
import * as m from '../model/mutations';
import { cellSize, LEVEL_CELL } from '../model/placement';
import { resolveEntity } from '../model/resolve';
import { isTopDownScene } from '../model/topDown';
import type { Id, ObjectDefinition, Project, Vec2 } from '../types';

const target = z.enum(['instance', 'definition']).describe('"instance" changes one placed entity, "definition" changes the library object and every instance that does not override it');

export const operationSchema = z.union([
  z.object({
    op: z.literal('set_component_field'),
    target,
    id: z.string().describe('Entity id (instance) or object definition id (definition)'),
    component: z.string(),
    field: z.string(),
    valueJson: z.string().describe('The new value encoded as JSON, e.g. "3", "true", "\\"#ff0000\\"", "{\\"x\\":0,\\"y\\":490}"'),
  }),
  z.object({
    op: z.literal('add_component'),
    target,
    id: z.string(),
    component: z.string(),
    propsJson: z.string().describe('JSON object with the fields to set; omitted fields use defaults. "{}" for all defaults'),
  }),
  z.object({
    op: z.literal('remove_component'),
    target,
    id: z.string(),
    component: z.string(),
  }),
  z.object({
    op: z.literal('set_transform'),
    entityId: z.string(),
    x: z.number().nullable(),
    y: z.number().nullable(),
    rotation: z.number().nullable(),
    scaleX: z.number().nullable(),
    scaleY: z.number().nullable(),
  }),
  z.object({
    op: z.literal('rename'),
    target,
    id: z.string(),
    name: z.string(),
  }),
  z.object({
    op: z.literal('set_tags'),
    target,
    id: z.string(),
    tags: z.array(z.string()),
  }),
  z.object({
    op: z.literal('set_world'),
    sceneId: z.string(),
    gravityX: z.number().nullable(),
    gravityY: z.number().nullable(),
    backgroundColor: z.string().nullable(),
  }),
  z.object({
    op: z.literal('set_background'),
    sceneId: z.string(),
    color: z.string().nullable().describe('Background color "#rrggbb", or null to keep'),
    fit: z.enum(['cover', 'tile']).nullable().describe('cover: image fills the view height and repeats sideways; tile: repeats at its own size'),
    parallax: z.number().nullable().describe('0 = background stays fixed on screen, 1 = moves exactly with the level; 0.2-0.6 gives depth'),
    removeImage: z.boolean().describe('true to remove the background image and show only the color'),
  }),
  z.object({
    op: z.literal('create_definition'),
    ref: z.string().describe('Temporary name for this new object, usable as definitionRef in a later place_instance'),
    name: z.string(),
    description: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    components: z.array(z.object({ component: z.string(), propsJson: z.string() })),
  }),
  z.object({
    op: z.literal('place_instance'),
    sceneId: z.string(),
    definitionRef: z.string().describe('An existing definition id, or the ref of a create_definition earlier in this list'),
    x: z.number(),
    y: z.number(),
    name: z.string().nullable(),
    ref: z.string().nullable().describe('Temporary name for the placed entity, usable as an entity id in later relationships/rules in this list; null if not needed'),
  }),
  z.object({
    op: z.literal('draw_sprite'),
    target,
    id: z.string().describe('Entity id (instance) or object definition id (definition) whose look this becomes'),
    name: z.string().describe('Short name for the image, e.g. "Spikes"'),
    palette: z.array(z.object({ key: z.string().describe('One letter or digit (never a quote, backslash or space)'), color: z.string().describe('"#rrggbb"') })).describe('"." is transparent and is not listed'),
    rows: z.array(z.string()).describe('Pixel rows, top to bottom, all the same length; use the grid size given for the object (same proportions as the object)'),
    situation: z
      .enum(['run', 'jump', 'fall', 'climb', 'hang', 'hurt', 'shoot', 'up', 'down'])
      .nullable()
      .describe('null: the normal look. A situation: an extra image shown only while that happens (e.g. "jump" for a jumping sprite); the normal look stays'),
  }),
  z.object({
    op: z.literal('make_sound'),
    name: z.string().describe('Short name scripts play it by, e.g. "Quack", "Boing" (unique among sounds)'),
    description: z.string().describe('What it sounds like, in plain words'),
    soundJson: z.string().describe('The sound recipe as JSON: {"volume":0.8,"layers":[…]} (see "Sounds")'),
    replaceId: z.string().nullable().describe('An existing sound asset id to remake (keeps its name unless a new one is given, so scripts playing it keep working); null for a new sound'),
  }),
  z.object({
    op: z.literal('draw_tiles'),
    sceneId: z.string(),
    definitionRef: z.string().describe('An existing definition id, or the ref of a create_definition earlier in this list'),
    rects: z
      .array(z.object({ col: z.number().int(), row: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) }))
      .describe('Rectangles of 32px level cells to fill, one copy per cell (a row of ground: height 1)'),
  }),
  z.object({
    op: z.literal('build_path'),
    sceneId: z.string(),
    start: z
      .object({ col: z.number().int(), row: z.number().int() })
      .nullable()
      .describe('The cell the player stands in where the route begins: a "_" cell of the level map. null = where the player starts'),
    direction: z.enum(['right', 'left']).describe('Which way the route goes from its start (a level can branch both ways from the player)'),
    floor: z.string().describe('The solid tile the route is built of (an object id, name or create_definition ref; e.g. Platform or Stone)'),
    ladder: z.string().nullable().describe('The ladder object for climb steps (id, name or ref); null = the library Ladder'),
    steps: z
      .array(
        z.discriminatedUnion('do', [
          z.object({ do: z.literal('run'), cells: z.number().int().describe('Floor this many cells long, going right') }),
          z.object({ do: z.literal('jump'), gap: z.number().int().describe('Empty cells to jump over (0 with a negative rise: a step down)'), rise: z.number().int().describe('Rows higher the landing is (negative: lower)') }),
          z.object({ do: z.literal('climb'), rows: z.number().int().describe('A ladder this many rows high; the route continues on a platform at its top') }),
          z.object({ do: z.literal('hazard'), object: z.string().describe('Hazard object (id, name or ref)'), cells: z.number().int().describe('Cells of hazards on the floor, to jump over') }),
          z.object({ do: z.literal('put'), object: z.string().describe('Object to stand on the floor here (key, coin, door, switch, enemy, goal…; id, name or ref)'), name: z.string().nullable(), ref: z.string().nullable().describe('Temporary name to use it in later relationships/rules; null if not needed') }),
        ]),
      )
      .describe('The way through, in order, left to right'),
  }),
  z.object({
    op: z.literal('erase_area'),
    sceneId: z.string(),
    col: z.number().int(),
    row: z.number().int(),
    width: z.number().int().min(1),
    height: z.number().int().min(1),
    definitionRef: z.string().nullable().describe('Only remove copies of this object; null removes everything in the area'),
  }),
  z.object({
    op: z.literal('create_relationship'),
    sceneId: z.string(),
    relationshipJson: z.string().describe('JSON {"type", "source": EntityRef, "target": EntityRef, "params": {}, "conditions": [Condition]}'),
  }),
  z.object({
    op: z.literal('update_relationship'),
    sceneId: z.string(),
    id: z.string(),
    patchJson: z.string().describe('JSON with any of "params", "conditions", "source", "target" (each replaces the old value)'),
  }),
  z.object({
    op: z.literal('remove_relationship'),
    sceneId: z.string(),
    id: z.string(),
  }),
  z.object({
    op: z.literal('create_rule'),
    sceneId: z.string(),
    ruleJson: z.string().describe('JSON {"name", "when": {"event", "subject": EntityRef, "other": EntityRef}, "conditions": [Condition], "actions": [Action]}'),
  }),
  z.object({
    op: z.literal('remove_rule'),
    sceneId: z.string(),
    id: z.string(),
  }),
  z.object({
    op: z.literal('set_editor_setting'),
    key: z.string().describe('An editor setting key from editor.settings (editor scope only)'),
    valueJson: z.string().describe('The new value as JSON, e.g. "\\"bottom\\"", "true", "1.5"'),
  }),
  z.object({
    op: z.literal('add_editor_overlay'),
    overlayJson: z.string().describe('JSON {"kind":"info"|"jump_reach","target":EntityRef,"show":[metric keys or "Component.field"]} - information drawn over the level while editing'),
  }),
  z.object({
    op: z.literal('remove_editor_overlay'),
    id: z.string().describe('Overlay id from editor.overlays'),
  }),
  z.object({
    op: z.literal('set_camera'),
    sceneId: z.string(),
    cameraJson: z.string().describe('JSON with only the camera settings to change, e.g. {"zoom":1.5,"bounds":"level"} (see level.camera)'),
  }),
  z.object({
    op: z.literal('set_script'),
    target,
    id: z.string().describe('Object definition id (definition: every copy runs it) or entity id (instance: only this one); also a create_definition / place_instance ref from earlier in this list'),
    scriptJson: z.string().describe('The whole behavior script as JSON (see "Behavior scripts"). Same "id" as an existing script of that owner replaces it; a new id (or none) adds one'),
  }),
  z.object({
    op: z.literal('remove_script'),
    target,
    id: z.string(),
    scriptId: z.string(),
  }),
  z.object({
    op: z.literal('set_script_enabled'),
    target,
    id: z.string(),
    scriptId: z.string(),
    enabled: z.boolean(),
  }),
  z.object({
    op: z.literal('set_rule_enabled'),
    sceneId: z.string(),
    id: z.string(),
    enabled: z.boolean(),
  }),
]);

export type Operation = z.infer<typeof operationSchema>;

/** Operations that change the editor rather than the project. */
export type EditorOperation = Extract<Operation, { op: 'set_editor_setting' | 'add_editor_overlay' | 'remove_editor_overlay' }>;

export function isEditorOperation(op: Operation): op is EditorOperation {
  return op.op === 'set_editor_setting' || op.op === 'add_editor_overlay' || op.op === 'remove_editor_overlay';
}

export interface ApplyResult {
  createdDefinitionIds: Id[];
  createdEntityIds: Id[];
  createdRelationshipIds: Id[];
  createdRuleIds: Id[];
  removedEntityIds: Id[];
  createdAssetIds: Id[];
}

/** Largest number of cells one draw_tiles may fill. */
const MAX_DRAW_CELLS = 3000;

/**
 * Replaces temporary names from earlier operations in this list with the real
 * ids: {"kind":"entity","id":<place ref>}, {"kind":"object","id":<definition ref>}
 * and a spawn action's "object".
 */
function substituteRefs(value: unknown, entities: Map<string, Id>, objects: Map<string, Id>): unknown {
  if (Array.isArray(value)) return value.map((v) => substituteRefs(v, entities, objects));
  if (typeof value !== 'object' || value === null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = substituteRefs(v, entities, objects);
  if (out.kind === 'entity' && typeof out.id === 'string') out.id = entities.get(out.id) ?? out.id;
  if (out.kind === 'object' && typeof out.id === 'string') out.id = objects.get(out.id) ?? out.id;
  if (out.type === 'spawn' && typeof out.object === 'string') out.object = objects.get(out.object) ?? out.object;
  // Script statements that name a library object.
  if ((out.do === 'spawn' || out.do === 'shoot') && typeof out.object === 'string') out.object = objects.get(out.object) ?? out.object;
  return out;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new m.ModelError(`${what} is not valid JSON`);
  }
}

function parseProps(text: string, what: string): Record<string, unknown> {
  const value = parseJson(text, what);
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new m.ModelError(`${what} must be a JSON object`);
  return value as Record<string, unknown>;
}

function sceneOfEntity(project: Project, entityId: Id): Id {
  const scene = project.scenes.find((s) => s.entities.some((e) => e.id === entityId));
  if (!scene) throw new m.ModelError(`There is no placed object with id "${entityId}" (use the ids in targets and otherEntities of this level; to add something, place_instance its object)`);
  return scene.id;
}

/**
 * Tries the operations on a copy of the project: the first problem, or null
 * when all of them would apply. Nothing is changed.
 */
export function checkOperations(project: Project, ops: Operation[], registry: ComponentRegistry): string | null {
  const game = ops.filter((op) => !isEditorOperation(op));
  if (!game.length) return null;
  try {
    produce(project, (d) => {
      applyOperations(d, game, registry);
    });
    return null;
  } catch (e) {
    if (e instanceof m.ModelError) return e.message;
    throw e;
  }
}

/**
 * Tile objects (placement "tile": Platform, Stone, Ladder…) sit on whole level
 * cells, as the pen and dragging put them; an AI position in between is moved
 * to the nearest cell, so every piece can be dragged on the grid afterwards.
 */
function onGrid(def: ObjectDefinition, p: Vec2): Vec2 {
  if (def.metadata.placement !== 'tile') return p;
  const size = (def.components.Sprite as { width?: number; height?: number } | undefined) ?? {};
  const cell = cellSize({ x: Number(size.width) || LEVEL_CELL, y: Number(size.height) || LEVEL_CELL }, LEVEL_CELL);
  const near = (v: number, c: number) => Math.round((v - c / 2) / c) * c + c / 2;
  return { x: near(p.x, cell.x), y: near(p.y, cell.y) };
}

/**
 * Things the AI put partly into the ground (a door half a tile into the
 * floor, a coin inside a platform's top) are lifted onto the surface. Only new
 * things, only non-tiles, and only when no more than half of it is sunk in:
 * anything placed clearly in the air or clearly inside a wall stays.
 */
function settleOnSurfaces(project: Project, created: Id[], registry: ComponentRegistry): void {
  if (!created.length) return;
  const fresh = new Set(created);
  for (const scene of project.scenes) {
    const mine = scene.entities.filter((e) => fresh.has(e.id));
    // Seen from above nothing stands on anything: things stay where they are put.
    if (!mine.length || isTopDownScene(project, scene, registry)) continue;
    const box = (e: (typeof scene.entities)[number]) => {
      const r = resolveEntity(project, e, registry);
      const col = r.components.Collider;
      const s = col && typeof col.size === 'object' && col.size ? (col.size as Vec2) : getEntitySize(r);
      const w = s.x * Math.abs(e.transform.scale.x);
      const h = (col?.shape === 'circle' ? s.x : s.y) * Math.abs(e.transform.scale.y);
      return { r, left: e.transform.position.x - w / 2, right: e.transform.position.x + w / 2, top: e.transform.position.y - h / 2, bottom: e.transform.position.y + h / 2, h };
    };
    const solids = scene.entities
      .filter((e) => !fresh.has(e.id) || project.definitions.find((d) => d.id === e.definitionId)?.metadata.placement === 'tile')
      .map(box)
      .filter((b) => b.r.components.Collider && b.r.components.Collider.isTrigger !== true && b.r.components.PhysicsBody?.bodyType !== 'dynamic');
    for (const e of mine) {
      if (project.definitions.find((d) => d.id === e.definitionId)?.metadata.placement === 'tile') continue;
      const b = box(e);
      let lift = 0;
      for (const s of solids) {
        if (s.r.id === e.id || Math.min(b.right, s.right) - Math.max(b.left, s.left) <= 2) continue;
        const sunk = b.bottom - s.top;
        if (sunk > 1 && b.top < s.top && sunk <= b.h / 2 + 1) lift = Math.max(lift, sunk);
      }
      if (lift) {
        e.transform.position = { ...e.transform.position, y: e.transform.position.y - lift };
        continue;
      }
      // Doors, switches and spikes stand on something, and things that fall (enemies, the player) would fall at once:
      // one placed in the air drops onto the first surface below it.
      const c = b.r.components;
      const falls = c.PhysicsBody?.bodyType === 'dynamic' && c.PhysicsBody.gravityScale !== 0;
      const moves = c.PhysicsBody?.bodyType === 'dynamic' || c.Patrol || c.Wander || c.MovingPlatform || c.CharacterController || b.r.scripts.length > 0;
      if (!falls && (moves || !(c.Openable || c.Switch || c.Damage))) continue;
      const near = (a: number, z: number) => Math.abs(a - z) <= 3;
      const supported = solids.some((s) => s.r.id !== e.id && Math.min(b.right, s.right) - Math.max(b.left, s.left) > 1 && (near(b.bottom, s.top) || near(b.top, s.bottom) || (Math.min(b.bottom, s.bottom) - Math.max(b.top, s.top) > 1)))
        || solids.some((s) => s.r.id !== e.id && Math.min(b.bottom, s.bottom) - Math.max(b.top, s.top) > 1 && (near(b.right, s.left) || near(b.left, s.right)));
      if (supported) continue;
      const below = solids
        .filter((s) => s.r.id !== e.id && Math.min(b.right, s.right) - Math.max(b.left, s.left) > 1 && s.top >= b.bottom && s.top - b.bottom <= 12 * LEVEL_CELL)
        .sort((x, y) => x.top - y.top)[0];
      if (below) e.transform.position = { ...e.transform.position, y: e.transform.position.y + (below.top - b.bottom) };
    }
  }
}

/** A placeholder color that says what kind of thing it is (hazards and enemies reddish, items gold, ground grey…). */
function placeholderColor(category: string, tags: string[]): string {
  const has = (...t: string[]) => tags.some((x) => t.includes(x.toLowerCase()));
  if (has('hazard', 'spikes', 'spike', 'lava', 'trap')) return '#d9dde6';
  if (has('enemy') || category === 'Enemies') return '#e5534b';
  if (has('collectible', 'coin', 'item', 'key') || category === 'Items') return '#f2c94c';
  if (has('platform', 'ground', 'wall') || category === 'Platforms') return '#8a8f9c';
  if (has('water')) return '#3b82f6';
  return '#b48cf2';
}

/**
 * Applies operations in order to a draft project. Throws ModelError on the
 * first invalid operation; callers run this inside one immer `produce`, so a
 * failure leaves the project untouched.
 */
export function applyOperations(
  project: Project,
  ops: Operation[],
  registry: ComponentRegistry,
  /** When given, an invalid operation is reported here and skipped instead of failing the whole list. */
  onInvalid?: (index: number, message: string) => void,
): ApplyResult {
  const refs = new Map<string, Id>();
  const entityRefs = new Map<string, Id>();
  const result: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [], createdRelationshipIds: [], createdRuleIds: [], removedEntityIds: [], createdAssetIds: [] };
  const logicJson = (text: string, what: string) => substituteRefs(parseProps(text, what), entityRefs, refs) as Record<string, unknown>;

  const applyOne = (given: Operation): void => {
    // A new object or entity made earlier in this list can be named by its ref ("make a Mushroom and draw it").
    let op = given;
    if ('target' in op && 'id' in op && typeof op.id === 'string') {
      const id = op.target === 'definition' ? refs.get(op.id) : entityRefs.get(op.id);
      if (id) op = { ...op, id } as Operation;
    }
    if (op.op === 'set_transform' && entityRefs.has(op.entityId)) op = { ...op, entityId: entityRefs.get(op.entityId)! };
    switch (op.op) {
      case 'set_component_field': {
        const value = parseJson(op.valueJson, `${op.component}.${op.field} value`);
        if (op.target === 'definition') m.setDefinitionComponentField(project, op.id, op.component, op.field, value, registry);
        else m.setEntityComponentField(project, sceneOfEntity(project, op.id), op.id, op.component, op.field, value, registry);
        break;
      }
      case 'add_component': {
        const props = parseProps(op.propsJson, `${op.component} props`);
        if (op.target === 'definition') m.addDefinitionComponent(project, op.id, op.component, registry, props);
        else m.addEntityComponent(project, sceneOfEntity(project, op.id), op.id, op.component, registry, props);
        break;
      }
      case 'remove_component':
        if (op.target === 'definition') m.removeDefinitionComponent(project, op.id, op.component);
        else m.removeEntityComponent(project, sceneOfEntity(project, op.id), op.id, op.component);
        break;
      case 'set_transform': {
        const entity = m.getEntity(project, sceneOfEntity(project, op.entityId), op.entityId);
        const t = entity.transform;
        const def = entity.definitionId ? project.definitions.find((d) => d.id === entity.definitionId) : undefined;
        const position = { x: op.x ?? t.position.x, y: op.y ?? t.position.y };
        m.setEntityTransform(project, sceneOfEntity(project, op.entityId), op.entityId, {
          position: def ? onGrid(def, position) : position,
          rotation: op.rotation ?? t.rotation,
          scale: { x: op.scaleX ?? t.scale.x, y: op.scaleY ?? t.scale.y },
        });
        break;
      }
      case 'rename':
        if (op.target === 'definition') m.renameDefinition(project, op.id, op.name);
        else m.renameEntity(project, sceneOfEntity(project, op.id), op.id, op.name);
        break;
      case 'set_tags':
        if (op.target === 'definition') m.setDefinitionTags(project, op.id, op.tags);
        else m.setEntityTags(project, sceneOfEntity(project, op.id), op.id, op.tags);
        break;
      case 'set_world': {
        const scene = m.getScene(project, op.sceneId);
        m.setWorldSettings(project, op.sceneId, {
          gravity: { x: op.gravityX ?? scene.world.gravity.x, y: op.gravityY ?? scene.world.gravity.y },
          ...(op.backgroundColor !== null ? { backgroundColor: op.backgroundColor } : {}),
        });
        break;
      }
      case 'set_background': {
        if (op.color !== null) m.setWorldSettings(project, op.sceneId, { backgroundColor: op.color });
        m.setBackground(project, op.sceneId, {
          ...(op.fit !== null ? { fit: op.fit } : {}),
          ...(op.parallax !== null ? { parallax: op.parallax } : {}),
          ...(op.removeImage ? { imageAssetId: null } : {}),
        });
        break;
      }
      case 'create_definition': {
        const components: Record<string, Record<string, unknown>> = {};
        for (const c of op.components) {
          if (!registry.has(c.component)) throw new m.ModelError(`Unknown component type "${c.component}"`);
          components[c.component] = registry.createDefault(c.component, parseProps(c.propsJson, `${c.component} props`));
        }
        // Nothing is invisible by accident: without a Sprite it gets a placeholder box the size of its collider
        // (a drawing in the same answer replaces it). An invisible object is a Sprite with visible false.
        if (!components.Sprite) {
          const size = (components.Collider?.size as { x: number; y: number } | undefined) ?? { x: 32, y: 32 };
          components.Sprite = registry.createDefault('Sprite', { width: size.x, height: size.y, color: placeholderColor(op.category, op.tags) });
        }
        const def = createDefinition(op.name, components, op.tags, op.description);
        def.metadata.category = op.category;
        m.addDefinition(project, def, registry);
        refs.set(op.ref, def.id);
        result.createdDefinitionIds.push(def.id);
        break;
      }
      case 'place_instance': {
        const defId = refs.get(op.definitionRef) ?? op.definitionRef;
        const def = m.getDefinition(project, defId);
        const entity = instantiateDefinition(def, onGrid(def, { x: op.x, y: op.y }), op.name ?? def.name);
        m.addEntity(project, op.sceneId, entity);
        if (op.ref) entityRefs.set(op.ref, entity.id);
        result.createdEntityIds.push(entity.id);
        break;
      }
      case 'make_sound': {
        const parsed = parseSoundRecipe(op.soundJson);
        if ('error' in parsed) throw new m.ModelError(parsed.error);
        const name = op.name.trim() || 'Sound';
        if (op.replaceId) {
          const old = project.assets.find((a) => a.id === op.replaceId && a.kind === 'sound');
          if (!old) throw new m.ModelError(`There is no sound "${op.replaceId}" to remake`);
          old.synth = parsed.recipe;
          old.data = soundDataUrl(parsed.recipe);
          old.name = name;
          old.description = op.description;
          result.createdAssetIds.push(old.id);
        } else {
          if (project.assets.some((a) => a.kind === 'sound' && a.name.toLowerCase() === name.toLowerCase())) {
            throw new m.ModelError(`There is already a sound called "${name}": remake it with replaceId, or give the new one another name`);
          }
          const id = generateId('snd');
          m.addAsset(project, { id, name, kind: 'sound', path: `assets/${id}.sound.json`, data: soundDataUrl(parsed.recipe), width: 0, height: 0, synth: parsed.recipe, description: op.description });
          result.createdAssetIds.push(id);
        }
        break;
      }
      case 'draw_sprite': {
        const entity = op.target === 'instance' ? m.getEntity(project, sceneOfEntity(project, op.id), op.id) : instantiateDefinition(m.getDefinition(project, op.id), { x: 0, y: 0 });
        const size = getEntitySize(resolveEntity(project, entity, registry));
        // Usual notation slips (a color for ".", spaces for empty pixels, colors without "#"…) are forgiven, not rejected.
        const drawn = normalizePixelArt({ palette: op.palette, rows: op.rows });
        const err = checkPixelArt(drawn);
        if (err) throw new m.ModelError(`Sprite: ${err}`);
        // Other proportions than the object's are fitted (repeated or padded), not rejected.
        const art = fitPixelArt(drawn, size);
        const asset = { ...createImageAsset(op.name.trim() || 'Sprite', svgDataUrl(pixelArtToSvg(art)), art.rows[0].length, art.rows.length, 'svg'), pixelArt: { palette: art.palette.map((p) => ({ ...p })), rows: [...art.rows] } };
        m.addAsset(project, asset);
        const situation = op.situation ?? null;
        if (situation) {
          // An extra image for one situation: the normal look stays as it is.
          if (op.target === 'definition') {
            const def = m.getDefinition(project, op.id);
            if (!def.components.SpriteStates) m.addDefinitionComponent(project, op.id, 'SpriteStates', registry);
            m.setDefinitionComponentField(project, op.id, 'SpriteStates', situation, asset.id, registry);
            m.addDefinitionSprite(project, op.id, { assetId: asset.id, frame: 1 });
          } else {
            const sceneId = sceneOfEntity(project, op.id);
            if (!resolveEntity(project, entity, registry).components.SpriteStates) m.addEntityComponent(project, sceneId, op.id, 'SpriteStates', registry);
            m.setEntityComponentField(project, sceneId, op.id, 'SpriteStates', situation, asset.id, registry);
          }
        } else if (op.target === 'definition') m.useDefinitionSprite(project, op.id, { assetId: asset.id, frame: 1 }, registry);
        else {
          const sceneId = sceneOfEntity(project, op.id);
          if (!resolveEntity(project, entity, registry).components.Sprite) m.addEntityComponent(project, sceneId, op.id, 'Sprite', registry, { width: size.x, height: size.y });
          m.setEntityComponentField(project, sceneId, op.id, 'Sprite', 'assetId', asset.id, registry);
          m.setEntityComponentField(project, sceneId, op.id, 'Sprite', 'frame', 1, registry);
        }
        result.createdAssetIds.push(asset.id);
        break;
      }
      case 'draw_tiles': {
        const defId = refs.get(op.definitionRef) ?? op.definitionRef;
        const def = m.getDefinition(project, defId);
        const scene = m.getScene(project, op.sceneId);
        const size = getEntitySize(resolveEntity(project, instantiateDefinition(def, { x: 0, y: 0 }), registry));
        const cells = op.rects.reduce((n, r) => n + r.width * r.height, 0);
        if (cells > MAX_DRAW_CELLS) throw new m.ModelError(`draw_tiles: ${cells} cells is too many at once (max ${MAX_DRAW_CELLS})`);
        const taken = new Set(scene.entities.filter((e) => e.definitionId === defId).map((e) => `${Math.round(e.transform.position.x)},${Math.round(e.transform.position.y)}`));
        // An object bigger than a cell (a 64×32 block, a 32×64 door) takes several cells: copies go side by side
        // every `step` cells, not one per cell on top of each other. Each sits on the bottom of its block of cells.
        const step = { x: Math.max(1, Math.round(size.x / LEVEL_CELL)), y: Math.max(1, Math.round(size.y / LEVEL_CELL)) };
        for (const r of op.rects) {
          const across = Math.max(1, Math.floor(r.width / step.x));
          const down = Math.max(1, Math.floor(r.height / step.y));
          for (let i = 0; i < across; i++) {
            for (let j = 0; j < down; j++) {
              const col = r.col + i * step.x;
              const bottomRow = r.row + r.height - 1 - j * step.y;
              const pos = { x: col * LEVEL_CELL + (step.x * LEVEL_CELL) / 2, y: (bottomRow + 1) * LEVEL_CELL - size.y / 2 };
              const key = `${Math.round(pos.x)},${Math.round(pos.y)}`;
              if (taken.has(key)) continue;
              taken.add(key);
              const entity = instantiateDefinition(def, pos);
              m.addEntity(project, op.sceneId, entity);
              result.createdEntityIds.push(entity.id);
            }
          }
        }
        break;
      }
      case 'build_path': {
        const byName = (x: string) => project.definitions.find((d) => d.name.toLowerCase() === x.trim().toLowerCase());
        const resolveDef = (x: string) => {
          const id = refs.get(x) ?? x;
          const d = project.definitions.find((q) => q.id === id) ?? byName(x);
          if (!d) throw new m.ModelError(`build_path: there is no object "${x}"`);
          return d;
        };
        buildPath(project, { sceneId: op.sceneId, start: op.start, direction: op.direction, floor: op.floor, ladder: op.ladder, steps: op.steps }, registry, resolveDef, (id, ref) => {
          result.createdEntityIds.push(id);
          if (ref) entityRefs.set(ref, id);
        });
        break;
      }
      case 'erase_area': {
        const scene = m.getScene(project, op.sceneId);
        const defId = op.definitionRef === null ? null : (refs.get(op.definitionRef) ?? op.definitionRef);
        const x0 = op.col * LEVEL_CELL;
        const y0 = op.row * LEVEL_CELL;
        const gone = scene.entities
          .filter((e) => (defId === null || e.definitionId === defId) && e.transform.position.x >= x0 && e.transform.position.x < x0 + op.width * LEVEL_CELL && e.transform.position.y >= y0 && e.transform.position.y < y0 + op.height * LEVEL_CELL)
          .map((e) => e.id);
        m.removeEntities(project, op.sceneId, gone);
        result.removedEntityIds.push(...gone);
        break;
      }
      case 'create_relationship': {
        const id = logic.addRelationship(project, op.sceneId, logicJson(op.relationshipJson, 'Relationship') as unknown as Parameters<typeof logic.addRelationship>[2]);
        result.createdRelationshipIds.push(id);
        break;
      }
      case 'update_relationship': {
        const patch = logicJson(op.patchJson, 'Relationship change');
        const allowed = ['params', 'conditions', 'source', 'target'];
        const extra = Object.keys(patch).find((k) => !allowed.includes(k));
        if (extra) throw new m.ModelError(`Relationship change cannot set "${extra}" (only ${allowed.join(', ')})`);
        logic.updateRelationship(project, op.sceneId, op.id, patch);
        break;
      }
      case 'remove_relationship':
        logic.removeRelationship(project, op.sceneId, op.id);
        break;
      case 'create_rule': {
        const id = logic.addRule(project, op.sceneId, logicJson(op.ruleJson, 'Rule') as unknown as Parameters<typeof logic.addRule>[2]);
        result.createdRuleIds.push(id);
        break;
      }
      case 'remove_rule':
        logic.removeRule(project, op.sceneId, op.id);
        break;
      case 'set_camera':
        m.setCameraSettings(project, op.sceneId, parseProps(op.cameraJson, 'Camera settings'));
        break;
      case 'set_script':
      case 'remove_script':
      case 'set_script_enabled': {
        const owner = { target: op.target, id: op.target === 'definition' ? (refs.get(op.id) ?? op.id) : (entityRefs.get(op.id) ?? op.id) };
        if (op.op === 'set_script') scripts.setScript(project, owner, logicJson(op.scriptJson, 'Script'));
        else if (op.op === 'remove_script') scripts.removeScript(project, owner, op.scriptId);
        else scripts.setScriptEnabled(project, owner, op.scriptId, op.enabled);
        break;
      }
      case 'set_rule_enabled':
        logic.setRuleEnabled(project, op.sceneId, op.id, op.enabled);
        break;
      case 'set_editor_setting':
      case 'add_editor_overlay':
      case 'remove_editor_overlay':
        // Editor settings are not part of the game; the editor applies them (see isEditorOperation).
        throw new m.ModelError('Editor settings cannot be changed together with the game');
    }
  };

  ops.forEach((op, i) => {
    if (!onInvalid) return applyOne(op);
    try {
      applyOne(op);
    } catch (e) {
      if (!(e instanceof m.ModelError)) throw e;
      onInvalid(i, e.message);
    }
  });
  settleOnSurfaces(project, result.createdEntityIds, registry);
  return result;
}

/**
 * The operations that apply, without the ones that don't (and what was wrong
 * with each): for a big change where a few parts fail, the rest still goes in.
 */
export function pruneOperations(project: Project, ops: Operation[], registry: ComponentRegistry): { kept: Operation[]; skipped: string[] } {
  const bad = new Map<number, string>();
  produce(project, (d) => {
    applyOperations(d, ops, registry, (i, message) => bad.set(i, message));
  });
  return { kept: ops.filter((_, i) => !bad.has(i)), skipped: [...bad.values()] };
}
