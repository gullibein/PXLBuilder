/**
 * F4: the reach model and pluggable validation (docs/engine-architecture-proposal.md §19). The movement setup
 * publishes a reach description (table, moves, simulator, and what each covers); the route solver's moves come
 * from it, wall jumps and dashes included; validators are chosen by what the level's mechanics need, and a level
 * nothing can judge is uncertain, never validated.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import '../../runtime/routeBot';
import { boulderDash, mining, spaceShooter } from '../../regression/games/action';
import { drMario, tetris } from '../../regression/games/boards';
import { mapGrid, mapLevel } from '../../regression/games/platformers';
import { PRECISION_ROOM, precisionRoom } from '../../regression/games/precision';
import { createBuiltinRegistry } from '../components/builtin';
import { modules } from '../engine/modules';
import { projectFromPreset, setGameProfile } from '../engine/profile';
import { ARCADE_MOVES } from '../levelGen/moves';
import { findRoles } from '../levelGen/roles';
import { solveLevel } from '../levelGen/solver';
import { instantiateDefinition } from '../model/factory';
import { jumpTable, reachabilityProblems } from '../model/reachability';
import { resolveEntity } from '../model/resolve';
import { arcadeMechanics, playerReach, reachOf, solverReach } from '../reach/reach';
import type { Project } from '../types';
import { levelPlayerReach, levelReachProblems } from './levelProblems';
import { chooseValidators, runValidators, VALIDATORS, type ValidationTarget } from './validators';

const registry = createBuiltinRegistry();

const reachIn = (p: Project) => playerReach(p, p.scenes[0].id, findRoles(p, registry).player!.id, registry)!;

/** A target for the validators: a room drawn as a map, its grid, its player's reach, its abilities as mechanics. */
function target(p: Project, rows: string[]): ValidationTarget {
  const reach = reachIn(p);
  return { project: p, sceneId: p.scenes[0].id, registry, grid: mapGrid(p, registry, rows), reach, mechanics: reach.abilities };
}

/** A shaft seven rows high (walls both sides), only climbed with wall jumps; the goal at its top. */
const SHAFT = [
  '...............',
  '.......G.......',
  '......#..#.....',
  '......#..#.....',
  '......#..#.....',
  '......#..#.....',
  '......#..#.....',
  '......#..#.....',
  '..P.......#....',
  '###############',
];
/** A spiked pit five cells wide, wider than the jump: only crossed with a dash. */
const PIT = ['..............', '..............', '..P........G..', '#####.....####', '#####^^^^^####', '##############'];

/** The room with the player given these abilities through the game's profile. */
const room = (rows: string[], abilities: string[]) =>
  produce(mapLevel(registry, rows), (d) => {
    setGameProfile(d, { abilities }, registry);
    const dash = d.definitions.find((x) => x.name === 'Player')!.components.Dash as Record<string, unknown> | undefined;
    if (dash) Object.assign(dash, { speed: 560, duration: 0.22 });
  });

