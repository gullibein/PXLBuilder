/**
 * AI context.
 *
 * The editor's selection establishes an explicit AIContext ("what the user is
 * working with"). buildAIPayload turns it into the small, relevant slice of
 * the project the model needs: the targets in full, everything else in brief.
 * The model never receives the raw project file.
 */
import { soundLength } from '../audio/sound';
import { audibleNotes, isStepSound, type StepSound } from '../audio/steps';
import type { ComponentRegistry } from '../components/registry';
import { diagnoseLevel, type Problem } from '../debug/diagnose';
import { summarizePlay, type PlayReport, type PlaySummary } from '../debug/playReport';
import { boundsOf, type CameraBounds, type CameraSettings } from '../model/camera';
import { describeRelationship, describeRule } from '../logic/describe';
import { instantiateDefinition } from '../model/factory';
import { getEntitySize } from '../model/geometry';
import { levelMap, type LevelMap } from '../model/levelMap';
import { LEVEL_CELL } from '../model/placement';
import { levelDesignIdea, type LevelDesignIdea } from './levelIdeas';
import { isTopDownScene } from '../model/topDown';
import { characterReach } from '../model/reach';
import { gridFor } from '../model/spriteResolution';
import { getDefinitionSprites } from '../model/mutations';
import { resolveEntity } from '../model/resolve';
import type { BehaviorScript, Condition, EntityRef, Id, Project, Relationship, Rule, RuleAction, Scene, Vec2 } from '../types';

export type AIContext =
  /** One selected entity. */
  | { kind: 'entity'; sceneId: Id; entityIds: [Id] }
  /** Three or more selected entities, addressed together. */
  | { kind: 'group'; sceneId: Id; entityIds: Id[] }
  /** Exactly two selected entities: the request is usually about how they relate. Order = selection order. */
  | { kind: 'pair'; sceneId: Id; entityIds: [Id, Id] }
  /**
   * The level itself (world settings, all of its contents). `point` is where the user pointed, if anywhere. `camera`:
   * asked from the level's camera outline (its own conversation, about the camera).
   */
  | { kind: 'level'; sceneId: Id; point: Vec2 | null; camera?: 'start' | 'limits' }
  /** The level's background (color, image, how it moves). */
  | { kind: 'background'; sceneId: Id }
  /** The whole game. */
  | { kind: 'project'; sceneId: Id }
  /** Creating a new object for the library. */
  | { kind: 'create'; sceneId: Id }
  /** One connection (relationship) the user clicked on, e.g. the line from a switch to a door. */
  | { kind: 'connection'; sceneId: Id; relationshipId: Id }
  /** The editor itself (layout, look, controls), not the game. */
  | { kind: 'editor'; sceneId: Id };

/** Derives the context from a selection (ordered by selection order). */
export function contextFromSelection(sceneId: Id, selected: Id[]): AIContext | null {
  if (selected.length === 0) return null;
  if (selected.length === 1) return { kind: 'entity', sceneId, entityIds: [selected[0]] };
  if (selected.length === 2) return { kind: 'pair', sceneId, entityIds: [selected[0], selected[1]] };
  return { kind: 'group', sceneId, entityIds: [...selected] };
}

/** Stable key used to keep a short conversation per context. */
export function contextKey(ctx: AIContext): string {
  switch (ctx.kind) {
    case 'entity':
    case 'group':
    case 'pair':
      return `${ctx.kind}:${ctx.entityIds.join(',')}`;
    case 'level':
      return ctx.camera ? `camera:${ctx.sceneId}` : `level:${ctx.sceneId}`;
    case 'background':
      return `background:${ctx.sceneId}`;
    case 'project':
      return 'project';
    case 'create':
      return 'create';
    case 'editor':
      return 'editor';
    case 'connection':
      return `connection:${ctx.relationshipId}`;
  }
}

