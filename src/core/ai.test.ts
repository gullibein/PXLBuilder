import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from './ai/capabilities';
import { buildAIPayload, codeFor, contextFromSelection, contextKey } from './ai/context';
import { userMessageParts } from './ai/prompt';
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
  it('a big level (2,160 tiles, then 300 things scattered in it) is built in moments, replacing what each covers', () => {
    // (Once took minutes, freezing the page: every new tile went through every object in the level.)
    let project = createProject(registry, 'Big');
    const sceneId = project.scenes[0].id;
    const def = (n: string) => project.definitions.find((d) => d.name === n)!;
    project = produce(project, (d) => m.addEntity(d, sceneId, instantiateDefinition(def('Player'), { x: 16, y: -16 })));
    const started = performance.now();
    const dirt = apply(project, [{ op: 'draw_tiles', sceneId, definitionRef: def('Platform').id, rects: [{ col: 0, row: 0, width: 24, height: 90 }], onTop: null }]);
    const scatter = Array.from({ length: 300 }, (_, i) => [
      { op: 'place_instance', sceneId, definitionRef: def('Stone').id, x: 16 + 32 * ((i * 7) % 24), y: 16 + 32 * ((i * 13) % 90), name: null, ref: null, onTop: null },
      { op: 'set_world', sceneId, gravityX: null, gravityY: 980, backgroundColor: null },
    ]).flat() as Operation[];
    const done = apply(dirt, scatter);
    expect(performance.now() - started).toBeLessThan(10000);
    const count = (p: Project, name: string) => p.scenes[0].entities.filter((e) => e.definitionId === def(name).id).length;
    expect(count(dirt, 'Platform')).toBe(24 * 90);
    // Each stone took the place of the dirt in its square (300 placed, some on the same square: those replace the stone there).
    const stones = new Set(Array.from({ length: 300 }, (_, i) => `${(i * 7) % 24},${(i * 13) % 90}`));
    expect(count(done, 'Stone')).toBe(stones.size);
    expect(count(done, 'Platform')).toBe(24 * 90 - stones.size);
    expect(count(done, 'Player')).toBe(1);
  }, 60000);

  it('"Give the player a timer" -> add Timer on the instance', () => {
    const { project, sceneId, player } = level();
    const next = apply(project, [{ op: 'add_component', target: 'instance', id: player.id, component: 'Timer', propsJson: '{"interval":2}' }]);
    const r = resolveEntity(next, m.getEntity(next, sceneId, player.id), registry);
    expect(r.components.Timer).toEqual({ interval: 2, repeat: true });
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
          { op: 'place_instance', sceneId, definitionRef: 'robot', x: 100, y: -100, name: null, ref: null, onTop: null },
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
    expect(() => apply(project, [{ op: 'rename', target: 'instance', id: 'ent_nope', name: 'x' }])).toThrow(/no placed object with id "ent_nope"/);
  });

  it('schema accepts the documented shapes', () => {
    expect(operationSchema.safeParse({ op: 'set_transform', entityId: 'e', x: 1, y: null, rotation: null, scaleX: null, scaleY: null }).success).toBe(true);
    expect(operationSchema.safeParse({ op: 'teleport', id: 'e' }).success).toBe(false);
    expect(aiResponseSchema.safeParse({ kind: 'apply', message: 'ok', changes: [], operations: [], needCode: null, starter: null }).success).toBe(true);
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
    expect(payload.targets[0].components.Patrol).toBeDefined();
    expect(payload.targets[0].object?.name).toBe('Enemy');
    expect(payload.targets[0].object?.placedCount).toBe(2);
    // Other entities are referenceable by name ("the player", "the door").
    expect(payload.otherEntities.map((e) => e.name)).toEqual(expect.arrayContaining(['Player', 'Door']));
    expect(payload.otherEntities.find((e) => e.id === player.id)).toMatchObject({ x: 0, y: 0, object: 'Player' });
    expect(payload.otherEntities.some((e) => e.id === enemy.id)).toBe(false);
    expect(payload.library.find((d) => d.name === 'Door')?.category).toBe('Environment');
    // (The selected enemy's rule scripts, Stomp and Hurts on touch, come in full: the AI changes them when asked.)
    expect(JSON.stringify(payload).length).toBeLessThan(9500);
    void door;
  });

  it('set_background: parallax sets both directions; parallaxY only up and down', () => {
    const { project, sceneId } = level();
    const bg = (p: Project) => p.scenes[0].world.background;
    const split = apply(project, [{ op: 'set_background', sceneId, color: null, fit: null, parallax: 0, parallaxY: 1, removeImage: false }]);
    expect(bg(split)).toMatchObject({ parallax: 0, parallaxY: 1 });
    expect(buildAIPayload(split, { kind: 'background', sceneId }, registry).level.background).toMatchObject({ parallax: 0, parallaxY: 1 });
    // Only up and down changed: left and right stay.
    const y = apply(split, [{ op: 'set_background', sceneId, color: null, fit: null, parallax: null, parallaxY: 0.4, removeImage: false }]);
    expect(bg(y)).toMatchObject({ parallax: 0, parallaxY: 0.4 });
    // parallax alone: both ways again (stored once).
    const both = apply(y, [{ op: 'set_background', sceneId, color: null, fit: null, parallax: 0.5, parallaxY: null, removeImage: false }]);
    expect(bg(both).parallax).toBe(0.5);
    expect('parallaxY' in bg(both)).toBe(false);
    expect(() => apply(project, [{ op: 'set_background', sceneId, color: null, fit: null, parallax: null, parallaxY: 2, removeImage: false }])).toThrow(/between 0 and 1/);
  });

  it('object context (right-click in the Objects tab) sends that library object in full, with its drawing', () => {
    const { project, sceneId, def, enemy: placed } = level();
    const enemy = def('Enemy');
    const payload = buildAIPayload(project, { kind: 'object', sceneId, definitionId: enemy.id }, registry);
    expect(payload.scope).toBe('object');
    expect(payload.scope_note).toMatch(/OBJECT LIBRARY/);
    expect(payload.object).toMatchObject({ id: enemy.id, name: 'Enemy', placedCount: 2 });
    expect(payload.object?.components.Patrol).toBeDefined();
    expect(payload.object?.look.sprite?.pixelArt?.rows.length).toBeGreaterThan(0);
    // The same grid a placed copy would be drawn on.
    expect(payload.object?.spriteGrid).toEqual(buildAIPayload(project, { kind: 'entity', sceneId, entityIds: [placed.id] }, registry).targets[0].spriteGrid);
    expect(payload.targets).toEqual([]);
    expect(payload.sound).toBeUndefined();
    expect(contextKey({ kind: 'object', sceneId, definitionId: enemy.id })).toBe(`object:${enemy.id}`);
  });

  it('sound context sends that sound with its notes; a remake keeps the same sound', () => {
    const { project, sceneId } = level();
    const made = apply(project, [{ op: 'make_sound', name: 'Boing', description: 'A spring', soundJson: '{"type":"steps","speed":4,"notes":[[24,0,5,0],[36,0,4,1]]}', replaceId: null }]);
    const boing = made.assets.find((a) => a.name === 'Boing')!;
    const payload = buildAIPayload(made, { kind: 'sound', sceneId, assetId: boing.id }, registry);
    expect(payload.scope).toBe('sound');
    expect(payload.sound).toMatchObject({ id: boing.id, name: 'Boing', sound: { type: 'steps', notes: [[24, 0, 5, 0], [36, 0, 4, 1]] } });
    expect(payload.object).toBeUndefined();
    const lower = apply(made, [{ op: 'make_sound', name: 'Boing', description: 'A lower spring', soundJson: '{"type":"steps","speed":4,"notes":[[19,0,5,0],[31,0,4,1]]}', replaceId: boing.id }]);
    expect(lower.assets.filter((a) => a.kind === 'sound').map((a) => a.id)).toEqual(made.assets.filter((a) => a.kind === 'sound').map((a) => a.id));
    expect((lower.assets.find((a) => a.id === boing.id)!.synth as { notes: number[][] }).notes[0][0]).toBe(19);
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
    expect(prompt).toMatch(/jetpacks/);
    expect(prompt).toMatch(/Patrol: walks back and forth/);
    expect(prompt).not.toMatch(/patrolling back and forth/);
  });
});

