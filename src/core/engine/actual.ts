/**
 * What a game actually is, read from its objects and levels (docs/engine-architecture-proposal.md §23): how each
 * player-controlled character moves and which abilities it has, and how each level is seen. The runtime plays
 * exactly these (a character moves by its own Character Controller, a level by its own gravity and projection), so
 * they are never taken from the profile. The profile declares what the game is meant to be (its view, its movement
 * model); the compatibility check compares the two and says where they differ (engine/profile.ts).
 *
 * Read-only, and nothing new to register: movement models and abilities are found through the modules there are.
 */
import type { ComponentRegistry } from '../components/registry';
import { resolveEntity } from '../model/resolve';
import type { Id, Project } from '../types';
import { tagMet } from './module';
import { modules, type AbilityModule, type LocomotionModule } from './modules';
import type { GameProfile } from './profileSchema';

export interface PlayerAbility {
  /** The ability (its module's id). */
  id: string;
  component: string;
  /** It works on this character: its movement model is one the ability needs (else it does nothing). */
  works: boolean;
  /** What it needs that the character's movement doesn't give (when it doesn't work). */
  needs: string | null;
}

export interface PlayerFacts {
  /** The object (definition), or the placed copy that differs from its object. */
  id: Id;
  name: string;
  /** In which level, for a placed copy that differs from its object (else null: the object itself). */
  level: string | null;
  /** Its Character Controller's movement value, as it is. */
  movement: string;
  /** The movement model that value selects (null: there is no such model: nothing moves it by the keys). */
  model: string | null;
  abilities: PlayerAbility[];
}

export type LevelView = 'side' | 'top' | 'iso';

export interface LevelFacts {
  id: Id;
  name: string;
  /** How the level is played: drawn at an angle (iso), else pulled by gravity (side), else neither (top). */
  view: LevelView;
}

export interface GameFacts {
  /** Every player-controlled object, each by itself (none stands for the others); empty: nothing is. */
  players: PlayerFacts[];
  levels: LevelFacts[];
}

type Components = Record<string, Record<string, unknown> | undefined>;

/**
 * Whether an ability works on a character moving by this model, and what it needs when not: by what the ability's
 * module requires of the movement and what the model's module gives (the runtime gives an ability only to such a
 * model: a test checks the two agree).
 */
export function abilityOn(abilityId: string, modelId: string | null): { works: boolean; needs: string | null } {
  const ab = modules.get<AbilityModule>('ability', abilityId);
  const gives = new Set((modelId ? modules.get<LocomotionModule>('locomotion', modelId)?.provides : null) ?? []);
  const missing = (ab?.requires ?? []).filter((t) => t.startsWith('locomotion:') && !tagMet(t, gives));
  return { works: !!ab && !!modelId && !missing.length, needs: missing.length ? missing.map((t) => t.replace(/locomotion:/g, '').split('|').join(' or ')).join(', ') : null };
}

function factsOf(id: Id, name: string, level: string | null, components: Components): PlayerFacts | null {
  const cc = components.CharacterController;
  if (!cc) return null;
  // (A controller with no value set moves as a platformer: the field's default.)
  const movement = typeof cc.movement === 'string' && cc.movement ? cc.movement : 'platformer';
  const model = modules.list<LocomotionModule>('locomotion').find((m) => m.controller === movement) ?? null;
  const abilities = modules
    .list<AbilityModule>('ability')
    .filter((a) => components[a.component])
    .map((a) => ({ id: a.id, component: a.component, ...abilityOn(a.id, model?.id ?? null) }));
  return { id, name, level, movement, model: model?.id ?? null, abilities };
}

const same = (a: PlayerFacts, b: PlayerFacts) => a.movement === b.movement && a.abilities.map((x) => x.id).join() === b.abilities.map((x) => x.id).join();

/** A level's view, from its own settings. */
export function levelView(world: { gravity: { x: number; y: number }; view?: string }): LevelView {
  return world.view === 'iso' ? 'iso' : world.gravity.x !== 0 || world.gravity.y !== 0 ? 'side' : 'top';
}

/** (Without a registry: the objects only, not the placed copies that differ from them.) */
export function gameFacts(project: Pick<Project, 'definitions' | 'scenes'>, registry?: ComponentRegistry): GameFacts {
  const players: PlayerFacts[] = [];
  const byDef = new Map<Id, PlayerFacts>();
  for (const d of project.definitions) {
    const f = factsOf(d.id, d.name, null, d.components as Components);
    if (!f) continue;
    players.push(f);
    byDef.set(d.id, f);
  }
  // Placed copies that move otherwise than their object (their own movement value or ability components).
  for (const s of registry ? project.scenes : [])
    for (const e of s.entities) {
      if (!Object.keys(e.components).length && !e.removedComponents.length) continue;
      const f = factsOf(e.id, e.name ?? byDef.get(e.definitionId ?? '')?.name ?? 'object', s.name, resolveEntity(project as Project, e, registry!).components as Components);
      const def = byDef.get(e.definitionId ?? '');
      if (f ? !def || !same(f, def) : false) players.push(f!);
    }
  return { players, levels: project.scenes.map((s) => ({ id: s.id, name: s.name, view: levelView(s.world) })) };
}

