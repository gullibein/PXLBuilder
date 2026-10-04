import { z } from 'zod';

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
});

export const sceneSchema = z.object({
  id,
  name: z.string(),
  world: z.object({ gravity: vec2, backgroundColor: z.string() }),
  entities: z.array(entitySchema),
});

export const definitionSchema = z.object({
  id,
  name: z.string(),
  description: z.string(),
  components: componentMap,
  tags: z.array(z.string()),
  metadata: z.record(z.string(), z.unknown()),
});

export const assetSchema = z.object({
  id,
  name: z.string(),
  kind: z.enum(['image', 'spritesheet', 'sound', 'music']),
  path: z.string(),
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