describe('logic operations (the relationships proof of concept, without a model)', () => {
  function keyDoorSwitch() {
    const base = level();
    const key = instantiateDefinition(base.def('Key'), { x: 100, y: 0 }, 'Blue Key');
    const sw = instantiateDefinition(base.def('Switch'), { x: 300, y: 0 }, 'Switch');
    const project = produce(base.project, (d) => {
      m.addEntity(d, base.sceneId, key);
      m.addEntity(d, base.sceneId, sw);
    });
    return { ...base, project, key, sw };
  }

  it('"Make the blue key open the blue door" -> requires; "make this switch open the door" -> controls; "only if the player has the key" -> a condition', () => {
    const { project, sceneId, door, sw, def } = keyDoorSwitch();
    let p = apply(project, [
      { op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: 'requires', source: { kind: 'entity', id: door.id }, target: { kind: 'object', id: def('Key').id } }) },
      { op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: 'controls', source: { kind: 'entity', id: sw.id }, target: { kind: 'entity', id: door.id } }) },
    ]);
    const controls = p.scenes[0].relationships.find((r) => r.type === 'controls')!;
    p = apply(p, [{ op: 'update_relationship', sceneId, id: controls.id, patchJson: JSON.stringify({ conditions: [{ type: 'has_item', entity: { kind: 'other' }, item: 'key' }] }) }]);
    const payload = buildAIPayload(p, { kind: 'pair', sceneId, entityIds: [sw.id, door.id] }, registry);
    expect(payload.logic.relationships.map((r) => r.text)).toEqual(['Door requires every Key', 'Switch opens and closes Door, only if whoever uses it has key']);
    expect(() => apply(p, [{ op: 'update_relationship', sceneId, id: controls.id, patchJson: '{"type":"damages"}' }])).toThrow(/cannot set "type"/);
  });

  it('rules, and references to things created earlier in the same reply', () => {
    const { project, sceneId, player } = level();
    let created!: ReturnType<typeof applyOperations>;
    const p = produce(project, (d) => {
      created = applyOperations(
        d,
        [
          { op: 'create_definition', ref: 'flag', name: 'Flag', description: 'Goal', category: 'Environment', tags: ['goal'], components: [{ component: 'Collider', propsJson: '{"isTrigger":true}' }] },
          { op: 'place_instance', sceneId, definitionRef: 'flag', x: 900, y: 0, name: 'Goal Flag', ref: 'goal', onTop: null },
          {
            op: 'create_rule',
            sceneId,
            ruleJson: JSON.stringify({
              name: 'Win',
              when: { event: 'touch_started', subject: { kind: 'entity', id: player.id }, other: { kind: 'entity', id: 'goal' } },
              actions: [{ type: 'show_message', text: 'You win!' }, { type: 'spawn', object: 'flag', at: null, x: 0, y: 0 }],
            }),
          },
        ],
        registry,
      );
    });
    const rule = p.scenes[0].rules[0];
    expect(rule.when.other).toEqual({ kind: 'entity', id: created.createdEntityIds[0] });
    expect(rule.actions[1]).toMatchObject({ type: 'spawn', object: created.createdDefinitionIds[0] });
    expect(created.createdRuleIds).toEqual([rule.id]);
    const payload = buildAIPayload(p, { kind: 'level', sceneId, point: null }, registry);
    expect(payload.logic.rules[0].text).toBe('When Player touches Goal Flag: show "You win!" and spawn a Flag at 0, 0.');
    const after = apply(p, [{ op: 'set_rule_enabled', sceneId, id: rule.id, enabled: false }, { op: 'remove_rule', sceneId, id: rule.id }]);
    expect(after.scenes[0].rules).toEqual([]);
  });

  it('invalid logic is rejected with a useful message', () => {
    const { project, sceneId, door } = level();
    expect(() => apply(project, [{ op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: 'opens', source: { kind: 'entity', id: door.id }, target: { kind: 'entity', id: door.id } }) }])).toThrow(/Unknown relationship type "opens"/);
    expect(() => apply(project, [{ op: 'create_rule', sceneId, ruleJson: JSON.stringify({ when: { event: 'on_fire' }, actions: [{ type: 'restart_level' }] }) }])).toThrow(/Unknown event/);
    expect(() => apply(project, [{ op: 'create_rule', sceneId, ruleJson: '{oops' }])).toThrow(/not valid JSON/);
  });

  it('the system prompt lists relationship types, events, conditions and actions', () => {
    const prompt = buildSystemPrompt(registry);
    for (const t of ['controls', 'requires', 'damages', 'collects', 'switch_activated', 'touch_started', 'has_item', 'restart_level', 'show_message']) expect(prompt).toContain(`  ${t}`);
    expect(prompt).toMatch(/targets \(recorded in the design only; NOT simulated/);
  });
});