/** The abilities the game's players have and that work on them, each once, in the modules' order. */
export function abilitiesInUse(facts: GameFacts): string[] {
  const have = new Set(facts.players.flatMap((p) => p.abilities.filter((a) => a.works).map((a) => a.id)));
  return modules.list<AbilityModule>('ability').map((a) => a.id).filter((id) => have.has(id));
}

const who = (p: PlayerFacts) => (p.level ? `${p.name} (in ${p.level})` : p.name);

/**
 * Where the game's players differ from the movement the profile declares, each by name, and what runs (the
 * character's own setting, always). No player-controlled object is no difference: movement is not in use.
 */
export function movementNotes(p: GameProfile, facts: GameFacts): string[] {
  const notes: string[] = [];
  for (const pl of facts.players) {
    if (pl.model === null) notes.push(`${who(pl)}: there is no movement model "${pl.movement}", so it ignores the movement keys (nothing else moves it in its place)`);
    else if (pl.model !== p.movement.model) notes.push(`${who(pl)} moves by "${pl.model}" (its Character Controller), not by the profile's "${p.movement.model}": it plays as its own setting says`);
    for (const a of pl.abilities) if (!a.works && pl.model !== null) notes.push(`${who(pl)}: its ${a.component} (${a.id}) needs ${a.needs} movement, so on this character it does nothing`);
  }
  return notes;
}

const VIEW_WORDS: Record<LevelView, string> = { side: 'from the side (it has gravity)', top: 'from above (no gravity)', iso: 'at an angle (isometric)' };

/**
 * Levels seen otherwise than the game's declared view, each by name. A level plays as it is set; what the declared
 * view decides for the whole game (which geometry and camera behaviours are supported, the level builder) is not
 * worked out again for it, and that is said.
 */
export function viewNotes(p: GameProfile, facts: GameFacts): string[] {
  const other = facts.levels.filter((l) => l.view !== p.view);
  if (!other.length) return [];
  const by = new Map<LevelView, string[]>();
  for (const l of other) by.set(l.view, [...(by.get(l.view) ?? []), l.name]);
  return [...by].map(([view, names]) => `${names.slice(0, 3).map((n) => `"${n}"`).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''} ${names.length > 1 ? 'are' : 'is'} seen ${VIEW_WORDS[view]}, not as the game's view says (${p.view}): ${names.length > 1 ? 'they play as they are' : 'it plays as it is'} set, while what the game's view decides (ramps and jump-through platforms, camera zones, the level builder) stays as for "${p.view}"`);
}

/**
 * Components the game's objects have that this engine has no such type of (an ability or a behaviour that isn't
 * registered here: a game made with another version, or with something added that isn't loaded). Nothing reads
 * them, so they do nothing; said, not passed over. (Loading a game warns of the same.)
 */
export function componentNotes(project: Pick<Project, 'definitions' | 'scenes'>, registry: ComponentRegistry): string[] {
  const missing = new Map<string, string[]>();
  const see = (owner: string, components: Record<string, unknown>) => {
    for (const type of Object.keys(components)) if (!registry.has(type)) missing.set(type, [...(missing.get(type) ?? []), owner]);
  };
  for (const d of project.definitions) see(d.name, d.components);
  for (const s of project.scenes) for (const e of s.entities) see(`${e.name ?? 'a placed object'} (in ${s.name})`, e.components);
  return [...missing].map(([type, owners]) => `${[...new Set(owners)].slice(0, 3).join(', ')}${new Set(owners).size > 3 ? '…' : ''}: there is no "${type}" component in this engine (an ability or behaviour that isn't registered), so it does nothing`);
}

/** How the game's players move, in words (the profile panel's and the AI's line): each by itself, or "not in use". */
export function describeMovement(facts: GameFacts): string {
  if (!facts.players.length) return 'not in use (no object is player-controlled)';
  return facts.players.map((p) => `${who(p)}: ${p.model ?? `unknown "${p.movement}"`}${p.abilities.length ? ` + ${p.abilities.map((a) => (a.works ? a.id : `${a.id} (does nothing)`)).join(', ')}` : ''}`).join('; ');
}
