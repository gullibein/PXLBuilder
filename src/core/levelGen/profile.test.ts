import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { GENRES, levelProfileOf, profilePuzzles, THEMES } from './profile';

const registry = createBuiltinRegistry();
const withLevel = (names: string[]) =>
  produce(createProject(registry), (d) => {
    names.forEach((n, i) => m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === n)!, { x: 16 + i * 32, y: 16 })));
  });

describe("a platformer's kind of play and its look", () => {
  it('a profile the game chose is used as it is', () => {
    const p = produce(createProject(registry), (d) => void (d.settings.levelProfile = { genre: 'puzzle', theme: 'snow', version: 1 }));
    const got = levelProfileOf(p, registry)!;
    expect([got.genre.id, got.theme!.id, got.stored]).toEqual(['puzzle', 'snow', true]);
  });

  it('without one, it is worked out from the game (and nothing is written): mostly switches, doors and crates make a puzzle platformer', () => {
    expect(levelProfileOf(withLevel(['Platform', 'Enemy', 'Enemy']), registry)!.genre.id).toBe('classic');
    expect(levelProfileOf(withLevel(['Platform', 'Switch', 'Door', 'Crate', 'Enemy']), registry)!.genre.id).toBe('puzzle');
    const p = withLevel(['Platform']);
    expect(levelProfileOf(p, registry)!.stored).toBe(false);
    expect(p.settings.levelProfile).toBeUndefined();
  });

  it('an empty game is offered a look, the same every time; a game with levels keeps the look it has', () => {
    const empty = createProject(registry);
    const a = levelProfileOf(empty, registry)!.theme;
    expect(a).not.toBeNull();
    expect(levelProfileOf(empty, registry)!.theme).toBe(a);
    expect(levelProfileOf(withLevel(['Platform']), registry)!.theme).toBeNull();
  });

  it('an unknown genre or theme (from a newer version, say) counts as not chosen; a top-down game has none', () => {
    const odd = produce(createProject(registry), (d) => void (d.settings.levelProfile = { genre: 'metroidvania', theme: 'forest', version: 1 }));
    expect(levelProfileOf(odd, registry)!.stored).toBe(false);
    expect(levelProfileOf(createProject(registry, 'T', 'topdown'), registry)).toBeNull();
  });

  it('every genre and theme has an id and words; a theme drops the puzzles that do not fit its look', () => {
    expect(new Set(GENRES.map((g) => g.id)).size).toBe(GENRES.length);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    const classic = GENRES.find((g) => g.id === 'classic')!;
    expect(profilePuzzles(classic, THEMES.find((t) => t.id === 'space')!)).not.toContain('swim for it');
    expect(profilePuzzles(classic, null)).toEqual(classic.puzzles);
  });
});
