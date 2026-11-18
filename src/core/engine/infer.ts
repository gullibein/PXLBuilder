/**
 * Working out which kit (and so which preset) a game was made from, by its objects' names: small and data-only, so
 * loading a game (migrations, the exported player) doesn't need every starter set. A test checks this against the
 * kits themselves (each kit's new game is recognised as that kit).
 */
import type { GameType } from '../types';
import { presetById } from './presets';
import type { GameProfile } from './profileSchema';

/** Objects only each kit has (by starter name). The top-down kits share the top-down objects, so theirs come first. */
const SIGNATURES: [string, string[]][] = [
  ['rpg', ['Knight', 'Mage', 'Wild Slime', 'Merchant']],
  ['roguelike', ['Rat', 'Skeleton', 'Ogre', 'Stairs', 'Locked Door']],
  ['isometric', ['Grass', 'Dirt', 'Cobblestone', 'Dark Stone', 'Light Stone', 'Snow']],
  ['topdown', ['Wall', 'Floor', 'Barrel']],
  ['platformer', ['Platform', 'Stone', 'Ramp', 'Ramp left', 'Bridge', 'Spring', 'Question block', 'Brick', 'Pipe top', 'Pressure plate']],
];

type Def = { name: string; metadata?: Record<string, unknown>; components?: Record<string, unknown> };

const starterName = (d: Def) => (typeof d.metadata?.starter === 'string' ? d.metadata.starter : d.name);

/** The kit a game was made from, or null when none of its objects are a kit's. */
export function kitOfObjects(definitions: Def[], gameType: GameType | undefined): string | null {
  const have = new Set(definitions.map(starterName));
  const hits = SIGNATURES.map(([id, names]) => ({ id, n: names.filter((x) => have.has(x)).length }));
  // (An RPG, a roguelike or an isometric game also has the top-down objects: its own decide.)
  const special = hits.slice(0, 3).filter((h) => h.n > 0).sort((a, b) => b.n - a.n)[0];
  if (special) return special.id;
  const top = hits[3].n;
  const side = hits[4].n;
  if (!top && !side) return null;
  if (top === side) return gameType === 'topdown' ? 'topdown' : 'platformer';
  return top > side ? 'topdown' : 'platformer';
}

/** The statements that take turns (what a script uses of the turn capability: engine/turns.ts). */
export const TURN_STATEMENTS = ['start_turns', 'give_turn', 'done', 'end_turn', 'turn_order'];
const USES_TURNS = new RegExp(`"do":"(${TURN_STATEMENTS.join('|')})"`);
/** Whether scripts (as stored) take turns. */
export const takesTurns = (scripts: unknown): boolean => !!scripts && USES_TURNS.test(JSON.stringify(scripts));

/**
 * Scripts were added to a game: if they take turns, its stored profile selects turn-taking (a game with no stored
 * profile has it worked out from its scripts). Adding something that takes turns is choosing turn-taking; taking it
 * out of the profile afterwards switches it off (and that is reported).
 */
export function selectTurnsFor(project: { settings: { profile?: { turns?: string[] } } }, scripts: unknown): void {
  const stored = project.settings.profile;
  if (stored && !stored.turns?.length && takesTurns(scripts)) stored.turns = ['team_turns'];
}

/** The profile of a game that has none stored: its kit's preset (never written by this). */
export function inferProfileFromObjects(project: { definitions: Def[]; settings: { gameType?: GameType }; scenes?: readonly { generator?: unknown; entities?: readonly { scripts?: unknown }[] }[] }): GameProfile {
  const kit = kitOfObjects(project.definitions, project.settings.gameType) ?? (project.settings.gameType === 'topdown' ? 'topdown' : 'platformer');
  const profile = JSON.parse(JSON.stringify((presetById(kit) ?? presetById('platformer')!).profile)) as GameProfile;
  // (Its abilities are not worked out here: they are read from its player-controlled objects whenever the profile
  // is asked for, engine/actual.ts, for a stored profile and a worked-out one alike.)
  // (Scripts that take turns: the game has team turns, beside its real time.)
  const scripted = [...project.definitions, ...(project.scenes ?? []).flatMap((s) => s.entities ?? [])] as { scripts?: unknown }[];
  if (!profile.turns?.length && scripted.some((x) => takesTurns(x.scripts))) profile.turns = ['team_turns'];
  // (A level with a recipe is a random level: the generator that builds it at play is part of the game.)
  if (project.scenes?.some((s) => s.generator) && profile.generator.id !== 'dungeon') profile.generator = { ...profile.generator, also: ['dungeon'] };
  return profile;
}
