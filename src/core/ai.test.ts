import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './ai/capabilities';
import { buildAIPayload, contextFromSelection, contextKey } from './ai/context';
import { aiResponseSchema } from './ai/protocol';
import { EMPTY_HISTORY, record, redo, undo } from './commands/history';
import { applyOperations, operationSchema, type Operation } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { resolveEntity } from './model/resolve';
import type { Project } from './types';

const registry = createBuiltinRegistry();

function level() {
  let project = createProject(registry, 'Test');
  const sceneId = project.scenes[0].id;
  const def = (name: string) => project.definitions.find((d) => d.name === name)!;
  const player = instantiateDefinition(def('Player'), { x: 0, y: 0 });
  const enemy = instantiateDefinition(def('Enemy'), { x: 200, y: 0 });
  const enemy2 = instantiateDefinition(def('Enemy'), { x: 300, y: 0 }, 'Enemy 2');
  const door = instantiateDefinition(def('Door'), { x: 500, y: 0 });
  project = produce(project, (d) => {
    for (const e of [player, enemy, enemy2, door]) m.addEntity(d, sceneId, e);
  });
  return { project, sceneId, player, enemy, enemy2, door, def };
}

const apply = (project: Project, ops: Operation[]) => produce(project, (d) => void applyOperations(d, ops, registry));

describe('operations', () => {
  it('"Make the player hurt enemies" -> add Damage on the instance', () => {
    const { project, sceneId, player } = level();
    const next = apply(project, [{ op: 'add_component', target: 'instance', id: player.id, component: 'Damage', propsJson: '{"amount":2}' }]);
    const r = resolveEntity(next, m.getEntity(next, sceneId, player.id), registry);
    expect(r.components.Damage).toEqual({ amount: 2 });
  });

  it('"Make gravity 30% weaker" -> set_world', () => {
    const { project, sceneId } = level();
    const next = apply(project, [{ op: 'set_world', sceneId, gravityX: null, gravityY: 686, backgroundColor: null }]);
    expect(next.scenes[0].world.gravity).toEqual({ x: 0, y: 686 });
  });

  it('definition target changes every non-overriding instance', () => {
    const { project, sceneId, enemy, enemy2, def } = level();
    const next = apply(project, [{ op: 'set_component_field', target: 'definition', id: def('Enemy').id, component: 'Sprite', field: 'color', valueJson: '"#00ff00"' }]);
    for (const e of [enemy, enemy2]) expect(resolveEntity(next, m.getEntity(next, sceneId, e.id), registry).components.Sprite.color).toBe('#00ff00');
  });

  it('creates a definition and places it by ref', () => {
    const { project, sceneId } = level();
    let result!: ReturnType<typeof applyOperations>;
    const next = produce(project, (d) => {
      result = applyOperations(
        d,
        [
          {
            op: 'create_definition',
            ref: 'robot',
            name: 'Flying Robot',
            description: 'Hovers and patrols',
            category: 'Enemies',
            tags: ['Enemy', 'flying'],
            components: [
              { component: 'Sprite', propsJson: '{"width":24,"height":20,"color":"#9aa7ff"}' },
              { component: 'PhysicsBody', propsJson: '{"gravityScale":0}' },
            ],
          },
          { op: 'place_instance', sceneId, definitionRef: 'robot', x: 100, y: -100, name: null },
        ],
        registry,
      );
    });
    const def = next.definitions.find((d) => d.name === 'Flying Robot')!;
    expect(def.metadata.category).toBe('Enemies');
    expect(def.tags).toEqual(['enemy', 'flying']);
    expect(def.components.PhysicsBody.gravityScale).toBe(0);
    expect(def.components.PhysicsBody.bodyType).toBe('dynamic'); // defaults filled
    expect(result.createdDefinitionIds).toEqual([def.id]);
    expect(m.getEntity(next, sceneId, result.createdEntityIds[0]).definitionId).toBe(def.id);
  });

  it('is all-or-nothing: one invalid operation rejects the whole list', () => {
    const { project, player } = level();
    expect(() =>
      apply(project, [
        { op: 'rename', target: 'instance', id: player.id, name: 'Hero' },
        { op: 'add_component', target: 'instance', id: player.id, component: 'Jetpack', propsJson: '{}' },
      ]),
    ).toThrow(/Unknown component type "Jetpack"/);
    expect(project.scenes[0].entities.find((e) => e.id === player.id)!.name).toBe('Player');
  });

  it('rejects bad JSON, bad values and unknown ids', () => {
    const { project, player } = level();
    expect(() => apply(project, [{ op: 'set_component_field', target: 'instance', id: player.id, component: 'Sprite', field: 'width', valueJson: 'wide' }])).toThrow(/not valid JSON/);
    expect(() => apply(project, [{ op: 'set_component_field', target: 'instance', id: player.id, component: 'Sprite', field: 'width', valueJson: '"wide"' }])).toThrow(/number/);
    expect(() => apply(project, [{ op: 'rename', target: 'instance', id: 'ent_nope', name: 'x' }])).toThrow(/not found/);
  });

  it('schema accepts the documented shapes', () => {
    expect(operationSchema.safeParse({ op: 'set_transform', entityId: 'e', x: 1, y: null, rotation: null, scaleX: null, scaleY: null }).success).toBe(true);
    expect(operationSchema.safeParse({ op: 'teleport', id: 'e' }).success).toBe(false);
    expect(aiResponseSchema.safeParse({ kind: 'apply', message: 'ok', changes: [], operations: [] }).success).toBe(true);
  });
});

