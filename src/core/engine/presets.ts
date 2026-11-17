/**
 * Presets: named game profiles, stored as data. A preset fills in a new game's profile; after that every system can
 * be changed on its own. The design references (docs/engine-architecture-proposal.md) become presets like these,
 * never modes in code. The first six are today's starters, unchanged.
 */
import type { GameProfile } from './profileSchema';

export interface Preset {
  id: string;
  name: string;
  describe: string;
  profile: GameProfile;
}

const side = (kits: string[], genre?: string): Omit<GameProfile, 'preset'> => ({
  version: 1,
  view: 'side',
  time: 'realtime',
  movement: { model: 'arcade', abilities: [] },
  geometry: ['box', 'one_way', 'ramp', 'cells'],
  camera: ['follow'],
  kits,
  generator: { id: 'sections', settings: genre ? { genre } : {} },
  progression: { model: 'stages' },
  theme: null,
});

const top = (kits: string[], view = 'top', time = 'realtime'): Omit<GameProfile, 'preset'> => ({
  version: 1,
  view,
  time,
  movement: { model: 'topdown', abilities: [] },
  geometry: ['box', 'cells'],
  camera: ['follow'],
  kits,
  generator: { id: null, settings: {} },
  progression: { model: 'stages' },
  theme: null,
});

const PRESET_LIST: (Omit<Preset, 'profile'> & { profile: Omit<GameProfile, 'preset'> })[] = [
  { id: 'platformer', name: 'Platformer', describe: 'Run and jump from the side; levels built by the engine (its kind worked out from the game)', profile: side(['platformer']) },
  { id: 'classic-platformer', name: 'Classic platformer', describe: 'Running and jumping: gaps, blocks, pipes, enemies to stomp, springs, moving platforms', profile: side(['platformer'], 'classic') },
  { id: 'puzzle-platformer', name: 'Puzzle platformer', describe: 'The way on worked out: levers, keys, pressure plates and crates, teleporters', profile: side(['platformer'], 'puzzle') },
  { id: 'topdown', name: 'Top-down game', describe: 'Walk in every direction, seen from above', profile: top(['topdown']) },
  { id: 'rpg', name: 'RPG', describe: 'Seen from above, with a party, monsters and turn-based battles, shops', profile: { ...top(['rpg']), turns: ['team_turns'] } },
  { id: 'roguelike', name: 'Roguelike', describe: 'A dungeon a step at a time: monsters answer each step; random floors', profile: { ...top(['roguelike']), generator: { id: 'dungeon', settings: {} } } },
  { id: 'isometric', name: 'Isometric game', describe: 'Seen at an angle, blocks with height', profile: top(['isometric'], 'iso') },
];

export const PRESETS: Preset[] = PRESET_LIST.map((p) => ({ ...p, profile: { ...p.profile, preset: p.id } }));

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** The preset each of today's starters is (the starter chooser and the AI's switch_starter use these). */
export const STARTER_PRESET: Record<string, string> = { platformer: 'platformer', topdown: 'topdown', rpg: 'rpg', roguelike: 'roguelike', isometric: 'isometric' };
