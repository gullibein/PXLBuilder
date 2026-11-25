/**
 * What a level is asked to be: a blueprint, the level designer's few lines (the AI's, the user's, or the editor's
 * "New level"), which the level builder turns into a whole level. Everything but the difficulty is optional: left
 * out, the builder chooses (from the seed, so the same blueprint and seed give the same level).
 *
 * Two ways to direct it, mixed freely: by intent (structure, focus, escalate, routes, secrets: the builder picks
 * sections and patterns to match), or section by section (sections: each named, or a "custom" one drawn as a small
 * map, which the builder joins into the rest).
 */
import { abilityDefinitions } from '../../abilities/index';
import { z } from 'zod';
import type { Role } from './roles';

export const STRUCTURES = ['run', 'climb', 'descent', 'loop', 'hub'] as const;
export type Structure = (typeof STRUCTURES)[number];

/** What each structure is (told to the AI, shown in the editor). */
export const STRUCTURE_INFO: Record<Structure, string> = {
  run: 'one long way from left to right, the ground rising and falling',
  climb: 'floors stacked on each other, zig-zagging up from the bottom to the goal at the top',
  descent: 'from the top down: through holes in floors stacked on each other, to the goal at the bottom',
  loop: 'out along the bottom, up at the far end, and back along the top to the goal above the start',
  hub: 'the start in the middle: the key at one end, the locked goal at the other',
};

/** What levels are made of that the builder has by itself. */
export const OWN_MECHANICS = ['gap', 'stairs', 'floating', 'enemy', 'pipe', 'blocks', 'spring', 'mover', 'hazard', 'coins', 'ramp', 'water', 'ladder', 'switch', 'key', 'crate', 'teleporter'] as const;
/** A mechanic a level can be asked for by: the builder's own, or an ability with a part in the player's reach (by its id). */
export type Mechanic = (typeof OWN_MECHANICS)[number] | (string & {});
/** The mechanics there are now: the builder's own, then the abilities that have a part in the player's reach (src/abilities). */
export const mechanics = (): Mechanic[] => [...OWN_MECHANICS, ...abilityDefinitions().filter((a) => a.reach).map((a) => a.id)];
const mechanicSchema = z.string().refine((m) => mechanics().includes(m), { error: (issue) => `"${String(issue.input)}" is not a mechanic (there are: ${mechanics().join(', ')})` });

/**
 * How big a level is. short: about a screen (a first lesson, a breather). medium and long: two to three screens.
 * very_long and huge: the levels of a classic console platformer, several screens long (and, in the structures that
 * stack floors, several high).
 */
export const LENGTHS = ['short', 'medium', 'long', 'very_long', 'huge'] as const;
export type Length = (typeof LENGTHS)[number];

/** How many ways there are through: one; a bonus route up above; a choice of two ways; a risky shortcut beside a slow safe way. */
export const ROUTES = ['one', 'bonus_above', 'choice', 'risky_shortcut'] as const;

export const SECTION_ROLES = ['intro', 'teach', 'test', 'rest', 'twist', 'finale'] as const;
export type SectionRole = (typeof SECTION_ROLES)[number];

const customSchema = z.object({
  rows: z.array(z.string().min(1)).min(1).max(12).describe('The section as a small map, top row first; its bottom row is the ground'),
  legend: z.record(z.string().length(1), z.string()).describe('What each character is: a part (ground, ledge, oneway, ladder, hazard, enemy, coin, block, brick, spring, crate…); "." is empty'),
});

export const sectionSchema = z.object({
  role: z.enum(SECTION_ROLES).nullable().default(null),
  pattern: z.string().nullable().default(null).describe('A pattern id (null: the builder picks one for the role)'),
  variant: z.string().nullable().default(null).describe("One of the pattern's variants (null: the builder picks)"),
  harder: z.boolean().nullable().default(null),
  custom: customSchema.nullable().default(null),
});

export const blueprintSchema = z.object({
  difficulty: z.number().int().min(1).max(5),
  length: z.enum(LENGTHS).nullable().default(null),
  seed: z.number().int().nullable().default(null),
  structure: z.enum(STRUCTURES).nullable().default(null),
  // (More than three named: the first three count, rather than the whole level being refused and asked for again.)
  focus: z.preprocess((v) => (Array.isArray(v) ? v.slice(0, 3) : v), z.array(mechanicSchema).max(3).nullable().default(null)).describe('Mechanics the level is about'),
  escalate: mechanicSchema.nullable().default(null).describe('A mechanic that gets harder each time it comes'),
  avoid: z.array(mechanicSchema).nullable().default(null),
  routes: z.enum(ROUTES).nullable().default(null),
  secrets: z.number().int().min(0).max(3).nullable().default(null),
  concept: z.string().max(300).nullable().default(null),
  // (As many as the biggest level has: a huge climb is built of some 45, and its variation names them all.)
  sections: z.array(sectionSchema).max(64).nullable().default(null),
});

export type Blueprint = z.infer<typeof blueprintSchema>;
export type SectionSpec = z.infer<typeof sectionSchema>;
export type CustomSection = z.infer<typeof customSchema>;

/** A blueprint with every left-out field filled with the builder's default. */
export function readBlueprint(raw: unknown): Blueprint {
  return blueprintSchema.parse(raw);
}

/** Parts a custom section's legend may name. */
export const CUSTOM_PARTS: readonly Role[] = ['ground', 'ledge', 'oneway', 'rampRight', 'rampLeft', 'ladder', 'hazard', 'lava', 'water', 'deepWater', 'enemy', 'coin', 'heart', 'crate', 'spring', 'block', 'brick'];
