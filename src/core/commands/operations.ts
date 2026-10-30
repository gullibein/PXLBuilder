/**
 * Structured, serializable game operations.
 *
 * This is the vocabulary the AI (and later scripted tools) use to change a
 * project. Operations reference things by stable id, carry values as JSON so
 * they survive any transport, and are applied through the same validated
 * mutation functions the inspector uses. A list of operations is applied
 * all-or-nothing inside one transaction.
 */
import { removePanel, setPanel } from '../model/panels';
import { onlyOnTouch, touchHarm } from '../model/ruleScripts';
import { gridFor } from '../model/spriteResolution';
import { produce } from 'immer';
import { z } from 'zod';
import type { ComponentRegistry } from '../components/registry';
import { createAnimatedPixelArtAsset, createDefinition, createLevelFor, instantiateDefinition, MAX_FRAMES } from '../model/factory';
import { buildPath } from './buildPath';
import { soundDataUrl } from '../audio/sound';
import { parseSteps } from '../audio/steps';
import { parseInstrument, parseNoteName, parseSong } from '../audio/music';
import * as music from '../model/music';
import { ENGINE_PARTS, findSong } from '../script/language';
import { generateId } from '../ids';
import { checkPixelArt, fitPixelArt, normalizePixelArt } from '../model/pixelArt';
import * as logic from '../logic/mutations';
import * as scripts from '../script/mutations';
import { getEntitySize, getWorldBounds, type Rect } from '../model/geometry';
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
    fit: z.enum(['cover', 'tile', 'placed']).nullable().describe('cover: image fills the view height and repeats sideways; tile: repeats at its own size; placed: one picture at a place in the level (moved and resized in the editor)'),
    parallax: z.number().nullable().describe('How much the background moves with the level as the camera moves: 0 = stays fixed on screen, 1 = moves exactly with the level; 0.2-0.6 gives depth. Sets both directions (left/right and up/down) unless parallaxY is given'),
    parallaxY: z.number().nullable().describe('Only for the camera moving up and down, when that should differ from left and right (e.g. parallax 0, parallaxY 1: stays on screen sideways, moves with the level up and down); null = as parallax'),
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
    op: z.literal('set_sprite_resolution'),
    resolution: z.union([z.literal(8), z.literal(16), z.literal(32), z.literal(64)]).describe('Art pixels per 32 px tile for the built-in objects: 8 (8×8 sprites, chunky), 16, 32 (as they ship) or 64 (detailed)'),
  }),
  z.object({
    op: z.literal('create_level'),
    ref: z.string().describe('Temporary name for the new level, usable as sceneId in later operations of this list (place_instance, build_path, draw_tiles, set_world, create_rule…)'),
    name: z.string().describe('Its name, e.g. "Level 2" or "The Mines"'),
  }),
  z.object({
    op: z.literal('place_instance'),
    sceneId: z.string(),
    definitionRef: z.string().describe('An existing definition id, or the ref of a create_definition earlier in this list'),
    x: z.number(),
    y: z.number(),
    name: z.string().nullable(),
    ref: z.string().nullable().describe('Temporary name for the placed entity, usable as an entity id in later relationships/rules in this list; null if not needed'),
    onTop: z.boolean().nullable().describe('Where other objects already are: null/false replaces them (deletes what it covers, as placing in the editor does); true puts it on top and keeps them, only when both must really share the square'),
  }),
  z.object({
    op: z.literal('draw_autotile'),
    id: z.string().describe('The library object (definition id) whose autotile pictures these are'),
    palette: z.array(z.object({ key: z.string().describe('One letter or digit'), color: z.string().describe('"#rrggbb"') })).describe('Colors of the tiles sent ("." is transparent and is not listed)'),
    tiles: z
      .array(z.object({ index: z.number().int().describe('Which of the 16 pictures: up 1 + right 2 + down 4 + left 8 for the sides joined to a tile of the same object (0 alone, 15 joined all round)'), rows: z.array(z.string()).describe('Its pixel rows, exactly the autotile grid size') }))
      .describe('The pictures to draw (all 16, or only the ones to change; the others stay)'),
  }),
  z.object({
    op: z.literal('draw_sprite'),
    target,
    id: z.string().describe('Entity id (instance) or object definition id (definition) whose look this becomes'),
    name: z.string().describe('Short name for the image, e.g. "Spikes"'),
    palette: z.array(z.object({ key: z.string().describe('One letter or digit (never a quote, backslash or space)'), color: z.string().describe('"#rrggbb"') })).describe('"." is transparent and is not listed'),
    rows: z.array(z.string()).describe('Pixel rows, top to bottom, all the same length; use the grid size given for the object (same proportions as the object). For an animation: the first frame'),
    frames: z
      .array(z.array(z.string()))
      .nullable()
      .describe('For an animation (a walk cycle, a flickering torch, a spinning coin): the frames AFTER the first, each a list of rows of the same size as rows, with the same palette; it plays rows, then these, over and over. null for a still picture'),
    fps: z.number().nullable().describe('Animation speed in frames per second (walk cycle 6-10, idle breathing 2-4); null = 8'),
    situation: z
      .enum(['run', 'jump', 'fall', 'climb', 'hang', 'hurt', 'shoot', 'defeated', 'up', 'down'])
      .nullable()
      .describe('null: the normal look. A situation: an extra image shown only while that happens (e.g. "jump" for a jumping sprite); the normal look stays'),
  }),
  z.object({
    op: z.literal('make_sound'),
    name: z.string().describe('Short name scripts play it by, e.g. "Quack", "Boing" (unique among sounds)'),
    description: z.string().describe('What it sounds like, in plain words'),
    soundJson: z.string().describe('The sound as JSON: {"type":"steps","speed":8,"notes":[[pitch,wave,volume,effect],…]} (see "Sounds")'),
    replaceId: z.string().nullable().describe('An existing sound asset id to remake (keeps its name unless a new one is given, so scripts playing it keep working); null for a new sound'),
  }),
  z.object({
    op: z.literal('make_instrument'),
    name: z.string().describe('Short name, e.g. "Lead", "Bass", "Kick" (unique among instruments)'),
    description: z.string().describe('What it sounds like, in plain words'),
    instrumentJson: z.string().describe('The instrument as JSON: {"chip":"8bit","wave":"pulse25","attack":0.01,"decay":0.2,"sustain":0.5,"release":0.1,…} (see "Music"). With replaceId, only the fields that change are needed (the rest stay as they are)'),
    replaceId: z.string().nullable().describe('An existing instrument asset id to reshape (keeps its name unless a new one is given, and every field not in instrumentJson); null for a new instrument'),
  }),
  z.object({
    op: z.literal('make_song'),
    name: z.string().describe('Short name, e.g. "Level 1 theme" (unique among songs); scripts play it by this name'),
    description: z.string().describe('What it is like, in plain words'),
    songJson: z.string().describe('The song as JSON: {"bpm":120,"steps":16,"loop":true,"channels":[{"instrument":"Lead"},…],"patterns":[{"name":"A","notes":[[channel,step,pitch,length,velocity],…]}],"order":[0,0,1]} (see "Music")'),
    replaceId: z.string().nullable().describe('An existing song asset id to rewrite; null for a new song'),
  }),
  z.object({
    op: z.literal('edit_song'),
    id: z.string().describe('The song asset id'),
    changesJson: z
      .string()
      .describe(
        'Only what changes, as JSON: {"bpm":…, "steps":…, "loop":…, "order":[…], "channels":[{"index":3,"volume":0.6} (change one), {"instrument":"Cowbell","drum":true} (a new one, at the end), {"index":5,"remove":true}], "patterns":[{"index":0,"channels":[3,4,5],"notes":[[3,0,36,1,1],…]} (replaces the notes of just channels 3-5 in pattern 0; the other channels keep theirs), {"index":2,"notes":[…]} (all of pattern 2\'s notes), {"index":<number of patterns>,"name":"C","notes":[…]} (a new pattern), {"index":1,"remove":true}]}. Indexes count from 0 in the song as it is now',
      ),
  }),
  z.object({
    op: z.literal('set_level_music'),
    sceneId: z.string(),
    music: z.string().nullable().describe('The song (name, id, or the name of a make_song earlier in this list) that plays while the level is played; null for none'),
  }),
  z.object({
    op: z.literal('draw_tiles'),
    sceneId: z.string(),
    definitionRef: z.string().describe('An existing definition id, or the ref of a create_definition earlier in this list'),
    rects: z
      .array(z.object({ col: z.number().int(), row: z.number().int(), width: z.number().int().min(1), height: z.number().int().min(1) }))
      .describe('Rectangles of 32px level cells to fill, one copy per cell (a row of ground: height 1)'),
    onTop: z.boolean().nullable().describe('Where other objects already are: null/false replaces them (deletes what it covers, as placing in the editor does); true puts it on top and keeps them, only when both must really share the square'),
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
          z.object({
            do: z.literal('climb'),
            rows: z.number().int().describe('A ladder this many rows high; the route continues on a platform at its top'),
            back: z.boolean().nullish().describe('true: the platform at the top runs BACK over the floor below (a layer above it, the route turns around; needs rows >= 3); false/null: it continues ahead'),
          }),
          z.object({ do: z.literal('turn') }).describe('The route turns around and continues the other way from where it is (zig-zags, switchbacks; then e.g. jump up onto a ledge above the way you came)'),
          z.object({ do: z.literal('hazard'), object: z.string().describe('Hazard object (id, name or ref)'), cells: z.number().int().describe('Cells of hazards on the floor, to jump over') }),
          z.object({ do: z.literal('put'), object: z.string().describe('Object to stand on the floor here (key, coin, door, switch, enemy, goal…; id, name or ref)'), name: z.string().nullable(), ref: z.string().nullable().describe('Temporary name to use it in later relationships/rules; null if not needed') }),
        ]),
      )
      .describe('The way through, in order, starting in "direction" (turn and climb back reverse it)'),
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
    op: z.literal('set_panel'),
    id: z.string().describe('The library object (definition id) the panel belongs to'),
    panelJson: z
      .string()
      .describe('The whole panel as JSON: {"title","controls":[{"label","target","control","min","max","step"}]} (see the "panels" guidance); replaces the one it had'),
  }).describe("Gives an object its own editor panel (shown beside it when selected, never in the game)"),
  z.object({
    op: z.literal('remove_panel'),
    id: z.string().describe('The library object (definition id) whose panel goes'),
  }),
  z.object({
    op: z.literal('open_sprite_editor'),
    id: z.string().describe('The entity id or object definition id whose sprite to open (a placed copy opens its object)'),
    situation: z.string().nullable().describe('null: its normal look. A situation (run, jump, up, down…): that look (a new drawing for it if it has none)'),
  }).describe('Opens the sprite editor so the USER can draw or edit the sprite by hand ("open the sprite editor", "I want to edit the sprite myself"); changes nothing by itself'),
  z.object({
    op: z.literal('set_editor_setting'),
    key: z.string().describe('An editor setting key from EDITOR SETTINGS (editor scope only)'),
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
    op: z.literal('use_script_for'),
    target,
    id: z.string().describe('The object (definition) or entity (instance) whose engine part a script takes over'),
    part: z.enum(ENGINE_PARTS).describe("The part of the engine's own code (see ENGINE PARTS)"),
    scriptJson: z
      .string()
      .nullable()
      .describe("null: the part's ready-made script, exactly what the engine does. Or the script as JSON: the ready-made one changed as the user asked (keep what wasn't asked about as it is)"),
  }),
  z.object({
    op: z.literal('edit_script'),
    target,
    id: z.string().describe('The script owner: object definition id (definition) or entity id (instance)'),
    scriptId: z.string().describe('The id of the script to change'),
    editsJson: z
      .string()
      .describe(
        'The changes as a JSON list, made in order: [{"at":"handlers.2.do.0","action":"replace","value":{…},"was":"play_sound"}]. at: keys and list positions from the script top, by dots (handlers.N, handlers.N.do.M, handlers.N.if, vars…). action: replace (what is there), insert (before position N in a list; N = its length adds at the end), remove. was (optional, recommended): text that must appear in the JSON of what is there now. Later positions in the same list shift after an insert or remove, so list edits are best made from the last position to the first',
      ),
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
export type EditorOperation = Extract<Operation, { op: 'set_editor_setting' | 'add_editor_overlay' | 'remove_editor_overlay' | 'open_sprite_editor' }>;

export function isEditorOperation(op: Operation): op is EditorOperation {
  return op.op === 'set_editor_setting' || op.op === 'add_editor_overlay' || op.op === 'remove_editor_overlay' || op.op === 'open_sprite_editor';
}

export interface ApplyResult {
  createdDefinitionIds: Id[];
  createdEntityIds: Id[];
  createdRelationshipIds: Id[];
  createdRuleIds: Id[];
  removedEntityIds: Id[];
  createdAssetIds: Id[];
  /** New levels (create_level), in order. */
  createdSceneIds: Id[];
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
  if ((out.do === 'spawn' || out.do === 'shoot' || out.do === 'draw') && typeof out.object === 'string') out.object = objects.get(out.object) ?? out.object;
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
/** How much two boxes overlap, as a share of the smaller one (0: apart or only touching). */
function overlapShare(a: Rect, b: Rect): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
  if (w <= 0 || h <= 0) return 0;
  const area = (r: Rect) => Math.max(1, (r.maxX - r.minX) * (r.maxY - r.minY));
  return (w * h) / Math.min(area(a), area(b));
}

/**
 * What a new object placed in this level would cover, as the editor decides it: other objects sharing at least half a
 * square with it. Floors (drawn under everything) never count, nor does anything when a floor is placed.
 */
function coveredBy(index: CoverIndex, project: Project, entity: ReturnType<typeof instantiateDefinition>, registry: ComponentRegistry): { id: Id; isPlayer: boolean }[] {
  const resolved = resolveEntity(project, entity, registry);
  if (isUnder(resolved.components)) return [];
  const box = getWorldBounds(resolved);
  const out: { id: Id; isPlayer: boolean }[] = [];
  for (const id of index.near(box)) {
    const e = index.items.get(id)!;
    if (e.definitionId === entity.definitionId && entity.definitionId !== null) continue;
    if (!e.under && overlapShare(e.box, box) >= 0.5) out.push({ id, isPlayer: e.isPlayer });
  }
  return out;
}

/** Changes that never add, remove, move or resize anything placed: what is where stays known across them. */
const KEEPS_PLACES = new Set<string>([
  'set_world',
  'set_background',
  'create_definition',
  'create_level',
  'make_sound',
  'make_instrument',
  'make_song',
  'edit_song',
  'set_level_music',
  'rename',
  'set_tags',
  'create_relationship',
  'update_relationship',
  'remove_relationship',
  'create_rule',
  'remove_rule',
  'set_rule_enabled',
  'set_camera',
  'set_script',
  'edit_script',
  'remove_script',
  'set_script_enabled',
]);

/** Drawn under everything (a floor): never covers anything, and is never covered. */
const isUnder = (c: Record<string, Record<string, unknown>>) => Number(c.Sprite?.layer ?? 0) < 0;

/**
 * Where everything in one level is, by 32 px cell, to find what a new object covers without going through every
 * object in the level each time (an answer drawing thousands of tiles would otherwise take minutes). Made once for
 * an answer's run of placing and drawing, and kept up to date as it adds and removes things.
 */
class CoverIndex {
  readonly items = new Map<Id, { box: Rect; definitionId: Id | null; under: boolean; isPlayer: boolean; cells: string[] }>();
  private readonly cells = new Map<string, Set<Id>>();

  constructor(
    readonly sceneId: Id,
    project: Project,
    registry: ComponentRegistry,
  ) {
    for (const e of m.getScene(project, sceneId).entities) this.add(project, e, registry);
  }

  private static cellsOf(b: Rect): string[] {
    const out: string[] = [];
    const c0 = Math.floor(b.minX / LEVEL_CELL);
    const c1 = Math.floor(b.maxX / LEVEL_CELL);
    const r0 = Math.floor(b.minY / LEVEL_CELL);
    const r1 = Math.floor(b.maxY / LEVEL_CELL);
    // (Something huge is filed under its corners' cells' span only up to a limit; it is still found, see near.)
    if ((c1 - c0 + 1) * (r1 - r0 + 1) > 4096) return ['*'];
    for (let c = c0; c <= c1; c++) for (let r = r0; r <= r1; r++) out.push(`${c},${r}`);
    return out;
  }

  add(project: Project, e: ReturnType<typeof instantiateDefinition>, registry: ComponentRegistry): void {
    const r = resolveEntity(project, e, registry);
    const box = getWorldBounds(r);
    const cells = CoverIndex.cellsOf(box);
    this.items.set(e.id, { box, definitionId: e.definitionId, under: isUnder(r.components), isPlayer: !!r.components.CharacterController, cells });
    for (const k of cells) {
      let set = this.cells.get(k);
      if (!set) this.cells.set(k, (set = new Set()));
      set.add(e.id);
    }
  }

  remove(ids: Id[]): void {
    for (const id of ids) {
      const item = this.items.get(id);
      if (!item) continue;
      for (const k of item.cells) this.cells.get(k)?.delete(id);
      this.items.delete(id);
    }
  }

  /** Everything whose box shares a cell with this one (to be checked for real overlap). */
  near(b: Rect): Set<Id> {
    const out = new Set<Id>(this.cells.get('*') ?? []);
    const keys = CoverIndex.cellsOf(b);
    if (keys[0] === '*') return new Set(this.items.keys());
    for (const k of keys) for (const id of this.cells.get(k) ?? []) out.add(id);
    return out;
  }
}

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
      const moves = c.PhysicsBody?.bodyType === 'dynamic' || c.Patrol || c.Wander || c.MovingPlatform || c.CharacterController || b.r.scripts.some((sc) => !onlyOnTouch(sc));
      if (!falls && (moves || !(c.Openable || c.Switch || touchHarm(b.r.scripts)))) continue;
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
  /** Levels made earlier in this list, by their ref. */
  const levelRefs = new Map<string, Id>();
  const result: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [], createdRelationshipIds: [], createdRuleIds: [], removedEntityIds: [], createdAssetIds: [], createdSceneIds: [] };
  const logicJson = (text: string, what: string) => substituteRefs(parseProps(text, what), entityRefs, refs) as Record<string, unknown>;
  // What is where in a level, while placing and drawing (anything else that changes the level drops it).
  let cover: CoverIndex | null = null;
  const coverOf = (sceneId: Id) => (cover?.sceneId === sceneId ? cover : (cover = new CoverIndex(sceneId, project, registry)));

  const applyOne = (given: Operation): void => {
    // A new object or entity made earlier in this list can be named by its ref ("make a Mushroom and draw it").
    let op = given;
    if ('target' in op && 'id' in op && typeof op.id === 'string') {
      const id = op.target === 'definition' ? refs.get(op.id) : entityRefs.get(op.id);
      if (id) op = { ...op, id } as Operation;
    }
    if (op.op === 'set_transform' && entityRefs.has(op.entityId)) op = { ...op, entityId: entityRefs.get(op.entityId)! };
    if ('sceneId' in op && levelRefs.has(op.sceneId)) op = { ...op, sceneId: levelRefs.get(op.sceneId)! } as Operation;
    if (op.op !== 'place_instance' && op.op !== 'draw_tiles' && !KEEPS_PLACES.has(op.op)) cover = null;
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
          ...(op.parallax !== null ? { parallax: op.parallax, parallaxY: op.parallaxY } : op.parallaxY !== null ? { parallaxY: op.parallaxY } : {}),
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
      case 'set_sprite_resolution':
        m.changeSpriteResolution(project, op.resolution, registry);
        break;
      case 'create_level': {
        if (levelRefs.has(op.ref)) throw new m.ModelError(`Two new levels are called "${op.ref}"; give each its own ref`);
        if (!op.name.trim()) throw new m.ModelError('A new level needs a name');
        const scene = createLevelFor(project, op.name.trim());
        m.addScene(project, scene);
        levelRefs.set(op.ref, scene.id);
        result.createdSceneIds.push(scene.id);
        break;
      }
      case 'place_instance': {
        const defId = refs.get(op.definitionRef) ?? op.definitionRef;
        const def = m.getDefinition(project, defId);
        const entity = instantiateDefinition(def, onGrid(def, { x: op.x, y: op.y }), op.name ?? def.name);
        // Over other objects: replaces them (as placing in the editor does), unless onTop. The player is never deleted.
        const index = coverOf(op.sceneId);
        if (!op.onTop) {
          const gone = coveredBy(index, project, entity, registry).filter((c) => !c.isPlayer).map((c) => c.id);
          if (gone.length) {
            m.removeEntities(project, op.sceneId, gone);
            index.remove(gone);
            result.removedEntityIds.push(...gone);
          }
        }
        m.addEntity(project, op.sceneId, entity);
        index.add(project, entity, registry);
        if (op.ref) entityRefs.set(op.ref, entity.id);
        result.createdEntityIds.push(entity.id);
        break;
      }
      case 'make_sound': {
        const parsed = parseSteps(op.soundJson);
        if ('error' in parsed) throw new m.ModelError(parsed.error);
        const name = op.name.trim() || 'Sound';
        if (op.replaceId) {
          const old = project.assets.find((a) => a.id === op.replaceId && a.kind === 'sound');
          if (!old) throw new m.ModelError(`There is no sound "${op.replaceId}" to remake`);
          old.synth = parsed.sound;
          old.data = soundDataUrl(parsed.sound);
          old.name = name;
          old.description = op.description;
          result.createdAssetIds.push(old.id);
        } else {
          if (project.assets.some((a) => a.kind === 'sound' && a.name.toLowerCase() === name.toLowerCase())) {
            throw new m.ModelError(`There is already a sound called "${name}": remake it with replaceId, or give the new one another name`);
          }
          const id = generateId('snd');
          m.addAsset(project, { id, name, kind: 'sound', path: `assets/${id}.sound.json`, data: soundDataUrl(parsed.sound), width: 0, height: 0, synth: parsed.sound, description: op.description });
          result.createdAssetIds.push(id);
        }
        break;
      }
      case 'make_instrument': {
        // Reshaping one: the fields not given stay as they are.
        const base = op.replaceId ? project.assets.find((a) => a.id === op.replaceId && a.kind === 'instrument')?.instrument : undefined;
        let given: unknown = op.instrumentJson;
        if (base) {
          try {
            given = { ...base, ...(JSON.parse(op.instrumentJson) as object) };
          } catch {
            throw new m.ModelError('Instrument: not valid JSON');
          }
        }
        const parsed = parseInstrument(given);
        if ('error' in parsed) throw new m.ModelError(parsed.error);
        const name = op.name.trim() || 'Instrument';
        if (op.replaceId) {
          const old = project.assets.find((a) => a.id === op.replaceId && a.kind === 'instrument');
          if (!old) throw new m.ModelError(`There is no instrument "${op.replaceId}" to reshape`);
          music.setInstrument(project, old.id, parsed.instrument);
          const problem = name !== old.name ? music.renameMusicAsset(project, old.id, name) : null;
          if (problem) throw new m.ModelError(problem);
          old.description = op.description;
          result.createdAssetIds.push(old.id);
        } else {
          const problem = music.musicNameProblem(project, 'instrument', name);
          if (problem) throw new m.ModelError(`${problem}: reshape it with replaceId, or give the new one another name`);
          result.createdAssetIds.push(music.addInstrumentAsset(project, name, parsed.instrument, op.description));
        }
        break;
      }
      case 'make_song': {
        const raw = readSongJson(op.songJson, project);
        if ('error' in raw) throw new m.ModelError(raw.error);
        const parsed = parseSong(raw.value);
        if ('error' in parsed) throw new m.ModelError(parsed.error);
        const name = op.name.trim() || 'Song';
        if (op.replaceId) {
          const old = project.assets.find((a) => a.id === op.replaceId && a.kind === 'music');
          if (!old) throw new m.ModelError(`There is no song "${op.replaceId}" to rewrite`);
          music.setSong(project, old.id, parsed.song);
          const problem = name !== old.name ? music.renameMusicAsset(project, old.id, name) : null;
          if (problem) throw new m.ModelError(problem);
          old.description = op.description;
          result.createdAssetIds.push(old.id);
        } else {
          const problem = music.musicNameProblem(project, 'music', name);
          if (problem) throw new m.ModelError(`${problem}: rewrite it with replaceId, or give the new one another name`);
          result.createdAssetIds.push(music.addSongAsset(project, name, parsed.song, op.description));
        }
        break;
      }
      case 'edit_song': {
        const asset = findSong(project, op.id);
        if (!asset) throw new m.ModelError(`There is no song "${op.id}"`);
        let changes: music.SongEdit;
        try {
          changes = JSON.parse(op.changesJson) as music.SongEdit;
        } catch {
          throw new m.ModelError('edit_song: changesJson is not valid JSON');
        }
        let edited;
        try {
          edited = music.editSong(asset.song!, changes, (ref) => instrumentByRef(project, ref)?.id ?? null, (x) => (typeof x === 'number' ? x : typeof x === 'string' ? parseNoteName(x) : null));
        } catch (e) {
          throw new m.ModelError(e instanceof Error ? e.message : String(e));
        }
        const parsed = parseSong(edited);
        if ('error' in parsed) throw new m.ModelError(parsed.error);
        for (const c of parsed.song.channels) if (!c.name) c.name = project.assets.find((a) => a.id === c.instrument)?.name ?? '';
        music.setSong(project, asset.id, parsed.song);
        result.createdAssetIds.push(asset.id);
        break;
      }
      case 'set_level_music': {
        if (op.music === null) {
          music.setLevelMusic(project, op.sceneId, null);
          break;
        }
        const song = findSong(project, op.music);
        if (!song) throw new m.ModelError(`There is no song "${op.music}" (make one with make_song first)`);
        music.setLevelMusic(project, op.sceneId, song.id);
        break;
      }
      case 'draw_autotile': {
        const defId = refs.get(op.id) ?? op.id;
        m.drawAutotileTiles(project, defId, op.palette, op.tiles, registry);
        break;
      }
      case 'draw_sprite': {
        const entity = op.target === 'instance' ? m.getEntity(project, sceneOfEntity(project, op.id), op.id) : instantiateDefinition(m.getDefinition(project, op.id), { x: 0, y: 0 });
        const size = getEntitySize(resolveEntity(project, entity, registry));
        // Usual notation slips (a color for ".", spaces for empty pixels, colors without "#"…) are forgiven, not rejected.
        const drawn = normalizePixelArt({ palette: op.palette, rows: op.rows });
        const err = checkPixelArt(drawn);
        if (err) throw new m.ModelError(`Sprite: ${err}`);
        // The game's sprite size is kept: a drawing with more pixels than it allows for this object is refused (the AI
        // draws it again at the right size), so every picture in the game has pixels of the same size.
        const res = project.settings.spriteResolution;
        if (res && res !== 32) {
          const grid = gridFor(size, res);
          if (drawn.rows[0].length > grid.width + 1 || drawn.rows.length > grid.height + 1) {
            throw new m.ModelError(
              `Sprite "${op.name}" is ${drawn.rows[0].length}×${drawn.rows.length} pixels, but this game's sprites are ${res}×${res} pixels a tile: draw this ${size.x}×${size.y} object ${grid.width}×${grid.height} pixels`,
            );
          }
        }
        // Other proportions than the object's are fitted (repeated or padded), not rejected.
        const art = fitPixelArt(drawn, size);
        const frames = [art.rows];
        for (const [i, rows] of (op.frames ?? []).entries()) {
          const f = normalizePixelArt({ palette: op.palette, rows });
          const ferr = checkPixelArt(f);
          if (ferr) throw new m.ModelError(`Sprite frame ${i + 2}: ${ferr}`);
          const fitted = fitPixelArt(f, size);
          if (fitted.rows.length !== art.rows.length || fitted.rows[0].length !== art.rows[0].length) {
            throw new m.ModelError(`Sprite frame ${i + 2} is ${f.rows[0].length}×${f.rows.length}; every frame must be the size of the first (${drawn.rows[0].length}×${drawn.rows.length})`);
          }
          frames.push(fitted.rows);
        }
        if (frames.length > MAX_FRAMES) throw new m.ModelError(`An animation can have at most ${MAX_FRAMES} frames`);
        const asset = createAnimatedPixelArtAsset(op.name.trim() || 'Sprite', art.palette, frames, op.fps && op.fps > 0 ? Math.min(60, op.fps) : 8);
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
        } else if (op.target === 'definition') {
          // A new look: the object's old pictures go (those this answer drew stay), so styles never mix.
          m.replaceDefinitionLook(project, op.id, { assetId: asset.id, frame: 1 }, result.createdAssetIds, registry);
        }
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
        const index = coverOf(op.sceneId);
        // Added together at the end (copies of one object never replace each other, so none of them is removed meanwhile).
        const fresh: ReturnType<typeof instantiateDefinition>[] = [];
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
              // Over other objects: replaces them, unless onTop; a cell with the player in it is left out (never drawn over).
              if (!op.onTop) {
                const covered = coveredBy(index, project, entity, registry);
                if (covered.some((c) => c.isPlayer)) continue;
                if (covered.length) {
                  m.removeEntities(project, op.sceneId, covered.map((c) => c.id));
                  index.remove(covered.map((c) => c.id));
                  result.removedEntityIds.push(...covered.map((c) => c.id));
                }
              }
              fresh.push(entity);
              index.add(project, entity, registry);
              result.createdEntityIds.push(entity.id);
            }
          }
        }
        m.addEntities(project, op.sceneId, fresh);
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
      case 'edit_script': {
        const owner = { target: op.target, id: op.target === 'definition' ? (refs.get(op.id) ?? op.id) : (entityRefs.get(op.id) ?? op.id) };
        const parsed = substituteRefs(parseJson(op.editsJson, 'Script edits'), entityRefs, refs) as unknown;
        // (A single edit, or {"edits": […]}, is taken as the list it means.)
        const edits = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as { edits?: unknown }).edits) ? (parsed as { edits: unknown[] }).edits : [parsed];
        scripts.editScript(project, owner, op.scriptId, edits as scripts.ScriptEdit[]);
        break;
      }
      case 'use_script_for': {
        const owner = { target: op.target, id: op.target === 'definition' ? (refs.get(op.id) ?? op.id) : (entityRefs.get(op.id) ?? op.id) };
        scripts.useScriptFor(project, owner, op.part, op.scriptJson === null ? null : logicJson(op.scriptJson, 'Script'));
        break;
      }
      case 'set_panel':
        setPanel(project, refs.get(op.id) ?? op.id, logicJson(op.panelJson, 'Panel'), registry);
        break;
      case 'remove_panel':
        removePanel(project, refs.get(op.id) ?? op.id);
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
      case 'open_sprite_editor':
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
      // (It may have stopped halfway: what is where is worked out again.)
      cover = null;
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

