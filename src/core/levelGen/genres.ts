/**
 * How each genre's levels are put together: which structures it uses, how often each pattern comes up in each kind
 * of section, and how a level is paced. The patterns themselves are shared (patterns/); a genre is its choices.
 */
import type { Mechanic, SectionRole, Structure } from './blueprint';

export interface GenreBuild {
  id: string;
  version: number;
  /** Structures it builds, with how often each is picked (when the blueprint leaves it open). */
  structures: Partial<Record<Structure, number>>;
  /** Patterns it uses, with a weight for each kind of section (missing: not in that kind). */
  weights: Record<string, Partial<Record<SectionRole, number>>>;
  /** Pacings: the order of section kinds between the start and the goal (one picked per level, repeated as needed). */
  pacings: SectionRole[][];
  /**
   * The mechanics a level of this genre is built around (its signature, when the blueprint names none); and, when
   * set, a level needs at least one section about one of them (a puzzle level without a puzzle is built again).
   */
  core?: Mechanic[];
}

export const CLASSIC_BUILD: GenreBuild = {
  id: 'classic',
  version: 2,
  structures: { run: 4, climb: 2, descent: 1.5, loop: 2, hub: 1.5 },
  weights: {
    start: { intro: 1 },
    flat: { rest: 2, teach: 0.5 },
    stairs: { teach: 1, test: 1, rest: 1.5, twist: 0.5 },
    gap: { teach: 2, test: 2, twist: 1 },
    floating: { test: 1.5, twist: 2 },
    enemy: { teach: 1.5, test: 2, twist: 1.5 },
    pipes: { teach: 1.5, test: 1.5, twist: 1, rest: 1 },
    blocks: { teach: 1.5, rest: 2, test: 0.5 },
    spring: { teach: 1, test: 1, twist: 1, rest: 0.5 },
    mover: { test: 1, twist: 2 },
    spikes: { teach: 1, test: 1.5, twist: 1 },
    bonus: { rest: 0.7 },
    slopes: { teach: 1, test: 1, rest: 1.2, twist: 0.5 },
    pool: { teach: 1, test: 1, twist: 1 },
    cliff: { teach: 0.8, test: 1, twist: 0.8, rest: 0.5 },
    split: { test: 0.4, twist: 0.7 },
    // (Built only for a player with the capability each requires: patterns/abilities.ts.)
    dash_gap: { teach: 1.5, test: 2, twist: 1.5 },
    wall_shaft: { teach: 1.5, test: 1.5, twist: 1.5 },
    dash_rise: { teach: 1.5, test: 1.5, twist: 1 },
    kick_back: { teach: 1.5, test: 1.5, twist: 1 },
    // (The two that need both abilities: never the first thing a level asks.)
    dash_shaft: { test: 1.5, twist: 2 },
    dash_cling: { test: 1.5, twist: 2 },
    goal: { finale: 1 },
  },
  pacings: [
    ['teach', 'test', 'rest', 'twist', 'test'],
    ['teach', 'rest', 'test', 'test', 'twist'],
    ['test', 'teach', 'twist', 'rest', 'test'],
    ['teach', 'test', 'twist', 'rest', 'twist'],
    ['rest', 'teach', 'test', 'twist'],
  ],
};

/**
 * The puzzle platformer: levers and keys for walled-in doors, pressure plates held down by crates, crates to climb
 * walls with, teleporters through walls; between them, quieter running and jumping (few enemies). Paced with a rest
 * after each puzzle, to look round the next one.
 */
export const PUZZLE_BUILD: GenreBuild = {
  id: 'puzzle',
  version: 1,
  structures: { run: 3, climb: 2, loop: 1.5, hub: 2, descent: 1 },
  weights: {
    start: { intro: 1 },
    flat: { rest: 2.5 },
    stairs: { rest: 1.5, teach: 0.5 },
    gap: { teach: 0.7, test: 0.5, rest: 0.3 },
    floating: { test: 0.4, twist: 0.4 },
    spikes: { test: 0.5, twist: 0.5 },
    spring: { teach: 0.4, test: 0.4, rest: 0.3 },
    cliff: { teach: 0.6, test: 0.6, rest: 0.6 },
    enemy: { test: 0.2 },
    bonus: { rest: 0.6 },
    lever_door: { teach: 2, test: 1.5, twist: 1 },
    key_door: { teach: 1.2, test: 1.5, twist: 1 },
    plate_door: { teach: 1, test: 2, twist: 2 },
    crate_step: { teach: 2, test: 1.5, twist: 1 },
    teleport: { teach: 1, test: 1, twist: 1.5 },
    goal: { finale: 1 },
  },
  pacings: [
    ['teach', 'rest', 'test', 'rest', 'twist'],
    ['teach', 'test', 'rest', 'twist', 'rest'],
    ['rest', 'teach', 'rest', 'test', 'twist'],
    ['teach', 'rest', 'twist', 'test'],
  ],
  core: ['switch', 'key', 'crate', 'teleporter'],
};

export const GENRE_BUILDS: Record<string, GenreBuild> = { classic: CLASSIC_BUILD, puzzle: PUZZLE_BUILD };