export interface EntityDetail {
  id: Id;
  name: string;
  object: { id: Id; name: string; placedCount: number } | null;
  tags: string[];
  position: Vec2;
  size: Vec2;
  rotation: number;
  scale: Vec2;
  components: Record<string, Record<string, unknown>>;
  /** "Component.field" values set on this instance only (overriding its object definition). */
  instanceOverrides: string[];
  /** The pixel grid to use when drawing a sprite for it (draw_sprite): same proportions as its size. */
  spriteGrid: { width: number; height: number };
  /**
   * How it looks now: the normal image and the extra images for situations
   * (jump, run…), each with its pixels when it is pixel art, so a variation
   * ("a jumping sprite") can start from the same drawing.
   */
  look: {
    sprite: LookImage | null;
    situations: Record<string, LookImage>;
  };
  /** Behavior scripts, in full: its object's (every copy runs them) and its own (only this one). */
  scripts: { object: BehaviorScript[]; own: BehaviorScript[] };
}

export interface LookImage {
  image: string;
  /** Its pixels; an animation also has all its frames (rows is the first). */
  pixelArt: { palette: { key: string; color: string }[]; rows: string[]; frames?: string[][] } | null;
  /** For an animation: how many frames and how fast. */
  animation?: { frames: number; fps: number };
}

export interface EntityBrief {
  id: Id;
  name: string;
  /** Its library object's name (its components, tags and scripts are the object's: see library). */
  object: string | null;
  x: number;
  y: number;
  /** What this one has of its own (changed on it alone): components, tags, scripts. */
  own?: { components?: string[]; tags?: string[]; scripts?: string[] };
}

/**
 * Editor settings the AI may change (editor scope only). The editor declares
 * them; core only carries them, so the game model knows nothing about the UI.
 */
export interface EditorSettingsPayload {
  /**
   * Each editor setting's current value, by key. What the settings are (labels, descriptions, allowed values), the
   * overlay kinds and metrics never change, so they come once with the instructions (EDITOR SETTINGS, cached).
   */
  values: Record<string, unknown>;
  /** Information drawn over the level while editing (labels, guides): what is shown now. */
  overlays?: unknown[];
}

