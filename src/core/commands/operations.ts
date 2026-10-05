/**
 * Structured, serializable game operations.
 *
 * This is the vocabulary the AI (and later scripted tools) use to change a
 * project. Operations reference things by stable id, carry values as JSON so
 * they survive any transport, and are applied through the same validated
 * mutation functions the inspector uses. A list of operations is applied
 * all-or-nothing inside one transaction.
 */
import { z } from 'zod';
import type { ComponentRegistry } from '../components/registry';
import { createDefinition, instantiateDefinition } from '../model/factory';
import * as logic from '../logic/mutations';
import { getEntitySize } from '../model/geometry';
import * as m from '../model/mutations';
import { LEVEL_CELL } from '../model/placement';
import { resolveEntity } from '../model/resolve';
import type { Id, Project } from '../types';

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
    op: z.literal('draw_tiles'),
    sceneId: z.string(),
    definitionRef: z.string().describe('An existing definition id, or the ref of a create_definition earlier in this list'),
    rects: z
      .array(z.object({ col: z.number().int(), row: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) }))
      .describe('Rectangles of 32px level cells to fill, one copy per cell (a row of ground: height 1)'),
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
  if (!scene) throw new m.ModelError(`Entity "${entityId}" not found`);
  return scene.id;
}

/**
 * Applies operations in order to a draft project. Throws ModelError on the
 * first invalid operation; callers run this inside one immer `produce`, so a
 * failure leaves the project untouched.
 */
export function applyOperations(project: Project, ops: Operation[], registry: ComponentRegistry): ApplyResult {
  const refs = new Map<string, Id>();
  const entityRefs = new Map<string, Id>();
  const result: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [], createdRelationshipIds: [], createdRuleIds: [], removedEntityIds: [] };
  const logicJson = (text: string, what: string) => substituteRefs(parseProps(text, what), entityRefs, refs) as Record<string, unknown>;

  for (const op of ops) {
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
        m.setEntityTransform(project, sceneOfEntity(project, op.entityId), op.entityId, {
          position: { x: op.x ?? t.position.x, y: op.y ?? t.position.y },
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
        const entity = instantiateDefinition(def, { x: op.x, y: op.y }, op.name ?? def.name);
        m.addEntity(project, op.sceneId, entity);
        if (op.ref) entityRefs.set(op.ref, entity.id);
        result.createdEntityIds.push(entity.id);
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
        for (const r of op.rects) {
          for (let col = r.col; col < r.col + r.width; col++) {
            for (let row = r.row; row < r.row + r.height; row++) {
              // Centered in the cell horizontally, resting on the cell's bottom (so a short spike sits on the ground below).
              const pos = { x: col * LEVEL_CELL + LEVEL_CELL / 2, y: (row + 1) * LEVEL_CELL - size.y / 2 };
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
      case 'set_rule_enabled':
        logic.setRuleEnabled(project, op.sceneId, op.id, op.enabled);
        break;
      case 'set_editor_setting':
      case 'add_editor_overlay':
      case 'remove_editor_overlay':
        // Editor settings are not part of the game; the editor applies them (see isEditorOperation).
        throw new m.ModelError('Editor settings cannot be changed together with the game');
    }
  }
  return result;
}
