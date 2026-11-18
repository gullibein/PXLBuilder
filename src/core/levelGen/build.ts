/**
 * Building levels into a game: which builder a game uses, what to ask it for (a new level, the same level made
 * again, a variation of it), and putting a built level in (its operations, and the record of how it was made). Used
 * by the generate_level operation (the AI) and the editor's level menu (no AI).
 */
import type { ComponentRegistry } from '../components/registry';
import { applyOperations, type ApplyResult } from '../commands/operations';
import { createLevelFor } from '../model/factory';
import * as m from '../model/mutations';
import type { Id, Project, Scene } from '../types';
import { produce } from 'immer';
import { mechanics, ROUTES, STRUCTURE_INFO, type Blueprint, type Mechanic, type Structure } from './blueprint';
import { allPatterns, patternById } from './patterns/index';
import { patternFits } from './pattern';
import { playerReach } from '../reach/reach';
import { findRoles } from './roles';
import { fingerprintOfScene } from './fingerprint';
import { LevelGenError, type GenerateOptions, type GenerateResult } from './generate';
import { GENRE_BUILDS } from './genres';
import { levelProfileOf } from './profile';
import { generatorOf } from '../engine/profile';

/**
 * What builds this game's levels, by name ("classic", "puzzle", or another generator's id), or null: the game's
 * profile has no level builder that builds levels here (not a platformer, or its genre has no builder yet).
 */
export function builderFor(project: Project, registry: ComponentRegistry): string | null {
  const gen = generatorOf(project, registry);
  if (!gen?.build) return null;
  return gen.label ? gen.label(project, registry) : gen.id;
}

/** Why a game has no builder (for the menu's hint), or null. */
export function noBuilderReason(project: Project, registry: ComponentRegistry): string | null {
  const profile = levelProfileOf(project, registry);
  const gen = generatorOf(project, registry);
  if (!profile && !gen?.build) return 'Only platformer levels can be built by the engine';
  if (!gen?.build) return "This game's profile has no level builder";
  if (builderFor(project, registry)) return null;
  return profile ? `The engine can't build ${profile.genre.name.toLowerCase()} levels yet` : "This game's level builder can't build its levels";
}

type Fingerprint = { structure?: Structure; length?: string; sections?: string[]; signature?: Mechanic | null };
const fingerprintOf = (s: Scene | undefined) => (s?.madeBy?.fingerprint ?? null) as Fingerprint | null;

export type BuildKind = 'new' | 'regenerate' | 'variation';

/**
 * How hard the game's n-th built level is: rising a step every two levels, every fourth a breather (2, 2, 3, 2, 4, 4, 5, 4…):
 * a step easier and short; never more than a step easier than the level before, never past 5.
 */
export function difficultyCurve(n: number, previous: number): { difficulty: number; breather: boolean } {
  const breather = n % 4 === 0;
  const rising = Math.min(5, 1 + Math.ceil(n / 2));
  const d = Math.max(1, Math.min(5, Math.max(rising - (breather ? 1 : 0), previous - 1)));
  return { difficulty: d, breather };
}

/**
 * What to ask the builder for. new: a level a step harder than the game's hardest built one (else 2), of another
 * structure than the last ones. regenerate: the level's own blueprint (else a plain one) with a new seed. variation:
 * the same structure, length and sections (patterns and variants) with a new seed: the same plan, built afresh.
 * Null when there is nothing to vary (a level not built by the engine).
 */
export function blueprintFor(project: Project, sceneId: Id | null, kind: BuildKind, seed: number): { blueprint: Record<string, unknown>; avoidStructures: Structure[]; recentSignatures?: Mechanic[] } | null {
  const scene = sceneId ? project.scenes.find((s) => s.id === sceneId) : undefined;
  const made = scene?.madeBy;
  if (kind === 'new') {
    const built = project.scenes.filter((s) => s.madeBy);
    const last = Number(built.at(-1)?.madeBy!.blueprint.difficulty) || 0;
    const avoid = built.slice(-2).map((s) => fingerprintOf(s)?.structure).filter((x): x is Structure => !!x);
    const recentSignatures = built.slice(-3).map((s) => fingerprintOf(s)?.signature).filter((x): x is Mechanic => !!x);
    const { difficulty, breather } = difficultyCurve(built.length + 1, last);
    return { blueprint: { difficulty, ...(breather ? { length: 'short' } : {}), seed }, avoidStructures: avoid, recentSignatures };
  }
  if (kind === 'regenerate') return { blueprint: { ...(made?.blueprint ?? { difficulty: 2 }), seed }, avoidStructures: [] };
  if (!made) return null;
  const f = fingerprintOf(scene);
  const own = (made.blueprint.sections as Blueprint['sections']) ?? null;
  // (The sections it was built of, by name, without its start and goal, which come anyway.)
  const sections = own ?? (f?.sections ?? [])
    .filter((x) => !/^(intro|finale):/.test(x))
    .map((x) => {
      const [role, rest] = x.split(':');
      const [pattern, variant] = rest.split('@')[0].split('/');
      return { role, pattern, variant };
    })
    .filter((x) => x.pattern !== 'custom');
  return { blueprint: { ...made.blueprint, structure: f?.structure ?? null, length: f?.length ?? null, sections, seed }, avoidStructures: [] };
}

