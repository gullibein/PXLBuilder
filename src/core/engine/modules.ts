/**
 * The engine's modules, as they are today, registered (F1 of docs/engine-architecture-proposal.md). Most only
 * describe and point to code that hasn't moved behind its interface yet (`pointsTo`: where it is, and the stage that
 * moves it). What does go through these modules already: new games (kits), the level builder (generators), the
 * player's movement and the levels' gravity when the profile changes (locomotion, views).
 */
import { CAMERA_BEHAVIORS } from './camera';
import { VALIDATORS, type Validator } from '../validation/validators';
import { GEOMETRY } from './geometry';
import type { ComponentRegistry } from '../components/registry';
import { createProject } from '../model/factory';
import { createIsometricProject } from '../model/isometricStarter';
import { createRoguelikeProject } from '../model/roguelikeStarter';
import { createRpgProject } from '../model/rpgStarter';
import type { Id, Project } from '../types';
import { generateLevel, type GenerateOptions, type GenerateResult } from '../levelGen/generate';
import { GENRE_BUILDS } from '../levelGen/genres';
import { levelProfileOf } from '../levelGen/profile';
import { ModuleRegistry, type Module } from './module';

export interface ViewModule extends Module {
  kind: 'view';
  /** The levels' gravity in this view (a side view pulls down; seen from above, nothing falls). */
  gravity: { x: number; y: number };
}

export interface LocomotionModule extends Module {
  kind: 'locomotion';
  /** The Character Controller's movement value that selects its runtime model (runtime/movement). */
  controller: string;
}

export interface AbilityModule extends Module {
  kind: 'ability';
  /** The component that gives a character the ability (its runtime ability: runtime/movement/abilities.ts). */
  component: string;
}

export interface KitModule extends Module {
  kind: 'kit';
  /** A new game of this kit's objects (today's starter). */
  create(registry: ComponentRegistry, name: string): Project;
  /** Which KIT_ROLES table declares its objects' parts. */
  roles: string;
}

export interface GeneratorRequest {
  project: Project;
  sceneId: Id;
  blueprint: unknown;
  registry: ComponentRegistry;
  options: GenerateOptions;
}

export interface GeneratorModule extends Module {
  kind: 'generator';
  /** The validators its levels go through (all must pass for "validated"). */
  validators: (project: Project, registry: ComponentRegistry) => string[];
  /** Builds a level (New level, Regenerate, Variation, more levels, generate_level). Missing: levels made otherwise. */
  build?(req: GeneratorRequest): GenerateResult;
  /** A short name for what it builds in this game ("classic", "puzzle"…), or null when it can't build here. */
  label?(project: Project, registry: ComponentRegistry): string | null;
}

export interface GeometryModule extends Module {
  kind: 'geometry';
  /** What the game's shapes of this kind do when it isn't active (not selected, or not supported). */
  without: string;
}
export { GEOMETRY };

export interface CameraModule extends Module {
  kind: 'camera';
  /** What happens when a game uses it without it being active. */
  without: string;
}

export interface ValidatorModule extends Module {
  kind: 'validator';
  validator: Validator;
}

export const modules = new ModuleRegistry();

// ---------------------------------------------------------------- views and time
modules.register<ViewModule>({ kind: 'view', id: 'side', version: 1, describe: 'Seen from the side: gravity pulls down, "up" is jumping', requires: [], provides: ['view:side'], gravity: { x: 0, y: 980 } });
modules.register<ViewModule>({ kind: 'view', id: 'top', version: 1, describe: 'Seen from above: no gravity, walking in every direction', requires: [], provides: ['view:top'], gravity: { x: 0, y: 0 } });
modules.register<ViewModule>({ kind: 'view', id: 'iso', version: 1, describe: 'Seen at an angle (isometric): blocks with height', requires: [], provides: ['view:iso'], gravity: { x: 0, y: 0 } });
modules.register({ kind: 'time', id: 'realtime', version: 1, describe: 'Everything moves all the time', requires: [], provides: ['time:realtime'] });
modules.register({
  kind: 'time',
  id: 'turns',
  version: 1,
  describe: 'Turn by turn: the world answers each of the player\'s steps',
  requires: ['kit:turns'],
  provides: ['time:turns'],
  fallback: { 'kit:turns': 'nothing in the game takes turns yet (no turn scripts): it plays in real time' },
  pointsTo: { code: 'runtime/turns.ts (TurnKit), driven by the turn scripts', movesIn: 'F6' },
});

// ---------------------------------------------------------------- movement
modules.register<LocomotionModule>({
  kind: 'locomotion',
  id: 'arcade',
  version: 1,
  describe: 'Run and jump: accelerate to a top speed, gravity, air control, ladders, ramps, swimming',
  requires: ['view:side', 'time:realtime'],
  provides: ['locomotion:arcade', 'reach:table', 'reach:moves', 'reach:simulator'],
  controller: 'platformer',
});
modules.register<LocomotionModule>({
  kind: 'locomotion',
  id: 'topdown',
  version: 1,
  describe: 'Walk in every direction, no gravity or jumping',
  requires: ['view:top|view:iso'],
  provides: ['locomotion:topdown'],
  controller: 'topdown',
});
const ability = (id: string, component: string, describe: string): AbilityModule => ({ kind: 'ability', id, version: 1, describe, requires: ['locomotion:arcade'], provides: [`ability:${id}`], component });
modules.register(ability('double_jump', 'DoubleJump', 'Extra jumps in the air'));
modules.register(ability('ledge_grab', 'LedgeGrab', 'Catch ledges and climb up'));
modules.register(ability('wall_jump', 'WallJump', 'Slide down walls and jump off them'));
modules.register(ability('dash', 'Dash', 'A short fast dash the way the keys point, no gravity; refilled on landing'));