describe('transactions', () => {
  it('records, undoes and redoes whole project versions', () => {
    const a = createProject(registry, 'A');
    const b = produce(a, (d) => m.renameProject(d, 'B'));
    const c = produce(b, (d) => m.renameProject(d, 'C'));
    let h = record(EMPTY_HISTORY, { label: 'to B', source: 'user', time: 0, before: a, after: b, changes: [], operations: [] });
    h = record(h, { label: 'to C', source: 'ai', time: 5000, before: b, after: c, changes: ['Name: C'], operations: [] });
    const u1 = undo(h)!;
    expect(u1.project.name).toBe('B');
    const u2 = undo(u1.history)!;
    expect(u2.project.name).toBe('A');
    expect(undo(u2.history)).toBeNull();
    const r1 = redo(u2.history)!;
    expect(r1.project.name).toBe('B');
    // A new change clears the redo stack.
    const h2 = record(r1.history, { label: 'to D', source: 'user', time: 9000, before: b, after: c, changes: [], operations: [] });
    expect(redo(h2)).toBeNull();
  });

  it('coalesces rapid edits with the same key into one undo step', () => {
    const a = createProject(registry, 'A');
    const b = produce(a, (d) => m.renameProject(d, 'B'));
    const c = produce(b, (d) => m.renameProject(d, 'C'));
    let h = record(EMPTY_HISTORY, { label: 'color', source: 'user', time: 0, before: a, after: b, changes: [], operations: [], coalesceKey: 'k' });
    h = record(h, { label: 'color', source: 'user', time: 300, before: b, after: c, changes: [], operations: [], coalesceKey: 'k' });
    expect(h.past).toHaveLength(1);
    expect(undo(h)!.project.name).toBe('A');
  });
});

describe('AI context', () => {
  it('derives entity / pair / group contexts from the selection order', () => {
    expect(contextFromSelection('s', [])).toBeNull();
    expect(contextFromSelection('s', ['a'])?.kind).toBe('entity');
    expect(contextFromSelection('s', ['key', 'door'])).toEqual({ kind: 'pair', sceneId: 's', entityIds: ['key', 'door'] });
    expect(contextFromSelection('s', ['a', 'b', 'c'])?.kind).toBe('group');
    expect(contextKey({ kind: 'pair', sceneId: 's', entityIds: ['k', 'd'] })).not.toBe(contextKey({ kind: 'pair', sceneId: 's', entityIds: ['d', 'k'] }));
  });

  it('sends targets in full and everything else briefly', () => {
    const { project, sceneId, enemy, player, door } = level();
    const payload = buildAIPayload(project, { kind: 'entity', sceneId, entityIds: [enemy.id] }, registry);
    expect(payload.targets).toHaveLength(1);
    expect(payload.targets[0].components.Damage).toEqual({ amount: 1 });
    expect(payload.targets[0].object?.name).toBe('Enemy');
    expect(payload.targets[0].object?.placedCount).toBe(2);
    // Other entities are referenceable by name ("the player", "the door").
    expect(payload.otherEntities.map((e) => e.name)).toEqual(expect.arrayContaining(['Player', 'Door']));
    expect(payload.otherEntities.find((e) => e.id === player.id)).toMatchObject({ x: 0, y: 0, object: 'Player' });
    expect(payload.otherEntities.some((e) => e.id === enemy.id)).toBe(false);
    expect(payload.library.find((d) => d.name === 'Door')?.category).toBe('Environment');
    expect(JSON.stringify(payload).length).toBeLessThan(8000);
    void door;
  });

  it('level context carries world settings and the pointed location', () => {
    const { project, sceneId } = level();
    const payload = buildAIPayload(project, { kind: 'level', sceneId, point: { x: 40, y: 80 } }, registry);
    expect(payload.scope).toBe('level');
    expect(payload.level.gravity).toEqual({ x: 0, y: 980 });
    expect(payload.point).toEqual({ x: 40, y: 80 });
    expect(payload.targets).toEqual([]);
  });

  it('system prompt describes the real components and what is missing', () => {
    const prompt = buildSystemPrompt(registry);
    for (const c of registry.list()) expect(prompt).toContain(`  ${c.type}:`);
    expect(prompt).toContain('maxHealth: integer (min 1)');
    expect(prompt).toMatch(/Not available yet/);
    expect(prompt).toMatch(/patrolling/);
  });
});
