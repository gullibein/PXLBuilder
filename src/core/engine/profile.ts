/**
 * A game's profile at work: the profile it has (stored, or worked out from the game), whether its modules go
 * together, a new game made from one, and changing one (by hand or by the AI's set_game_profile). See
 * docs/engine-architecture-proposal.md §3, §10, §12.
 */
import { cameraNotes } from './camera';
import { generatorNotes, selectedGenerators } from './generators';
import { turnNotes } from './turns';
import { progressionIds } from '../progression/progression';
import { geometryNotes } from './geometry';
import { z } from 'zod';
import type { ComponentRegistry } from '../components/registry';
import { ModelError } from '../model/mutations';
import type { ObjectDefinition, Project } from '../types';
import { KIT_ROLES } from './kitRoles';
import { tagMet, type Module, type ModuleKind } from './module';
import { modules, type AbilityModule, type GeneratorModule, type KitModule, type LocomotionModule, type TurnsModule, type ViewModule } from './modules';
import { presetById, PRESETS } from './presets';
import { gameProfileSchema, type GameProfile } from './profileSchema';
import { inferProfileFromObjects, kitOfObjects } from './infer';
import { abilitiesInUse, abilityOn, describeMovement, gameFacts, movementNotes, viewNotes, type GameFacts } from './actual';

// (Through JSON: profiles are plain data, and this reads an Immer draft as well.)
const cloneValue = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** The profile the game chose (a stored one that reads), else null. */
export function storedGameProfile(project: Project): GameProfile | null {
  const p = project.settings.profile;
  return p && gameProfileSchema.safeParse(p).success ? p : null;
}

/** The starter name of an object (older games: its name). */
const starterName = (d: { name: string; metadata?: Record<string, unknown> }) => (typeof d.metadata?.starter === 'string' ? d.metadata.starter : d.name);

/** The kit a game was made from, by its objects; null: none of them (engine/infer.ts). */
export function kitOf(project: Pick<Project, 'definitions' | 'settings'>, _registry?: ComponentRegistry): string | null {
  return kitOfObjects(project.definitions, project.settings.gameType);
}

/**
 * The profile worked out from a game that has none stored (every game from before profiles): the preset of the kit
 * it was made from. Never written by this: a game gets a stored profile when the user or the AI chooses one, or when
 * it is made from a preset.
 */
export function inferProfile(project: Pick<Project, 'definitions' | 'settings'> & Partial<Pick<Project, 'scenes'>>, registry?: ComponentRegistry): GameProfile {
  return withAbilities(inferProfileFromObjects(project), project, registry);
}

/**
 * A profile with the abilities the game's players actually have (engine/actual.ts): abilities are components on
 * characters, never a second list to keep in step, so whatever a profile had stored for them is not read.
 */
function withAbilities(p: GameProfile, project: Pick<Project, 'definitions'> & Partial<Pick<Project, 'scenes'>>, registry?: ComponentRegistry): GameProfile {
  const abilities = abilitiesInUse(gameFacts({ definitions: project.definitions, scenes: project.scenes ?? [] }, registry));
  return { ...p, movement: { ...p.movement, abilities } };
}

/**
 * The game's profile: the stored one, else worked out from the game. What it declares (the view, the movement
 * model, geometry, camera, generators, turns, progression) is as chosen; its abilities are the players' own.
 */
export function profileOf(project: Project, registry: ComponentRegistry): GameProfile {
  const stored = storedGameProfile(project);
  return stored ? withAbilities(stored, project, registry) : inferProfile(project, registry);
}

