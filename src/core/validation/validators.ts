/**
 * Level validation behind one interface (docs/engine-architecture-proposal.md §8.2, §19, F4): validators are
 * modules, each with a strategy (static, analytical, solver, simulation), a cost, and what of the player's reach
 * description it needs. Each gives a verdict (pass, fail, or unknown: couldn't judge, said) on the mechanics it
 * covers. Which validators judge a level comes from its mechanics and the reach description's coverage (§8.4): a
 * mechanic only the moves cover goes to the route solver; one the moves only estimate, to the route bot too; one
 * nothing covers makes the level uncertain, never passed off as validated.
 *
 * Today's checks, moved here as they are: layout (a way to win, a safe start), checker (the jump-arc reachability
 * check), cell_solver (the route solver), puzzle_needed (each puzzle piece needed), route_bot (the route played on
 * the real runtime).
 */
import type { ComponentRegistry } from '../components/registry';
import type { LevelGrid } from '../levelGen/grid';
import { solveLevel, type SolveResult } from '../levelGen/solver';
import { layoutProblems, levelReachability, startConflicts, winProblems } from '../model/reachability';
import { solverReach, type ReachDescription } from '../reach/reach';
import type { Id, Project } from '../types';

export type Strategy = 'static' | 'analytical' | 'solver' | 'simulation';

export interface Verdict {
  state: 'pass' | 'fail' | 'unknown';
  /** The mechanics it judged. */
  covered: string[];
  /** Unknown only because it doesn't judge these mechanics (a stronger validator that does may settle them). */
  unjudged?: string[];
  problems: string[];
  /** A route (cell by cell) the editor or another validator can use. */
  evidence?: { route?: SolveResult['path'] };
}

/** A level to validate: the game, the level, and what is known of it. */
export interface ValidationTarget {
  project: Project;
  sceneId: Id;
  registry: ComponentRegistry;
  /** The version to judge reach on (moving platforms as bridges along their paths), when it differs. */
  judged?: Project;
  /** The level as a cell grid (the level builder's, a map's), when there is one: what the solver searches. */
  grid?: LevelGrid | null;
  reach: ReachDescription | null;
  /** The mechanics the level uses (its sections', its player's abilities). */
  mechanics: string[];
  /**
   * The simulator's time budget for this level, in seconds of play (the game's own time, so the same on every
   * machine); 0: none left (the level is then not played, and stays uncertain). Absent: no limit.
   */
  botSeconds?: number;
}

export interface Validator {
  id: string;
  strategy: Strategy;
  cost: 'cheap' | 'moderate' | 'expensive';
  /** What of the reach description it uses. */
  needs: ('table' | 'moves' | 'simulator')[];
  describe: string;
  /** Verdicts of the validators run before it (a route bot plays the solver's route). */
  validate(t: ValidationTarget, before: Readonly<Record<string, Verdict>>): Verdict;
}

const pass = (covered: string[], evidence?: Verdict['evidence']): Verdict => ({ state: 'pass', covered, problems: [], ...(evidence ? { evidence } : {}) });

const layout: Validator = {
  id: 'layout',
  strategy: 'static',
  cost: 'cheap',
  needs: [],
  describe: 'A way to win, the start on safe ground, riders not crushed',
  validate({ project, sceneId, registry }) {
    const problems: string[] = [];
    for (const p of winProblems(project, sceneId, registry)) problems.push(p.text);
    for (const p of layoutProblems(project, sceneId, registry)) problems.push(p.text);
    const start = startConflicts(project, sceneId, registry);
    if (start && (start.solid.length || start.hurts.length)) problems.push(`the player starts inside or next to ${[...start.solid, ...start.hurts].map((x) => x.name).join(', ')}`);
    return problems.length ? { state: 'fail', covered: ['layout'], problems } : pass(['layout']);
  },
};

const checker: Validator = {
  id: 'checker',
  strategy: 'analytical',
  cost: 'cheap',
  needs: ['table'],
  describe: "Everything needed is reachable with the player's jump arcs, ladders, springs",
  validate({ project, sceneId, registry, judged, reach, mechanics }) {
    const covered = reach?.covers.table ?? [];
    const r = levelReachability(judged ?? project, sceneId, registry);
    if (r.status === 'ok') {
      if (!r.unreachable.things.length) return pass(covered);
      // (Out of reach by jump arcs alone, with abilities the arcs don't know: not proof, so not judged.)
      const beyond = mechanics.filter((m) => !covered.includes(m));
      if (reach?.table && beyond.length) return { state: 'unknown', covered, unjudged: beyond, problems: [`the jump checker doesn't judge ${beyond.join(' and ')}`] };
      return { state: 'fail', covered, problems: [`the player can't get to ${r.unreachable.things.map((t) => t.name).join(', ')}`] };
    }
    if (r.status === 'uncertain') return { state: 'unknown', covered: [], problems: [r.why] };
    return { state: 'fail', covered, problems: [r.status === 'no-player' ? 'there is no player' : 'the player has no ground to stand on'] };
  },
};

