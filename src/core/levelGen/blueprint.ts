/**
 * What a level is asked to be: a blueprint, the level designer's few lines (the AI's, the user's, or the editor's
 * "New level"), which the level builder turns into a whole level. Everything but the difficulty is optional: left
 * out, the builder chooses (from the seed, so the same blueprint and seed give the same level).
 *
 * Two ways to direct it, mixed freely: by intent (structure, focus, escalate, routes, secrets: the builder picks
 * sections and patterns to match), or section by section (sections: each named, or a "custom" one drawn as a small
 * map, which the builder joins into the rest).
 */
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

export const MECHANICS = ['gap', 'stairs', 'floating', 'enemy', 'pipe', 'blocks', 'spring', 'mover', 'hazard', 'coins', 'ramp', 'water', 'ladder'] as const;
export type Mechanic = (typeof MECHANICS)[number];

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
  length: z.enum(['short', 'medium', 'long']).nullable().default(null),
  seed: z.number().int().nullable().default(null),
  structure: z.enum(STRUCTURES).nullable().default(null),
  focus: z.array(z.enum(MECHANICS)).max(3).nullable().default(null).describe('Mechanics the level is about'),
  escalate: z.enum(MECHANICS).nullable().default(null).describe('A mechanic that gets harder each time it comes'),
  avoid: z.array(z.enum(MECHANICS)).nullable().default(null),
  routes: z.enum(ROUTES).nullable().default(null),
  secrets: z.number().int().min(0).max(3).nullable().default(null),
  concept: z.string().max(300).nullable().default(null),
  sections: z.array(sectionSchema).max(16).nullable().default(null),
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