/** The modules a profile selects, each with the system it is for. */
function selected(p: GameProfile): { kind: ModuleKind; id: string; system: string }[] {
  return [
    { kind: 'view', id: p.view, system: 'view' },
    { kind: 'time', id: p.time, system: 'time' },
    ...(p.turns ?? []).map((id) => ({ kind: 'turns' as const, id, system: 'turns' })),
    { kind: 'locomotion', id: p.movement.model, system: 'movement' },
    ...p.movement.abilities.map((id) => ({ kind: 'ability' as const, id, system: 'movement' })),
    ...p.geometry.map((id) => ({ kind: 'geometry' as const, id, system: 'geometry' })),
    ...p.camera.map((id) => ({ kind: 'camera' as const, id, system: 'camera' })),
    ...p.kits.map((id) => ({ kind: 'kit' as const, id, system: 'kits' })),
    ...selectedGenerators(p).map((id) => ({ kind: 'generator' as const, id, system: 'generator' })),
    { kind: 'progression', id: p.progression.model, system: 'progression' },
  ];
}

export type Compatibility = { state: 'ok' } | { state: 'degraded'; notes: string[] } | { state: 'incompatible'; reasons: string[] };

/**
 * Whether a profile's modules go together, from what each requires and provides: every required tag must be given
 * by another selected module; one that isn't, with a fallback, works in a lesser way (degraded, said); without one,
 * the combination is refused (incompatible, with why). Nothing here knows any particular module.
 */
export function checkProfile(p: GameProfile): Compatibility {
  const reasons: string[] = [];
  const notes: string[] = [];
  const mods: Module[] = [];
  for (const s of selected(p)) {
    const m = modules.get(s.kind, s.id);
    if (!m) reasons.push(`there is no ${s.kind} module "${s.id}" (for ${s.system})`);
    else mods.push(m);
  }
  if (new Set(p.kits).size !== p.kits.length) reasons.push('a kit is listed twice');
  // (Every game has walls and floors: without boxes nothing would be solid.)
  if (!p.geometry.includes('box')) reasons.push('geometry "box" (walls and floors) is needed by every game');
  const provided = new Set(mods.flatMap((m) => m.provides));
  for (const m of mods)
    for (const tag of m.requires) {
      if (tagMet(tag, provided)) continue;
      const instead = m.fallback?.[tag];
      if (instead) notes.push(`${m.kind} ${m.id}: ${instead}`);
      else reasons.push(`${m.kind} "${m.id}" needs ${tag.split('|').join(' or ')}, which nothing selected gives`);
    }
  if (reasons.length) return { state: 'incompatible', reasons };
  return notes.length ? { state: 'degraded', notes } : { state: 'ok' };
}

/**
 * Compatibility of a game: its profile's, and then what its objects use against what the profile makes active
 * (engine/geometry.ts: the runtime does exactly what these notes say).
 */
export function checkGame(project: Project, registry: ComponentRegistry): Compatibility {
  const p = profileOf(project, registry);
  // (Abilities are judged on the character that has them, below: not against the declared movement model.)
  const base = checkProfile({ ...p, movement: { ...p.movement, abilities: [] } });
  if (base.state === 'incompatible') return base;
  const facts = gameFacts(project, registry);
  const provided = new Set(selected(p).flatMap((s) => modules.get(s.kind, s.id)?.provides ?? []));
  const kindsOf = (kind: ModuleKind) => modules.list<TurnsModule>(kind).map((g) => ({ id: g.id, version: g.version, describe: g.describe, requires: g.requires, fallback: g.fallback, without: g.without }));
  // (Generators: every one registered, the engine's and any added, with what each requires.)
  const generators = modules.list<GeneratorModule>('generator').map((g) => ({ id: g.id, version: g.version, describe: g.describe, requires: g.requires, fallback: g.fallback, without: g.without }));
  const notes = [...(base.state === 'degraded' ? base.notes : []), ...geometryNotes(p, project.definitions, provided), ...cameraNotes(p, project.definitions, provided), ...generatorNotes(p, project.scenes, provided, generators), ...turnNotes(p, project, provided, kindsOf('turns')), ...movementNotes(p, facts), ...viewNotes(p, facts), ...(progressionIds().includes(p.progression.model) ? [] : [`progression '${p.progression.model}': nothing carries it out, so a won level is followed by nothing: the game stops there`])];
  return notes.length ? { state: 'degraded', notes } : { state: 'ok' };
}