export interface AIPayload {
  scope: AIContext['kind'];
  /**
   * Only on the first request of a brand-new game (typed in the New game window): the starter the game was made
   * from (current) and the other starters there are. Build on current if it suits the request, else switch_starter.
   */
  newGame?: { current: string; starters: { id: string; is: string }[] };
  /** The connection the user selected (scope "connection"): in words and as data. */
  connection?: { id: Id; text: string; type: string; source: EntityRef; target: EntityRef; params: Record<string, unknown>; conditions: Condition[] };
  /** The editor's adjustable settings and overlays, with their current values (editor changes are possible from any scope). */
  editor?: EditorSettingsPayload;
  scope_note: string;
  level: {
    id: Id;
    name: string;
    gravity: Vec2;
    backgroundColor: string;
    background: { image: { name: string; width: number; height: number } | null; fit: 'cover' | 'tile'; parallax: number };
    isStartLevel: boolean;
    /** The level grid for drawing (draw_tiles, erase_area) and what is already drawn, in cells. */
    grid: { cell: number; occupied: { minCol: number; maxCol: number; minRow: number; maxRow: number } | null };
    /** The camera in play: its settings, what it follows (the entity with a CameraTarget), and the box around everything placed. */
    camera: CameraSettings & { follows: string | null; levelBounds: CameraBounds | null };
    /** The level as a text map, one character per cell (see the legend): what is where, and where the player can get to. */
    map: LevelMap | null;
    /**
     * side: seen from the side, with gravity (platformer). topdown: seen from above (Zelda, Rogue): the player walks in
     * every direction, nothing falls, walls block; playerReach is then null (no jumping).
     */
    view: 'side' | 'topdown';
    /** The game's sprite size: art pixels per 32 px tile of the built-in objects' pictures (32 = as they ship). */
    spriteResolution: number;
    /**
     * For building or rebuilding a level: the layout to use this time (chosen at random by the app, so levels
     * differ), where the start and goal go, and the shapes of the game's other levels. Follow it unless the user
     * asked for a particular layout.
     */
    design?: LevelDesignIdea;
    /** What the player-controlled character can do: the limits a level must respect to be playable. */
    playerReach: { character: string; jumpHeightPx: number; jumpHeightTiles: number; runningJumpDistancePx: number; runningJumpDistanceTiles: number; speed: number } | null;
  };
  /** The selected/target entities, in full. */
  targets: EntityDetail[];
  /** Where the user pointed in the level (world coordinates), if anywhere. */
  point: Vec2 | null;
  /** Asked from the camera outline: the request is about the level's camera (level.camera). */
  aboutCamera?: true;
  /**
   * The other placed things that matter one by one (with ids, for changing that one): the few of a kind (the player,
   * doors, a goal), and any changed on its own. Plain copies of objects placed many times (ground, walls, dirt,
   * coins) are only on level.map, by cell (see otherCopies).
   */
  otherEntities: EntityBrief[];
  /** How many plain copies of each object are on the map but not listed one by one, e.g. { "Dirt": 212 }. */
  otherCopies: Record<string, number>;
  /** Object library. */
  library: {
    id: Id;
    name: string;
    category: string;
    tags: string[];
    components: string[];
    placedCount: number;
    /** Its size in pixels and the 32 px level cells it takes: "32x64 px, 1x2 cells" (a door). */
    size: string;
    /**
     * Behavior scripts every copy runs: id, name and the first sentence of the description. The code itself is in
     * targets[].scripts for the selected things' own objects (codeInTargets); the AI asks for any other ("need_code").
     */
    scripts: { id: Id; name: string; description: string }[];
    codeInTargets?: true;
    /** Sprites collected for this object (left out when none): image asset id, its name, the cell (sprite sheets). */
    sprites?: { assetId: Id; image: string; frame: number; sheet?: true }[];
  }[];
  /** The level's relationships and rules: in words, plus their data (for editing or removing by id). */
  logic: {
    relationships: { id: Id; text: string; type: string; source: EntityRef; target: EntityRef; params: Record<string, unknown>; conditions: Condition[] }[];
    rules: { id: Id; text: string; name: string; enabled: boolean; when: Rule['when']; conditions: Condition[]; actions: RuleAction[] }[];
  };
  /** Sounds made so far (play them by name with play_sound; remake one with make_sound replaceId). */
  /** The game's sounds; step sounds with their notes (`sound`), to remake one starting from what it is now. */
  sounds: { id: Id; name: string; description: string; seconds: number; sound?: StepSound }[];
  /** Other levels (project scope only lists their contents). */
  otherLevels: { id: Id; name: string; map?: LevelMap | null; entities?: EntityBrief[]; otherCopies?: Record<string, number> }[];
  coordinateSystem: string;
  /** For debugging questions ("why…?"): what can't work as set up, and what happened the last time the level was played. */
  debug: {
    problems: (Omit<Problem, 'key'> & { entities: string[] })[];
    lastPlay: (PlaySummary & { note: string }) | null;
  };
}

/** The last play session, as the editor kept it. */
export interface LastPlay {
  report: PlayReport;
  /** The game was changed since that play (it shows the game as it was). */
  changedSince: boolean;
}

const MAX_BRIEFS = 200;
/** An object placed more often than this in a level is shown on the map only (its plain copies aren't listed). */
const MANY_COPIES = 3;
const MAX_LOGIC = 100;

