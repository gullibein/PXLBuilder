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
import type { EntityInstance, Id, Project, Scene } from '../types';
import { gameCamera } from '../engine/camera';

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
  /** The levels it uses as parts of the levels it builds (room templates): they are not played on their own. */
  parts?(project: Project): Id[];
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
  parts: (project) => project.scenes.flatMap((s) => s.generator?.templates ?? []),
  example({ project, scene, registry, seed }) {
    const g = scene.generator!;
    return generateDungeon(project, scene, registry, seed ?? g.preview, g.previewFloor);
  },
};

/** One cell: a room's zone takes in the walls round it. */
const WALL = 32;

/**
 * Camera zones for the rooms a generator built: one for each room, its inside and the walls round it, as ordinary
 * Camera Zone objects (invisible; the camera's "rooms" behaviour does the rest: runtime/cameraBehaviors.ts). The
 * corridors between rooms are in no zone: there the camera follows as usual, and slides into the next room.
 */
export function roomZones(built: BuiltAtPlay | null, registry: ComponentRegistry): EntityInstance[] {
  return (built?.roomList ?? []).map((r, i) => ({
    id: `zone_${i}`,
    name: `Room ${i + 1}`,
    definitionId: null,
    transform: { position: { x: r.x, y: r.y }, rotation: 0, scale: { x: 1, y: 1 } },
    components: {
      Sprite: registry.createDefault('Sprite', { width: r.w + 2 * WALL, height: r.h + 2 * WALL, visible: false }),
      CameraZone: registry.createDefault('CameraZone', { transition: 'slide' }),
    },
    removedComponents: [],
    tags: ['camera_zone'],
    metadata: { generated: true },
  }));
}

/**
 * A level built for play by its generator, as the game has it: with camera zones for its rooms when the game's
 * camera has the "rooms" behaviour active (engine/camera.ts), and exactly what the generator built when not. Zones
 * placed by hand in the level stay as they are.
 */
export function buildForPlay(gen: PlayGenerator, req: Parameters<PlayGenerator['build']>[0]): PlayBuild {
  const out = gen.build(req);
  if (!gameCamera(req.project).includes('rooms')) return out;
  const zones = roomZones(out.built, req.registry);
  return zones.length ? { ...out, scene: { ...out.scene, entities: [...zones, ...out.scene.entities] } } : out;
}

const REGISTERED = new Map<string, PlayGenerator>([[dungeon.id, dungeon]]);

/** Adds a play-time generator (declared in engine/generators.ts, or as a module by whoever registers it). */
export function registerPlayGenerator(g: PlayGenerator): void {
  REGISTERED.set(g.id, g);
}
export function unregisterPlayGenerator(id: string): void {
  REGISTERED.delete(id);
}
/** The levels generators use as parts (not played on their own, whatever the game's progression). */
export function partLevels(project: Project): Set<Id> {
  return new Set([...REGISTERED.values()].flatMap((g) => g.parts?.(project) ?? []));
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
