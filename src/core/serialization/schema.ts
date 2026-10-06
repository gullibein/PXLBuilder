import { z } from 'zod';
import { relationshipSchema, ruleSchema } from '../logic/vocabulary';
import { cameraSchema } from '../model/camera';
import { scriptSchema } from '../script/language';

/** Structural schemas for the current format version (component props are checked against the component registry separately). */

const vec2 = z.object({ x: z.number().finite(), y: z.number().finite() });
const id = z.string().min(1);
const componentMap = z.record(z.string(), z.record(z.string(), z.unknown()));

export const transformSchema = z.object({
  position: vec2,
  rotation: z.number().finite(),
  scale: vec2,
});

export const entitySchema = z.object({
  id,
  name: z.string(),
  definitionId: id.nullable(),
  transform: transformSchema,
  components: componentMap,
  removedComponents: z.array(z.string()),
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  scripts: z.array(scriptSchema).optional(),
});

export const sceneSchema = z.object({
  id,
  name: z.string(),
  world: z.object({
    gravity: vec2,
    backgroundColor: z.string(),
    background: z.object({ imageAssetId: id.nullable(), fit: z.enum(['cover', 'tile']), parallax: z.number().min(0).max(1) }),
  }),
  entities: z.array(entitySchema),
  relationships: z.array(relationshipSchema),
  rules: z.array(ruleSchema),
  camera: cameraSchema,
});

export const definitionSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  components: componentMap,
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
  scripts: z.array(scriptSchema).optional(),
});

export const assetSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(['image', 'spritesheet', 'sound', 'music']),
  path: z.string(),
  data: z.string().startsWith('data:'),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  grid: z
    .object({
      columns: z.number().int().positive(),
      rows: z.number().int().positive(),
      cellWidth: z.number().positive(),
      cellHeight: z.number().positive(),
      offsetX: z.number().nonnegative(),
      offsetY: z.number().nonnegative(),
      spacingX: z.number().nonnegative(),
      spacingY: z.number().nonnegative(),
    })
    .optional(),
  pixelArt: z.object({ palette: z.array(z.object({ key: z.string(), color: z.string() })), rows: z.array(z.string()) }).optional(),
});

export const projectSchema = z.object({
  formatVersion: z.number().int(),
  id,
  name: z.string(),
  settings: z.object({ gridSize: z.number().int().positive() }),
  startSceneId: id,
  scenes: z.array(sceneSchema).min(1),
  definitions: z.array(definitionSchema),
  assets: z.array(assetSchema),
});

/** project.json: the project index. Scenes and object definitions live in their own files. */
export const projectIndexSchema = z.object({
  formatVersion: z.number().int(),
  id,
  name: z.string(),
  settings: z.unknown(),
  startSceneId: id,
  scenes: z.array(z.object({ id, name: z.string(), file: z.string() })),
  objects: z.array(z.object({ id, name: z.string(), file: z.string() })),
  assets: z.array(z.unknown()),
});