const SCOPE_NOTES: Record<AIContext['kind'], string> = {
  entity: 'The user selected one entity (see targets). Phrases like "the player", "this", "it" most likely refer to it, but the user may also mention other entities by name.',
  pair: 'The user selected two entities, in this order: targets[0] then targets[1]. The request is most likely about how they relate: usually a relationship between them (create_relationship), sometimes a rule. See logic for what already connects them.',
  group: 'The user selected several entities (see targets) and is addressing them together ("these", "them", "all of them").',
  level: 'The user is addressing the level itself: its world settings and its contents. "here" refers to `point` if set.',
  background:
    'The user is editing the level BACKGROUND (level.background, level.backgroundColor). Use set_background. "Move along with the level" / "scroll with the level" means parallax (0 fixed on screen, 1 moves with the level; about 0.3-0.6 for depth). You cannot create or edit pictures; the user uploads background images themselves.',
  project: 'The user is addressing the whole game, across all levels.',
  create: 'The user wants a NEW object added to the object library. Use create_definition. Do not place it unless asked.',
  connection:
    'The user clicked on a CONNECTION (see connection; its two ends are targets[0] = source and targets[1] = target). The request is about what this connection does: change it with update_relationship (id = connection.id), e.g. for a switch (controls): params.action "open" | "close" | "toggle" | "disappear" | "move", with offset (pixels, one tile = 32, negative y = up) and speed for "move". Replace or remove it only if asked; if what they want cannot be expressed by a connection, a rule may do it.',
  editor:
    'The user is changing the PXLBuilder EDITOR itself (where things are, how it looks, what it shows over the level), not the game. Use only editor operations (set_editor_setting, add_editor_overlay, remove_editor_overlay). If the request needs something they cannot do, reply unsupported and say what can be changed instead.',
};

function occupiedCells(scene: Scene): AIPayload['level']['grid']['occupied'] {
  if (!scene.entities.length) return null;
  const cols = scene.entities.map((e) => Math.floor(e.transform.position.x / LEVEL_CELL));
  const rows = scene.entities.map((e) => Math.floor(e.transform.position.y / LEVEL_CELL));
  return { minCol: Math.min(...cols), maxCol: Math.max(...cols), minRow: Math.min(...rows), maxRow: Math.max(...rows) };
}

/** Reach of the level's player character (the first placed one, else the library's). */
function playerReach(project: Project, scene: Scene, registry: ComponentRegistry): AIPayload['level']['playerReach'] {
  const placed = scene.entities.map((e) => resolveEntity(project, e, registry)).find((r) => r.components.CharacterController);
  const def = project.definitions.find((d) => d.components.CharacterController);
  const components = placed?.components ?? (def ? def.components : null);
  if (!components) return null;
  const r = characterReach(components, scene.world.gravity.y);
  if (!r) return null;
  const t = (px: number) => Math.round((px / LEVEL_CELL) * 10) / 10;
  // Heights round down: 62.5 px is "1.9 tiles", never "2" (two rows up is out of reach).
  const down = (px: number) => Math.floor((px / LEVEL_CELL) * 10) / 10;
  return { character: placed?.name ?? def!.name, jumpHeightPx: Math.floor(r.height), jumpHeightTiles: down(r.height), runningJumpDistancePx: Math.round(r.distance), runningJumpDistanceTiles: t(r.distance), speed: r.speed };
}

