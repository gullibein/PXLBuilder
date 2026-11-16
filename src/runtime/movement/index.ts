/**
 * The movement registries: locomotion models (by the Character Controller's `movement` value) and abilities (by
 * the components a character has), in the order their hooks run. Registering one is all a new model or ability
 * needs (docs/engine-architecture-proposal.md §16).
 */
import type { RuntimeEntity } from '../runtime';
import { dash, doubleJump, ledgeGrab, wallJump } from './abilities';
import { arcade } from './arcade';
import { topdown } from './topdown';
import type { Ability, LocomotionModel } from './types';

const MODELS: LocomotionModel[] = [];
/** Abilities in the order their hooks run (a dash before a wall jump before a double jump; ledge grab last). */
const ABILITIES: Ability[] = [];

export function registerLocomotion(m: LocomotionModel): () => void {
  if (MODELS.some((x) => x.id === m.id)) throw new Error(`Two locomotion models with the id "${m.id}"`);
  MODELS.push(m);
  return () => void MODELS.splice(MODELS.indexOf(m), 1);
}

export function registerAbility(a: Ability): () => void {
  if (ABILITIES.some((x) => x.id === a.id)) throw new Error(`Two abilities with the id "${a.id}"`);
  ABILITIES.push(a);
  return () => void ABILITIES.splice(ABILITIES.indexOf(a), 1);
}

registerLocomotion(arcade);
registerLocomotion(topdown);
registerAbility(dash);
registerAbility(wallJump);
registerAbility(doubleJump);
registerAbility(ledgeGrab);

/** The model a Character Controller `movement` value answers to (unknown: arcade, as a platformer). */
export function locomotionFor(movement: string | undefined): LocomotionModel {
  return MODELS.find((m) => m.answersTo.includes(movement ?? 'platformer')) ?? arcade;
}

/** The movement values the models answer to (the Character Controller's choices). */
export function movementValues(): string[] {
  return MODELS.flatMap((m) => m.answersTo);
}

/** The abilities a character has (by its components) that work with its model. */
export function abilitiesFor(e: RuntimeEntity, model: LocomotionModel): Ability[] {
  return ABILITIES.filter((a) => a.worksWith.includes(model.id) && e.base.components[a.component]);
}

/** The states a character's movement is in now (its model's and its abilities'): the motion snapshot's states. */
export function motionStates(e: RuntimeEntity): string[] {
  if (!e.controller) return [];
  const model = locomotionFor(e.controller.movement);
  return [...model.states(e), ...abilitiesFor(e, model).flatMap((a) => a.states?.(e) ?? [])];
}

export type { Ability, LocomotionModel, MotionSnapshot, MovementContext, MovementHost } from './types';

/** The components that give abilities (for checking the engine's ability modules agree). */
export function abilityComponents(): string[] {
  return ABILITIES.map((a) => a.component);
}
