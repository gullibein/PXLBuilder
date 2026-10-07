/**
 * AI context.
 *
 * The editor's selection establishes an explicit AIContext ("what the user is
 * working with"). buildAIPayload turns it into the small, relevant slice of
 * the project the model needs: the targets in full, everything else in brief.
 * The model never receives the raw project file.
 */
import type { ComponentRegistry } from '../components/registry';
import { diagnoseLevel, type Problem } from '../debug/diagnose';
import { summarizePlay, type PlayReport, type PlaySummary } from '../debug/playReport';
import { boundsOf, type CameraBounds, type CameraSettings } from '../model/camera';
import { describeRelationship, describeRule } from '../logic/describe';
import { instantiateDefinition } from '../model/factory';
import { getEntitySize } from '../model/geometry';
import { LEVEL_CELL } from '../model/placement';
import { characterReach } from '../model/reach';
import { suggestedGrid } from '../model/pixelArt';
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
  /** The level itself (world settings, all of its contents). `point` is where the user pointed, if anywhere. */
  | { kind: 'level'; sceneId: Id; point: Vec2 | null }
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
      return `level:${ctx.sceneId}`;
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
  pixelArt: { palette: { key: string; color: string }[]; rows: string[] } | null;
}

export interface EntityBrief {
  id: Id;
  name: string;
  object: string | null;
  tags: string[];
  x: number;
  y: number;
  components: string[];
  /** Names of the behavior scripts it runs. */
  scripts?: string[];
}

/**
 * Editor settings the AI may change (editor scope only). The editor declares
 * them; core only carries them, so the game model knows nothing about the UI.
 */
export interface EditorSettingsPayload {
  settings: { key: string; label: string; description: string; type: string; options?: readonly string[]; min?: number; max?: number; value: unknown }[];
  /** Information drawn over the level while editing (labels, guides): what is shown now, and what can be. */
  overlays?: unknown[];
  overlayKinds?: Record<string, string>;
  metrics?: { key: string; label: string; description: string }[];
}

export interface AIPayload {
  scope: AIContext['kind'];
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
    /** What the player-controlled character can do: the limits a level must respect to be playable. */
    playerReach: { character: string; jumpHeightPx: number; jumpHeightTiles: number; runningJumpDistancePx: number; runningJumpDistanceTiles: number; speed: number } | null;
  };
  /** The selected/target entities, in full. */
  targets: EntityDetail[];
  /** Where the user pointed in the level (world coordinates), if anywhere. */
  point: Vec2 | null;
  /** All other entities in the level, briefly, so the user can refer to them by name. */
  otherEntities: EntityBrief[];
  /** Object library. */
  library: {
    id: Id;
    name: string;
    category: string;
    tags: string[];
    components: string[];
    placedCount: number;
    /** Its size in pixels, and how many 32 px level cells it takes (a 32×64 door: 1×2). */
    size: { w: number; h: number; cells: { w: number; h: number } };
    /** Behavior scripts every copy runs (in full when it's a target's object; else id, name and description). */
    scripts: { id: Id; name: string; description: string }[];
    /** Sprites collected for this object: image asset id + cell number (for sprite sheets). */
    sprites: { assetId: Id; image: string; frame: number; sheet: boolean }[];
  }[];
  /** The level's relationships and rules: in words, plus their data (for editing or removing by id). */
  logic: {
    relationships: { id: Id; text: string; type: string; source: EntityRef; target: EntityRef; params: Record<string, unknown>; conditions: Condition[] }[];
    rules: { id: Id; text: string; name: string; enabled: boolean; when: Rule['when']; conditions: Condition[]; actions: RuleAction[] }[];
  };
  /** Other levels (project scope only lists their contents). */
  otherLevels: { id: Id; name: string; entities?: EntityBrief[] }[];
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