export function buildAIPayload(project: Project, ctx: AIContext, registry: ComponentRegistry, editor?: EditorSettingsPayload, lastPlay?: LastPlay | null, random?: () => number): AIPayload {
  const scene = project.scenes.find((s) => s.id === ctx.sceneId) ?? project.scenes[0];
  const connection = ctx.kind === 'connection' ? scene.relationships.find((r) => r.id === ctx.relationshipId) : undefined;
  const endIds = (ref: EntityRef) => (ref.kind === 'entity' ? [ref.id] : []);
  const targetIds = 'entityIds' in ctx ? ctx.entityIds : connection ? [...endIds(connection.source), ...endIds(connection.target)] : [];
  const placed = (defId: Id) => project.scenes.reduce((n, s) => n + s.entities.filter((e) => e.definitionId === defId).length, 0);
  const fullScripts = scriptsInFull(project, scene, targetIds);

  const detail = (id: Id): EntityDetail | null => {
    const entity = scene.entities.find((e) => e.id === id);
    if (!entity) return null;
    const r = resolveEntity(project, entity, registry);
    const def = project.definitions.find((d) => d.id === entity.definitionId);
    return {
      id: entity.id,
      name: entity.name,
      object: def ? { id: def.id, name: def.name, placedCount: placed(def.id) } : null,
      tags: r.tags,
      position: r.transform.position,
      size: getEntitySize(r),
      rotation: r.transform.rotation,
      scale: r.transform.scale,
      components: r.components,
      instanceOverrides: [...r.overriddenFields],
      spriteGrid: gridFor(getEntitySize(r), project.settings.spriteResolution),
      scripts: { object: def?.scripts ?? [], own: entity.scripts ?? [] },
      look: lookOf(r.components),
    };
  };

  const image = (assetId: unknown): LookImage | null => {
    const a = typeof assetId === 'string' ? project.assets.find((x) => x.id === assetId) : undefined;
    return a ? { image: a.name, pixelArt: a.pixelArt ?? null, ...(a.animation ? { animation: { frames: a.animation.frames.length, fps: a.animation.fps } } : {}) } : null;
  };
  const lookOf = (c: Record<string, Record<string, unknown>>): EntityDetail['look'] => {
    const situations: Record<string, LookImage> = {};
    for (const [k, v] of Object.entries(c.SpriteStates ?? {})) {
      const img = image(v);
      if (img) situations[k] = img;
    }
    return { sprite: image(c.Sprite?.assetId), situations };
  };

  /**
   * The level's placed things worth listing one by one, briefly, and how many plain copies are left to the map: an
   * object placed more than a few times (MANY_COPIES) is listed only for copies changed on their own, renamed, or
   * named by the level's logic.
   */
  const briefs = (s: Scene, exclude: Set<Id>): { list: EntityBrief[]; copies: Record<string, number> } => {
    const count = new Map<string, number>();
    for (const e of s.entities) if (e.definitionId) count.set(e.definitionId, (count.get(e.definitionId) ?? 0) + 1);
    const logic = JSON.stringify([s.relationships, s.rules]);
    const list: EntityBrief[] = [];
    const copies: Record<string, number> = {};
    for (const e of s.entities) {
      if (exclude.has(e.id)) continue;
      const def = e.definitionId ? project.definitions.find((d) => d.id === e.definitionId) : undefined;
      const own = {
        ...(Object.keys(e.components ?? {}).length ? { components: Object.keys(e.components) } : {}),
        ...(e.tags?.length ? { tags: e.tags } : {}),
        ...(e.scripts?.length ? { scripts: e.scripts.map((x) => x.name) } : {}),
      };
      const plainName = !def || e.name === def.name || new RegExp(`^${def.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`).test(e.name);
      const plainCopy = !!def && (count.get(def.id) ?? 0) > MANY_COPIES && !Object.keys(own).length && plainName && !logic.includes(e.id);
      if (plainCopy) {
        copies[def.name] = (copies[def.name] ?? 0) + 1;
        continue;
      }
      if (list.length >= MAX_BRIEFS) continue;
      list.push({ id: e.id, name: e.name, object: def?.name ?? null, x: Math.round(e.transform.position.x), y: Math.round(e.transform.position.y), ...(Object.keys(own).length ? { own } : {}) });
    }
    return { list, copies };
  };
  const others = briefs(scene, new Set(targetIds));

  return {
    scope: ctx.kind,
    scope_note: SCOPE_NOTES[ctx.kind],
    ...(editor ? { editor } : {}),
    ...(connection ? { connection: { id: connection.id, text: describeRelationship(project, scene, connection), type: connection.type, source: connection.source, target: connection.target, params: connection.params, conditions: connection.conditions } } : {}),
    level: {
      id: scene.id,
      name: scene.name,
      gravity: scene.world.gravity,
      backgroundColor: scene.world.backgroundColor,
      background: {
        image: (() => {
          const a = project.assets.find((x) => x.id === scene.world.background.imageAssetId);
          return a ? { name: a.name, width: a.width, height: a.height } : null;
        })(),
        fit: scene.world.background.fit,
        parallax: scene.world.background.parallax,
      },
      isStartLevel: project.startSceneId === scene.id,
      grid: { cell: LEVEL_CELL, occupied: occupiedCells(scene) },
      map: levelMap(project, scene.id, registry),
      view: isTopDownScene(project, scene, registry) ? 'topdown' : 'side',
      spriteResolution: project.settings.spriteResolution ?? 32,
      ...(random && (ctx.kind === 'level' || ctx.kind === 'project') ? { design: levelDesignIdea(project, scene, registry, random) } : {}),
      playerReach: isTopDownScene(project, scene, registry) ? null : playerReach(project, scene, registry),
      camera: {
        ...scene.camera,
        follows: scene.entities.find((e) => resolveEntity(project, e, registry).components.CameraTarget)?.name ?? null,
        levelBounds: boundsOf(
          scene.entities.map((e) => {
            const s = getEntitySize(resolveEntity(project, e, registry));
            return { x: e.transform.position.x, y: e.transform.position.y, w: s.x, h: s.y };
          }),
        ),
      },
    },
    targets: targetIds.map(detail).filter((d): d is EntityDetail => d !== null),
    point: ctx.kind === 'level' ? ctx.point : null,
    ...(ctx.kind === 'level' && ctx.camera ? { aboutCamera: true as const } : {}),
    otherEntities: others.list,
    otherCopies: others.copies,
    library: project.definitions.map((d) => ({
      id: d.id,
      name: d.name,
      category: typeof d.metadata.category === 'string' ? d.metadata.category : 'Custom',
      tags: d.tags,
      components: Object.keys(d.components),
      placedCount: placed(d.id),
      size: (() => {
        const s = getEntitySize(resolveEntity(project, instantiateDefinition(d, { x: 0, y: 0 }), registry));
        return `${s.x}x${s.y} px, ${Math.max(1, Math.round(s.x / LEVEL_CELL))}x${Math.max(1, Math.round(s.y / LEVEL_CELL))} cells`;
      })(),
      // (The selected things' own scripts are in targets in full: not twice.)
      scripts: (d.scripts ?? []).map((x) => ({ id: x.id, name: x.name, description: firstSentence(x.description) })),
      ...(fullScripts.has(d.id) ? { codeInTargets: true as const } : {}),
      ...(() => {
        const sprites = getDefinitionSprites(d).map((r) => {
          const a = project.assets.find((x) => x.id === r.assetId);
          return { assetId: r.assetId, image: a?.name ?? '?', frame: r.frame, ...(a?.kind === 'spritesheet' ? { sheet: true as const } : {}) };
        });
        return sprites.length ? { sprites } : {};
      })(),
    })),
    logic: {
      relationships: scene.relationships.slice(0, MAX_LOGIC).map((r: Relationship) => ({ id: r.id, text: describeRelationship(project, scene, r), type: r.type, source: r.source, target: r.target, params: r.params, conditions: r.conditions })),
      rules: scene.rules.slice(0, MAX_LOGIC).map((r) => ({ id: r.id, text: describeRule(project, scene, r), name: r.name, enabled: r.enabled, when: r.when, conditions: r.conditions, actions: r.actions })),
    },
    sounds: project.assets
      .filter((a) => a.kind === 'sound' && a.synth)
      .map((a) => ({ id: a.id, name: a.name, description: a.description ?? '', seconds: Math.round(soundLength(a.synth!) * 100) / 100, ...(isStepSound(a.synth) ? { sound: { ...a.synth, notes: a.synth.notes.slice(0, audibleNotes(a.synth)) } } : {}) })),
    otherLevels: project.scenes
      .filter((s) => s.id !== scene.id)
      .map((s) => {
        if (ctx.kind !== 'project') return { id: s.id, name: s.name };
        const b = briefs(s, new Set());
        return { id: s.id, name: s.name, map: levelMap(project, s.id, registry), entities: b.list, otherCopies: b.copies };
      }),
    debug: debugPayload(project, scene, registry, targetIds, lastPlay ?? null),
    coordinateSystem: 'Pixels. x grows to the right, y grows DOWNWARD (so gravity y > 0 pulls down, and "above" means smaller y). Entity positions are centers.',
  };
}

