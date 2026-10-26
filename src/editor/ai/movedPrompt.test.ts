import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../../core/components/builtin';
import type { Operation } from '../../core/commands/operations';
import { createProject, instantiateDefinition } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { aboutSomethingElse } from './runPrompt';

const registry = createBuiltinRegistry();

function level() {
  let project = createProject(registry, 'Test');
  const sceneId = project.scenes[0].id;
  const def = (name: string) => project.definitions.find((d) => d.name === name)!;
  const player = instantiateDefinition(def('Player'), { x: 0, y: 0 });
  const enemy = instantiateDefinition(def('Enemy'), { x: 200, y: 0 });
  const coin1 = instantiateDefinition(def('Coin'), { x: 300, y: 0 });
  const coin2 = instantiateDefinition(def('Coin'), { x: 340, y: 0 });
  project = produce(project, (d) => {
    for (const e of [player, enemy, coin1, coin2]) m.addEntity(d, sceneId, e);
  });
  return { project, sceneId, player, enemy, def };
}

const field = (target: 'instance' | 'definition', id: string): Operation => ({ op: 'set_component_field', target, id, component: 'Sprite', field: 'color', valueJson: '"#ff0"' }) as Operation;

describe("a prompt about something else goes to that one's card", () => {
  it("asked on the player, changing only the enemy (the one in the level, or its object): the enemy's card", () => {
    const { project, sceneId, player, enemy, def } = level();
    const onPlayer = { kind: 'entity' as const, sceneId, entityIds: [player.id] as [string] };
    const toEnemy = { kind: 'entity', sceneId, entityIds: [enemy.id] };
    expect(aboutSomethingElse(project, onPlayer, [field('instance', enemy.id)])).toEqual(toEnemy);
    // The Enemy object, placed once: that one copy's card.
    expect(aboutSomethingElse(project, onPlayer, [field('definition', def('Enemy').id)])).toEqual(toEnemy);
    // Its object and the copy together are still one thing; a sound for it to play goes along.
    expect(aboutSomethingElse(project, onPlayer, [field('instance', enemy.id), field('definition', def('Enemy').id), { op: 'make_sound' } as unknown as Operation])).toEqual(toEnemy);
  });

  it("an object placed several times: the object's card (in Objects)", () => {
    const { project, sceneId, player, def } = level();
    expect(aboutSomethingElse(project, { kind: 'entity', sceneId, entityIds: [player.id] }, [field('definition', def('Coin').id)])).toEqual({ kind: 'object', sceneId, definitionId: def('Coin').id });
  });

  it('stays where it was asked: about the thing itself or its object, several things, or the level', () => {
    const { project, sceneId, player, enemy, def } = level();
    const onPlayer = { kind: 'entity' as const, sceneId, entityIds: [player.id] as [string] };
    expect(aboutSomethingElse(project, onPlayer, [field('instance', player.id)])).toBeNull();
    expect(aboutSomethingElse(project, onPlayer, [field('definition', def('Player').id)])).toBeNull();
    expect(aboutSomethingElse(project, onPlayer, [field('instance', player.id), field('instance', enemy.id)])).toBeNull();
    expect(aboutSomethingElse(project, onPlayer, [field('instance', enemy.id), field('definition', def('Coin').id)])).toBeNull();
    expect(aboutSomethingElse(project, onPlayer, [{ op: 'place_instance', sceneId, definitionRef: def('Coin').id, x: 0, y: 0, name: null, ref: null, onTop: null } as Operation])).toBeNull();
    // Only cards about one thing move their prompts (not the level's, or a pair's).
    expect(aboutSomethingElse(project, { kind: 'level', sceneId, point: null }, [field('instance', enemy.id)])).toBeNull();
    expect(aboutSomethingElse(project, { kind: 'pair', sceneId, entityIds: [player.id, enemy.id] }, [field('instance', enemy.id)])).toBeNull();
  });

  it("asked on a library object's card (Objects), changing another object: that one's card", () => {
    const { project, sceneId, enemy, def } = level();
    expect(aboutSomethingElse(project, { kind: 'object', sceneId, definitionId: def('Player').id }, [field('definition', def('Enemy').id)])).toEqual({ kind: 'entity', sceneId, entityIds: [enemy.id] });
    expect(aboutSomethingElse(project, { kind: 'object', sceneId, definitionId: def('Enemy').id }, [field('instance', enemy.id)])).toBeNull();
  });
});