/** The generator module the game's levels are built with, or null. */
export function generatorOf(project: Project, registry: ComponentRegistry): GeneratorModule | null {
  const id = profileOf(project, registry).generator.id;
  return id ? (modules.get<GeneratorModule>('generator', id) ?? null) : null;
}

/** The part an object plays by its kit's declaration (or undefined). */
export function declaredRole(def: ObjectDefinition): string | undefined {
  const name = starterName(def);
  for (const table of Object.values(KIT_ROLES)) if (table[name]) return table[name];
  return undefined;
}

/**
 * A new game from a profile: its first kit's objects (today's starter), then each other kit's objects that don't
 * repeat one already there (by name, or by the part it plays: one player, one goal…), the player moving as the
 * profile's locomotion says, and the profile stored. Throws when the profile's modules don't go together.
 */
export function projectFromProfile(profile: GameProfile, registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const check = checkProfile(profile);
  if (check.state === 'incompatible') throw new ModelError(`These systems don't go together: ${check.reasons.join('; ')}`);
  const [first, ...rest] = profile.kits.map((id) => modules.get<KitModule>('kit', id)!);
  const project = first.create(registry, name);
  for (const kit of rest) {
    const other = kit.create(registry, name);
    const roles = new Set(project.definitions.map((d) => declaredRole(d)).filter(Boolean));
    const names = new Set(project.definitions.map(starterName));
    for (const d of other.definitions) {
      const role = declaredRole(d);
      if (names.has(starterName(d)) || (role && roles.has(role))) continue;
      project.definitions.push(d);
    }
    // (The kit's pictures the objects refer to: their sprites, their looks, pictures their scripts name.)
    const text = JSON.stringify(project.definitions);
    for (const a of other.assets) if (!project.assets.some((x) => x.id === a.id) && text.includes(a.id)) project.assets.push(a);
  }
  applyMovement(project, profile);
  applyView(project, profile);
  project.settings.profile = cloneValue(profile);
  return project;
}

/** A new game from a preset. */
export function projectFromPreset(presetId: string, registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const preset = presetById(presetId);
  if (!preset) throw new ModelError(`There is no preset "${presetId}" (there are: ${PRESETS.map((p) => p.id).join(', ')})`);
  return projectFromProfile(preset.profile, registry, name);
}

/** The player-controlled objects move as the profile's locomotion model says (the Character Controller's setting). */
function applyMovement(project: Project, profile: GameProfile): void {
  const loco = modules.get<LocomotionModule>('locomotion', profile.movement.model);
  if (!loco) return;
  for (const d of project.definitions) {
    const cc = d.components.CharacterController as Record<string, unknown> | undefined;
    if (cc && cc.movement !== loco.controller) cc.movement = loco.controller;
  }
}

/**
 * The levels are seen as the profile's view says: their gravity and their projection (flat, or at an angle), every
 * level alike. Only what differs is written.
 */
function applyView(project: Project, profile: GameProfile): void {
  const view = modules.get<ViewModule>('view', profile.view);
  if (!view) return;
  for (const s of project.scenes) {
    if (s.world.gravity.x !== view.gravity.x || s.world.gravity.y !== view.gravity.y) s.world.gravity = { ...view.gravity };
    if (view.projection === 'iso' && s.world.view !== 'iso') s.world.view = 'iso';
    if (view.projection === 'flat' && s.world.view !== undefined) delete s.world.view;
  }
}

const abilityFits = (abilityId: string, modelId: string): boolean => abilityOn(abilityId, modelId).works;

/** A change to a profile: systems to set (the rest stay), or a preset to take them from (the game's kits are kept). */
export const profileChangeSchema = z
  .object({
    preset: z.string().nullable(),
    view: z.string(),
    time: z.string(),
    turns: z.array(z.string()),
    movement: z.string(),
    abilities: z.array(z.string()),
    geometry: z.array(z.string()),
    camera: z.array(z.string()),
    addKits: z.array(z.string()),
    generator: z.string().nullable(),
    alsoGenerators: z.array(z.string()),
    genre: z.string().nullable(),
    theme: z.string().nullable(),
  })
  .partial()
  .strict();