export function buildAIPayload(project: Project, ctx: AIContext, registry: ComponentRegistry, editor?: EditorSettingsPayload, lastPlay?: LastPlay | null): AIPayload {
  const scene = project.scenes.find((s) => s.id === ctx.sceneId) ?? project.scenes[0];
  const connection = ctx.kind === 'connection' ? scene.relationships.find((r) => r.id === ctx.relationshipId) : undefined;
  const endIds = (ref: EntityRef) => (ref.kind === 'entity' ? [ref.id] : []);
  const targetIds = 'entityIds' in ctx ? ctx.entityIds : connection ? [...endIds(connection.source), ...endIds(connection.target)] : [];
  const placed = (defId: Id) => project.scenes.reduce((n, s) => n + s.entities.filter((e) => e.definitionId === defId).length, 0);

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
      spriteGrid: suggestedGrid(getEntitySize(r)),
      scripts: { object: def?.scripts ?? [], own: entity.scripts ?? [] },
      look: lookOf(r.components),
    };
  };

  const image = (assetId: unknown): LookImage | null => {
    const a = typeof assetId === 'string' ? project.assets.find((x) => x.id === assetId) : undefined;
    return a ? { image: a.name, pixelArt: a.pixelArt ?? null } : null;
  };
  const lookOf = (c: Record<string, Record<string, unknown>>): EntityDetail['look'] => {
    const situations: Record<string, LookImage> = {};
    for (const [k, v] of Object.entries(c.SpriteStates ?? {})) {
      const img = image(v);
      if (img) situations[k] = img;
    }
    return { sprite: image(c.Sprite?.assetId), situations };
  };

  const briefs = (s: Scene, exclude: Set<Id>): EntityBrief[] =>
    s.entities
      .filter((e) => !exclude.has(e.id))
      .slice(0, MAX_BRIEFS)
      .map((e) => {
        const r = resolveEntity(project, e, registry);
        return {
          id: e.id,
          name: e.name,
          object: project.definitions.find((d) => d.id === e.definitionId)?.name ?? null,
          tags: r.tags,
          x: Math.round(r.transform.position.x),
          y: Math.round(r.transform.position.y),
          components: Object.keys(r.components),
          ...(r.scripts.length ? { scripts: r.scripts.map((x) => x.name) } : {}),
        };
      });

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
      playerReach: playerReach(project, scene, registry),
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
    otherEntities: briefs(scene, new Set(targetIds)),
    library: project.definitions.map((d) => ({
      id: d.id,
      name: d.name,
      category: typeof d.metadata.category === 'string' ? d.metadata.category : 'Custom',
      tags: d.tags,
      components: Object.keys(d.components),
      placedCount: placed(d.id),
      size: (() => {
        const s = getEntitySize(resolveEntity(project, instantiateDefinition(d, { x: 0, y: 0 }), registry));
        return { w: s.x, h: s.y, cells: { w: Math.max(1, Math.round(s.x / LEVEL_CELL)), h: Math.max(1, Math.round(s.y / LEVEL_CELL)) } };
      })(),
      scripts: (d.scripts ?? []).map((x) => ({ id: x.id, name: x.name, description: x.description })),
      sprites: getDefinitionSprites(d).map((r) => {
        const a = project.assets.find((x) => x.id === r.assetId);
        return { assetId: r.assetId, image: a?.name ?? '?', frame: r.frame, sheet: a?.kind === 'spritesheet' };
      }),
    })),
    logic: {
      relationships: scene.relationships.slice(0, MAX_LOGIC).map((r: Relationship) => ({ id: r.id, text: describeRelationship(project, scene, r), type: r.type, source: r.source, target: r.target, params: r.params, conditions: r.conditions })),
      rules: scene.rules.slice(0, MAX_LOGIC).map((r) => ({ id: r.id, text: describeRule(project, scene, r), name: r.name, enabled: r.enabled, when: r.when, conditions: r.conditions, actions: r.actions })),
    },
    otherLevels: project.scenes
      .filter((s) => s.id !== scene.id)
      .map((s) => (ctx.kind === 'project' ? { id: s.id, name: s.name, entities: briefs(s, new Set()) } : { id: s.id, name: s.name })),
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
