/**
 * Locomotion models (by the Character Controller's `movement` value), registered here; and the abilities a
 * character has (by its components), which are the definitions of src/abilities: an ability is registered there,
 * once, and nowhere else (docs/engine-architecture-proposal.md §16, §24).
 */
import type { RuntimeEntity } from '../runtime';
import { abilitiesVersion, abilityDefinitions } from '../../abilities/index';
import { arcade } from './arcade';
import { topdown } from './topdown';
import type { Ability, LocomotionModel } from './types';

const MODELS: LocomotionModel[] = [];
/**
 * The abilities, as the runtime has them: every definition of src/abilities (the one place an ability is
 * registered), in the order their hooks run (a dash before a wall jump before a double jump; ledge grab last).
 */
let known: { version: number; list: Ability[] } | null = null;
function abilities(): Ability[] {
  if (known && known.version === abilitiesVersion()) return known.list;
  // (A stable sort: those with the same order stay as they were registered.)
  const list = abilityDefinitions()
    .map((d, i) => ({ ability: { id: d.id, component: d.component.type, worksWith: d.worksWith, ...d.runtime } as Ability, order: d.order, i }))
    .sort((a, b) => a.order - b.order || a.i - b.i)
    .map((x) => x.ability);
  known = { version: abilitiesVersion(), list };
  return list;
}

export function registerLocomotion(m: LocomotionModel): () => void {
  if (MODELS.some((x) => x.id === m.id)) throw new Error(`Two locomotion models with the id "${m.id}"`);
  MODELS.push(m);
  return () => void MODELS.splice(MODELS.indexOf(m), 1);
}

registerLocomotion(arcade);
registerLocomotion(topdown);

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

/** The keys a character's abilities listen to (their definitions say), each with what it does: for key hints and touch buttons. */
export function abilityKeys(e: RuntimeEntity): { action: 'jump' | 'interact' | 'fire' | 'special'; does: string }[] {
  if (!e.controller) return [];
  const model = locomotionFor(e.controller.movement);
  if (!model) return [];
  return abilityDefinitions()
    .filter((d) => d.keys && d.worksWith.includes(model.id) && e.base.components[d.component.type])
    .flatMap((d) => d.keys!(e.base.components));
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
