/**
 * How each genre's levels are put together: which structures it uses, how often each pattern comes up in each kind
 * of section, and how a level is paced. The patterns themselves are shared (patterns/); a genre is its choices.
 */
import type { SectionRole, Structure } from './blueprint';

export interface GenreBuild {
  id: string;
  version: number;
  /** Structures it builds, with how often each is picked (when the blueprint leaves it open). */
  structures: Partial<Record<Structure, number>>;
  /** Patterns it uses, with a weight for each kind of section (missing: not in that kind). */
  weights: Record<string, Partial<Record<SectionRole, number>>>;
  /** Pacings: the order of section kinds between the start and the goal (one picked per level, repeated as needed). */
  pacings: SectionRole[][];
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

export const GENRE_BUILDS: Record<string, GenreBuild> = { classic: CLASSIC_BUILD };
