/**
 * Which level generators a game has (docs/engine-architecture-proposal.md §22.1), in the same four steps as its
 * geometry and camera: registered, selected (the profile's level builder, and any others it lists), supported,
 * active. There are two kinds: a generator that builds a level while editing (New level, generate_level: the level
 * is then ordinary objects), and one that builds a level anew from its recipe each time it is played. Only an active
 * generator builds; a level with a recipe whose generator isn't active plays as it is placed by hand, and the
 * compatibility report says so.
 *
 * Data only, so the runtime and the exported player can ask it; the generators themselves are in levelGen/ (edit
 * time) and core/generation (play time).
 */
import type { GameType } from '../types';
import { profileTags, statusOf, type GeometryKind, type GeometryStatus } from './geometry';
import { inferProfileFromObjects } from './infer';
import { gameProfileSchema, type GameProfile } from './profileSchema';

export interface GeneratorKind extends GeometryKind {
  /** When it builds: while editing (the result is ordinary objects), or anew at each play (from the level's recipe). */
  when: 'edit' | 'play';
}

export const GENERATORS: GeneratorKind[] = [
  {
    id: 'sections',
    version: 1,
    when: 'edit',
    describe: "Levels of floors, each a run of sections (patterns) sized from the player's jump; a genre setting (classic, puzzle) picks the patterns",
    requires: ['view:side', 'reach:table', 'role:player', 'role:ground', 'role:goal'],
    without: 'the engine builds no levels (New level, more levels and generate_level have nothing to build with)',
  },
  {
    id: 'dungeon',
    version: 1,
    when: 'play',
    describe: 'Random dungeon floors, built anew each time a level with a recipe is played (rooms, caves or a maze; monsters, loot, a locked door and its key, room templates)',
    requires: [],
    without: "the level's recipe is not built: it plays as it is placed by hand",
  },
];

/** Adds a generator's declaration (a generator registered from outside the engine; its module and builder besides). */
export function registerGeneratorKind(kind: GeneratorKind): void {
  if (!GENERATORS.some((g) => g.id === kind.id)) GENERATORS.push(kind);
}
export function unregisterGeneratorKind(id: string): void {
  const i = GENERATORS.findIndex((g) => g.id === id);
  if (i >= 0) GENERATORS.splice(i, 1);
}

/** The generators a profile selects: its level builder, then any others it lists. */
export function selectedGenerators(p: GameProfile): string[] {
  return [...new Set([...(p.generator.id ? [p.generator.id] : []), ...(p.generator.also ?? [])])];
}

/** The four steps for a profile's generators (`kinds`: the registered ones; by default, the engine's). */
export function generatorStatus(p: GameProfile, provided: ReadonlySet<string> = profileTags(p), kinds: readonly GeometryKind[] = GENERATORS): GeometryStatus {
  return statusOf(kinds, selectedGenerators(p), provided);
}

type Level = { name: string; generator?: unknown };

/** The play-time generators a game's levels use (by their recipes), with the levels using each. */
export function generatorsUsed(scenes: readonly Level[]): Map<string, string[]> {
  const used = new Map<string, string[]>();
  // (A level's recipe is the dungeon generator's: the one recipe kind there is.)
  const random = scenes.filter((s) => s.generator).map((s) => s.name);
  if (random.length) used.set('dungeon', random);
  return used;
}

/** Levels with a recipe whose generator the profile doesn't make active, and what happens instead. */
export function generatorNotes(p: GameProfile, scenes: readonly Level[], provided?: ReadonlySet<string>, kinds: readonly GeometryKind[] = GENERATORS): string[] {
  const status = generatorStatus(p, provided, kinds);
  const notes: string[] = [];
  for (const [id, names] of generatorsUsed(scenes)) {
    if (status.active.includes(id)) continue;
    const g = kinds.find((x) => x.id === id);
    const why = status.unsupported.find((u) => u.id === id)?.why ?? `the game's profile doesn't select the generator "${id}"`;
    notes.push(`${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}: ${why}, so ${g?.without ?? 'it is not built'}`);
  }
  return notes;
}

type Game = { definitions: { name: string; components?: Record<string, unknown> }[]; settings: { profile?: unknown; gameType?: GameType }; scenes?: readonly Level[] };

/** The generators active in a game that build at play: its stored profile's, else the one worked out from the game. */
export function gamePlayGenerators(project: Game): ReadonlySet<string> {
  const stored = gameProfileSchema.safeParse(project.settings.profile);
  const p = stored.success ? stored.data : inferProfileFromObjects(project as Parameters<typeof inferProfileFromObjects>[0]);
  // (Every selected generator that is supported; which of them build at play is for whoever asks by id.)
  return new Set(generatorStatus(p, profileTags(p), GENERATORS.filter((g) => g.when === 'play')).active);
}
