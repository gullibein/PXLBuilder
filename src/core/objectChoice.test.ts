import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyAsNewObject, applyToObject, objectChoiceFor } from './commands/objectChoice';
import type { Operation } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { resolveEntity } from './model/resolve';

const registry = createBuiltinRegistry();

function twoEnemies() {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  const enemy = project.definitions.find((d) => d.name === 'Enemy')!;
  const a = instantiateDefinition(enemy, { x: 0, y: 0 });
  const b = instantiateDefinition(enemy, { x: 100, y: 0 });
  const player = instantiateDefinition(project.definitions.find((d) => d.name === 'Player')!, { x: -100, y: 0 });
  project = produce(project, (d) => {
    for (const e of [a, b, player]) m.addEntity(d, sceneId, e);
  });
  return { project, sceneId, enemy, a, b, player };
}

const patrol = (target: 'instance' | 'definition', id: string): Operation => ({ op: 'add_component', target, id, component: 'Patrol', propsJson: '{"speed":90}' });

describe('change the object, or create a new one', () => {
  it('a change to what an object is (behavior, look) asks; moving or renaming one copy does not', () => {
    const { project, enemy, a } = twoEnemies();
    expect(objectChoiceFor(project, [patrol('instance', a.id)], [a.id])).toEqual({ definitionId: enemy.id, objectName: 'Enemy', copies: 2, switchIds: [a.id] });
    expect(objectChoiceFor(project, [patrol('definition', enemy.id)], [a.id])).toMatchObject({ definitionId: enemy.id, switchIds: [a.id] });
    expect(objectChoiceFor(project, [{ op: 'set_transform', entityId: a.id, x: 5, y: null, rotation: null, scaleX: null, scaleY: null }], [a.id])).toBeNull();
    expect(objectChoiceFor(project, [{ op: 'rename', target: 'instance', id: a.id, name: 'Bob' }], [a.id])).toBeNull();
  });

  it('a change touching two different objects is not a single choice', () => {
    const { project, a, player } = twoEnemies();
    expect(objectChoiceFor(project, [patrol('instance', a.id), patrol('instance', player.id)], [a.id])).toBeNull();
  });

  it('"Change Enemy": every enemy gets it, even when the AI aimed at one copy', () => {
    const { project, enemy, a, b } = twoEnemies();
    const choice = objectChoiceFor(project, [patrol('instance', a.id)], [a.id])!;
    const p = produce(project, (d) => void applyToObject(d, [patrol('instance', a.id)], choice, registry));
    expect(p.definitions.find((d) => d.id === enemy.id)!.components.Patrol).toMatchObject({ speed: 90 });
    for (const e of [a, b]) expect(resolveEntity(p, p.scenes[0].entities.find((x) => x.id === e.id)!, registry).components.Patrol).toBeDefined();
    expect(p.scenes[0].entities.find((x) => x.id === a.id)!.components.Patrol).toBeUndefined(); // on the object, not the copy
  });

  it('"Create new": a new object "Enemy 2" with the change; the selected enemy becomes it; the old Enemy and the other copy are unchanged', () => {
    const { project, enemy, a, b } = twoEnemies();
    const choice = objectChoiceFor(project, [patrol('definition', enemy.id)], [a.id])!;
    let newId = '';
    const p = produce(project, (d) => {
      newId = applyAsNewObject(d, [patrol('definition', enemy.id)], choice, registry).newDefinitionId;
    });
    const fresh = p.definitions.find((d) => d.id === newId)!;
    expect(fresh.name).toBe('Enemy 2');
    expect(fresh.components.Patrol).toMatchObject({ speed: 90 });
    expect(fresh.components.Sprite.assetId).toBe(enemy.components.Sprite.assetId); // keeps the look
    expect(p.definitions.find((d) => d.id === enemy.id)!.components.Patrol).toBeUndefined();
    const ea = p.scenes[0].entities.find((x) => x.id === a.id)!;
    const eb = p.scenes[0].entities.find((x) => x.id === b.id)!;
    expect(ea.definitionId).toBe(newId);
    expect(ea.name).toBe('Enemy 2');
    expect(eb.definitionId).toBe(enemy.id);
    expect(resolveEntity(p, eb, registry).components.Patrol).toBeUndefined();
    // A second new kind gets the next free name.
    const again = produce(p, (d) => void applyAsNewObject(d, [patrol('definition', enemy.id)], { ...choice, switchIds: [b.id] }, registry));
    expect(again.definitions.map((d) => d.name)).toContain('Enemy 3');
  });
});
