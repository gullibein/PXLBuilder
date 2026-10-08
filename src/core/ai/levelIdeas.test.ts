import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject, createScene, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { buildAIPayload } from './context';
import { levelDesignIdea, levelShape } from './levelIdeas';

const registry = createBuiltinRegistry();

/** A finished level: floor along the bottom, the player bottom left, the goal top right. */
function project() {
  return produce(createProject(registry), (d) => {
    const s = d.scenes[0];
    const put = (name: string, x: number, y: number) => m.addEntity(d, s.id, instantiateDefinition(d.definitions.find((x) => x.name === name)!, { x, y }));
    for (let x = 16; x < 640; x += 32) put('Platform', x, 304);
    put('Platform', 624, 48);
    put('Player', 32, 272);
    put('Goal', 624, 16);
    m.addScene(d, createScene('Level 2'));
  });
}

describe('variety for generated levels', () => {
  it('describes a level by where it starts and ends', () => {
    const p = project();
    expect(levelShape(p, p.scenes[0], registry)).toBe('starts bottom left, goal top right, about 20 by 10 cells');
    expect(levelShape(p, p.scenes[1], registry)).toBeNull();
  });

  it('picks the layout at random (not always the same), and lists the other levels', () => {
    const p = project();
    const names = new Set<string>();
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 40; i++) names.add(levelDesignIdea(p, p.scenes[1], registry, random).layout.name);
    expect(names.size).toBeGreaterThan(6);
    const idea = levelDesignIdea(p, p.scenes[1], registry, () => 0.1);
    expect(idea.otherLevels).toEqual(['Level 1: starts bottom left, goal top right, about 20 by 10 cells']);
  });

  it('top-down levels get top-down layouts', () => {
    const p = createProject(registry, 'Dungeon', 'topdown');
    const names = new Set<string>();
    for (let i = 0; i < 6; i++) names.add(levelDesignIdea(p, p.scenes[0], registry, () => i / 6 + 0.01).layout.name);
    expect([...names].every((n) => ['Dungeon rooms', 'Maze', 'Hub and spokes', 'Ring', 'Long hall', 'Courtyard'].includes(n))).toBe(true);
  });

  it('the AI gets an idea for level and whole-game requests only', () => {
    const p = project();
    const level = buildAIPayload(p, { kind: 'level', sceneId: p.scenes[1].id } as never, registry, undefined, null, () => 0.5);
    expect(level.level.design?.layout.name).toBeTruthy();
    const thing = buildAIPayload(p, { kind: 'entity', sceneId: p.scenes[0].id, entityIds: [p.scenes[0].entities[0].id] } as never, registry, undefined, null, () => 0.5);
    expect(thing.level.design).toBeUndefined();
  });
});
