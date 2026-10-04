/**
 * The game graph: the project seen as typed nodes and edges, built on demand
 * from the project model (the model stays the single source of truth).
 *
 * Structure edges (contains, instance_of, has_component, has_tag, uses_asset,
 * gives_item, carries) come from the model itself; relationship edges carry
 * the relationship's type ("controls", "requires", ...); rules link to the
 * event they listen to and to what they check and act on.
 *
 * Queries answer design questions without anyone reading raw JSON:
 * "what does Switch 1 control?", "which doors require the red key?",
 * "where can the player get the key?", "all hazards in Level 1".
 */
import type { ComponentRegistry } from '../components/registry';
import { describeRule } from '../logic/describe';
import { entityTags, refMatches, refsInActions, refsInConditions, resolveRef } from '../logic/refs';
import { resolveEntity } from '../model/resolve';
import type { EntityInstance, EntityRef, Id, Project, Relationship, Rule, Scene } from '../types';

export type NodeKind = 'project' | 'scene' | 'entity' | 'object' | 'component' | 'asset' | 'rule' | 'event' | 'tag' | 'item' | 'role';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
}

export interface GraphEdge {
  from: string;
  type: string;
  to: string;
  /** The relationship or rule this edge comes from, if any. */
  via?: Id;
  /** Extra detail, e.g. the action type for a rule's acts_on edge. */
  detail?: string;
}

export const nodeId = {
  scene: (id: Id) => `scene:${id}`,
  entity: (id: Id) => `entity:${id}`,
  object: (id: Id) => `object:${id}`,
  asset: (id: Id) => `asset:${id}`,
  rule: (id: Id) => `rule:${id}`,
  event: (type: string) => `event:${type}`,
  tag: (tag: string) => `tag:${tag}`,
  item: (name: string) => `item:${name}`,
  component: (owner: string, type: string) => `component:${owner}/${type}`,
};

/** The graph node a reference stands for (subject/other/any become role nodes). */
export function refNode(ref: EntityRef): string {
  switch (ref.kind) {
    case 'entity':
      return nodeId.entity(ref.id);
    case 'object':
      return nodeId.object(ref.id);
    case 'tag':
      return nodeId.tag(ref.tag);
    default:
      return `role:${ref.kind}`;
  }
}

/** The item name an object gives when collected (Collectible.itemId, or its name in lower case). */
export function itemNameOf(components: Record<string, Record<string, unknown>>, fallbackName: string): string | null {
  const c = components.Collectible;
  if (!c) return null;
  return typeof c.itemId === 'string' && c.itemId.trim() ? c.itemId.trim() : fallbackName.toLowerCase();
}

export class GameGraph {
  readonly nodes = new Map<string, GraphNode>();
  readonly edges: GraphEdge[] = [];

  addNode(id: string, kind: NodeKind, label: string): void {
    if (!this.nodes.has(id)) this.nodes.set(id, { id, kind, label });
  }

  addEdge(edge: GraphEdge): void {
    this.edges.push(edge);
  }

  /** Edges matching all given parts. */
  find(match: { from?: string; type?: string; to?: string; via?: Id } = {}): GraphEdge[] {
    return this.edges.filter((e) => (match.from === undefined || e.from === match.from) && (match.type === undefined || e.type === match.type) && (match.to === undefined || e.to === match.to) && (match.via === undefined || e.via === match.via));
  }

  /** Nodes reached from `from` along edges of `type` (any type if omitted). */
  out(from: string, type?: string): GraphNode[] {
    return this.find({ from, type }).map((e) => this.nodes.get(e.to)!).filter(Boolean);
  }

  /** Nodes with an edge of `type` into `to`. */
  in(to: string, type?: string): GraphNode[] {
    return this.find({ to, type }).map((e) => this.nodes.get(e.from)!).filter(Boolean);
  }

  ofKind(kind: NodeKind): GraphNode[] {
    return [...this.nodes.values()].filter((n) => n.kind === kind);
  }
}