export type ProfileChange = z.infer<typeof profileChangeSchema>;

/** The profile with a change made (not checked). */
export function changedProfile(base: GameProfile, c: ProfileChange): GameProfile {
  let p = cloneValue(base);
  if (c.preset) {
    const preset = presetById(c.preset);
    if (!preset) throw new ModelError(`There is no preset "${c.preset}" (there are: ${PRESETS.map((x) => x.id).join(', ')})`);
    p = { ...cloneValue(preset.profile), kits: [...base.kits, ...preset.profile.kits.filter((k) => !base.kits.includes(k))], theme: base.theme };
    // (A preset says nothing about abilities: the players keep theirs, as far as the preset's movement has them.)
    p.movement.abilities = base.movement.abilities.filter((a) => abilityFits(a, p.movement.model));
  }
  const touched = Object.keys(c).some((k) => k !== 'preset');
  if (c.view) p.view = c.view;
  if (c.time) p.time = c.time;
  if (c.turns) {
    if (c.turns.length) p.turns = [...new Set(c.turns)];
    else delete p.turns;
  }
  if (c.movement) p.movement = { ...p.movement, model: c.movement };
  if (c.abilities) p.movement = { ...p.movement, abilities: [...c.abilities] };
  if (c.geometry) p.geometry = [...c.geometry];
  if (c.camera) p.camera = [...c.camera];
  if (c.addKits) p.kits = [...p.kits, ...c.addKits.filter((k) => !p.kits.includes(k))];
  // (The level builder changes; the other generators the game uses stay, without the one that became the builder.)
  if (c.generator !== undefined) p.generator = { ...p.generator, id: c.generator, settings: c.generator === p.generator.id ? p.generator.settings : {} };
  if (c.alsoGenerators) p.generator = { ...p.generator, also: [...c.alsoGenerators] };
  if (p.generator.also) {
    const also = [...new Set(p.generator.also)].filter((id) => id !== p.generator.id);
    p.generator = also.length ? { ...p.generator, also } : { id: p.generator.id, settings: p.generator.settings };
  }
  if (c.genre !== undefined) {
    const { genre: _g, ...rest } = p.generator.settings;
    p.generator = { ...p.generator, settings: c.genre ? { ...rest, genre: c.genre } : rest };
  }
  if (c.theme !== undefined) p.theme = c.theme;
  // (Changed by hand after a preset: still says which preset it came from.)
  if (touched && !c.preset) p.preset = base.preset;
  return gameProfileSchema.parse(p);
}

/**
 * Changes the game's profile (one undoable edit): checked first (incompatible: refused with why), then what the
 * changed systems do to the game: the player's movement, the levels' gravity for a new view, the objects of kits
 * added (those not already there). Returns what was done and, for a degraded combination, what works differently.
 */
