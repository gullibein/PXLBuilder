import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from './components/builtin';
import { buildGraph, findEntities, findRelationships, nodeId, relationshipsOf, rulesAbout, sourcesOfItem } from './graph/graph';
import { describeRelationship, describeRule } from './logic/describe';
import * as logic from './logic/mutations';
import { RelationshipRegistry } from './logic/vocabulary';
import { createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { projectFromBundle, projectFromFiles, projectToBundle, projectToFiles } from './serialization/serialize';
import { FORMAT_VERSION } from './serialization/version';
import type { Project, Relationship, Rule } from './types';

const registry = createBuiltinRegistry();

/** Player, two Doors, a Switch, a Key and a Coin in one level. */
function world() {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  const ids: Record<string, string> = {};
  const def = (name: string) => project.definitions.find((d) => d.name === name)!;
  project = produce(project, (d) => {
    for (const [name, as, x] of [['Player', 'Player', 0], ['Door', 'Blue Door', 100], ['Door', 'Red Door', 200], ['Switch', 'Switch 1', 50], ['Key', 'Blue Key', 20], ['Coin', 'Coin', 30]] as const) {
      const e = instantiateDefinition(def(name), { x, y: 0 }, as);
      m.addEntity(d, sceneId, e);
      ids[as] = e.id;
    }
  });
  return { project, sceneId, ids, def: (name: string) => def(name).id };
}

const ent = (id: string) => ({ kind: 'entity' as const, id });
const obj = (id: string) => ({ kind: 'object' as const, id });
const rel = (type: string, source: Relationship['source'], target: Relationship['target'], extra: Partial<Relationship> = {}) => ({ type, source, target, params: {}, conditions: [], ...extra });
const rule = (extra: Partial<Rule> = {}): Omit<Rule, 'id'> => ({
  name: '',
  enabled: true,
  when: { event: 'touch_started', subject: { kind: 'any' }, other: { kind: 'any' } },
  conditions: [],
  actions: [{ type: 'show_message', text: 'Hi', seconds: 3 }],
  ...extra,
});

function edit(project: Project, recipe: (d: Project) => void): Project {
  return produce(project, (d) => {
    recipe(d);
  });
}

describe('relationships', () => {
  it('are created with defaults filled in and described in words', () => {
    const { project, sceneId, ids } = world();
    let id = '';
    const p = edit(project, (d) => {
      id = logic.addRelationship(d, sceneId, rel('controls', ent(ids['Switch 1']), ent(ids['Blue Door'])));
    });
    const r = p.scenes[0].relationships.find((x) => x.id === id)!;
    expect(r.params).toEqual({ action: 'toggle' });
    expect(describeRelationship(p, p.scenes[0], r)).toBe('Switch 1 controls Blue Door');
  });

  it('are validated: type, parameters and references', () => {
    const { project, sceneId, ids, def } = world();
    const tryAdd = (input: ReturnType<typeof rel>) => () => edit(project, (d) => void logic.addRelationship(d, sceneId, input));
    expect(tryAdd(rel('befriends', ent(ids.Player), ent(ids.Coin)))).toThrow(/Unknown relationship type "befriends"/);
    expect(tryAdd(rel('controls', ent(ids['Switch 1']), ent('ent_nope')))).toThrow(/not in level/);
    expect(tryAdd(rel('requires', ent(ids['Blue Door']), obj('def_nope')))).toThrow(/does not exist/);
    expect(tryAdd(rel('controls', ent(ids['Switch 1']), ent(ids['Blue Door']), { params: { action: 'explode' } }))).toThrow(/must be one of/);
    expect(tryAdd(rel('controls', ent(ids['Switch 1']), ent(ids['Blue Door']), { params: { speed: 2 } }))).toThrow(/no parameter "speed"/);
    expect(tryAdd(rel('controls', { kind: 'subject' }, ent(ids['Blue Door'])))).toThrow(/must name an entity/);
    expect(tryAdd(rel('requires', ent(ids['Blue Door']), obj(def('Key')), { conditions: [{ type: 'has_item', entity: { kind: 'any' }, item: 'x', count: 1, not: false }] }))).toThrow(/must name who/);
  });

  it('carry conditions ("only if the player has the key")', () => {
    const { project, sceneId, ids } = world();
    const p = edit(project, (d) => {
      logic.addRelationship(d, sceneId, rel('controls', ent(ids['Switch 1']), ent(ids['Blue Door']), { conditions: [{ type: 'has_item', entity: { kind: 'other' }, item: 'key', count: 1, not: false }] }));
    });
    expect(describeRelationship(p, p.scenes[0], p.scenes[0].relationships[0])).toBe('Switch 1 controls Blue Door, only if who uses it has key');
  });

  it('can be updated and removed', () => {
    const { project, sceneId, ids } = world();
    let id = '';
    let p = edit(project, (d) => {
      id = logic.addRelationship(d, sceneId, rel('controls', ent(ids['Switch 1']), ent(ids['Blue Door'])));
    });
    p = edit(p, (d) => logic.updateRelationship(d, sceneId, id, { params: { action: 'open' } }));
    expect(p.scenes[0].relationships[0].params.action).toBe('open');
    expect(() => edit(p, (d) => logic.updateRelationship(d, sceneId, id, { params: { action: 'nope' } }))).toThrow();
    p = edit(p, (d) => logic.removeRelationship(d, sceneId, id));
    expect(p.scenes[0].relationships).toEqual([]);
  });

  it('the registry is extensible', () => {
    const reg = new RelationshipRegistry([]);
    reg.register({ type: 'afraid_of', verb: 'is afraid of', description: '', simulated: false, params: { distance: { kind: 'number', default: 64, min: 0 } } });
    expect(reg.normalizeParams('afraid_of', {})).toEqual({ params: { distance: 64 } });
    expect(reg.normalizeParams('afraid_of', { distance: -1 })).toEqual({ error: 'afraid_of.distance must be >= 0' });
  });
});

describe('rules', () => {
  it('are validated: event, filters, conditions and actions', () => {
    const { project, sceneId, ids, def } = world();
    const tryAdd = (r: Omit<Rule, 'id'>) => () => edit(project, (d) => void logic.addRule(d, sceneId, r));
    expect(tryAdd(rule({ when: { event: 'sneezed', subject: { kind: 'any' }, other: { kind: 'any' } } }))).toThrow(/Unknown event "sneezed"/);
    expect(tryAdd(rule({ when: { event: 'died', subject: { kind: 'subject' }, other: { kind: 'any' } } }))).toThrow(/when subject/);
    expect(tryAdd(rule({ actions: [] }))).toThrow(/actions/);
    expect(tryAdd(rule({ actions: [{ type: 'open', target: { kind: 'any' } }] }))).toThrow(/must name its target/);
    expect(tryAdd(rule({ actions: [{ type: 'spawn', object: 'def_nope', at: null, x: 0, y: 0 }] }))).toThrow(/does not exist/);
    expect(tryAdd(rule({ actions: [{ type: 'open', target: ent('ent_gone') }] }))).toThrow(/not in level/);
    expect(tryAdd(rule({ when: { event: 'collected', subject: obj(def('Player')), other: ent(ids.Coin) } }))).not.toThrow();
  });

  it('fill in defaults for loosely written input (as the AI sends it)', () => {
    const { project, sceneId, ids } = world();
    const p = edit(project, (d) => {
      logic.addRule(d, sceneId, { when: { event: 'level_started' }, actions: [{ type: 'open', target: ent(ids['Blue Door']) }] } as unknown as Omit<Rule, 'id'>);
    });
    const r = p.scenes[0].rules[0];
    expect(r).toMatchObject({ enabled: true, name: '', conditions: [], when: { event: 'level_started', subject: { kind: 'any' }, other: { kind: 'any' } } });
    expect(describeRule(p, p.scenes[0], r)).toBe('When the level starts: open Blue Door.');
  });

  it('read as sentences', () => {
    const { project, sceneId, ids, def } = world();
    const p = edit(project, (d) => {
      logic.addRule(d, sceneId, rule({
        when: { event: 'collected', subject: obj(def('Player')), other: ent(ids['Blue Key']) },
        conditions: [{ type: 'health', entity: { kind: 'subject' }, compare: '>=', value: 2, not: false }],
        actions: [{ type: 'open', target: ent(ids['Red Door']) }, { type: 'show_message', text: 'Unlocked', seconds: 2 }],
      }));
    });
    expect(describeRule(p, p.scenes[0], p.scenes[0].rules[0])).toBe('When every Player picks up Blue Key, if every Player\'s health >= 2: open Red Door and show "Unlocked".');
  });

  it('can be disabled, renamed and removed', () => {
    const { project, sceneId } = world();
    let id = '';
    let p = edit(project, (d) => {
      id = logic.addRule(d, sceneId, rule());
    });
    p = edit(p, (d) => {
      logic.setRuleEnabled(d, sceneId, id, false);
      logic.renameRule(d, sceneId, id, '  Greeting ');
    });
    expect(p.scenes[0].rules[0]).toMatchObject({ enabled: false, name: 'Greeting' });
    p = edit(p, (d) => logic.removeRule(d, sceneId, id));
    expect(p.scenes[0].rules).toEqual([]);
  });
});

describe('deleting things keeps references valid', () => {
  it('deleting an entity removes the relationships and rules about it', () => {
    const { project, sceneId, ids } = world();
    let p = edit(project, (d) => {
      logic.addRelationship(d, sceneId, rel('controls', ent(ids['Switch 1']), ent(ids['Blue Door'])));
      logic.addRelationship(d, sceneId, rel('controls', ent(ids['Switch 1']), ent(ids['Red Door'])));
      logic.addRule(d, sceneId, rule({ actions: [{ type: 'open', target: ent(ids['Blue Door']) }] }));
      logic.addRule(d, sceneId, rule());
    });
    p = edit(p, (d) => m.removeEntities(d, sceneId, [ids['Blue Door']]));
    expect(p.scenes[0].relationships).toHaveLength(1);
    expect(p.scenes[0].relationships[0].target).toEqual(ent(ids['Red Door']));
    expect(p.scenes[0].rules).toHaveLength(1);
  });

  it('deleting an object removes relationships and rules that name it', () => {
    const { project, sceneId, ids, def } = world();
    let p = edit(project, (d) => {
      logic.addRelationship(d, sceneId, rel('requires', ent(ids['Blue Door']), obj(def('Key'))));
      logic.addRule(d, sceneId, rule({ actions: [{ type: 'spawn', object: def('Key'), at: null, x: 0, y: 0 }] }));
    });
    p = edit(p, (d) => m.deleteDefinition(d, def('Key'), registry));
    expect(p.scenes[0].relationships).toEqual([]);
    expect(p.scenes[0].rules).toEqual([]);
  });
});

describe('graph queries', () => {
  function wired() {
    const w = world();
    const p = edit(w.project, (d) => {
      logic.addRelationship(d, w.sceneId, rel('controls', ent(w.ids['Switch 1']), ent(w.ids['Blue Door'])));
      logic.addRelationship(d, w.sceneId, rel('controls', ent(w.ids['Switch 1']), ent(w.ids['Red Door'])));
      logic.addRelationship(d, w.sceneId, rel('requires', ent(w.ids['Blue Door']), obj(w.def('Key'))));
      logic.addRelationship(d, w.sceneId, rel('targets', { kind: 'tag', tag: 'enemy' }, obj(w.def('Player'))));
      logic.addRule(d, w.sceneId, rule({ when: { event: 'collected', subject: { kind: 'any' }, other: ent(w.ids.Coin) }, actions: [{ type: 'open', target: ent(w.ids['Red Door']) }] }));
    });
    return { ...w, project: p, scene: p.scenes[0] };
  }

  it('"Find all objects controlled by Switch 1"', () => {
    const { project, scene, ids } = wired();
    const found = findRelationships(project, scene, { type: 'controls', source: ent(ids['Switch 1']) });
    expect(found.flatMap((r) => r.targets.map((e) => e.name))).toEqual(['Blue Door', 'Red Door']);
  });

  it('"Find all doors requiring the Key" (through the object)', () => {
    const { project, scene, def } = wired();
    const found = findRelationships(project, scene, { type: 'requires', target: obj(def('Key')) });
    expect(found.flatMap((r) => r.sources.map((e) => e.name))).toEqual(['Blue Door']);
  });

  it('"Find all hazards in Level 1" and entities by component', () => {
    const { project, sceneId } = wired();
    expect(findEntities(project, registry, { sceneId, tag: 'door' }).map((x) => x.entity.name)).toEqual(['Blue Door', 'Red Door']);
    expect(findEntities(project, registry, { component: 'Switch' }).map((x) => x.entity.name)).toEqual(['Switch 1']);
    expect(findEntities(project, registry, { name: 'blue key' }).map((x) => x.entity.name)).toEqual(['Blue Key']);
  });

  it('relationships and rules of one entity, including through its object or tags', () => {
    const { project, scene, ids } = wired();
    const door = relationshipsOf(project, scene, ids['Blue Door']);
    expect(door.outgoing.map((r) => r.type)).toEqual(['requires']);
    expect(door.incoming.map((r) => r.type)).toEqual(['controls']);
    expect(relationshipsOf(project, scene, ids.Player).incoming.map((r) => r.type)).toEqual(['targets']);
    expect(rulesAbout(project, scene, ids['Red Door'])).toHaveLength(1);
    expect(rulesAbout(project, scene, ids['Blue Door'])).toHaveLength(0);
  });

  it('"Where does the player get the key?"', () => {
    const { project } = wired();
    expect(sourcesOfItem(project, registry, 'key').map((s) => [s.entity.name, s.how])).toEqual([['Blue Key', 'pickup']]);
    expect(sourcesOfItem(project, registry, 'coin').map((s) => s.entity.name)).toEqual(['Coin']);
  });

  it('the graph has structure, relationship and rule edges', () => {
    const { project, ids, def } = wired();
    const g = buildGraph(project, registry);
    expect(g.out(nodeId.entity(ids['Switch 1']), 'controls').map((n) => n.label)).toEqual(['Blue Door', 'Red Door']);
    expect(g.out(nodeId.entity(ids['Blue Key']), 'instance_of').map((n) => n.label)).toEqual(['Key']);
    expect(g.out(nodeId.object(def('Key')), 'gives_item').map((n) => n.label)).toEqual(['key']);
    expect(g.in(nodeId.object(def('Key')), 'requires').map((n) => n.label)).toEqual(['Blue Door']);
    expect(g.out(nodeId.tag('enemy'), 'targets').map((n) => n.label)).toEqual(['Player']);
    const ruleNode = g.ofKind('rule')[0];
    expect(g.out(ruleNode.id, 'listens_to').map((n) => n.label)).toEqual(['collected']);
    expect(g.out(ruleNode.id, 'acts_on').map((n) => n.label)).toEqual(['Red Door']);
    expect(g.out(nodeId.object(def('Player')), 'has_component').map((n) => n.label)).toContain('Inventory');
  });
});

describe('saving and loading logic', () => {
  it('relationships and rules survive a save/load round trip', () => {
    const { project, sceneId, ids, def } = world();
    const p = edit(project, (d) => {
      logic.addRelationship(d, sceneId, rel('requires', ent(ids['Blue Door']), obj(def('Key')), { params: { consume: true } }));
      logic.addRule(d, sceneId, rule({ actions: [{ type: 'restart_level' }] }));
    });
    const loaded = projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(p))), registry);
    expect(loaded.project).toEqual(p);
    expect(loaded.warnings).toEqual([]);
  });

  it('a broken reference in a saved file loads with a warning (nothing is thrown away)', () => {
    const { project, sceneId, ids, def } = world();
    const p = edit(project, (d) => void logic.addRelationship(d, sceneId, rel('requires', ent(ids['Blue Door']), obj(def('Key')))));
    const files = projectToFiles(p) as Record<string, unknown>;
    const scene = structuredClone(files[`scenes/${sceneId}.json`]) as { relationships: { source: { id: string } }[] };
    scene.relationships[0].source.id = 'ent_gone';
    files[`scenes/${sceneId}.json`] = scene;
    const loaded = projectFromFiles(files, registry);
    expect(loaded.project.scenes[0].relationships).toHaveLength(1);
    expect(loaded.warnings[0]).toMatch(/ent_gone/);
  });

  it('format v3 -> v4: levels get logic, the starter Player gets health and an inventory, Key and Switch are added', () => {
    const fresh = createProject(registry);
    const v3 = produce(fresh, (d) => {
      d.formatVersion = 3;
      const player = d.definitions.find((x) => x.name === 'Player')!;
      delete player.components.Health;
      delete player.components.DamageReceiver;
      delete player.components.Inventory;
      delete d.definitions.find((x) => x.name === 'Door')!.components.Openable;
      d.definitions.find((x) => x.name === 'Coin')!.components.Collectible.collectionBehavior = 'consume';
      d.definitions = d.definitions.filter((x) => x.name !== 'Key' && x.name !== 'Switch');
      d.assets = d.assets.filter((a) => a.name !== 'Lever');
    });
    const files = structuredClone(projectToFiles(v3)) as Record<string, Record<string, unknown>>;
    files['project.json'].formatVersion = 3;
    for (const [path, file] of Object.entries(files)) {
      if (path.startsWith('scenes/')) {
        delete file.relationships;
        delete file.rules;
      }
    }
    const { project, warnings } = projectFromFiles(files, registry);
    expect(warnings).toEqual([]);
    expect(project.formatVersion).toBe(FORMAT_VERSION);
    expect(project.scenes[0]).toMatchObject({ relationships: [], rules: [] });
    const player = project.definitions.find((x) => x.name === 'Player')!;
    expect(Object.keys(player.components)).toEqual(expect.arrayContaining(['Health', 'DamageReceiver', 'Inventory']));
    expect(project.definitions.find((x) => x.name === 'Door')!.components.Openable).toEqual({ startsOpen: false });
    expect(project.definitions.find((x) => x.name === 'Coin')!.components.Collectible.collectionBehavior).toBe('addToInventory');
    const sw = project.definitions.find((x) => x.name === 'Switch')!;
    expect(project.assets.some((a) => a.id === sw.components.Sprite.assetId)).toBe(true);
    expect(project.definitions.some((x) => x.name === 'Key')).toBe(true);
  });
});