// ---------------------------------------------------------------- geometry and camera
// (All answered by the collision world, runtime/geometry/world.ts, behind the GeometryQuery interface; the runtime
// and the level checker use only the active ones: engine/geometry.ts, where they are declared.)
for (const g of GEOMETRY) modules.register<GeometryModule>({ kind: 'geometry', ...g, provides: [`geometry:${g.id}`] });
// Camera behaviours (runtime/camera: a pipeline in the profile's order; declared in engine/camera.ts).
for (const b of CAMERA_BEHAVIORS) modules.register<CameraModule>({ kind: 'camera', ...b, provides: [`camera:${b.id}`] });

// ---------------------------------------------------------------- kits (today's starter sets)
const topKit = (id: string, describe: string, create: KitModule['create'], requires: string[], provides: string[] = []): KitModule => ({
  kind: 'kit', id, version: 1, describe, requires, provides: [`kit:${id}`, 'role:player', ...provides], create, roles: 'topdown',
});
modules.register<KitModule>({
  kind: 'kit',
  id: 'platformer',
  version: 1,
  describe: 'Platformer objects: player, ground, ramps, bridges, water, ladders, enemies, coins, hearts, keys and doors, switches and plates, crates, springs, ? blocks, bricks, pipes, a goal',
  requires: ['view:side'],
  provides: ['kit:platformer', 'role:player', 'role:ground', 'role:goal'],
  create: (registry, name) => createProject(registry, name),
  roles: 'platformer',
});
modules.register(topKit('topdown', 'Top-down objects: hero, walls, floors, enemies, coins, keys and doors, switches, teleporters, a goal', (r, n) => createProject(r, n, 'topdown'), ['view:top|view:iso']));
// (The RPG's objects are scripts and pictures: they work seen from the side too, so it needs no view.)
modules.register(topKit('rpg', 'RPG objects: a party, monsters, battles, towns people and shops (on top of the top-down objects)', (r, n) => createRpgProject(r, n), []));
modules.register(topKit('roguelike', 'Roguelike objects: monsters that answer each step, gold, potions, stairs down, random floors', (r, n) => createRoguelikeProject(r, n), ['view:top'], ['kit:turns']));
modules.register(topKit('isometric', 'Isometric blocks: floors, walls and water with height, a hero', (r, n) => createIsometricProject(r, n), ['view:iso']));

// ---------------------------------------------------------------- level generation and progression
modules.register<GeneratorModule>({
  kind: 'generator',
  id: 'sections',
  version: 1,
  describe: 'Levels of floors, each a run of sections (patterns) sized from the player\'s jump; a genre setting (classic, puzzle) picks the patterns',
  requires: ['view:side', 'reach:table', 'role:player', 'role:ground', 'role:goal'],
  provides: ['generator:levels'],
  validators: (project, registry) => ['layout', 'checker', 'cell_solver', ...(levelProfileOf(project, registry)?.genre.id === 'puzzle' ? ['puzzle_needed'] : [])],
  label: (project, registry) => {
    const genre = levelProfileOf(project, registry)?.genre.id;
    return genre && GENRE_BUILDS[genre] ? genre : null;
  },
  build: ({ project, sceneId, blueprint, registry, options }) => {
    const genre = levelProfileOf(project, registry)?.genre.id;
    const id = genre && GENRE_BUILDS[genre] ? genre : 'classic';
    return generateLevel(project, sceneId, blueprint, registry, id, { validators: ['layout', 'checker', 'cell_solver', ...(id === 'puzzle' ? ['puzzle_needed'] : [])], ...options });
  },
  pointsTo: { code: 'levelGen/generate.ts (layout, floors, sections), genres.ts', movesIn: 'F6' },
});
modules.register<GeneratorModule>({
  kind: 'generator',
  id: 'dungeon',
  version: 1,
  describe: 'Random dungeon floors, built anew each time a level with a recipe is played (rooms, corridors, monsters, loot)',
  requires: ['view:top'],
  provides: ['generator:at_play'],
  validators: () => [],
  pointsTo: { code: 'model/dungeon.ts generateDungeon (Scene.generator)', movesIn: 'F6' },
});
modules.register({ kind: 'progression', id: 'stages', version: 1, describe: 'Levels one after another (go_to_level for branches and secret exits)', requires: [], provides: ['progression:stages'], pointsTo: { code: 'runtime next_level / go_to_level, the play view', movesIn: 'F6' } });

// ---------------------------------------------------------------- validators (core/validation/validators.ts)
// (What each needs of the player's reach description: its table, its moves, its simulator.)
for (const v of VALIDATORS) modules.register<ValidatorModule>({ kind: 'validator', id: v.id, version: 1, describe: v.describe, requires: v.needs.map((n) => `reach:${n}`), provides: [`validates:${v.id}`], validator: v });
