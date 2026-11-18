/**
 * The movement registries: locomotion models (by the Character Controller's `movement` value) and abilities (by
 * the components a character has), in the order their hooks run. Registering one is all a new model or ability
 * needs (docs/engine-architecture-proposal.md §16).
 */
import type { RuntimeEntity } from '../runtime';
import { abilitiesVersion, abilityDefinitions } from '../../abilities/index';
import { doubleJump, ledgeGrab } from './abilities';
import { arcade } from './arcade';
import { topdown } from './topdown';
import type { Ability, LocomotionModel } from './types';

const MODELS: LocomotionModel[] = [];
/**
 * Abilities registered here, with when their hooks run (double jump and ledge grab until they are definitions too,
 * V1.2; and the ones tests add). The others are the definitions of src/abilities: abilities() has them all, in the
 * order their hooks run (a dash before a wall jump before a double jump; ledge grab last).
 */
const ABILITIES: { ability: Ability; order: number }[] = [];
let known: { version: number; local: number; list: Ability[] } | null = null;
function abilities(): Ability[] {
  if (known && known.version === abilitiesVersion() && known.local === ABILITIES.length) return known.list;
  const all = [...abilityDefinitions().map((d) => ({ ability: { id: d.id, component: d.component.type, worksWith: d.worksWith, ...d.runtime } as Ability, order: d.order })), ...ABILITIES];
  // (A stable sort: those with the same order stay as they were registered.)
  const list = all.map((x, i) => ({ ...x, i })).sort((a, b) => a.order - b.order || a.i - b.i).map((x) => x.ability);
  known = { version: abilitiesVersion(), local: ABILITIES.length, list };
  return list;
}

export function registerLocomotion(m: LocomotionModel): () => void {
  if (MODELS.some((x) => x.id === m.id)) throw new Error(`Two locomotion models with the id "${m.id}"`);
  MODELS.push(m);
  return () => void MODELS.splice(MODELS.indexOf(m), 1);
}

/** Only its runtime part (the whole of an ability is a definition: src/abilities registerAbility). */
export function registerAbility(a: Ability, order = 100): () => void {
  if (abilities().some((x) => x.id === a.id)) throw new Error(`Two abilities with the id "${a.id}"`);
  const entry = { ability: a, order };
  ABILITIES.push(entry);
  known = null;
  return () => {
    ABILITIES.splice(ABILITIES.indexOf(entry), 1);
    known = null;
  };
}

registerLocomotion(arcade);
registerLocomotion(topdown);
registerAbility(doubleJump, 30);
registerAbility(ledgeGrab, 40);

/**
 * The model a Character Controller `movement` value answers to, or null: there is no such model. Never another one
 * in its place: a character whose model isn't there ignores the movement keys, and the runtime and the compatibility
 * report say so. (No value set: the field's default, a platformer.)
 */
export function locomotionFor(movement: string | undefined): LocomotionModel | null {
  return MODELS.find((m) => m.answersTo.includes(movement ?? 'platformer')) ?? null;
}

/** The movement values the models answer to (the Character Controller's choices). */
export function movementValues(): string[] {
  return MODELS.flatMap((m) => m.answersTo);
}

/** The abilities a character has (by its components) that work with its model. */
export function abilitiesFor(e: RuntimeEntity, model: LocomotionModel): Ability[] {
  return abilities().filter((a) => a.worksWith.includes(model.id) && e.base.components[a.component]);
}

/** The states a character's movement is in now (its model's and its abilities'): the motion snapshot's states. */
export function motionStates(e: RuntimeEntity): string[] {
  if (!e.controller) return [];
  const model = locomotionFor(e.controller.movement);
  if (!model) return [];
  return [...model.states(e), ...abilitiesFor(e, model).flatMap((a) => a.states?.(e) ?? [])];
}

export type { Ability, LocomotionModel, MotionSnapshot, MovementContext, MovementHost } from './types';

/** The locomotion models the ability of a component works with (for checking the engine's ability modules agree). */
export function abilityWorksWith(component: string): string[] {
  return abilities().find((a) => a.component === component)?.worksWith ?? [];
}

/** The components that give abilities (for checking the engine's ability modules agree). */
export function abilityComponents(): string[] {
  return abilities().map((a) => a.component);
}
