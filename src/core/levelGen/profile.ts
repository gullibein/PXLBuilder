/**
 * A platformer's kind of play (its genre) and its look (its theme), kept apart: a classic platformer can be a forest
 * or a castle without building its levels any differently, and a castle can be classic or a puzzle game. The game
 * keeps both for good (settings.levelProfile), so its levels don't change kind from one to the next.
 *
 * To add one, add an entry to GENRES or THEMES: nothing else needs to change.
 */
import type { ComponentRegistry } from '../components/registry';
import { resolveEntity } from '../model/resolve';
import { isTopDownScene } from '../model/topDown';
import type { LevelProfile, Project } from '../types';

export interface Genre {
  id: string;
  name: string;
  /** How its levels play: the pieces and challenges it is made of (told to the AI). */
  rules: string;
  /** The puzzles (ai/levelIdeas.ts LEVEL_PUZZLES) its levels are built around. */
  puzzles: string[];
}

export interface Theme {
  id: string;
  name: string;
  /** How it looks: ground, platforms, the back, things to see (told to the AI). */
  look: string;
  /** Puzzles that don't fit the look (no water in a space station, no grassy hills in a castle). */
  avoid: string[];
}

export const GENRES: Genre[] = [
  {
    id: 'classic',
    name: 'Classic platformer',
    rules:
      'Running and jumping: gaps and pits, floating platforms and rows of blocks (? blocks, bricks), pipes to jump onto, walking enemies to stomp, coins in the air, springs and moving platforms; ramps and water where the look has them. Solid platforms; a goal at the end.',
    puzzles: ['hill', 'swim for it', 'bridge over the gap', 'moving platform', 'spring up', 'crate step', 'drop-through', 'lava pit'],
  },
  {
    id: 'puzzle',
    name: 'Puzzle platformer',
    rules:
      'The way on is worked out, not just jumped: switches open doors elsewhere, crates are pushed into place to climb on, teleporters join parts of the level, ladders appear; few enemies, hazards that punish a careless step. Every puzzle needed to get through.',
    puzzles: ['switch and door', 'crate step', 'crate stack', 'teleporter shortcut', 'hidden ladder', 'drop-through', 'spring up'],
  },
];

export const THEMES: Theme[] = [
  { id: 'forest', name: 'Forest', look: 'Grassy earth with a bright green top, tree trunks and leafy canopies, logs and mushroom caps as platforms, vines, flowers; a sky through the trees.', avoid: [] },
  { id: 'desert', name: 'Desert', look: 'Sand and sandstone blocks, dunes, cacti and bleached bones, crumbling ruins, a hot pale sky with a big sun; quicksand or lava instead of water.', avoid: ['swim for it'] },
  { id: 'snow', name: 'Snow', look: 'Snow-capped ground and ice blocks, pine trees, icicles hanging from ledges, frozen ponds, a pale winter sky with falling snow.', avoid: [] },
  { id: 'cave', name: 'Underground cave', look: 'Thick rock all round, autotiled, a dark back wall, stalactites, glowing crystals and mushrooms, wooden ladders and bridges, pools of water or acid.', avoid: [] },
  { id: 'castle', name: 'Castle', look: 'Grey stone bricks, battlements, banners and torches on the walls, wooden doors and drawbridges, chains, lava or spikes in the dungeon.', avoid: ['hill'] },
  { id: 'space', name: 'Space station', look: 'Metal panels and grates with rivets, glowing pipes and screens, thin metal bars as jump-through platforms, stars through the windows; lasers as hazards.', avoid: ['hill', 'swim for it'] },
  { id: 'temple', name: 'Ancient temple', look: 'Ancient carved stone with cracks, overgrown with moss and grass, statues, spikes on floors and ceilings, fire or lava pits, platforms on chains.', avoid: ['swim for it'] },
  { id: 'factory', name: 'Industrial factory', look: 'Steel girders and rusty plates, conveyor-like belts, smokestacks, warning stripes, crates and barrels, steam vents as hazards.', avoid: ['hill', 'swim for it'] },
  { id: 'haunted', name: 'Haunted house', look: 'Creaky wooden floors and shelves, patterned wallpaper, cobwebs, candles, portraits, ghosts; a full moon through the windows.', avoid: ['hill', 'swim for it'] },
];

export const genreById = (id: string | undefined): Genre | undefined => GENRES.find((g) => g.id === id);
export const themeById = (id: string | undefined): Theme | undefined => THEMES.find((t) => t.id === id);

/** A profile the game chose (genre and theme both known), else null. */
export function storedProfile(project: Project): LevelProfile | null {
  const p = project.settings.levelProfile;
  return p && genreById(p.genre) && themeById(p.theme) ? p : null;
}

/** A small, stable number from a text (the same game always gets the same pick). */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** What a game's levels hold, counted: what kind of platformer they make. */
function counts(project: Project, registry: ComponentRegistry): { puzzles: number; action: number; built: boolean } {
  let puzzles = 0;
  let action = 0;
  let built = false;
  for (const scene of project.scenes) {
    if (isTopDownScene(project, scene, registry)) continue;
    for (const e of scene.entities) {
      const c = resolveEntity(project, e, registry).components;
      if (c.CharacterController) continue;
      built = true;
      if (c.Switch || c.Openable || c.Pushable) puzzles++;
      if (c.Patrol || c.Shooter || c.MovingPlatform) action++;
    }
  }
  return { puzzles, action, built };
}

/**
 * The game's profile: the one it chose, else worked out from it (never saved by this: a game only gets a profile
 * when the user or the AI chooses one). A platformer whose levels are mostly switches, doors and crates is a puzzle
 * platformer; others are classic. The look: for a game with levels already, none is suggested (`theme` null: they
 * keep the look they have); an empty one gets one picked from the game's id, the same each time. Null for a game
 * that isn't a platformer.
 */
export function levelProfileOf(project: Project, registry: ComponentRegistry): { genre: Genre; theme: Theme | null; stored: boolean } | null {
  const stored = storedProfile(project);
  if (stored) return { genre: genreById(stored.genre)!, theme: themeById(stored.theme)!, stored: true };
  if ((project.settings.gameType ?? 'platformer') !== 'platformer') return null;
  const { puzzles, action, built } = counts(project, registry);
  const genre = puzzles >= 3 && puzzles > action ? genreById('puzzle')! : genreById('classic')!;
  return { genre, theme: built ? null : THEMES[hash(project.id) % THEMES.length], stored: false };
}

/** The puzzles for a level of this profile: the genre's, without those the look rules out. */
export function profilePuzzles(genre: Genre, theme: Theme | null): string[] {
  const out = genre.puzzles.filter((p) => !theme?.avoid.includes(p));
  return out.length ? out : genre.puzzles;
}
