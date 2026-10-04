import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from './components/builtin';
import { ComponentRegistry } from './components/registry';
import { createProject, createStandaloneEntity, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { resolveEntity } from './model/resolve';
import { migrateProject } from './serialization/migrations';
import { projectFromBundle, projectFromFiles, projectToBundle, projectToFiles } from './serialization/serialize';
import type { Project } from './types';

const registry = createBuiltinRegistry();

function setup() {
  const project = createProject(registry, 'Test');
  const sceneId = project.scenes[0].id;
  const player = project.definitions.find((d) => d.name === 'Player')!;
  return { project, sceneId, player };
}

function withPlayer() {
  const { project, sceneId, player } = setup();
  const entity = instantiateDefinition(player, { x: 100, y: 200 });
  const p = produce(project, (d) => m.addEntity(d, sceneId, entity));
  return { project: p, sceneId, player, entityId: entity.id };
}

describe('component registry', () => {
  it('creates defaults and validates props', () => {
    expect(registry.createDefault('Health')).toEqual({ maxHealth: 3, currentHealth: 3 });
    expect(registry.validate('Health', { maxHealth: 2.5 }, { partial: true })[0].message).toMatch(/integer/);
    expect(registry.validate('Health', { bogus: 1 }, { partial: true })[0].message).toBe('unknown field');
    expect(registry.validate('Health', { maxHealth: 3 })).toHaveLength(1); // currentHealth missing
    expect(registry.validate('Nope', {})[0].message).toMatch(/unknown component/);
  });

  it('is extensible and rejects invalid registrations', () => {
    const r = new ComponentRegistry();
    r.register({ type: 'Glow', label: 'Glow', description: '', category: 'x', fields: { radius: { kind: 'number', default: 4, min: 0 } } });
    expect(r.createDefault('Glow')).toEqual({ radius: 4 });
    expect(() => r.register({ type: 'Glow', label: '', description: '', category: '', fields: {} })).toThrow(/already/);
    expect(() =>
      r.register({ type: 'Bad', label: '', description: '', category: '', fields: { a: { kind: 'number', default: -1, min: 0 } } }),
    ).toThrow(/invalid/);
  });
});

describe('definitions and instances', () => {
  it('instances inherit definition components and tags', () => {
    const { project, sceneId, entityId } = withPlayer();
    const r = resolveEntity(project, m.getEntity(project, sceneId, entityId), registry);
    expect(r.components.CharacterController.speed).toBe(200);
    expect(r.tags).toContain('player');
    expect(r.overriddenFields.size).toBe(0);
  });

  it('instance edits become overrides; definition edits reach non-overridden instances', () => {
    const { project, sceneId, player, entityId } = withPlayer();
    const other = instantiateDefinition(player, { x: 0, y: 0 });
    let p = produce(project, (d) => m.addEntity(d, sceneId, other));
    p = produce(p, (d) => m.setEntityComponentField(d, sceneId, entityId, 'CharacterController', 'speed', 300, registry));
    p = produce(p, (d) => m.setDefinitionComponentField(d, player.id, 'CharacterController', 'speed', 250, registry));
    p = produce(p, (d) => m.setDefinitionComponentField(d, player.id, 'CharacterController', 'jumpForce', 600, registry));

    const a = resolveEntity(p, m.getEntity(p, sceneId, entityId), registry);
    const b = resolveEntity(p, m.getEntity(p, sceneId, other.id), registry);
    expect(a.components.CharacterController.speed).toBe(300);
    expect(a.components.CharacterController.jumpForce).toBe(600);
    expect(a.overriddenFields.has('CharacterController.speed')).toBe(true);
    expect(b.components.CharacterController.speed).toBe(250);
    // Only the override is stored on the instance.
    expect(m.getEntity(p, sceneId, entityId).components).toEqual({ CharacterController: { speed: 300 } });

    p = produce(p, (d) => m.revertEntityComponentField(d, sceneId, entityId, 'CharacterController', 'speed'));
    expect(resolveEntity(p, m.getEntity(p, sceneId, entityId), registry).components.CharacterController.speed).toBe(250);
    expect(m.getEntity(p, sceneId, entityId).components).toEqual({});
  });

  it('setting an override back to the inherited value drops it', () => {
    const { project, sceneId, entityId } = withPlayer();
    let p = produce(project, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Sprite', 'color', '#000000', registry));
    p = produce(p, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Sprite', 'color', '#4fa3ff', registry));
    expect(m.getEntity(p, sceneId, entityId).components).toEqual({});
  });

  it('rejects invalid values without mutating', () => {
    const { project, sceneId, entityId } = withPlayer();
    expect(() => produce(project, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Damage', 'amount', 3, registry))).toThrow(/no Damage/);
    expect(() => produce(project, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Sprite', 'width', 'big', registry))).toThrow(/number/);
    expect(() => produce(project, (d) => m.setEntityComponentField(d, sceneId, entityId, 'Sprite', 'nope', 1, registry))).toThrow(/no field/);
  });

  it('adds and removes components on instances', () => {
    const { project, sceneId, entityId } = withPlayer();
    let p = produce(project, (d) => m.addEntityComponent(d, sceneId, entityId, 'Damage', registry, { amount: 5 }));
    let r = resolveEntity(p, m.getEntity(p, sceneId, entityId), registry);
    expect(r.components.Damage).toEqual({ amount: 5 });
    expect(r.instanceOnlyComponents.has('Damage')).toBe(true);

    p = produce(p, (d) => m.removeEntityComponent(d, sceneId, entityId, 'CameraTarget'));
    r = resolveEntity(p, m.getEntity(p, sceneId, entityId), registry);
    expect(r.components.CameraTarget).toBeUndefined();

    p = produce(p, (d) => m.addEntityComponent(d, sceneId, entityId, 'CameraTarget', registry));
    r = resolveEntity(p, m.getEntity(p, sceneId, entityId), registry);
    expect(r.components.CameraTarget.followStrength).toBe(0.15);
    expect(() => produce(p, (d) => m.addEntityComponent(d, sceneId, entityId, 'Sprite', registry))).toThrow(/already/);
  });

  it('deleting a definition unlinks its instances with their effective state', () => {
    const { project, sceneId, player, entityId } = withPlayer();
    let p = produce(project, (d) => m.setEntityComponentField(d, sceneId, entityId, 'CharacterController', 'speed', 333, registry));
    p = produce(p, (d) => m.deleteDefinition(d, player.id, registry));
    const e = m.getEntity(p, sceneId, entityId);
    expect(e.definitionId).toBeNull();
    expect(e.components.CharacterController.speed).toBe(333);
    expect(e.components.Sprite.color).toBe('#4fa3ff');
    expect(e.tags).toContain('player');
  });
});

describe('entity and scene mutations', () => {
  it('moves, duplicates, removes entities', () => {
    const { project, sceneId, entityId } = withPlayer();
    let created: string[] = [];
    let p = produce(project, (d) => {
      m.moveEntities(d, sceneId, [entityId], { x: 10, y: -5 });
      created = m.duplicateEntities(d, sceneId, [entityId], { x: 16, y: 16 });
    });
    expect(m.getEntity(p, sceneId, entityId).transform.position).toEqual({ x: 110, y: 195 });
    expect(m.getEntity(p, sceneId, created[0]).transform.position).toEqual({ x: 126, y: 211 });
    expect(created[0]).not.toBe(entityId);
    p = produce(p, (d) => m.removeEntities(d, sceneId, [entityId]));
    expect(p.scenes[0].entities.map((e) => e.id)).toEqual(created);
  });

  it('normalizes tags and keeps one scene minimum', () => {
    const { project, sceneId, entityId } = withPlayer();
    const p = produce(project, (d) => m.setEntityTags(d, sceneId, entityId, [' Boss', 'boss', '', 'Tutorial']));
    expect(m.getEntity(p, sceneId, entityId).tags).toEqual(['boss', 'tutorial']);
    expect(() => produce(p, (d) => m.removeScene(d, sceneId))).toThrow(/at least one/);
  });

  it('updates world settings with validation', () => {
    const { project, sceneId } = setup();
    const p = produce(project, (d) => m.setWorldSettings(d, sceneId, { gravity: { x: 0, y: 490 } }));
    expect(p.scenes[0].world.gravity.y).toBe(490);
    expect(() => produce(p, (d) => m.setWorldSettings(d, sceneId, { backgroundColor: 'blue' }))).toThrow();
  });
});

describe('serialization', () => {
  function sample(): Project {
    const { project, sceneId, entityId } = withPlayer();
    return produce(project, (d) => {
      m.setEntityComponentField(d, sceneId, entityId, 'CharacterController', 'speed', 321, registry);
      m.addEntity(d, sceneId, createStandaloneEntity('Loose', { x: 5, y: 5 }, { Sprite: registry.createDefault('Sprite') }));
    });
  }

  it('round-trips through the file layout', () => {
    const project = sample();
    const files = projectToFiles(project);
    expect(Object.keys(files)).toContain('project.json');
    expect(Object.keys(files)).toContain(`scenes/${project.scenes[0].id}.json`);
    expect(Object.keys(files).filter((k) => k.startsWith('objects/'))).toHaveLength(project.definitions.length);
    const { project: loaded, warnings } = projectFromFiles(files, registry);
    expect(loaded).toEqual(project);
    expect(warnings).toEqual([]);
  });

  it('round-trips through a JSON bundle string', () => {
    const project = sample();
    const text = JSON.stringify(projectToBundle(project));
    expect(projectFromBundle(JSON.parse(text), registry).project).toEqual(project);
  });

  it('rejects broken files with clear errors', () => {
    const files = projectToFiles(sample());
    const sceneFile = Object.keys(files).find((k) => k.startsWith('scenes/'))!;
    expect(() => projectFromFiles({ ...files, [sceneFile]: undefined }, registry)).toThrow();
    const noScene = { ...files };
    delete noScene[sceneFile];
    expect(() => projectFromFiles(noScene, registry)).toThrow(/Missing file/);
    const future = { ...files, 'project.json': { ...(files['project.json'] as object), formatVersion: 99 } };
    expect(() => projectFromFiles(future, registry)).toThrow(/newer/);
    expect(() => projectFromBundle({ hello: 1 }, registry)).toThrow(/Not a PXLBuilder/);
  });

  it('keeps unknown components but warns', () => {
    const project = produce(sample(), (d) => {
      d.scenes[0].entities[0].components.Mystery = { a: 1 };
    });
    const { project: loaded, warnings } = projectFromFiles(projectToFiles(project), registry);
    expect(loaded.scenes[0].entities[0].components.Mystery).toEqual({ a: 1 });
    expect(warnings[0]).toMatch(/unknown component type "Mystery"/);
  });

  it('applies migrations in order', () => {
    const migrations = [
      { from: 1, to: 2, migrate: (r: Record<string, unknown>) => ({ ...r, a: 1 }) },
      { from: 2, to: 3, migrate: (r: Record<string, unknown>) => ({ ...r, b: (r.a as number) + 1 }) },
    ];
    expect(migrateProject({ formatVersion: 1 }, migrations, 3)).toEqual({ formatVersion: 3, a: 1, b: 2 });
    expect(() => migrateProject({ formatVersion: 1 }, [], 2)).toThrow(/No migration/);
  });
});