function debugPayload(project: Project, scene: Scene, registry: ComponentRegistry, focus: Id[], lastPlay: LastPlay | null): AIPayload['debug'] {
  const nameOf = (id: Id) => scene.entities.find((e) => e.id === id)?.name ?? id;
  const problems = diagnoseLevel(project, scene.id, registry).map(({ severity, text, entityIds }) => ({ severity, text, entityIds, entities: entityIds.map(nameOf) }));
  if (!lastPlay || lastPlay.report.sceneId !== scene.id) return { problems, lastPlay: null };
  const players = scene.entities.filter((e) => resolveEntity(project, e, registry).components.CharacterController).map((e) => e.id);
  const note = lastPlay.changedSince
    ? 'The game was changed after this play, so it shows the game as it was then; things may already be different.'
    : 'Nothing was changed since this play: it shows the game as it is now.';
  return { problems, lastPlay: { ...summarizePlay(lastPlay.report, focus, players), note } };
}

/** A script's description, short: its first sentence (at most about 120 characters). */
function firstSentence(text: string): string {
  const first = /^.*?[.!?](\s|$)/.exec(text.trim())?.[0].trim() ?? text.trim();
  return first.length <= 120 ? first : `${first.slice(0, 117).replace(/\s+\S*$/, '')}…`;
}

