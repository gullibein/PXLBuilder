import { describe, expect, it } from 'vitest';
import type { Operation } from '../commands/operations';
import type { AIContext } from './context';
import { unaskedChanges } from './unasked';

const onEnemy: AIContext = { kind: 'entity', sceneId: 's', entityIds: ['e1'] };
const onLevel: AIContext = { kind: 'level', sceneId: 's', point: null };
const newObject = { op: 'create_definition', name: 'Squished Motobug' } as unknown as Operation;
const look = { op: 'draw_sprite', target: 'definition', id: 'd1', situation: 'defeated' } as unknown as Operation;
const noStomp = { op: 'remove_component', target: 'definition', id: 'd1', component: 'Stompable' } as unknown as Operation;

describe('changes the user did not ask for', () => {
  it('a look asked for on an object is not a new object', () => {
    expect(unaskedChanges(onEnemy, 'I need a squished enemy sprite for when the player stomps the enemy', [newObject])).toMatch(/not a new object/);
    expect(unaskedChanges(onEnemy, 'I need a squished enemy sprite for when the player stomps the enemy', [look])).toBeNull();
    // Asked for a new thing, or not about one object: a new object is fine.
    expect(unaskedChanges(onEnemy, 'make a new enemy with a red sprite', [newObject])).toBeNull();
    expect(unaskedChanges(onEnemy, 'when stomped it drops a coin sprite', [newObject])).toBeNull();
    expect(unaskedChanges(onLevel, 'add a mushroom with a cute sprite', [newObject])).toBeNull();
  });

  it('a built-in behavior is never removed unless the request names it and asks for it gone', () => {
    expect(unaskedChanges(onEnemy, 'the squished motobug should not be a new object, but a sprite within the motobug object!', [look, noStomp])).toMatch(/removes Stompable/);
    expect(unaskedChanges(onEnemy, 'I need a squished enemy sprite for when the player stomps the enemy', [noStomp])).toMatch(/removes Stompable/);
    expect(unaskedChanges(onEnemy, 'make it so you can no longer stomp it', [noStomp])).toBeNull();
    expect(unaskedChanges(onEnemy, 'remove its behaviors', [noStomp])).toBeNull();
  });
});
