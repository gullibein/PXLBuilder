/**
 * AI context.
 *
 * The editor's selection establishes an explicit AIContext ("what the user is
 * working with"). buildAIPayload turns it into the small, relevant slice of
 * the project the model needs: the targets in full, everything else in brief.
 * The model never receives the raw project file.
 */
import type { ComponentRegistry } from '../components/registry';
import { describeRelationship, describeRule } from '../logic/describe';
import { getEntitySize } from '../model/geometry';
import { getDefinitionSprites } from '../model/mutations';
import { resolveEntity } from '../model/resolve';
import type { Condition, EntityRef, Id, Project, Relationship, Rule, RuleAction, Scene, Vec2 } from '../types';

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
  | { kind: 'create'; sceneId: Id };

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
}

export interface EntityBrief {
  id: Id;
  name: string;
  object: string | null;
  tags: string[];
  x: number;
  y: number;
  components: string[];
}

export interface AIPayload {
  scope: AIContext['kind'];
  scope_note: string;
  level: {
    id: Id;
    name: string;
    gravity: Vec2;
    backgroundColor: string;
    background: { image: { name: string; width: number; height: number } | null; fit: 'cover' | 'tile'; parallax: number };
    isStartLevel: boolean;
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
};

export function buildAIPayload(project: Project, ctx: AIContext, registry: ComponentRegistry): AIPayload {
  const scene = project.scenes.find((s) => s.id === ctx.sceneId) ?? project.scenes[0];
  const targetIds = 'entityIds' in ctx ? ctx.entityIds : [];
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
    };
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
        };
      });

  return {
    scope: ctx.kind,
    scope_note: SCOPE_NOTES[ctx.kind],
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
    coordinateSystem: 'Pixels. x grows to the right, y grows DOWNWARD (so gravity y > 0 pulls down, and "above" means smaller y). Entity positions are centers.',
  };
}