describe('F4: reach descriptions', () => {
  it('the arcade model publishes the jump table it always had, the arcade moves, and the route bot; what each covers', () => {
    const p = projectFromPreset('platformer', registry);
    const r = reachIn(p);
    const player = resolveEntity(p, instantiateDefinition(p.definitions.find((d) => d.id === findRoles(p, registry).player!.id)!, { x: 0, y: 0 }), registry);
    expect(r.model).toBe('arcade');
    expect(r.table).toEqual(jumpTable(player.components, p.scenes[0].world.gravity.y));
    expect(r.moves!.map((m) => m.id)).toEqual(ARCADE_MOVES.map((m) => m.id));
    expect(r.simulator).toBe('route_bot');
    expect(r.covers.table).toEqual(arcadeMechanics());
    expect(r.approximate).toEqual([]);
  });

  it('abilities add their moves; the table has no closed form for them, the moves estimate them, the route bot plays them', () => {
    const r = reachIn(precisionRoom(registry));
    expect(r.abilities).toEqual(['wall_jump', 'dash']);
    expect(r.moves!.map((m) => m.id)).toEqual([...ARCADE_MOVES.map((m) => m.id), 'wall_jump', 'dash']);
    for (const a of ['wall_jump', 'dash']) {
      expect(r.covers.table).not.toContain(a);
      expect(r.covers.moves).toContain(a);
      expect(r.covers.simulator).toContain(a);
    }
    expect(r.approximate).toEqual(['wall_jump', 'dash']);
  });

  it('seen from above there is nothing to tabulate or search: no table, no moves (the checker walks top-down levels its own way)', () => {
    const p = projectFromPreset('topdown', registry);
    const r = reachIn(p)!;
    expect(r).toMatchObject({ model: 'topdown', table: null, moves: null, simulator: null });
    expect(reachOf({}, 980)).toBeNull();
  });
});

describe('F4: the route solver with the reach description\'s moves', () => {
  it('a shaft only wall jumps climb: solvable with WallJump, not without; the route bot climbs it on the real runtime', () => {
    const without = target(room(SHAFT, []), SHAFT);
    expect(solveLevel(without.grid!, solverReach(without.reach!)!).goal).toBe(false);
    const withIt = target(room(SHAFT, ['wall_jump']), SHAFT);
    const solved = solveLevel(withIt.grid!, solverReach(withIt.reach!)!);
    expect(solved.goal).toBe(true);
    expect(solved.path.map((p) => p.move)).toContain('wall_jump');
    const v = runValidators(chooseValidators([], withIt).ids, withIt);
    expect(v.verdicts.route_bot?.state).toBe('pass');
    expect(v.state).toBe('validated');
  });

  it('a pit only a dash crosses: solvable with Dash, not without; the route bot dashes over it', () => {
    expect(solveLevel(target(room(PIT, []), PIT).grid!, solverReach(reachIn(room(PIT, [])))!).goal).toBe(false);
    const t = target(room(PIT, ['dash']), PIT);
    const solved = solveLevel(t.grid!, solverReach(t.reach!)!);
    expect(solved.goal).toBe(true);
    expect(solved.path.map((p) => p.move)).toContain('dash');
    expect(runValidators(chooseValidators([], t).ids, t).state).toBe('validated');
  });

  it('the Celeste-inspired room: solvable only with both abilities (as the regression bot found by playing), and played by the route bot', () => {
    const solves = (abilities: string[]) => {
      const t = target(precisionRoom(registry, abilities), PRECISION_ROOM);
      return solveLevel(t.grid!, solverReach(t.reach!)!).goal;
    };
    expect([solves(['wall_jump', 'dash']), solves(['dash']), solves(['wall_jump']), solves([])]).toEqual([true, false, false, false]);
    const t = target(precisionRoom(registry), PRECISION_ROOM);
    const chosen = chooseValidators([], t);
    expect(chosen.ids).toEqual(['layout', 'cell_solver', 'route_bot']);
    const v = runValidators(chosen.ids, t);
    expect(v.verdicts.cell_solver.state).toBe('pass');
    expect(v.verdicts.route_bot.state).toBe('pass');
    expect(v.state).toBe('validated');
  });

  it('a route only estimated (moves the route bot did not confirm) leaves the level uncertain, never validated', () => {
    const t = target(precisionRoom(registry), PRECISION_ROOM);
    const v = runValidators(['layout', 'cell_solver'], t);
    expect(v.state).toBe('uncertain');
    expect(v.uncertain.join(' ')).toMatch(/only estimated/);
  });

  it('the same level, reach and seed give the same route (reproducible)', () => {
    const t = target(precisionRoom(registry), PRECISION_ROOM);
    const a = solveLevel(t.grid!, solverReach(t.reach!)!);
    const b = solveLevel(t.grid!, solverReach(reachIn(precisionRoom(registry)))!);
    expect(b).toEqual(a);
  });
});

