/**
 * Generators that build a level anew each time it is played (docs/engine-architecture-proposal.md §22.1): one
 * interface, asked by the runtime (the level as played), the editor (the example it shows, faint) and the AI's
 * context. Which of them may build is the game's profile's to say (engine/generators.ts): `playGeneratorFor` gives a
 * level's generator only when it is active in the game.
 *
 * The dungeon generator (model/dungeon.ts) is the first: its code is as it was, behind this.
 */
import type { ComponentRegistry } from '../components/registry';
import { gamePlayGenerators } from '../engine/generators';
import { buildLevel, generateDungeon, newSeed, type Dungeon } from '../model/dungeon';
import { patchGenerator } from '../model/mutations';
import type { Project, Scene } from '../types';

/** What was built, for scripts and tools: its rooms, where it starts, the way on, what didn't work out. */
export type BuiltAtPlay = Dungeon;

export interface PlayBuild {
  /** The level as played: what is placed by hand, and what was built around it. */
  scene: Scene;
  built: BuiltAtPlay | null;
  /** The seed it was built from. */
  seed: number;
  /** The changes scripts asked of the recipe couldn't be made (they are dropped). */
  patchRefused: boolean;
}

export interface PlayGenerator {
  id: string;
  /** This level is one it builds (it has its recipe). */
  applies(scene: Scene): boolean;
  /**
   * Builds the level for a play: `floor` (how deep the game is), `patch` (what scripts changed of the recipe for
   * this build), `seed` (given: that one; else the recipe's own, or a new one). Also how the editor keeps an example
   * as ordinary objects (its preview seed and floor).
   */
  build(req: { project: Project; scene: Scene; registry: ComponentRegistry; floor: number; patch?: Record<string, unknown>; seed?: number }): PlayBuild;
  /** The example the editor shows of a level (its recipe's preview seed and floor, or the seed given). */
  example(req: { project: Project; scene: Scene; registry: ComponentRegistry; seed?: number }): BuiltAtPlay;
}

const dungeon: PlayGenerator = {
  id: 'dungeon',
  applies: (scene) => !!scene.generator,
  build({ project, scene, registry, floor, patch, seed }) {
    // (With what scripts changed of the recipe; a change that doesn't check out was said when it was made.)
    let recipe = scene.generator!;
    let patchRefused = false;
    if (patch) {
      try {
        recipe = patchGenerator(project, recipe, patch);
      } catch {
        patchRefused = true;
      }
    }
    const used = seed ?? recipe.seed ?? newSeed();
    const built = buildLevel(project, { ...scene, generator: recipe }, registry, used, floor);
    return { scene: built.scene, built: built.dungeon, seed: used, patchRefused };
  },
  example({ project, scene, registry, seed }) {
    const g = scene.generator!;
    return generateDungeon(project, scene, registry, seed ?? g.preview, g.previewFloor);
  },
};

const REGISTERED = new Map<string, PlayGenerator>([[dungeon.id, dungeon]]);

/** Adds a play-time generator (declared in engine/generators.ts, or as a module by whoever registers it). */
export function registerPlayGenerator(g: PlayGenerator): void {
  REGISTERED.set(g.id, g);
}
export function unregisterPlayGenerator(id: string): void {
  REGISTERED.delete(id);
}
export const playGeneratorById = (id: string): PlayGenerator | undefined => REGISTERED.get(id);
export const playGeneratorIds = (): string[] => [...REGISTERED.keys()];

/**
 * The generator that builds this level at play: one that applies to it and is active in the game (`active`: the
 * game's active play-time generators, when already worked out). Null: an ordinary level, or its generator isn't
 * active (then the level plays as it is placed by hand; the compatibility report says so).
 */
export function playGeneratorFor(project: Project, scene: Scene, active: ReadonlySet<string> = gamePlayGenerators(project)): PlayGenerator | null {
  for (const g of REGISTERED.values()) if (active.has(g.id) && g.applies(scene)) return g;
  return null;
}