/**
 * A song from the AI: its channels name their instruments (by name or id), and pitches may be note names ("C4").
 * Returns the song with instrument ids and MIDI pitches, ready to check.
 */
function readSongJson(text: string, project: Project): { value: unknown } | { error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'Song: not valid JSON' };
  }
  if (!value || typeof value !== 'object') return { error: 'Song: expected an object' };
  const song = value as { channels?: unknown; patterns?: unknown };
  const instruments = project.assets.filter((a) => a.kind === 'instrument' && a.instrument);
  if (Array.isArray(song.channels)) {
    for (const [i, c] of song.channels.entries()) {
      if (!c || typeof c !== 'object') continue;
      const ch = c as { instrument?: unknown; name?: unknown };
      if (typeof ch.instrument !== 'string') continue;
      const inst = instrumentByRef(project, ch.instrument);
      if (!inst) return { error: `Song: channel ${i} plays instrument "${ch.instrument}", but there is none (instruments: ${instruments.map((a) => a.name).join(', ') || 'none yet: make them with make_instrument first'})` };
      ch.instrument = inst.id;
      if (typeof ch.name !== 'string' || !ch.name) ch.name = inst.name;
    }
  }
  if (Array.isArray(song.patterns)) {
    for (const p of song.patterns) {
      const notes = (p as { notes?: unknown })?.notes;
      if (!Array.isArray(notes)) continue;
      for (const n of notes) {
        if (!Array.isArray(n)) continue;
        if (n.length === 4) n.push(0.8);
        if (typeof n[2] !== 'string') continue;
        const pitch = parseNoteName(n[2]);
        if (pitch === null) return { error: `Song: "${n[2]}" is not a note (use MIDI numbers, 60 = C4, or names like "C4", "F#3", "Bb2")` };
        n[2] = pitch;
      }
    }
  }
  return { value };
}

/** An instrument by id, or by name (any case). */
function instrumentByRef(project: Project, ref: string): Project['assets'][number] | undefined {
  const instruments = project.assets.filter((a) => a.kind === 'instrument' && a.instrument);
  return instruments.find((a) => a.id === ref) ?? instruments.find((a) => a.name.toLowerCase() === ref.trim().toLowerCase());
}
