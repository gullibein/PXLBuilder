/**
 * The engine's modules, registered (docs/engine-architecture-proposal.md). Each describes a part of the engine that
 * is behind its interface (movement, geometry, validation, camera, generators, turns, progression: stages F2 to F6
 * moved them there), with what it requires and provides: a game's profile selects among them, and the compatibility
 * check works from these declarations alone. (`pointsTo` marked the ones that only described old code: none is left.)
 */
import { onAbilities } from '../../abilities/index';
import { TURN_SYSTEMS } from './turns';
import { PROGRESSIONS } from '../progression/progression';
import { GENERATORS } from './generators';
import { playGeneratorById, type PlayGenerator } from '../generation/playGenerators';
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
  /** How its levels are drawn and walked: flat, or at an angle (a level's own setting: world.view). */
  projection: 'flat' | 'iso';
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
  /** When it builds: while editing, or anew at each play. */
  when: 'edit' | 'play';
  /** What happens to what a game has of it when it isn't active. */
  without: string;
  /** Its play-time builder (when: play). */
  atPlay?: PlayGenerator;
  /** A short name for what it builds in this game ("classic", "puzzle"…), or null when it can't build here. */
  label?(project: Project, registry: ComponentRegistry): string | null;
}

export interface GeometryModule extends Module {
  kind: 'geometry';
  /** What the game's shapes of this kind do when it isn't active (not selected, or not supported). */
  without: string;
}
export { GEOMETRY };

export interface TurnsModule extends Module {
  kind: 'turns';
  /** What happens to scripts that take turns when it isn't active. */
  without: string;
}

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
modules.register<ViewModule>({ kind: 'view', id: 'side', version: 1, describe: 'Seen from the side: gravity pulls down, "up" is jumping', requires: [], provides: ['view:side'], gravity: { x: 0, y: 980 }, projection: 'flat' });
modules.register<ViewModule>({ kind: 'view', id: 'top', version: 1, describe: 'Seen from above: no gravity, walking in every direction', requires: [], provides: ['view:top'], gravity: { x: 0, y: 0 }, projection: 'flat' });
modules.register<ViewModule>({ kind: 'view', id: 'iso', version: 1, describe: 'Seen at an angle (isometric): blocks with height', requires: [], provides: ['view:iso'], gravity: { x: 0, y: 0 }, projection: 'iso' });
// (The engine's clock: fixed steps of real time, runtime.ts update. The one time model there is.)
modules.register({ kind: 'time', id: 'realtime', version: 1, describe: 'Real time: everything moves all the time (turn-taking is chosen beside it)', requires: [], provides: ['time:realtime'] });
// Turn-taking: a capability beside the clock (engine/turns.ts; the turn system itself: runtime/turns.ts).
for (const t of TURN_SYSTEMS) modules.register<TurnsModule>({ kind: 'turns', ...t, provides: [`turns:${t.id}`] });

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
// Every ability declared whole in one definition (src/abilities): its module is made from that, now and whenever
// one is registered or taken out. What it requires is the movement models its definition says it works with.
onAbilities((def, change) => {
  if (change === 'removed') modules.unregister('ability', def.id);
  else modules.register<AbilityModule>({ kind: 'ability', id: def.id, version: 1, describe: def.describe, requires: [def.worksWith.map((m) => `locomotion:${m}`).join('|')], provides: [`ability:${def.id}`], component: def.component.type });
});

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
modules.register(topKit('roguelike', 'Roguelike objects: monsters that answer each step, gold, potions, stairs down, random floors', (r, n) => createRoguelikeProject(r, n), ['view:top']));
modules.register(topKit('isometric', 'Isometric blocks: floors, walls and water with height, a hero', (r, n) => createIsometricProject(r, n), ['view:iso']));

// ---------------------------------------------------------------- level generation and progression
// Generators (declared in engine/generators.ts; only the ones active in a game build: at edit time through
// levelGen/build.ts, at play through core/generation/playGenerators.ts).
const generatorKind = (id: string) => GENERATORS.find((g) => g.id === id)!;
modules.register<GeneratorModule>({
  kind: 'generator',
  ...generatorKind('sections'),
  provides: ['generator:sections', 'generator:levels'],
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
});
modules.register<GeneratorModule>({
  kind: 'generator',
  ...generatorKind('dungeon'),
  provides: ['generator:dungeon', 'generator:at_play'],
  // (Built anew at each play, from a seed: nothing to validate ahead; what didn't work out is in its example's problems.)
  validators: () => [],
  atPlay: playGeneratorById('dungeon')!,
});
// (Progression: core/progression/progression.ts has the models; the game session, runtime/session.ts, asks the game's.)
for (const g of PROGRESSIONS) modules.register({ kind: 'progression', ...g, provides: [`progression:${g.id}`] });

// ---------------------------------------------------------------- validators (core/validation/validators.ts)
// (What each needs of the player's reach description: its table, its moves, its simulator.)
for (const v of VALIDATORS) modules.register<ValidatorModule>({ kind: 'validator', id: v.id, version: 1, describe: v.describe, requires: v.needs.map((n) => `reach:${n}`), provides: [`validates:${v.id}`], validator: v });
