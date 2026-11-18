/**
 * The movement architecture (docs/engine-architecture-proposal.md §16): a character moves under one locomotion
 * model (looked up by its Character Controller's `movement` value), with abilities composed on top (by the
 * components it has). Models and abilities see the world only through the MovementHost, and every model publishes
 * the same MotionSnapshot, so the camera, animation, scripts and validation never need to know a model's insides.
 * A new model or ability is a registered object: nothing in the runtime changes.
 */
import type { Box } from '../physics';
import type { Action, InputView } from '../input';
import type { Ladder, RuntimeEntity } from '../runtime';
import type { EnginePart } from '../../core/script/language';

/** What a model or an ability may ask of the world and the runtime: nothing else. (F3: collisions via GeometryQuery.) */
export interface MovementHost {
  /** The ladder it is at (at least half of it inside one), or null. */
  ladderAt(e: RuntimeEntity): Ladder | null;
  isOnFloorBelowLadder(e: RuntimeEntity): boolean;
  /** Stands it on top of a ladder (after climbing up to it). */
  standOn(e: RuntimeEntity, ladder: Ladder): void;
  /** It stands on a jump-through platform. */
  onJumpThrough(e: RuntimeEntity): boolean;
  /** Catches the top edge of a wall beside it, when there is one at hand height (ledge grab). */
  tryGrabLedge(e: RuntimeEntity, dir: 1 | -1): void;
  /** While hanging from a ledge: climbs up or lets go; true while still hanging. */
  hang(e: RuntimeEntity, input: InputView, dir: number): boolean;
  /** A wall (something solid) right beside it on that side, at body height. */
  wallBeside(e: RuntimeEntity, dir: 1 | -1): boolean;
  /** The area it covers on screen (its sprite's size): what ladders and water are measured with. */
  zone(e: RuntimeEntity): Box;
  /** Seen at an angle (isometric): the keys go the way they point on the screen. */
  isoView(): boolean;
  /** A script of its own took this part of the engine over (engine parts). */
  ownsPart(e: RuntimeEntity, part: EnginePart): boolean;
}

export interface MovementContext {
  e: RuntimeEntity;
  input: InputView;
  dt: number;
  host: MovementHost;
}

/**
 * Abilities hook into a model at named points; a model calls the points it has, in a fixed order, so abilities
 * compose: several can be on one character (double jump and wall jump and dash), each doing only its own part.
 */
export interface Ability {
  id: string;
  /** The component that gives a character this ability (and holds its settings). */
  component: string;
  /** The locomotion models it works with. */
  worksWith: string[];
  /** Before anything else of the step: may take the step over entirely (a dash in progress). True: taken. */
  override?(ctx: MovementContext): boolean;
  /** On the ground (each step): refill what landing refills (air jumps, dashes). */
  grounded?(ctx: MovementContext): void;
  /** Which way the player is steered this step (it may hold it back: just after a wall jump). */
  steer?(ctx: MovementContext, dir: number): number;
  /** Jump pressed in the air, with no ground jump possible: may do its own (wall jump, double jump). True: done. */
  airJump?(ctx: MovementContext): boolean;
  /** After the step's running and jumping (ledge grab, wall slide). */
  after?(ctx: MovementContext, dir: number): void;
  /** The states it adds to the motion snapshot now ("dashing", "wallSliding"). */
  states?(e: RuntimeEntity): string[];
  /** The step's gravity: false while it holds gravity off (a dash). */
  gravity?(e: RuntimeEntity): boolean;
}

export interface LocomotionModel {
  /** Its id; also the Character Controller `movement` values it answers to. */
  id: string;
  answersTo: string[];
  /** It floats: no gravity pulls it (seen from above); Jump also fires; nothing lands on it. */
  floats: boolean;
  /**
   * The keys it reads: `move` wherever the character is, `sometimes` only at certain places (a ladder, water, a
   * platform to drop through). For anything that asks which keys ought to do something (the play probe); a model
   * that doesn't say is not judged on it.
   */
  keys?: { move: Action[]; sometimes: Action[] };
  /** Moves the character for one step, calling the abilities' hooks at its points. */
  step(ctx: MovementContext, abilities: readonly Ability[]): void;
  /** The states it is in now (grounded, airborne, climbing…). */
  states(e: RuntimeEntity): string[];
}

/** What every model publishes, whatever its insides: for the camera, animation, scripts, enemies, validation. */
export interface MotionSnapshot {
  model: string;
  velocity: { x: number; y: number };
  facing: 1 | -1;
  heading: { x: number; y: number } | null;
  states: string[];
  intent: { x: number; y: number; jump: boolean };
}