describe('drawing levels', () => {
  it('one object per square: drawing or placing over other objects replaces them (onTop keeps both); the player is never drawn over', () => {
    const { project, sceneId, def } = level();
    const stone = def('Stone').id;
    const at = (p: Project, col: number, row: number) => p.scenes[0].entities.filter((e) => Math.abs(e.transform.position.x - (col * 32 + 16)) < 16 && Math.abs(e.transform.position.y - (row * 32 + 16)) < 16).map((e) => p.definitions.find((d) => d.id === e.definitionId)?.name);
    // Platforms in row 5, then stone drawn over two of them: those two are stone now, not both.
    const p1 = apply(project, [
      { op: 'draw_tiles', sceneId, definitionRef: def('Platform').id, rects: [{ col: 10, row: 5, width: 4, height: 1 }], onTop: null },
      { op: 'draw_tiles', sceneId, definitionRef: stone, rects: [{ col: 11, row: 5, width: 2, height: 1 }], onTop: null },
    ]);
    expect([10, 11, 12, 13].map((c) => at(p1, c, 5))).toEqual([['Platform'], ['Stone'], ['Stone'], ['Platform']]);
    // A door placed in that row replaces the stone it covers; with onTop the stone stays under it.
    const p2 = apply(p1, [{ op: 'place_instance', sceneId, definitionRef: def('Coin').id, x: 11 * 32 + 16, y: 5 * 32 + 16, name: null, ref: null, onTop: null }]);
    expect(at(p2, 11, 5)).toEqual(['Coin']);
    const p3 = apply(p1, [{ op: 'place_instance', sceneId, definitionRef: def('Coin').id, x: 11 * 32 + 16, y: 5 * 32 + 16, name: null, ref: null, onTop: true }]);
    expect(at(p3, 11, 5)).toEqual(['Stone', 'Coin']);
    // Stone drawn over the player's square: that square is left out; the player stays.
    const player = project.scenes[0].entities.find((e) => e.name === 'Player')!;
    const [pc, pr] = [20, -4];
    const onCell = apply(project, [{ op: 'set_transform', entityId: player.id, x: pc * 32 + 16, y: pr * 32 + 16, rotation: null, scaleX: null, scaleY: null }]);
    const p4 = apply(onCell, [{ op: 'draw_tiles', sceneId, definitionRef: stone, rects: [{ col: pc - 1, row: pr, width: 3, height: 1 }], onTop: null }]);
    expect(p4.scenes[0].entities.some((e) => e.id === player.id)).toBe(true);
    expect(at(p4, pc, pr)).toEqual(['Player']);
    expect(at(p4, pc - 1, pr)).toContain('Stone');
  });

  it('draw_tiles fills rectangles of 32px cells, one copy per cell, without duplicates', () => {
    const { project, sceneId, def } = level();
    const platform = def('Platform').id;
    const before = project.scenes[0].entities.length;
    const p = apply(project, [
      { op: 'draw_tiles', sceneId, definitionRef: platform, rects: [{ col: -2, row: 3, width: 5, height: 1 }, { col: 0, row: 3, width: 2, height: 2 }], onTop: null },
    ]);
    const tiles = p.scenes[0].entities.filter((e) => e.definitionId === platform);
    // 5 in row 3, plus 2 new in row 4 (the two in row 3 already exist).
    expect(tiles).toHaveLength(7);
    expect(p.scenes[0].entities.length).toBe(before + 7);
    expect(tiles.map((e) => e.transform.position).filter((pos) => pos.y === 112).map((pos) => pos.x)).toEqual([-48, -16, 16, 48, 80]);
  });

  it('a shorter object rests on the bottom of its cell (spikes sit on the ground below)', () => {
    const { project, sceneId, def } = level();
    const p = apply(project, [{ op: 'draw_tiles', sceneId, definitionRef: def('Hazard').id, rects: [{ col: 0, row: 0, width: 1, height: 1 }], onTop: null }]);
    const hazard = p.scenes[0].entities.at(-1)!;
    // Hazard is 32x16 (one cell): centered in cell 0 at x=16, bottom at y=32.
    expect(hazard.transform.position).toEqual({ x: 16, y: 24 });
  });

  it('objects wider or taller than a cell are placed side by side, not on top of each other', () => {
    const { project, sceneId, def } = level();
    const before = project.scenes[0].entities.length;
    // A 4-cell row of one-cell spikes: four copies, one per cell.
    const p = apply(project, [{ op: 'draw_tiles', sceneId, definitionRef: def('Hazard').id, rects: [{ col: 0, row: -1, width: 4, height: 1 }], onTop: null }]);
    expect(p.scenes[0].entities.slice(before).map((e) => e.transform.position.x)).toEqual([16, 48, 80, 112]);
    // A 2-cell-wide object (a 64-wide block) every 2 cells.
    const wide = apply(project, [
      { op: 'create_definition', ref: 'w', name: 'Wide', description: '', category: 'Platforms', tags: [], components: [{ component: 'Sprite', propsJson: '{"width":64,"height":32}' }] },
      { op: 'draw_tiles', sceneId, definitionRef: 'w', rects: [{ col: 0, row: -1, width: 4, height: 1 }], onTop: null },
    ]);
    expect(wide.scenes[0].entities.slice(before).map((e) => e.transform.position)).toEqual([{ x: 32, y: -16 }, { x: 96, y: -16 }]);
    // A door (one cell wide, two tall) drawn in one row stands on that row's bottom, not sunk into the ground.
    const d = apply(project, [{ op: 'draw_tiles', sceneId, definitionRef: def('Door').id, rects: [{ col: 3, row: -1, width: 1, height: 1 }], onTop: null }]);
    expect(d.scenes[0].entities.at(-1)!.transform.position).toEqual({ x: 112, y: -32 });
  });

  it('something placed half into the ground is lifted onto it; something in the air stays', () => {
    const { project, sceneId, def } = level();
    const ground = apply(project, [{ op: 'draw_tiles', sceneId, definitionRef: def('Platform').id, rects: [{ col: 20, row: 0, width: 4, height: 1 }], onTop: null }]);
    // The ground row's top is at y=0. A 64-tall door centered at y=-16 is sunk 16 px into it.
    const p = apply(ground, [
      { op: 'place_instance', sceneId, definitionRef: def('Door').id, x: 680, y: -16, name: null, ref: null, onTop: null },
      { op: 'place_instance', sceneId, definitionRef: def('Coin').id, x: 720, y: -60, name: null, ref: null, onTop: null },
    ]);
    const [door, coin] = p.scenes[0].entities.slice(-2);
    expect(door.transform.position).toEqual({ x: 680, y: -32 });
    expect(coin.transform.position).toEqual({ x: 720, y: -60 });
    // A door or spikes placed in the air drop onto the surface below (a coin may float).
    const dropped = apply(ground, [
      { op: 'place_instance', sceneId, definitionRef: def('Door').id, x: 690, y: -200, name: null, ref: null, onTop: null },
      { op: 'place_instance', sceneId, definitionRef: def('Hazard').id, x: 720, y: -150, name: null, ref: null, onTop: null },
    ]);
    const [door2, spikes] = dropped.scenes[0].entities.slice(-2);
    expect(door2.transform.position.y).toBe(-32);
    expect(spikes.transform.position.y).toBe(-8);
  });

  it('erase_area removes what is in the cells (optionally one object only), with its connections', () => {
    const { project, sceneId, def } = level();
    const p1 = apply(project, [{ op: 'draw_tiles', sceneId, definitionRef: def('Platform').id, rects: [{ col: 10, row: 0, width: 4, height: 1 }], onTop: null }, { op: 'draw_tiles', sceneId, definitionRef: def('Stone').id, rects: [{ col: 10, row: 1, width: 4, height: 1 }], onTop: null }]);
    const p2 = apply(p1, [{ op: 'erase_area', sceneId, col: 10, row: 0, width: 2, height: 2, definitionRef: def('Stone').id }]);
    expect(p2.scenes[0].entities.length).toBe(p1.scenes[0].entities.length - 2);
    const p3 = apply(p1, [{ op: 'erase_area', sceneId, col: 10, row: 0, width: 4, height: 2, definitionRef: null }]);
    expect(p3.scenes[0].entities.length).toBe(p1.scenes[0].entities.length - 8);
  });

  it('refuses huge fills', () => {
    const { project, sceneId, def } = level();
    expect(() => apply(project, [{ op: 'draw_tiles', sceneId, definitionRef: def('Platform').id, rects: [{ col: 0, row: 0, width: 100, height: 100 }], onTop: null }])).toThrow(/too many/);
  });

  it('the AI is told the grid and what the player can reach', () => {
    const { project, sceneId } = level();
    const payload = buildAIPayload(project, { kind: 'level', sceneId, point: null }, registry);
    expect(payload.level.grid.cell).toBe(32);
    expect(payload.level.grid.occupied).toEqual({ minCol: 0, maxCol: 15, minRow: 0, maxRow: 0 });
    expect(payload.level.playerReach).toMatchObject({ character: 'Player', jumpHeightPx: 62, jumpHeightTiles: 1.9 });
    expect(payload.level.playerReach!.runningJumpDistanceTiles).toBeCloseTo(4.5, 1);
  });
});