describe('F4: choosing validators by coverage', () => {
  it('a classic level\'s mechanics are all in the table: the builder\'s own validators, nothing added', () => {
    const p = projectFromPreset('classic-platformer', registry);
    const t = { reach: reachIn(p), mechanics: ['walk', 'jump', 'spring', 'ladder'], grid: mapGrid(p, registry, ['P.G', '###']) };
    expect(chooseValidators(['layout', 'checker', 'cell_solver'], t)).toEqual({ ids: ['layout', 'checker', 'cell_solver'], notes: [] });
  });

  it('abilities with no grid to search (a hand-made level): said to be unjudged', () => {
    const p = precisionRoom(registry);
    const c = chooseValidators(['layout', 'checker'], { reach: reachIn(p), mechanics: ['wall_jump', 'dash'], grid: null });
    expect(c.ids).toEqual(['layout', 'checker']);
    expect(c.notes.join(' ')).toMatch(/wall_jump and dash aren't judged/);
  });

  it('boards, shooters, mining and Boulder Dash: no reach validator is ever chosen; the editor\'s level problems are exactly what they were', () => {
    const games: Project[] = [tetris(registry), drMario(registry, []), spaceShooter(registry), mining(registry), boulderDash(registry), projectFromPreset('topdown', registry), projectFromPreset('roguelike', registry)];
    for (const g of games) {
      const sceneId = g.scenes[0].id;
      const reach = levelPlayerReach(g, sceneId, registry);
      expect(chooseValidators([], { reach, mechanics: reach?.abilities ?? [], grid: null }).ids, g.name).toEqual(['layout']);
      expect(levelReachProblems(g, sceneId, registry), g.name).toEqual(reachabilityProblems(g, sceneId, registry));
    }
  });

  it('the editor: a player with wall jumps and dashes is not told "can\'t get to the Goal"; the room is said to be unjudged; without them it is told', () => {
    const withAbilities = precisionRoom(registry);
    const told = levelReachProblems(withAbilities, withAbilities.scenes[0].id, registry);
    expect(told.map((p) => p.key)).toEqual(['reach-unjudged']);
    expect(told[0].text).toMatch(/wall jumps and dashes aren't judged/);
    const plain = precisionRoom(registry, []);
    expect(levelReachProblems(plain, plain.scenes[0].id, registry).some((p) => p.key.startsWith('reach-things:'))).toBe(true);
  });

  it('validators are modules: none points to old code; each requires what it needs of the reach description', () => {
    const mods = modules.list('validator');
    expect(mods.map((m) => m.id)).toEqual(VALIDATORS.map((v) => v.id));
    expect(mods.filter((m) => m.pointsTo)).toEqual([]);
    expect(Object.fromEntries(mods.map((m) => [m.id, m.requires]))).toEqual({ layout: [], checker: ['reach:table'], cell_solver: ['reach:moves'], puzzle_needed: ['reach:moves'], route_bot: ['reach:simulator'] });
  });
});

describe('F4: the route bot plays the moves the reach description says it simulates', () => {
  it('every move a reach description\'s rules make is one the bot plays; a route with a move it can\'t play is skipped, said', async () => {
    const { botMoves, playRoute } = await import('../../runtime/routeBot');
    const r = reachIn(precisionRoom(registry));
    const made = new Set<string>(['wall_slide']);
    for (const m of r.moves!) made.add(m.id);
    for (const id of made) expect(botMoves(), id).toContain(id as never);
    const p = mapLevel(registry, ['P.G', '###']);
    expect(playRoute(p, p.scenes[0].id, [{ col: 0, row: 0, move: 'start' }, { col: 2, row: 0, move: 'grapple' as never }], registry)).toMatchObject({ won: false, skipped: "it can't play a grapple move" });
  });
});
