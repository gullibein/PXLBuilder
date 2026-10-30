import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { gameFromText, projectToBundle, ProjectLoadError } from './serialize';

const registry = createBuiltinRegistry();

/** A saved game, broken by `mess` (a hand edit, another version of the app…). */
function brokenFile(mess: (files: Record<string, any>) => void): string { // eslint-disable-line @typescript-eslint/no-explicit-any
  const bundle = projectToBundle(createProject(registry, 'Broken'));
  mess(bundle.files);
  return JSON.stringify(bundle);
}

describe('fixing a game file that does not open', () => {
  const objectFile = (files: Record<string, any>, name: string) => Object.entries(files).find(([k, v]) => k.startsWith('objects/') && v.name === name)![1]; // eslint-disable-line @typescript-eslint/no-explicit-any
  const sceneFile = (files: Record<string, any>) => Object.entries(files).find(([k]) => k.startsWith('scenes/'))![1]; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('leaves out only what is broken, and says what', () => {
    const text = brokenFile((files) => {
      // A script in a shape this version doesn't know, a component it doesn't know, a broken placed thing.
      objectFile(files, 'Enemy').scripts.push({ id: 'scr_x', name: 'Weird', handlers: [{ when: { on: 'teleport_party' }, do: [{ do: 'dance' }] }] });
      objectFile(files, 'Coin').components.Sparkles = { amount: 3 };
      sceneFile(files).entities.push({ id: 'ent_bad', name: 'Ghost', definitionId: 'def_gone', transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } }, components: {}, removedComponents: [], tags: [], metadata: {} });
      sceneFile(files).entities.push({ id: 'ent_worse', name: 'Junk', transform: 'nowhere' });
    });
    expect(() => gameFromText(text, registry)).toThrow(ProjectLoadError);
    const { project, removed } = gameFromText(text, registry, { repair: true });
    expect(removed).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/the script "Weird" of "Enemy"/),
        expect.stringMatching(/the placed thing "Junk"/),
        expect.stringMatching(/Sparkles settings of "Coin"/),
        expect.stringMatching(/the placed thing "Ghost" .*its object is missing/),
      ]),
    );
    // Everything else is as it was: the Enemy keeps its own scripts, the Coin is still a coin.
    const enemy = project.definitions.find((d) => d.name === 'Enemy')!;
    expect(enemy.scripts!.map((s) => s.name)).toEqual(['Stomp', 'Hurts on touch']);
    expect(project.definitions.find((d) => d.name === 'Coin')!.components.Collectible).toBeDefined();
    expect(project.definitions).toHaveLength(createProject(registry).definitions.length);
  });

  it('a file that opens as it is, opened with repair, loses nothing', () => {
    const { removed } = gameFromText(brokenFile(() => {}), registry, { repair: true });
    expect(removed).toEqual([]);
  });

  it('a missing level file or object file: the rest opens', () => {
    const text = brokenFile((files) => {
      const key = Object.keys(files).find((k) => k.startsWith('objects/') && files[k].name === 'Crate')!;
      const place = (name: string, definitionId: string) => ({ id: `ent_${name}`, name, definitionId, transform: { position: { x: 0, y: 0 }, rotation: 0, scale: { x: 1, y: 1 } }, components: {}, removedComponents: [], tags: [], metadata: {} });
      sceneFile(files).entities.push(place('Crate', files[key].id), place('Coin', objectFile(files, 'Coin').id));
      delete files[key];
    });
    const { project, removed } = gameFromText(text, registry, { repair: true });
    expect(removed![0]).toMatch(/missing from the file/);
    expect(project.definitions.some((d) => d.name === 'Crate')).toBe(false);
    // The placed crate had its object in it: it is left out too; the rest of the level stays.
    expect(project.scenes[0].entities.map((e) => e.name)).toEqual(['Coin']);
  });
});