export function buildGraph(project: Project, registry: ComponentRegistry): GameGraph {
  const g = new GameGraph();
  g.addNode('project', 'project', project.name);
  for (const a of project.assets) g.addNode(nodeId.asset(a.id), 'asset', a.name);
  const addTags = (owner: string, tags: string[]) => {
    for (const t of tags) {
      g.addNode(nodeId.tag(t), 'tag', t);
      g.addEdge({ from: owner, type: 'has_tag', to: nodeId.tag(t) });
    }
  };
  const addComponents = (owner: string, components: Record<string, Record<string, unknown>>) => {
    for (const [type, props] of Object.entries(components)) {
      const c = nodeId.component(owner, type);
      g.addNode(c, 'component', type);
      g.addEdge({ from: owner, type: 'has_component', to: c });
      if (type === 'Sprite' && typeof props.assetId === 'string' && g.nodes.has(nodeId.asset(props.assetId))) g.addEdge({ from: owner, type: 'uses_asset', to: nodeId.asset(props.assetId) });
    }
  };

  for (const d of project.definitions) {
    const n = nodeId.object(d.id);
    g.addNode(n, 'object', d.name);
    addComponents(n, d.components);
    addTags(n, d.tags);
    const item = itemNameOf(d.components, d.name);
    if (item) {
      g.addNode(nodeId.item(item), 'item', item);
      g.addEdge({ from: n, type: 'gives_item', to: nodeId.item(item) });
    }
  }

  for (const scene of project.scenes) {
    const s = nodeId.scene(scene.id);
    g.addNode(s, 'scene', scene.name);
    g.addEdge({ from: 'project', type: 'contains', to: s });
    for (const e of scene.entities) {
      const n = nodeId.entity(e.id);
      g.addNode(n, 'entity', e.name);
      g.addEdge({ from: s, type: 'contains', to: n });
      if (e.definitionId) g.addEdge({ from: n, type: 'instance_of', to: nodeId.object(e.definitionId) });
      const r = resolveEntity(project, e, registry);
      // Instance components are listed only where they differ from the object (added on this copy).
      addComponents(n, Object.fromEntries(Object.entries(r.components).filter(([t]) => !e.definitionId || r.instanceOnlyComponents.has(t))));
      addTags(n, e.tags);
      const items = r.components.Inventory?.items;
      if (Array.isArray(items)) {
        for (const item of new Set(items as string[])) {
          g.addNode(nodeId.item(item), 'item', item);
          g.addEdge({ from: n, type: 'carries', to: nodeId.item(item) });
        }
      }
    }
    for (const rel of scene.relationships) addRelationshipEdges(g, project, scene, rel);
    for (const rule of scene.rules) addRuleEdges(g, project, scene, rule);
  }
  return g;
}

function ensureRefNode(g: GameGraph, project: Project, scene: Scene, ref: EntityRef): string {
  const id = refNode(ref);
  if (ref.kind === 'tag') g.addNode(id, 'tag', ref.tag);
  else if (ref.kind === 'subject' || ref.kind === 'other' || ref.kind === 'any') g.addNode(id, 'role', ref.kind);
  else if (!g.nodes.has(id)) g.addNode(id, ref.kind === 'entity' ? 'entity' : 'object', ref.kind === 'entity' ? (scene.entities.find((e) => e.id === ref.id)?.name ?? ref.id) : (project.definitions.find((d) => d.id === ref.id)?.name ?? ref.id));
  return id;
}

function addRelationshipEdges(g: GameGraph, project: Project, scene: Scene, rel: Relationship): void {
  g.addEdge({ from: ensureRefNode(g, project, scene, rel.source), type: rel.type, to: ensureRefNode(g, project, scene, rel.target), via: rel.id });
  for (const ref of refsInConditions(rel.conditions)) g.addEdge({ from: ensureRefNode(g, project, scene, rel.source), type: 'depends_on', to: ensureRefNode(g, project, scene, ref), via: rel.id });
}

function addRuleEdges(g: GameGraph, project: Project, scene: Scene, rule: Rule): void {
  const r = nodeId.rule(rule.id);
  g.addNode(r, 'rule', rule.name || describeRule(project, scene, rule));
  g.addEdge({ from: nodeId.scene(scene.id), type: 'contains', to: r });
  g.addNode(nodeId.event(rule.when.event), 'event', rule.when.event);
  g.addEdge({ from: r, type: 'listens_to', to: nodeId.event(rule.when.event) });
  for (const ref of [rule.when.subject, rule.when.other]) if (ref.kind !== 'any') g.addEdge({ from: r, type: 'triggered_by', to: ensureRefNode(g, project, scene, ref) });
  for (const ref of refsInConditions(rule.conditions)) g.addEdge({ from: r, type: 'checks', to: ensureRefNode(g, project, scene, ref) });
  for (const a of rule.actions) {
    for (const ref of refsInActions([a])) g.addEdge({ from: r, type: a.type === 'spawn' && ref.kind === 'object' ? 'spawns' : 'acts_on', to: ensureRefNode(g, project, scene, ref), detail: a.type });
  }
}

// ---------------------------------------------------------------- model queries

const asTarget = (project: Project, e: EntityInstance) => ({ id: e.id, definitionId: e.definitionId, tags: entityTags(project, e) });

