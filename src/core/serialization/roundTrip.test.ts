import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { createIsometricProject } from '../model/isometricStarter';
import * as m from '../model/mutations';
import { createRoguelikeProject } from '../model/roguelikeStarter';
import { createRpgProject } from '../model/rpgStarter';
import { projectFromBundle, projectFromFiles, projectToBundle, projectToFiles } from './serialize';

const registry = createBuiltinRegistry();

/** Every starter, and one with game controls set: saved and loaded again, nothing of it may be lost. */
const games = () => [
  ['platformer', createProject(registry, 'P', 'platformer')],
  ['top-down', createProject(registry, 'T', 'topdown')],
  ['RPG', createRpgProject(registry)],
  ['roguelike (a random level)', createRoguelikeProject(registry)],
  ['isometric (its view, raised blocks)', createIsometricProject(registry)],
  [
    'controls changed',
    produce(createProject(registry, 'C', 'platformer'), (d) => {
      m.setControls(d, { jump: ['KeyW'] });
    }),
  ],
] as const;

describe('saved and loaded again', () => {
  for (const [name, project] of games()) {
    it(`${name}: exactly the same game`, () => {
      const json = JSON.parse(JSON.stringify(projectToBundle(project)));
      const back = projectFromBundle(json, registry);
      expect(back.project).not.toBeNull();
      expect(JSON.parse(JSON.stringify(back.project))).toEqual(JSON.parse(JSON.stringify(project)));
      const files = projectFromFiles(JSON.parse(JSON.stringify(projectToFiles(project))), registry);
      expect(JSON.parse(JSON.stringify(files.project))).toEqual(JSON.parse(JSON.stringify(project)));
    });
  }
});