/** Mechanics the game's look rules out (no swimming in a space station, no grassy slopes in a castle). */
export function themeAvoids(project: Project, registry: ComponentRegistry): Mechanic[] {
  const theme = levelProfileOf(project, registry)?.theme;
  if (!theme) return [];
  const out: Mechanic[] = [];
  if (theme.avoid.includes('swim for it')) out.push('water');
  if (theme.avoid.includes('hill')) out.push('ramp');
  return out;
}

/** Builds a level of the game (checked, not applied), leaving out what its look rules out. */
export function buildLevel(project: Project, sceneId: Id, blueprint: unknown, registry: ComponentRegistry, options: GenerateOptions = {}): GenerateResult {
  // The game's level builder: the generator its profile selects that builds while editing. None: nothing is built,
  // and why is said (no other builder steps in).
  const gen = generatorOf(project, registry);
  const build = gen?.build;
  if (!build) throw new LevelGenError(noBuilderReason(project, registry) ?? "This game's profile has no level builder (Game profile, or set_game_profile with generator \"sections\")");
  return build({ project, sceneId, blueprint, registry, options: { ...options, avoidMechanics: [...(options.avoidMechanics ?? []), ...themeAvoids(project, registry)] } });
}

/** Puts a built level into a project being edited: its operations, and the record of how it was made. */
export function applyBuilt(project: Project, sceneId: Id, built: GenerateResult, registry: ComponentRegistry): ApplyResult {
  const result = applyOperations(project, built.ops, registry);
  m.getScene(project, sceneId).madeBy = built.madeBy;
  return result;
}

/**
 * A new level for the game, built by the engine: the level (like the game's last one: gravity, background, camera)
 * and what goes in it. The project isn't changed: add the scene, then applyBuilt.
 */
export function newBuiltLevel(project: Project, name: string, blueprint: unknown, registry: ComponentRegistry, options: GenerateOptions = {}): { scene: Scene; built: GenerateResult } {
  const like = project.scenes.filter((s) => !s.generator).at(-1);
  const scene = createLevelFor(project, name, like);
  if (like) scene.world.background = JSON.parse(JSON.stringify(like.world.background));
  const withIt = produce(project, (d) => void m.addScene(d, JSON.parse(JSON.stringify(scene))));
  return { scene, built: buildLevel(withIt, scene.id, blueprint, registry, options) };
}

/**
 * What the AI is told about the level builder (context.level.builder, with level requests only): the structures,
 * the mechanics, and this genre's patterns with their variants, for the parts the game has (one line each).
 */
export function builderInfo(project: Project, registry: ComponentRegistry): Record<string, unknown> | null {
  const genre = builderFor(project, registry);
  if (!genre) return null;
  const roles = findRoles(project, registry);
  const build = GENRE_BUILDS[genre];
  // (Only what can be built for this game: it has the parts, and its player the reach, the capabilities a pattern requires.)
  const caps = (roles.player && project.scenes[0] ? playerReach(project, project.scenes[0].id, roles.player.id, registry)?.capabilities : null) ?? {};
  const fitting = Object.keys(build.weights)
    .map((id) => patternById(id))
    .filter((p): p is NonNullable<typeof p> => !!p && patternFits(p, roles, caps));
  const required = new Set(allPatterns().flatMap((p) => (patternFits(p, roles, caps) ? [] : (p.requires ?? []))));
  const patterns = fitting
    .map((p) => {
      const vs = p.variants.filter((v) => (v.needs ?? []).every((r) => roles[r])).map((v) => v.id);
      return `${p.id} (${vs.join(', ')}): ${p.name}`;
    });
  const profile = levelProfileOf(project, registry)!;
  return {
    genre,
    theme: profile.theme?.id ?? null,
    structures: STRUCTURE_INFO,
    // (Not the mechanics of abilities the player doesn't have.)
    mechanics: mechanics().filter((m) => !themeAvoids(project, registry).includes(m) && !required.has(m)).join(', '),
    // (The game's levels, briefly, so a new one is something else: the engine checks that too.)
    levels: project.scenes.flatMap((s) => {
      const f = fingerprintOfScene(project, s, registry);
      if (!f) return [];
      const parts = f.sections.filter((x) => !/^(intro|finale):/.test(x)).map((x) => x.split(':')[1].split('@')[0].split('/')[0]);
      return [`${s.name}: ${f.structure ?? 'made by hand'}${f.signature ? `, about ${f.signature}` : ''}${parts.length ? ` (${[...new Set(parts)].slice(0, 6).join(', ')})` : ''}`];
    }),
    routes: ROUTES.join(', '),
    patterns,
  };
}
