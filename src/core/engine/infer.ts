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

type Def = { name: string; metadata?: Record<string, unknown> };
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

/** The profile of a game that has none stored: its kit's preset (never written by this). */
export function inferProfileFromObjects(project: { definitions: Def[]; settings: { gameType?: GameType } }): GameProfile {
  const kit = kitOfObjects(project.definitions, project.settings.gameType) ?? (project.settings.gameType === 'topdown' ? 'topdown' : 'platformer');
  return JSON.parse(JSON.stringify((presetById(kit) ?? presetById('platformer')!).profile)) as GameProfile;
}
