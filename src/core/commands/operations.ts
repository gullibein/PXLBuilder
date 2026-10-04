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
import * as m from '../model/mutations';
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
  }),
]);

export type Operation = z.infer<typeof operationSchema>;

export interface ApplyResult {
  createdDefinitionIds: Id[];
  createdEntityIds: Id[];
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
  const result: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [] };

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
        result.createdEntityIds.push(entity.id);
        break;
      }
    }
  }
  return result;
}
