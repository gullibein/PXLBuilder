/**
 * Which turn-taking a game has (docs/engine-architecture-proposal.md §22.7). The engine has one clock: real time.
 * Turn-taking is a capability a game selects beside it: an RPG's map runs in real time and its battles take turns.
 * The same four steps as geometry, camera and generators: registered, selected (profile.turns), supported, active.
 * Turn statements in a game whose profile doesn't make the capability active are refused, with a script error, and
 * the compatibility report names the objects using them.
 *
 * (The roguelike's "the world answers each step" is its scripts' own, by a signal: no engine turn system, and none
 * claimed. A time model that steps the whole world belongs with grid movement: slice V2.)
 *
 * Data only, so the runtime and the exported player can ask it; the turn system itself is runtime/turns.ts.
 */
import type { GameType } from '../types';
import { profileTags, statusOf, type GeometryKind, type GeometryStatus } from './geometry';
import { inferProfileFromObjects, takesTurns, TURN_STATEMENTS } from './infer';
import { gameProfileSchema, type GameProfile } from './profileSchema';

export const TURN_SYSTEMS: GeometryKind[] = [
  {
    id: 'team_turns',
    version: 1,
    describe: "Teams take turns: each unit of the team whose turn it is has its go, by itself or picked with the cursor; then the next team's turn (tactics, RPG battles)",
    requires: [],
    without: 'nothing takes turns: start_turns, give_turn, done, end_turn and turn_order are refused, with a script error',
  },
];

export { takesTurns, TURN_STATEMENTS };

export function turnStatus(p: GameProfile, provided: ReadonlySet<string> = profileTags(p), kinds: readonly GeometryKind[] = TURN_SYSTEMS): GeometryStatus {
  return statusOf(kinds, p.turns ?? [], provided);
}

type Scripted = { name: string; scripts?: unknown };
type Game = { definitions: readonly Scripted[]; scenes?: readonly { entities?: readonly Scripted[] }[] };

/** The turn systems a game's scripts use, with the objects using each. */
export function turnsUsed(game: Game): Map<string, string[]> {
  const names = [...game.definitions, ...(game.scenes ?? []).flatMap((s) => s.entities ?? [])].filter((x) => takesTurns(x.scripts)).map((x) => x.name);
  return names.length ? new Map([['team_turns', [...new Set(names)]]]) : new Map();
}

/** Objects whose scripts take turns in a game whose profile doesn't make that active, and what happens instead. */
export function turnNotes(p: GameProfile, game: Game, provided?: ReadonlySet<string>, kinds: readonly GeometryKind[] = TURN_SYSTEMS): string[] {
  const status = turnStatus(p, provided, kinds);
  // (Any turn system active serves the turn statements.)
  if (status.active.length) return [];
  const notes: string[] = [];
  for (const [id, names] of turnsUsed(game)) {
    const why = status.unsupported.find((u) => u.id === id)?.why ?? `the game's profile doesn't select turns ("${id}")`;
    notes.push(`${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''}: ${why}, so ${kinds.find((k) => k.id === id)?.without ?? 'nothing takes turns'}`);
  }
  return notes;
}

/** The turn systems active in a game, in order: its stored profile's, else the one worked out from the game. */
export function gameTurns(project: Game & { settings: { profile?: unknown; gameType?: GameType } }, kinds: readonly GeometryKind[] = TURN_SYSTEMS): string[] {
  const stored = gameProfileSchema.safeParse(project.settings.profile);
  return turnStatus(stored.success ? stored.data : inferProfileFromObjects(project as Parameters<typeof inferProfileFromObjects>[0]), undefined, kinds).active;
}
