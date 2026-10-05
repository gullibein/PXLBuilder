/**
 * Validated edits for relationships and rules. Like the other model
 * mutations they change a draft project in place and throw ModelError on bad
 * input, so the inspector, the AI and tests all go through the same checks.
 */
import { generateId } from '../ids';
import { getScene, ModelError } from '../model/mutations';
import type { Condition, EntityRef, Id, Project, Relationship, Rule, RuleAction, Scene } from '../types';
import { checkRef } from './refs';
import { eventRegistry, relationshipRegistry, relationshipSchema, ruleSchema } from './vocabulary';

function issues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const i = error.issues[0];
  return `${i.path.map(String).join('.') || '(root)'}: ${i.message}`;
}

function check(project: Project, scene: Scene, ref: EntityRef, where: string, allowEventRefs: boolean): void {
  const err = checkRef(project, scene, ref, where, allowEventRefs);
  if (err) throw new ModelError(err);
}

function checkConditions(project: Project, scene: Scene, conditions: Condition[], where: string): void {
  conditions.forEach((c, i) => {
    if (c.entity.kind === 'any') throw new ModelError(`${where} condition ${i + 1}: must name who it is about`);
    check(project, scene, c.entity, `${where} condition ${i + 1}`, true);
  });
}

function checkActions(project: Project, scene: Scene, actions: RuleAction[]): void {
  actions.forEach((a, i) => {
    const where = `Action ${i + 1} (${a.type})`;
    if ('target' in a) {
      if (a.target.kind === 'any') throw new ModelError(`${where}: must name its target`);
      check(project, scene, a.target, where, true);
    }
    if (a.type === 'teleport') {
      if (a.to.kind === 'any') throw new ModelError(`${where}: must say where to`);
      check(project, scene, a.to, where, true);
    }
    if (a.type === 'spawn') {
      if (!project.definitions.some((d) => d.id === a.object)) throw new ModelError(`${where}: object "${a.object}" does not exist`);
      if (a.at) check(project, scene, a.at, where, true);
    }
  });
}

/** Validates and normalizes a relationship (defaults filled in). */
export function validateRelationship(project: Project, sceneId: Id, input: unknown): Relationship {
  const scene = getScene(project, sceneId);
  const parsed = relationshipSchema.safeParse(input);
  if (!parsed.success) throw new ModelError(`Relationship ${issues(parsed.error)}`);
  const rel = parsed.data as Relationship;
  if (!relationshipRegistry.has(rel.type)) {
    throw new ModelError(`Unknown relationship type "${rel.type}". Known: ${relationshipRegistry.list().map((t) => t.type).join(', ')}`);
  }
  const params = relationshipRegistry.normalizeParams(rel.type, rel.params);
  if ('error' in params) throw new ModelError(params.error);
  check(project, scene, rel.source, 'Relationship source', false);
  check(project, scene, rel.target, 'Relationship target', false);
  checkConditions(project, scene, rel.conditions, 'Relationship');
  return { ...rel, params: params.params };
}

/** Validates and normalizes a rule (defaults filled in). */
export function validateRule(project: Project, sceneId: Id, input: unknown): Rule {
  const scene = getScene(project, sceneId);
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) throw new ModelError(`Rule ${issues(parsed.error)}`);
  const rule = parsed.data as Rule;
  if (!eventRegistry.has(rule.when.event)) {
    throw new ModelError(`Unknown event "${rule.when.event}". Known: ${eventRegistry.list().map((e) => e.type).join(', ')}`);
  }
  for (const [role, ref] of [['subject', rule.when.subject], ['other', rule.when.other]] as const) {
    if (ref.kind === 'subject' || ref.kind === 'other') throw new ModelError(`Rule "when ${role}" must be an entity, an object, a tag or any`);
    check(project, scene, ref, `Rule "when ${role}"`, true);
  }
  checkConditions(project, scene, rule.conditions, 'Rule');
  checkActions(project, scene, rule.actions);
  return rule;
}

export function addRelationship(project: Project, sceneId: Id, input: Omit<Relationship, 'id'> & { id?: Id }): Id {
  const rel = validateRelationship(project, sceneId, { ...input, id: input.id ?? generateId('rel') });
  const scene = getScene(project, sceneId);
  if (scene.relationships.some((r) => r.id === rel.id)) throw new ModelError(`Relationship "${rel.id}" already exists`);
  scene.relationships.push(rel);
  return rel.id;
}

export function getRelationship(project: Project, sceneId: Id, id: Id): Relationship {
  const rel = getScene(project, sceneId).relationships.find((r) => r.id === id);
  if (!rel) throw new ModelError(`Relationship "${id}" not found`);
  return rel;
}

/** Replaces a relationship's parameters and/or conditions (validated together). */
export function updateRelationship(project: Project, sceneId: Id, id: Id, patch: Partial<Pick<Relationship, 'params' | 'conditions' | 'source' | 'target'>>): void {
  const current = getRelationship(project, sceneId, id);
  const next = validateRelationship(project, sceneId, { ...current, ...patch });
  Object.assign(current, next);
}

export function removeRelationship(project: Project, sceneId: Id, id: Id): void {
  getRelationship(project, sceneId, id);
  const scene = getScene(project, sceneId);
  scene.relationships = scene.relationships.filter((r) => r.id !== id);
}

export function addRule(project: Project, sceneId: Id, input: Omit<Rule, 'id'> & { id?: Id }): Id {
  const rule = validateRule(project, sceneId, { ...input, id: input.id ?? generateId('rul') });
  const scene = getScene(project, sceneId);
  if (scene.rules.some((r) => r.id === rule.id)) throw new ModelError(`Rule "${rule.id}" already exists`);
  scene.rules.push(rule);
  return rule.id;
}

export function getRule(project: Project, sceneId: Id, id: Id): Rule {
  const rule = getScene(project, sceneId).rules.find((r) => r.id === id);
  if (!rule) throw new ModelError(`Rule "${id}" not found`);
  return rule;
}

export function removeRule(project: Project, sceneId: Id, id: Id): void {
  getRule(project, sceneId, id);
  const scene = getScene(project, sceneId);
  scene.rules = scene.rules.filter((r) => r.id !== id);
}

export function setRuleEnabled(project: Project, sceneId: Id, id: Id, enabled: boolean): void {
  getRule(project, sceneId, id).enabled = enabled;
}

export function renameRule(project: Project, sceneId: Id, id: Id, name: string): void {
  getRule(project, sceneId, id).name = name.trim();
}