/**
 * The library objects whose scripts go to the AI in full in targets: only the selected things' own objects. The
 * others come as their scripts' names and one-line descriptions, except those sent along (codeToSend); the AI asks for
 * any other it needs (kind "need_code", see codeFor), so a request doesn't pay for code it doesn't read.
 */
function scriptsInFull(project: Project, scene: Scene, targetIds: Id[]): Set<Id> {
  const defs = targetIds.map((id) => scene.entities.find((e) => e.id === id)?.definitionId).filter((x): x is Id => !!x);
  return new Set(defs.filter((id) => project.definitions.find((d) => d.id === id)?.scripts?.length));
}

/**
 * Objects whose full scripts are sent with a request without being asked for (as FULL CODE): those the request names
 * ("make the mole shake while digging") and the player's object in this level (the one asked about most), so the AI
 * doesn't need a second round trip to read them. Not the selected things' own (they are in targets already).
 */
export function codeToSend(project: Project, ctx: AIContext, request: string): Id[] {
  const scene = project.scenes.find((s) => s.id === ctx.sceneId) ?? project.scenes[0];
  const inTargets = scriptsInFull(project, scene, 'entityIds' in ctx ? ctx.entityIds : []);
  const text = request.toLowerCase();
  const placedHere = new Set(scene.entities.map((e) => e.definitionId));
  const out: Id[] = [];
  for (const d of project.definitions) {
    if (!d.scripts?.length || inTargets.has(d.id)) continue;
    const name = d.name.toLowerCase();
    const named = name.length >= 3 && new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es)?([^a-z0-9]|$)`).test(text);
    const player = !!d.components.CharacterController && placedHere.has(d.id);
    if (named || player) out.push(d.id);
  }
  return out;
}

/** The full scripts of these library objects (by id or name), for a "need_code" answer. Unknown ones are left out. */
export function codeFor(project: Project, ids: string[]): { id: Id; name: string; scripts: BehaviorScript[] }[] {
  const out: { id: Id; name: string; scripts: BehaviorScript[] }[] = [];
  for (const want of ids) {
    const d = project.definitions.find((x) => x.id === want) ?? project.definitions.find((x) => x.name.toLowerCase() === want.trim().toLowerCase());
    if (d && !out.some((o) => o.id === d.id)) out.push({ id: d.id, name: d.name, scripts: d.scripts ?? [] });
  }
  return out;
}
