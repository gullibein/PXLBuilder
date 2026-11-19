import { produce } from 'immer';
import { setLevelProfile } from '../engine/profile';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject, createScene, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { buildAIPayload } from './context';
import { LEVEL_PUZZLES, levelDesignIdea, levelShape, levelsToGetThrough } from './levelIdeas';
import { tetris } from '../../regression/games/boards';
import { GENRES, THEMES } from '../levelGen/profile';

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
    expect(idea.otherLevels).toEqual(['Level 1: starts bottom left, goal top right, about 20 by 10 cells; 1 floor rows, 0 enemies, 0 hazards; pieces: none']);
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

  it('platformer levels come with puzzles that fit the kind of platformer, each one with how', () => {
    for (const g of GENRES) for (const p of g.puzzles) expect(LEVEL_PUZZLES[p], `${g.name}: ${p}`).toBeTruthy();
    const p = createProject(registry);
    let n = 0;
    const idea = levelDesignIdea(p, p.scenes[0], registry, () => ((n = (n * 9301 + 49297) % 233280), n / 233280));
    expect(idea.style).toBeTruthy();
    expect(idea.puzzles!.length).toBeGreaterThanOrEqual(2);
    expect(idea.puzzles!.every((x) => GENRES[0].puzzles.includes(x.split(':')[0]))).toBe(true);
  });

  it("the game's kind and look stay the same from request to request (they used to be picked anew each time)", () => {
    const p = createProject(registry);
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const styles = new Set(Array.from({ length: 20 }, () => levelDesignIdea(p, p.scenes[0], registry, random).style!.name));
    expect(styles.size).toBe(1);
    // An empty game is offered a look; one with levels keeps the look they have.
    expect([...styles][0]).toMatch(/^Classic platformer, /);
    const built = project();
    const style = levelDesignIdea(built, built.scenes[1], registry, random).style!;
    expect(style.name).toBe('Classic platformer');
    expect(style.rules).toMatch(/Look: as the game's levels already look/);
  });

  it('a kind and look the game chose are used; puzzles the look rules out are left out', () => {
    const p = produce(createProject(registry), (d) => void (setLevelProfile(d, 'classic', 'space', registry)));
    for (let i = 0; i < 20; i++) {
      const idea = levelDesignIdea(p, p.scenes[0], registry, () => (i + 0.5) / 20);
      expect(idea.style!.name).toBe('Classic platformer, Space station');
      expect(idea.style!.rules).toContain(THEMES.find((t) => t.id === 'space')!.look);
      expect(idea.puzzles!.some((x) => /^(hill|swim for it):/.test(x))).toBe(false);
    }
    const puzzle = produce(createProject(registry), (d) => void (setLevelProfile(d, 'puzzle', 'castle', registry)));
    const idea = levelDesignIdea(puzzle, puzzle.scenes[0], registry, () => 0.3);
    expect(idea.style!.name).toBe('Puzzle platformer, Castle');
    expect(idea.puzzles!.every((x) => GENRES[1].puzzles.includes(x.split(':')[0]))).toBe(true);
  });
});

describe("games that aren't levels to get through", () => {
  it('a game with a character someone steers is levels to get through; a board (nothing placed is steered) is not; an empty game is not judged yet', () => {
    expect(levelsToGetThrough(project(), registry)).toBe(true);
    expect(levelsToGetThrough(createProject(registry), registry)).toBe(true);
    expect(levelsToGetThrough(tetris(registry), registry)).toBe(false);
    // A chess board: pieces and a rules object, no CharacterController anywhere.
    const board = produce(createProject(registry), (d) => {
      const coin = d.definitions.find((x) => x.name === 'Coin')!;
      for (let i = 0; i < 8; i++) m.addEntity(d, d.scenes[0].id, instantiateDefinition(coin, { x: 16 + 32 * i, y: 48 }));
    });
    expect(levelsToGetThrough(board, registry)).toBe(false);
  });

  it("the AI gets no level idea (a start corner, a goal corner, puzzles to build in) for a board game; a platformer's still comes", () => {
    const random = () => 0.3;
    const p = project();
    expect(buildAIPayload(p, { kind: 'level', sceneId: p.scenes[1].id, point: null }, registry, undefined, null, random).level.design).toBeDefined();
    const t = tetris(registry);
    expect(buildAIPayload(t, { kind: 'level', sceneId: t.scenes[0].id, point: null }, registry, undefined, null, random).level.design).toBeUndefined();
    expect(buildAIPayload(t, { kind: 'project', sceneId: t.scenes[0].id }, registry, undefined, null, random).level.design).toBeUndefined();
  });
});