describe('create_level: the AI makes more levels', () => {
  it('adds levels after the existing ones and builds them in the same answer (their ref is the sceneId)', () => {
    let project = createProject(registry);
    // A top-down game: its new levels have no gravity either.
    project = produce(project, (d) => {
      d.scenes[0].world.gravity = { x: 0, y: 0 };
    });
    const player = project.definitions.find((d) => d.name === 'Player')!.id;
    const platform = project.definitions.find((d) => d.name === 'Platform')!.id;
    const ops = operationSchema.array().parse([
      { op: 'create_level', ref: 'L2', name: 'The Mines' },
      { op: 'place_instance', sceneId: 'L2', definitionRef: player, x: 16, y: 16, name: null, ref: null, onTop: null },
      { op: 'draw_tiles', sceneId: 'L2', definitionRef: platform, rects: [{ col: -2, row: 1, width: 6, height: 1 }], onTop: null },
      { op: 'create_level', ref: 'L3', name: 'The Tower' },
      { op: 'place_instance', sceneId: 'L3', definitionRef: player, x: 0, y: 0, name: null, ref: null, onTop: null },
    ]);
    const after = apply(project, ops);
    expect(after.scenes.map((s) => s.name)).toEqual([project.scenes[0].name, 'The Mines', 'The Tower']);
    expect(after.scenes[1].entities).toHaveLength(7);
    expect(after.scenes[2].entities).toHaveLength(1);
    expect(after.scenes[1].world.gravity).toEqual({ x: 0, y: 0 });
    expect(after.scenes[0].entities).toHaveLength(project.scenes[0].entities.length);
  });

  it('two new levels with the same ref are refused', () => {
    const project = createProject(registry);
    const ops = operationSchema.array().parse([
      { op: 'create_level', ref: 'L2', name: 'A' },
      { op: 'create_level', ref: 'L2', name: 'B' },
    ]);
    expect(() => apply(project, ops)).toThrow(/Two new levels are called "L2"/);
  });
});