/** True if a relationship/rule reference covers this entity (directly, through its object, or a tag). */
export function refCovers(project: Project, ref: EntityRef, e: EntityInstance): boolean {
  if (ref.kind === 'subject' || ref.kind === 'other' || ref.kind === 'any') return false;
  return refMatches(ref, asTarget(project, e));
}

/** Two references overlap if they are the same, or share at least one placed entity. */
function refsOverlap(project: Project, scene: Scene, a: EntityRef, b: EntityRef): boolean {
  if (JSON.stringify(a) === JSON.stringify(b)) return true;
  const ids = new Set(resolveRef(project, scene, a).map((e) => e.id));
  return resolveRef(project, scene, b).some((e) => ids.has(e.id));
}

/** Entities in a level (or every level) by name, tag, component or object. */
export function findEntities(
  project: Project,
  registry: ComponentRegistry,
  filter: { sceneId?: Id; name?: string; tag?: string; component?: string; objectId?: Id },
): { sceneId: Id; entity: EntityInstance }[] {
  const out: { sceneId: Id; entity: EntityInstance }[] = [];
  for (const s of project.scenes) {
    if (filter.sceneId && s.id !== filter.sceneId) continue;
    for (const e of s.entities) {
      if (filter.name && e.name.toLowerCase() !== filter.name.toLowerCase()) continue;
      if (filter.objectId && e.definitionId !== filter.objectId) continue;
      if (filter.tag && !entityTags(project, e).includes(filter.tag)) continue;
      if (filter.component && !(filter.component in resolveEntity(project, e, registry).components)) continue;
      out.push({ sceneId: s.id, entity: e });
    }
  }
  return out;
}

export interface RelationshipMatch {
  relationship: Relationship;
  sources: EntityInstance[];
  targets: EntityInstance[];
}

/**
 * Relationships of a type (any if omitted) whose source and/or target overlap
 * the given references. "Find all doors requiring RedKey":
 * findRelationships(p, scene, { type: 'requires', target: { kind: 'object', id: redKey } }).
 */
export function findRelationships(project: Project, scene: Scene, match: { type?: string; source?: EntityRef; target?: EntityRef }): RelationshipMatch[] {
  return scene.relationships
    .filter((r) => (!match.type || r.type === match.type) && (!match.source || refsOverlap(project, scene, r.source, match.source)) && (!match.target || refsOverlap(project, scene, r.target, match.target)))
    .map((r) => ({ relationship: r, sources: resolveRef(project, scene, r.source), targets: resolveRef(project, scene, r.target) }));
}

/** Relationships an entity takes part in, as source (outgoing) or target (incoming), including through its object or tags. */
export function relationshipsOf(project: Project, scene: Scene, entityId: Id): { outgoing: Relationship[]; incoming: Relationship[] } {
  const e = scene.entities.find((x) => x.id === entityId);
  if (!e) return { outgoing: [], incoming: [] };
  return {
    outgoing: scene.relationships.filter((r) => refCovers(project, r.source, e)),
    incoming: scene.relationships.filter((r) => refCovers(project, r.target, e)),
  };
}

/** Rules that mention an entity anywhere (trigger, condition or action), including through its object or tags. */
export function rulesAbout(project: Project, scene: Scene, entityId: Id): Rule[] {
  const e = scene.entities.find((x) => x.id === entityId);
  if (!e) return [];
  return scene.rules.filter((r) => [r.when.subject, r.when.other, ...refsInConditions(r.conditions), ...refsInActions(r.actions)].some((ref) => refCovers(project, ref, e)));
}

/** Where an item can be had: placed collectibles giving it, and entities that start with it. */
export function sourcesOfItem(project: Project, registry: ComponentRegistry, item: string): { sceneId: Id; entity: EntityInstance; how: 'pickup' | 'carried' | 'rule' }[] {
  const out: { sceneId: Id; entity: EntityInstance; how: 'pickup' | 'carried' | 'rule' }[] = [];
  for (const s of project.scenes) {
    for (const e of s.entities) {
      const r = resolveEntity(project, e, registry);
      const objectName = project.definitions.find((d) => d.id === e.definitionId)?.name ?? e.name;
      if (itemNameOf(r.components, objectName) === item) out.push({ sceneId: s.id, entity: e, how: 'pickup' });
      else if (Array.isArray(r.components.Inventory?.items) && (r.components.Inventory.items as string[]).includes(item)) out.push({ sceneId: s.id, entity: e, how: 'carried' });
    }
    for (const rule of s.rules) {
      for (const a of rule.actions) {
        if (a.type !== 'give_item' || a.item !== item) continue;
        for (const e of resolveRef(project, s, a.target)) out.push({ sceneId: s.id, entity: e, how: 'rule' });
      }
    }
  }
  return out;
}
