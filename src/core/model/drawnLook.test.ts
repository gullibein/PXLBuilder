import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations } from '../commands/operations';
import { createBuiltinRegistry } from '../components/builtin';
import { undrawnObjects } from './drawnLook';
import { createProject } from './factory';

const registry = createBuiltinRegistry();
const art = { palette: [{ key: 'a', color: '#ff0000' }], rows: Array.from({ length: 8 }, () => 'a'.repeat(8)), frames: null, fps: null, situation: null };

describe('a new game drawn by the AI', () => {
  it('names the objects in the level left with the starter pictures, or as plain boxes; drawn ones are fine', () => {
    const before = createProject(registry, 'Test', 'platformer');
    const sceneId = before.scenes[0].id;
    const lib = (name: string) => before.definitions.find((d) => d.name === name)!.id;
    const ops = [
      { op: 'place_instance', sceneId, definitionRef: lib('Player'), x: 0, y: 0, name: null, ref: null },
      { op: 'place_instance', sceneId, definitionRef: lib('Coin'), x: 64, y: 0, name: null, ref: null },
      { op: 'create_definition', ref: 'gem', name: 'Gem', description: '', category: 'Items', tags: [], components: [{ component: 'Sprite', propsJson: '{"width":16,"height":16,"color":"#00ff00"}' }] },
      { op: 'place_instance', sceneId, definitionRef: 'gem', x: 96, y: 0, name: null, ref: null },
    ];
    const run = (extra: unknown[]) => produce(before, (d) => void applyOperations(d, [...ops, ...extra] as never, registry));
    expect(undrawnObjects(before, run([]), sceneId).sort()).toEqual(['Coin', 'Gem', 'Player']);
    const drawn = run([
      { op: 'draw_sprite', target: 'definition', id: lib('Player'), name: 'Hero', ...art },
      { op: 'draw_sprite', target: 'definition', id: 'gem', name: 'Gem', ...art },
    ]);
    expect(undrawnObjects(before, drawn, sceneId)).toEqual(['Coin']);
    // Objects not in the level don't count.
    expect(undrawnObjects(before, before, sceneId)).toEqual([]);
  });
});
