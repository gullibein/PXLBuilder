/**
 * AI context.
 *
 * The editor's selection establishes an explicit AIContext ("what the user is
 * working with"). buildAIPayload turns it into the small, relevant slice of
 * the project the model needs: the targets in full, everything else in brief.
 * The model never receives the raw project file.
 */
import type { ComponentRegistry } from '../components/registry';
import { getEntitySize } from '../model/geometry';
import { resolveEntity } from '../model/resolve';
import type { Id, Project, Scene, Vec2 } from '../types';

export type AIContext =
  /** One selected entity. */
  | { kind: 'entity'; sceneId: Id; entityIds: [Id] }
  /** Three or more selected entities, addressed together. */
  | { kind: 'group'; sceneId: Id; entityIds: Id[] }
  /** Exactly two selected entities: the request is usually about how they relate. Order = selection order. */
  | { kind: 'pair'; sceneId: Id; entityIds: [Id, Id] }
  /** The level itself (world settings, all of its contents). `point` is where the user pointed, if anywhere. */
  | { kind: 'level'; sceneId: Id; point: Vec2 | null }
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
  level: { id: Id; name: string; gravity: Vec2; backgroundColor: string; isStartLevel: boolean };
  /** The selected/target entities, in full. */
  targets: EntityDetail[];
  /** Where the user pointed in the level (world coordinates), if anywhere. */
  point: Vec2 | null;
  /** All other entities in the level, briefly, so the user can refer to them by name. */
  otherEntities: EntityBrief[];
  /** Object library. */
  library: { id: Id; name: string; category: string; tags: string[]; components: string[]; placedCount: number }[];
  /** Other levels (project scope only lists their contents). */
  otherLevels: { id: Id; name: string; entities?: EntityBrief[] }[];
  coordinateSystem: string;
}

const MAX_BRIEFS = 200;

const SCOPE_NOTES: Record<AIContext['kind'], string> = {
  entity: 'The user selected one entity (see targets). Phrases like "the player", "this", "it" most likely refer to it, but the user may also mention other entities by name.',
  pair: 'The user selected two entities, in this order: targets[0] then targets[1]. The request is most likely about how they relate.',
  group: 'The user selected several entities (see targets) and is addressing them together ("these", "them", "all of them").',
  level: 'The user is addressing the level itself: its world settings and its contents. "here" refers to `point` if set.',
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
    })),
    otherLevels: project.scenes
      .filter((s) => s.id !== scene.id)
      .map((s) => (ctx.kind === 'project' ? { id: s.id, name: s.name, entities: briefs(s, new Set()) } : { id: s.id, name: s.name })),
    coordinateSystem: 'Pixels. x grows to the right, y grows DOWNWARD (so gravity y > 0 pulls down, and "above" means smaller y). Entity positions are centers.',
  };
}
