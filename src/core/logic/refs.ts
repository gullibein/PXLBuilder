/**
 * Entity references: resolving them to entities, checking that they point at
 * something real, and describing them in words.
 */
import { findDefinition } from '../model/resolve';
import type { Condition, EntityInstance, EntityRef, Id, Project, RuleAction, Scene } from '../types';

/** What a reference needs to know about an entity: works for project entities and runtime entities alike. */
export interface RefTarget {
  id: Id;
  definitionId: Id | null;
  tags: readonly string[];
}

export interface EventEntities {
  subject?: RefTarget | null;
  other?: RefTarget | null;
}

/** True if `ref` points at `e`. `subject`/`other` compare with the event's entities. */
export function refMatches(ref: EntityRef, e: RefTarget, event: EventEntities = {}): boolean {
  switch (ref.kind) {
    case 'entity':
      return e.id === ref.id;
    case 'object':
      return e.definitionId === ref.id;
    case 'tag':
      return e.tags.includes(ref.tag);
    case 'subject':
      return event.subject?.id === e.id;
    case 'other':
      return event.other?.id === e.id;
    case 'any':
      return true;
  }
}

/** Effective tags of a placed entity (its object's tags plus its own). */
export function entityTags(project: Project, e: EntityInstance): string[] {
  const def = findDefinition(project, e.definitionId);
  return [...new Set([...(def?.tags ?? []), ...e.tags])];
}

/** The placed entities a reference points at (subject/other/any resolve to nothing outside an event). */
export function resolveRef(project: Project, scene: Scene, ref: EntityRef): EntityInstance[] {
  if (ref.kind === 'subject' || ref.kind === 'other' || ref.kind === 'any') return [];
  return scene.entities.filter((e) => refMatches(ref, { id: e.id, definitionId: e.definitionId, tags: entityTags(project, e) }));
}

/** Error message if the reference points at an entity or object that does not exist. */
export function checkRef(project: Project, scene: Scene, ref: EntityRef, where: string, allowEventRefs: boolean): string | null {
  switch (ref.kind) {
    case 'entity':
      return scene.entities.some((e) => e.id === ref.id) ? null : `${where}: entity "${ref.id}" is not in level "${scene.name}"`;
    case 'object':
      return project.definitions.some((d) => d.id === ref.id) ? null : `${where}: object "${ref.id}" does not exist`;
    case 'tag':
      return ref.tag.trim() ? null : `${where}: empty tag`;
    case 'subject':
    case 'other':
    case 'any':
      return allowEventRefs ? null : `${where}: must name an entity, an object or a tag`;
  }
}

export function sameRef(a: EntityRef, b: EntityRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** True if the reference names this entity or this object directly. */
export function refNames(ref: EntityRef, what: { entityId?: Id; definitionId?: Id }): boolean {
  return (ref.kind === 'entity' && ref.id === what.entityId) || (ref.kind === 'object' && ref.id === what.definitionId);
}

/** Every entity reference inside conditions and actions (for cascades and the graph). */
export function refsInConditions(conditions: Condition[]): EntityRef[] {
  return conditions.map((c) => c.entity);
}

export function refsInActions(actions: RuleAction[]): EntityRef[] {
  const out: EntityRef[] = [];
  for (const a of actions) {
    if ('target' in a && a.target) out.push(a.target);
    if (a.type === 'teleport') out.push(a.to);
    if (a.type === 'spawn') {
      out.push({ kind: 'object', id: a.object });
      if (a.at) out.push(a.at);
    }
  }
  return out;
}

/** "Door", "every Coin", "anything tagged enemy", "who touched". */
export function describeRef(project: Project, scene: Scene | null, ref: EntityRef, roles: { subject?: string | null; other?: string | null } = {}): string {
  switch (ref.kind) {
    case 'entity':
      return scene?.entities.find((e) => e.id === ref.id)?.name ?? '(missing entity)';
    case 'object': {
      const name = project.definitions.find((d) => d.id === ref.id)?.name ?? '(missing object)';
      return `every ${name}`;
    }
    case 'tag':
      return `anything tagged ${ref.tag}`;
    case 'subject':
      return roles.subject ?? 'the subject';
    case 'other':
      return roles.other ?? 'the other one';
    case 'any':
      return 'anything';
  }
}

/**
 * Removes the relationships and rules that point at something that is gone
 * (a deleted entity, or an object that no longer exists). Returns how many.
 */
export function pruneLogic(scene: Scene, isGone: (ref: EntityRef) => boolean): { relationships: number; rules: number } {
  const before = { relationships: scene.relationships.length, rules: scene.rules.length };
  scene.relationships = scene.relationships.filter((r) => ![r.source, r.target, ...refsInConditions(r.conditions)].some(isGone));
  scene.rules = scene.rules.filter((r) => ![r.when.subject, r.when.other, ...refsInConditions(r.conditions), ...refsInActions(r.actions)].some(isGone));
  return { relationships: before.relationships - scene.relationships.length, rules: before.rules - scene.rules.length };
}
