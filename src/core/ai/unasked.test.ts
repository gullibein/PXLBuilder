import { describe, expect, it } from 'vitest';
import type { Operation } from '../commands/operations';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import type { AIContext } from './context';
import { unaskedChanges } from './unasked';

const project = createProject(createBuiltinRegistry());
const enemy = project.definitions.find((d) => d.name === 'Enemy')!;
const stomp = enemy.scripts!.find((s) => s.name === 'Stomp')!;
const hurts = enemy.scripts!.find((s) => s.name === 'Hurts on touch')!;
const onEnemy: AIContext = { kind: 'entity', sceneId: 's', entityIds: ['e1'] };
const onLevel: AIContext = { kind: 'level', sceneId: 's', point: null };
const newObject = { op: 'create_definition', name: 'Squished Motobug' } as unknown as Operation;
const look = { op: 'draw_sprite', target: 'definition', id: enemy.id, situation: 'defeated' } as unknown as Operation;
const removeScript = (id: string) => ({ op: 'remove_script', target: 'definition', id: enemy.id, scriptId: id }) as unknown as Operation;
const noPatrol = { op: 'remove_component', target: 'definition', id: enemy.id, component: 'Patrol' } as unknown as Operation;

describe('changes the user did not ask for', () => {
  it('a look asked for on an object is not a new object', () => {
    expect(unaskedChanges(onEnemy, 'I need a squished enemy sprite for when the player stomps the enemy', [newObject])).toMatch(/not a new object/);
    expect(unaskedChanges(onEnemy, 'I need a squished enemy sprite for when the player stomps the enemy', [look])).toBeNull();
    // Asked for a new thing, or not about one object: a new object is fine.
    expect(unaskedChanges(onEnemy, 'make a new enemy with a red sprite', [newObject])).toBeNull();
    expect(unaskedChanges(onEnemy, 'when stomped it drops a coin sprite', [newObject])).toBeNull();
    expect(unaskedChanges(onLevel, 'add a mushroom with a cute sprite', [newObject])).toBeNull();
  });

  it("a rule script (stomping, hurting on touch) is never removed unless the request names it and asks for it gone", () => {
    expect(unaskedChanges(onEnemy, 'the squished motobug should not be a new object, but a sprite within the motobug object!', [look, removeScript(stomp.id)], project)).toMatch(/removes the "Stomp" script/);
    expect(unaskedChanges(onEnemy, 'I need a squished enemy sprite for when the player stomps the enemy', [removeScript(stomp.id)], project)).toMatch(/"Stomp"/);
    expect(unaskedChanges(onEnemy, 'make it so you can no longer stomp it', [removeScript(stomp.id)], project)).toBeNull();
    expect(unaskedChanges(onEnemy, "it shouldn't hurt the player anymore", [removeScript(hurts.id)], project)).toBeNull();
    expect(unaskedChanges(onEnemy, 'make it bigger', [removeScript(hurts.id)], project)).toMatch(/"Hurts on touch"/);
  });

  it('a built-in behavior is never removed unless the request names it and asks for it gone', () => {
    expect(unaskedChanges(onEnemy, 'give it a red hat', [noPatrol])).toMatch(/removes Patrol/);
    expect(unaskedChanges(onEnemy, 'it should stop walking around', [noPatrol])).toBeNull();
  });
});