export function setGameProfile(project: Project, change: ProfileChange, registry: ComponentRegistry): string[] {
  const before = profileOf(project, registry);
  const next = changedProfile(before, change);
  const check = checkProfile(next);
  if (check.state === 'incompatible') throw new ModelError(`That doesn't go together: ${check.reasons.join('; ')}`);
  const done: string[] = [];
  if (next.movement.model !== before.movement.model) {
    applyMovement(project, next);
    done.push(`the player moves by ${next.movement.model}`);
  }
  // Abilities: the player-controlled objects get the components of those added, and lose those of those taken away.
  const added = next.movement.abilities.filter((a) => !before.movement.abilities.includes(a));
  const removed = before.movement.abilities.filter((a) => !next.movement.abilities.includes(a));
  for (const id of [...added, ...removed]) {
    const ab = modules.get<AbilityModule>('ability', id)!;
    for (const d of project.definitions) {
      const cc = d.components.CharacterController as { movement?: unknown } | undefined;
      if (!cc) continue;
      // (Given to the characters it works on: the others would only carry a component that does nothing.)
      const model = modules.list<LocomotionModule>('locomotion').find((l) => l.controller === (cc.movement ?? 'platformer'));
      if (added.includes(id) && !d.components[ab.component] && model && abilityFits(id, model.id)) d.components[ab.component] = registry.createDefault(ab.component, {});
      if (removed.includes(id)) delete d.components[ab.component];
    }
  }
  if (added.length) done.push(`the player can now ${added.join(', ')}`);
  if (removed.length) done.push(`the player no longer has ${removed.join(', ')}`);
  if (next.view !== before.view) {
    const view = modules.get<ViewModule>('view', next.view)!;
    applyView(project, next);
    done.push(`levels seen ${next.view === 'side' ? 'from the side' : next.view === 'top' ? 'from above' : 'at an angle'} (gravity ${view.gravity.y})`);
  }
  for (const id of next.kits.filter((k) => !before.kits.includes(k))) {
    const kit = modules.get<KitModule>('kit', id)!;
    const other = kit.create(registry, project.name);
    const names = new Set(project.definitions.map(starterName));
    const roles = new Set(project.definitions.map((d) => declaredRole(d)).filter(Boolean));
    let added = 0;
    for (const d of other.definitions) {
      const role = declaredRole(d);
      if (names.has(starterName(d)) || (role && roles.has(role))) continue;
      project.definitions.push(d);
      added++;
    }
    const text = JSON.stringify(project.definitions);
    for (const a of other.assets) if (!project.assets.some((x) => x.id === a.id) && text.includes(a.id)) project.assets.push(a);
    done.push(`${added} object${added === 1 ? '' : 's'} of the ${id} kit added`);
  }
  project.settings.profile = next;
  if (check.state === 'degraded') done.push(...check.notes);
  return done;
}

/**
 * The game's kind of platformer and its look (set_level_profile), kept in its profile: the level builder's genre
 * (with the level builder made the sections builder, for a game seen from the side) and the theme.
 */
export function setLevelProfile(project: Project, genre: string, theme: string, registry: ComponentRegistry): void {
  // (Checked against the lists by the operation's schema; here only that they are words.)
  if (!genre.trim() || !theme.trim()) throw new ModelError('A level profile needs a genre and a theme');
  const side = profileOf(project, registry).view === 'side';
  setGameProfile(project, { ...(side ? { generator: 'sections' } : {}), genre, theme }, registry);
}

/** What each system can be (the modules there are), and the presets: for the AI and the profile panel. */
export function profileChoices(): { presets: string[]; choices: Record<string, string[]> } {
  const ids = (k: ModuleKind) => modules.list(k).map((m) => m.id);
  return {
    presets: PRESETS.map((p) => p.id),
    choices: { view: ids('view'), time: ids('time'), turns: ids('turns'), movement: ids('locomotion'), abilities: ids('ability'), geometry: ids('geometry'), camera: ids('camera'), kits: ids('kit'), generator: ids('generator'), progression: ids('progression') },
  };
}

/** The profile in a line per system (the AI's context, the profile panel's summary). */
export function describeProfile(p: GameProfile, facts?: GameFacts): string {
  const gen = `${p.generator.id ? `${p.generator.id}${p.generator.settings.genre ? ` (${String(p.generator.settings.genre)})` : ''}` : 'none'}${p.generator.also?.length ? `, also ${p.generator.also.join(', ')}` : ''}`;
  return [
    p.preset ? `preset ${p.preset}` : 'own profile',
    `view ${p.view}`,
    `time ${p.time}`,
    `turns ${p.turns?.join(', ') || 'none'}`,
    // (With the game's facts: how each player-controlled object really moves, or that none is.)
    facts ? `movement ${p.movement.model} (declared); players: ${describeMovement(facts)}` : `movement ${p.movement.model}${p.movement.abilities.length ? ` + ${p.movement.abilities.join(', ')}` : ''}`,
    `geometry ${p.geometry.join(', ') || 'none'}`,
    `camera ${p.camera.join(', ') || 'still'}`,
    `kits ${p.kits.join(', ')}`,
    `levels built by ${gen}`,
    `progression ${p.progression.model}`,
    ...(p.theme ? [`theme ${p.theme}`] : []),
  ].join('; ');
}
