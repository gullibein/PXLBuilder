/**
 * An ability, declared in one place (docs/engine-architecture-proposal.md §24, T1): what a character can do on top
 * of how it moves. One definition, registered once (registry.ts), is all the engine has of it: its component (the
 * editor and the AI add it to a character), its runtime behaviour, the names scripts read, its module in the
 * game's profile and report, its part in the player's reach (the route solver, the level builder, validation), and
 * how the route bot plays it. Each system reads the definition; none keeps a list of abilities of its own.
 *
 * Only the identity, the component and the runtime behaviour are needed. An ability without a reach part adds
 * nothing to what levels are built and judged by; one with a reach part but no bot part is built for and solved,
 * and its levels stay uncertain (nothing has played them), never validated.
 */
import type { ComponentDefinition } from '../core/components/schema';
import type { MoveRule } from '../core/levelGen/moves';
import type { ComponentMap } from '../core/types';
import type { InputState } from '../runtime/input';
import type { Ability as RuntimeAbility } from '../runtime/movement/types';
import type { Runtime, RuntimeEntity } from '../runtime/runtime';

/** A cell of a route, as the route solver gives it: where the player stands, the move that got it there, its mode. */
export interface RouteCell {
  col: number;
  row: number;
  move: string;
  mode?: number;
}

/** What the route bot gives an ability to play one step of a route with (one tick at a time, by the keys a player has). */
export interface BotStep {
  rt: Runtime;
  /** The player. */
  p: RuntimeEntity;
  input: InputState;
  from: RouteCell;
  to: RouteCell;
  /** The cell the player is in now. */
  here: { col: number; row: number };
  /** The middles of the step's cells (px), and which way the target is from the player (-1, 0, 1). */
  fromX: number;
  toX: number;
  dir: number;
  /** The play's time now and when this step began (seconds), and a tick's length. */
  t: number;
  began: number;
  dt: number;
  /** Holds or lets go of a key. */
  hold(action: 'left' | 'right' | 'up' | 'down' | 'jump', on: boolean): void;
  /** Plays a tick now (the bot plays one after every call of `step` by itself). */
  tick(): void;
  /** The side of the wall a route cell's mode holds (-1 left, 1 right, 0: none). */
  wallSide(mode?: number): number;
  /** The step's own memory: empty when the step begins. */
  mem: Record<string, unknown>;
}

export interface AbilityBot {
  /** The moves of a route it plays (the ones its move rule makes). */
  moves: string[];
  /** The keys for one tick of a step by one of its moves. */
  step(s: BotStep): void;
  /** The player counts as arrived in a cell (besides standing, climbing, swimming): holding the wall the step ends on. */
  settled?(s: Pick<BotStep, 'rt' | 'p' | 'to'>): boolean;
}

/** What an ability adds to the jump table (the closed-form numbers of the arcade model's jump). */
export interface TableBoost {
  /** More full jumps in the air. */
  airJumps?: number;
  /** A wall top this much above the jump's peak (px) is still caught and climbed. */
  grab?: number;
}

/**
 * An ability's part in the player's reach, one way or the other (or both):
 * - `table`: what it adds to the jump table. It is then judged exactly as a jump is, by the table, the arcade
 *   model's own moves and the route bot alike: nothing more to declare.
 * - `move`: a move rule of its own for the route solver, with its capability in numbers; `estimated`: its moves are
 *   estimates in cells, and a route through them counts only once the route bot has played it.
 */
export interface AbilityReach {
  table?(components: ComponentMap, body: { height: number }): TableBoost;
  /** `base`: the character's jump speed, the level's gravity, its running speed. */
  move?(components: ComponentMap, base: { jumpForce: number; gravity: number; speed: number }): MoveRule;
  estimated?: boolean;
}

export interface AbilityDefinition {
  /** Its id: in the game's profile, as a capability of the player's reach, as a mechanic levels are asked for by. */
  id: string;
  /** One line: the profile panel, the AI. */
  describe: string;
  /** In a sentence, many of them ("wall jumps"); by default its id. */
  plural?: string;
  /** The component that gives a character the ability and holds its settings. */
  component: ComponentDefinition;
  /** The movement models it works with (their ids): on a character moving otherwise it does nothing, and that is reported. */
  worksWith: string[];
  /** When its hooks run among the abilities of a character (lower first). */
  order: number;
  /** What it does in play: its hooks into the movement model's step, and the states it adds. */
  runtime: Omit<RuntimeAbility, 'id' | 'component' | 'worksWith'>;
  /** Names scripts read on a character (self.dashing): true while it is in that state (one of `runtime.states`). */
  scriptNames?: Record<string, { state: string; doc: string }>;
  /** Its part in the player's reach; none: levels are neither built nor judged by it. */
  reach?: AbilityReach;
  /** How the route bot plays its moves; none: a level that needs it is never proven playable here (uncertain). */
  bot?: AbilityBot;
  /** The AI guidance topic its component is described in (else: in the instructions every request carries). */
  topic?: string;
  /** What having it is called when the AI's work is told ("a double jump", "the ability to grab ledges"). */
  noun?: string;
  /** Words of a request that ask for it (an ability added that nobody asked for is pointed out). */
  askedBy?: RegExp;
}
