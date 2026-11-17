/**
 * Turn systems (docs/engine-architecture-proposal.md §22.7): what the turn statements of scripts (start_turns,
 * give_turn, done, end_turn, turn_order) and the names they read (turn_team, turn_number, my_turn…) are served by.
 * A game has the one its profile makes active (core/engine/turns.ts), or none: then nothing takes turns, and a
 * script that asks is told so. The rest of the turn kit (menus, the cursor, highlights, walking a path, popups)
 * is for any game and is not part of this.
 *
 * team_turns is the turn kit's own (runtime/turns.ts); another system is registered here and declared in
 * core/engine/turns.ts (or as a module).
 */
import type { RuntimeEntity } from './runtime';
import type { TurnKit } from './turns';

export interface TurnSystem {
  id: string;
  /** Turns begin: these teams (tags) in order; `pick`: the teams the player picks units from. Once: asked again, nothing changes. */
  start(teams: string[], pick: string[]): void;
  /** A unit gets its go now. */
  give(unit: RuntimeEntity): void;
  /** A unit's go is over. */
  done(unit: RuntimeEntity): void;
  /** The team's turn is over: the next team's. */
  endTurn(): void;
  /** Who goes first in a team: higher first. */
  setOrder(unit: RuntimeEntity, value: number): void;
  /** Whose turn it is (a team's tag; "" before turns begin). */
  team(): string;
  /** The round (1 = the first; 0 before turns begin). */
  round(): number;
  /** Only one side has anyone left. */
  over(): boolean;
  isActing(unit: RuntimeEntity): boolean;
  hasActed(unit: RuntimeEntity): boolean;
}

/** The turn kit's team turns, as a turn system. */
function teamTurns(kit: TurnKit): TurnSystem {
  return {
    id: 'team_turns',
    start: (teams, pick) => kit.startTurns(teams, pick),
    give: (unit) => kit.giveTurn(unit),
    done: (unit) => kit.done(unit),
    endTurn: () => kit.endTurn(),
    setOrder: (unit, value) => void kit.priority.set(unit, value),
    team: () => kit.team()?.tag ?? '',
    round: () => kit.turns?.number ?? 0,
    over: () => kit.turns?.over ?? false,
    isActing: (unit) => kit.isActing(unit),
    hasActed: (unit) => kit.hasActed(unit),
  };
}

const MAKE: Record<string, (kit: TurnKit) => TurnSystem> = { team_turns: teamTurns };

export function registerTurnSystem(id: string, make: (kit: TurnKit) => TurnSystem): void {
  MAKE[id] = make;
}
export function unregisterTurnSystem(id: string): void {
  delete MAKE[id];
}
export const turnSystemIds = (): string[] => Object.keys(MAKE);

/** The game's turn system: the first of its active ones that there is, or null (nothing takes turns). */
export function makeTurnSystem(active: readonly string[], kit: TurnKit): TurnSystem | null {
  const id = active.find((x) => MAKE[x]);
  return id ? MAKE[id](kit) : null;
}
