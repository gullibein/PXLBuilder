import { instrumentSchema, songSchema } from '../audio/music';
import { gameSoundSchema } from '../audio/sound';
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

/** A random level's recipe (Scene.generator). */
const spawnSchema = z.object({ object: id, weight: z.number(), fromFloor: z.number() });
const generatorSchema = z.object({
  style: z.enum(['rooms', 'caves', 'maze']).optional(),
  seed: z.number().nullable(),
  preview: z.number(),
  previewFloor: z.number(),
  width: z.number(),
  height: z.number(),
  rooms: z.number(),
  roomMin: z.number(),
  roomMax: z.number(),
  corridor: z.number(),
  loops: z.number(),
  wall: id.nullable(),
  floor: id.nullable(),
  stairs: id.nullable(),
  monsters: z.array(spawnSchema),
  monsterCount: z.number(),
  monstersPerFloor: z.number(),
  loot: z.array(spawnSchema),
  lootCount: z.number(),
  lootPerFloor: z.number(),
  door: id.nullable().optional(),
  key: id.nullable().optional(),
  lockFromFloor: z.number().optional(),
  templates: z.array(id).optional(),
  templateChance: z.number().optional(),
});

export const sceneSchema = z.object({
  id,
  name: z.string(),
  world: z.object({
    gravity: vec2,
    backgroundColor: z.string(),
    background: z.object({
      imageAssetId: id.nullable(),
      fit: z.enum(['cover', 'tile', 'placed']),
      parallax: z.number().min(0).max(1),
      parallaxY: z.number().min(0).max(1).nullable().optional(),
      rect: z.object({ x: z.number().finite(), y: z.number().finite(), w: z.number().positive(), h: z.number().positive() }).nullable().optional(),
      scroll: vec2.nullable().optional(),
      stars: z.object({ density: z.number().min(0).max(60), speed: vec2, layers: z.number().int().min(1).max(3), color: z.string() }).nullable().optional(),
      gradient: z.object({ top: z.string(), bottom: z.string(), bands: z.number().int().min(0).max(64).optional() }).nullable().optional(),
    }),
    view: z.enum(['flat', 'iso']).optional(),
  }),
  entities: z.array(entitySchema),
  relationships: z.array(relationshipSchema),
  rules: z.array(ruleSchema),
  music: id.nullable().optional(),
  camera: cameraSchema,
  generator: generatorSchema.optional(),
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
  kind: z.enum(['image', 'spritesheet', 'sound', 'music', 'instrument']),
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
  pixelArt: z.object({ palette: z.array(z.object({ key: z.string(), color: z.string() })), rows: z.array(z.string()), frames: z.array(z.array(z.string())).optional() }).optional(),
  animation: z.object({ frames: z.array(z.number().int().positive()).min(1), fps: z.number().positive() }).optional(),
  autotile: z.literal(true).optional(),
  synth: gameSoundSchema.optional(),
  instrument: instrumentSchema.optional(),
  song: songSchema.optional(),
  description: z.string().optional(),
});

export const projectSchema = z.object({
  formatVersion: z.number().int(),
  id,
  name: z.string(),
  settings: z.object({
    gridSize: z.number().int().positive(),
    gameType: z.enum(['platformer', 'topdown']).optional(),
    spriteResolution: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).optional(),
    playPixels: z.number().int().min(0).max(2160).optional(),
    controls: z.record(z.string(), z.array(z.string())).optional(),
  }),
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