const cellSolver: Validator = {
  id: 'cell_solver',
  strategy: 'solver',
  cost: 'moderate',
  needs: ['moves'],
  describe: 'A route to the goal cell by cell, with keys, switches, crates and plates in order',
  validate({ grid, reach }) {
    const sr = reach && solverReach(reach);
    if (!grid || !sr) return { state: 'unknown', covered: [], problems: [!grid ? 'no cell grid of the level to search' : "the player's movement has no move rules"] };
    const solved = solveLevel(grid, sr);
    if (!solved.goal || solved.unreached.length)
      return { state: 'fail', covered: reach!.covers.moves, problems: [`the route solver ${!solved.goal ? "can't get to the goal" : `can't get to ${solved.unreached.map((u) => `the ${u.role} at ${u.col},${u.row}`).join(', ')}`}`] };
    return pass(reach!.covers.moves, { route: solved.path });
  },
};

/** The puzzle pieces a level can be won without (each taken away in turn and the level solved again). */
export function unneededPuzzles(grid: LevelGrid, reach: Parameters<typeof solveLevel>[1]): string[] {
  const out: string[] = [];
  const without = (change: (g: LevelGrid) => void) => {
    const g = grid.clone();
    change(g);
    return solveLevel(g, reach).goal;
  };
  for (const p of grid.placed) {
    if (p.role !== 'switch' && p.role !== 'key') continue;
    if (without((g) => g.unplace(p.ref))) out.push(`the ${p.role === 'switch' ? 'lever' : 'key'} at ${p.col},${p.row}`);
  }
  for (const l of grid.links) {
    if (l.type !== 'teleports_to') continue;
    if (without((g) => g.unplace(l.from))) out.push(`the teleporter ${l.from}`);
  }
  grid.rows().forEach((row, r) =>
    [...row].forEach((ch, c) => {
      if (ch === 'C' && without((g) => g.clear(c, r, c, r))) out.push(`the crate at ${c},${r}`);
    }),
  );
  return out;
}

const puzzleNeeded: Validator = {
  id: 'puzzle_needed',
  strategy: 'solver',
  cost: 'moderate',
  needs: ['moves'],
  describe: 'Every lever, key, crate and teleporter is needed',
  validate({ grid, reach }) {
    const sr = reach && solverReach(reach);
    if (!grid || !sr) return { state: 'unknown', covered: [], problems: ['no cell grid of the level to search'] };
    const spare = unneededPuzzles(grid, sr);
    return spare.length ? { state: 'fail', covered: ['puzzle'], problems: [`it can be won without ${spare.join(', ')}`] } : pass(['puzzle']);
  },
};

/** The route bot's runner: set by the runtime side (runtime/routeBot.ts) so core code needn't load the runtime. */
let botRunner: ((project: Project, sceneId: Id, route: SolveResult['path'], registry: ComponentRegistry, maxSeconds?: number) => { won: boolean; skipped?: string; stuck?: { move: string } }) | null = null;
export function setRouteBot(run: typeof botRunner): void {
  botRunner = run;
}

const routeBot: Validator = {
  id: 'route_bot',
  strategy: 'simulation',
  cost: 'expensive',
  needs: ['simulator'],
  describe: 'Plays the route solver\'s route on the real runtime, with a player\'s controls',
  validate({ project, sceneId, registry, reach, botSeconds }, before) {
    const route = before.cell_solver?.evidence?.route;
    if (!botRunner) return { state: 'unknown', covered: [], problems: ['the route bot is not loaded here'] };
    if (!route) return { state: 'unknown', covered: [], problems: ['no route to play (the route solver found none)'] };
    if (botSeconds !== undefined && botSeconds <= 0) return { state: 'unknown', covered: [], problems: ["the route bot's time budget for this build is used up"] };
    const r = botRunner(project, sceneId, route, registry, botSeconds);
    if (r.won) return pass(reach?.covers.simulator ?? []);
    // (A bot that couldn't do a step proves nothing about a player: not judged.)
    return { state: 'unknown', covered: [], problems: [r.skipped ? `the route bot didn't play it: ${r.skipped}` : `the route bot couldn't do a ${r.stuck?.move ?? 'step'} on the way`] };
  },
};

export const VALIDATORS: readonly Validator[] = [layout, checker, cellSolver, puzzleNeeded, routeBot];
export const validatorById = (id: string) => VALIDATORS.find((v) => v.id === id);

const COST = { cheap: 0, moderate: 1, expensive: 2 };

/**
 * The validators for a level (§8.4): the static ones always; the ones its level builder (or the editor) requires;
 * then, for mechanics the reach description's table doesn't cover, the route solver where its moves do (and the
 * route bot for those the moves only estimate). Cheapest first. `notes`: mechanics nothing here can judge.
 */
export function chooseValidators(required: readonly string[], t: Pick<ValidationTarget, 'reach' | 'mechanics' | 'grid'>): { ids: string[]; notes: string[] } {
  const ids = new Set<string>(['layout', ...required]);
  const notes: string[] = [];
  const reach = t.reach;
  const beyond = reach ? t.mechanics.filter((m) => !reach.covers.table.includes(m)) : [];
  if (reach && beyond.length) {
    const byMoves = beyond.filter((m) => reach.covers.moves.includes(m));
    if (byMoves.length && t.grid) ids.add('cell_solver');
    const estimated = byMoves.filter((m) => reach.approximate.includes(m));
    if (estimated.length && t.grid && reach.simulator && estimated.every((m) => reach.covers.simulator.includes(m))) ids.add('route_bot');
    const unjudged = beyond.filter((m) => !t.grid || !reach.covers.moves.includes(m));
    if (unjudged.length) notes.push(`${unjudged.join(' and ')} ${unjudged.length > 1 ? "aren't" : "isn't"} judged here (${!t.grid ? 'no cell grid of the level for the route solver' : 'nothing covers it'})`);
  }
  const order = (id: string) => {
    const v = validatorById(id);
    return v ? COST[v.cost] * 10 + VALIDATORS.indexOf(v) : 99;
  };
  return { ids: [...ids].filter((id) => validatorById(id)).sort((a, b) => order(a) - order(b)), notes };
}

export interface Validation {
  state: 'validated' | 'uncertain' | 'invalid';
  problems: string[];
  verdicts: Record<string, Verdict>;
  /** What couldn't be judged, and why. */
  uncertain: string[];
}

/**
 * Runs validators in order, stopping at the first that fails (its problems, with those of the cheap static and
 * analytical ones before it, are the level's). A route through moves only estimated, not confirmed by the route bot,
 * leaves the level uncertain.
 */
export function runValidators(ids: readonly string[], t: ValidationTarget, notes: readonly string[] = [], before: Readonly<Record<string, Verdict>> = {}): Validation {
  // (`before`: verdicts already given, for a validator run afterwards: the route bot on the solver's route.)
  const verdicts: Record<string, Verdict> = { ...before };
  const problems: string[] = [];
  const uncertain = [...notes];
  /** Unknowns that only say "I don't judge these mechanics": settled below, if a stronger validator judged them. */
  const waiting: { mechanics: string[]; problems: string[] }[] = [];
  const searches = (v: Validator) => v.strategy === 'solver' || v.strategy === 'simulation';
  for (const id of ids) {
    const v = validatorById(id)!;
    // (The cheap static and analytical checks report together, as they always did; no search runs after a problem.)
    if (problems.length && searches(v)) break;
    const verdict = v.validate(t, verdicts);
    verdicts[id] = verdict;
    if (verdict.state === 'fail') {
      problems.push(...verdict.problems);
      if (searches(v)) break;
    } else if (verdict.state === 'unknown') {
      if (verdict.unjudged?.length) waiting.push({ mechanics: verdict.unjudged, problems: verdict.problems });
      else uncertain.push(...verdict.problems);
    }
  }
  if (problems.length) return { state: 'invalid', problems, verdicts, uncertain };
  // (Estimated moves the level needs, or that the solver's route took.)
  // (A move by the rule that makes it: a wall jump's rule also makes "wall_slide".)
  const ruleOf = (move: string) => t.reach?.moves?.find((r) => r.makes?.includes(move))?.id ?? move;
  const taken = new Set((verdicts.cell_solver?.evidence?.route ?? []).map((p) => ruleOf(p.move)));
  const estimated = t.reach?.approximate.filter((m) => t.mechanics.includes(m) || taken.has(m as never)) ?? [];
  const solved = verdicts.cell_solver?.state === 'pass';
  const played = verdicts.route_bot?.state === 'pass';
  if (estimated.length && solved && !played) uncertain.push(`the route through ${estimated.join(' and ')} is only estimated (not played)`);
  // What a cheaper validator couldn't judge is settled when the route solver covers it and found the way (and, for
  // estimated moves, the route was played); else it stays unjudged.
  for (const w of waiting) {
    const settled = solved && w.mechanics.every((m) => verdicts.cell_solver!.covered.includes(m)) && (played || !w.mechanics.some((m) => t.reach?.approximate.includes(m)));
    if (!settled) uncertain.push(...w.problems);
  }
  return { state: uncertain.length ? 'uncertain' : 'validated', problems: [], verdicts, uncertain };
}