describe("other objects' code goes to the AI", () => {
  it("with the Mole selected, the Diamond's scripts come in full (so a collision between them can be fixed where it is)", async () => {
    const { setScript } = await import('./script/mutations');
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    let mole = '';
    project = produce(project, (d) => {
      const enemy = d.definitions.find((x) => x.name === 'Enemy')!;
      const coin = d.definitions.find((x) => x.name === 'Coin')!;
      enemy.name = 'Mole';
      coin.name = 'Diamond';
      setScript(d, { target: 'definition', id: coin.id }, { name: 'Fall', description: 'Falls when nothing is under it.', handlers: [{ when: { on: 'tick' }, if: "!solid_at(self.x, self.y + 32)", do: [{ do: 'velocity', x: null, y: '200' }] }] });
      const e = instantiateDefinition(enemy, { x: 0, y: 0 });
      mole = e.id;
      m.addEntity(d, sceneId, e);
    });
    const payload = buildAIPayload(project, { kind: 'entity', sceneId, entityIds: [mole] }, registry);
    const diamond = payload.library.find((d) => d.name === 'Diamond')!;
    // Not sent up front (it costs on every request): the script's name and description are, and the AI asks for the
    // code when it needs it (kind "need_code"), getting the full scripts back.
    expect(diamond.codeInTargets).toBeUndefined();
    expect(diamond.scripts).toEqual([{ id: expect.any(String), name: 'Fall', description: 'Falls when nothing is under it.' }]);
    const code = codeFor(project, [diamond.id, 'Mole', 'nothing such']);
    expect(code.map((c) => c.name)).toEqual(['Diamond', 'Mole']);
    expect(JSON.stringify(code[0].scripts)).toContain('solid_at(self.x, self.y + 32)');
    // It goes after the game data (which stays the same, so it is read from the cache) and before the request.
    const { context, rest } = userMessageParts({ context: payload, request: 'Why?', history: [], code });
    expect(context).not.toContain('solid_at');
    expect(rest.indexOf('FULL CODE')).toBeLessThan(rest.indexOf('REQUEST'));
    expect(rest).toContain('solid_at(self.x, self.y + 32)');
  });

  it("the selected thing's code comes in full once (in targets), not again in the object list", async () => {
    const { setScript } = await import('./script/mutations');
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    let id = '';
    project = produce(project, (d) => {
      const coin = d.definitions.find((x) => x.name === 'Coin')!;
      setScript(d, { target: 'definition', id: coin.id }, { name: 'Spin', description: 'Spins.', handlers: [{ when: { on: 'tick' }, if: null, do: [{ do: 'velocity', x: '1', y: null }] }] });
      const e = instantiateDefinition(coin, { x: 0, y: 0 });
      id = e.id;
      m.addEntity(d, sceneId, e);
    });
    const payload = buildAIPayload(project, { kind: 'entity', sceneId, entityIds: [id] }, registry);
    const coin = payload.library.find((d) => d.name === 'Coin')!;
    expect(coin.codeInTargets).toBe(true);
    expect(coin.scripts).toEqual([{ id: expect.any(String), name: 'Spin', description: 'Spins.' }]);
    expect(JSON.stringify(payload.targets[0].scripts)).toContain('"handlers"');
    // Short entries: the size as one line, no empty sprite lists.
    expect(coin.size).toMatch(/^\d+x\d+ px, 1x1 cells$/);
    const ladder = payload.library.find((d) => d.name === 'Ladder')!;
    expect(ladder).not.toHaveProperty('codeInTargets');
  });
});

describe('the level, compactly', () => {
  it('plain copies of an object placed many times are only on the map; the few of a kind and changed copies are listed', () => {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    let changed = '';
    let player = '';
    project = produce(project, (d) => {
      const def = (n: string) => d.definitions.find((x) => x.name === n)!;
      for (let i = 0; i < 10; i++) m.addEntity(d, sceneId, instantiateDefinition(def('Platform'), { x: i * 32 + 16, y: 48 }, i === 0 ? 'Platform' : `Platform ${i + 1}`));
      const odd = instantiateDefinition(def('Platform'), { x: 368, y: 48 }, 'Crumbly ledge');
      changed = odd.id;
      m.addEntity(d, sceneId, odd);
      const p = instantiateDefinition(def('Player'), { x: 48, y: 16 });
      player = p.id;
      m.addEntity(d, sceneId, p);
      m.addEntity(d, sceneId, instantiateDefinition(def('Door'), { x: 200, y: 0 }));
    });
    const payload = buildAIPayload(project, { kind: 'level', sceneId, point: null }, registry);
    expect(payload.otherEntities.map((e) => e.name).sort()).toEqual(['Crumbly ledge', 'Door', 'Player']);
    expect(payload.otherEntities.find((e) => e.id === player)).toEqual({ id: player, name: 'Player', object: 'Player', x: 48, y: 16 });
    expect(payload.otherEntities.some((e) => e.id === changed)).toBe(true);
    expect(payload.otherCopies).toEqual({ Platform: 10 });
    // And on the map, one character per object.
    expect(payload.level.map!.rows.some((r) => r.includes('##########'))).toBe(true);
  });
});

describe('the camera has its own conversation', () => {
  it("asked from the camera outline: its own key (not the level's), and the AI is told it is about the camera", () => {
    expect(contextKey({ kind: 'level', sceneId: 's1', point: null })).toBe('level:s1');
    expect(contextKey({ kind: 'level', sceneId: 's1', point: null, camera: 'start' })).toBe('camera:s1');
    expect(contextKey({ kind: 'level', sceneId: 's1', point: null, camera: 'limits' })).toBe('camera:s1');
    const registry = createBuiltinRegistry();
    const project = createProject(registry);
    const sceneId = project.scenes[0].id;
    expect(buildAIPayload(project, { kind: 'level', sceneId, point: null, camera: 'start' }, registry).aboutCamera).toBe(true);
    expect(buildAIPayload(project, { kind: 'level', sceneId, point: null }, registry).aboutCamera).toBeUndefined();
  });
});
