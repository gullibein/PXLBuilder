/**
 * F4's non-regression goldens (docs/engine-architecture-proposal.md §19): what level validation says about a game
 * of every family, and what the level builder makes and its route solver finds for classic and puzzle levels.
 * Recorded before the reach model and the validators moved behind their interfaces; they must stay identical.
 * (REGRESSION_RECORD=1 prints them.)
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { projectFromPreset, setGameProfile } from '../core/engine/profile';
import { generateLevel } from '../core/levelGen/generate';
import type { LevelGrid } from '../core/levelGen/grid';
import { playerLimits } from '../core/levelGen/limits';
import { findRoles } from '../core/levelGen/roles';
import { solveLevel } from '../core/levelGen/solver';
import { layoutProblems, levelReachability, reachabilityProblems, startConflicts, winProblems } from '../core/model/reachability';
import type { Project } from '../core/types';
import { produce } from 'immer';
import { boulderDash, mining, spaceShooter } from './games/action';
import { drMario, tetris } from './games/boards';
import { digRoom } from './games/digging';
import { mapLevel, marioLevel } from './games/platformers';
import { precisionRoom } from './games/precision';
import { withSeed } from './harness';

const registry = createBuiltinRegistry();
const RECORD = !!process.env.REGRESSION_RECORD;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const golden = (name: string, got: unknown, want: string) => {
  if (RECORD) console.log(`GOLDEN ${JSON.stringify(name)}: '${hash(got)}',`);
  else expect(hash(got), `${name}: validation changed: ${JSON.stringify(got).slice(0, 600)}`).toBe(want);
};

/** Everything level validation says about a level today (the checks the editor, the AI and the builder run). */
export function validationOf(project: Project, sceneId = project.scenes[0].id) {
  const reach = levelReachability(project, sceneId, registry);
  return {
    reach:
      reach.status === 'ok'
        ? { status: 'ok', unreachable: reach.unreachable.things.map((t) => t.name).sort(), platforms: reach.unreachable.platforms?.length ?? 0 }
        : reach.status === 'uncertain'
          ? { status: 'uncertain', why: reach.why }
          : { status: reach.status },
    win: winProblems(project, sceneId, registry).map((p) => p.key),
    layout: layoutProblems(project, sceneId, registry).map((p) => p.key),
    start: startConflicts(project, sceneId, registry),
    // (Object ids are made new each time: left out.)
    problems: reachabilityProblems(project, sceneId, registry).map((p) => `${p.key.replace(/:.*$/, '')}: ${p.text}`),
  };
}

/** The games of the regression suite, every family. */
export const VALIDATED_GAMES: Record<string, () => Project> = {
  'mario: generated level': () => withSeed(1, () => marioLevel(registry, 21).project),
  'mario: stomp and block': () => mapLevel(registry, ['..........', '..........', '....?.....', '..........', '.P....E...', '##########']),
  tetris: () => tetris(registry, [{ col: 2, row: 18 }]),
  'dr mario': () => drMario(registry, [{ col: 3, row: 14, color: 'red' }]),
  'space shooter': () => spaceShooter(registry),
  mining: () => mining(registry),
  'boulder dash': () => boulderDash(registry),
  'celeste-inspired': () => precisionRoom(registry),
  'celeste-inspired, no abilities': () => precisionRoom(registry, []),
  'lode-runner-inspired': () => digRoom(registry),
  'top-down starter': () => projectFromPreset('topdown', registry),
  'rpg starter': () => projectFromPreset('rpg', registry),
  'roguelike starter': () => projectFromPreset('roguelike', registry),
  'isometric starter': () => projectFromPreset('isometric', registry),
};

const VALIDATION: Record<string, string> = {
  // (The classic builder's version 3: this seed's first build, thrown away before, is now the level. Before: '52a305319a3fec17'.)
  'mario: generated level': 'dff1429562a45dfb',
  'mario: stomp and block': 'fe346746f20b6904',
  tetris: 'a7b3607edbd79a55',
  'dr mario': 'a7b3607edbd79a55',
  'space shooter': '833fa133befcdbe6',
  mining: '5aef7d5598682282',
  'boulder dash': 'f66d9e1f77b2bddd',
  'celeste-inspired': '15d82715e7d0ed27',
  'celeste-inspired, no abilities': '15d82715e7d0ed27',
  'lode-runner-inspired': 'e0e6925a22f91ac4',
  'top-down starter': 'a7b3607edbd79a55',
  'rpg starter': 'ed06791ad1afecb6',
  'roguelike starter': '6d02212acf74d5a3',
  'isometric starter': 'ed06791ad1afecb6',
};

/** Classic and puzzle levels the builder makes (seeds and difficulties), with what its route solver finds on each. */
export function sweep(genre: 'classic' | 'puzzle', seeds: number[], difficulties: number[]) {
  const base = produce(projectFromPreset(genre === 'puzzle' ? 'puzzle-platformer' : 'classic-platformer', registry, 'Sweep'), (d) => void setGameProfile(d, { theme: 'forest' }, registry));
  const sceneId = base.scenes[0].id;
  const reach = playerLimits(base, sceneId, findRoles(base, registry).player!.id, registry, 5)!;
  const out: unknown[] = [];
  for (const difficulty of difficulties)
    for (const seed of seeds) {
      let grid: LevelGrid | null = null;
      try {
        const r = generateLevel(base, sceneId, { difficulty, structure: 'run', length: 'short', seed }, registry, genre, { onBuilt: (g) => (grid = g), candidates: 1 });
        const solved = grid ? solveLevel(grid, reach) : null;
        out.push({ seed, difficulty, rows: hash(r.rows), state: r.state, attempts: r.attempts, notes: r.notes, solved: solved && { goal: solved.goal, states: solved.states, path: solved.path.map((p) => `${p.move}@${p.col},${p.row}`).join(' '), unreached: solved.unreached } });
      } catch (e) {
        out.push({ seed, difficulty, error: (e as Error).message });
      }
    }
  return out;
}

const SWEEPS: Record<string, string> = {
  classic: '691be8e21782751f',
  puzzle: 'aa3430d4125ed190',
};

describe('F4 non-regression: level validation of every family, and the level builder\'s sweeps', () => {
  it('what validation says about each game of the regression suite (boards, shooters, mining, Boulder Dash, platformers, starters) is unchanged', () => {
    for (const [name, make] of Object.entries(VALIDATED_GAMES)) golden(`validation: ${name}`, validationOf(make()), VALIDATION[name]);
  });

  it('classic and puzzle levels: what the builder makes, whether it is validated, and the route the solver finds, are unchanged', () => {
    golden('sweep: classic', sweep('classic', [1, 2, 3, 4, 5, 6], [2, 4]), SWEEPS.classic);
    golden('sweep: puzzle', sweep('puzzle', [1, 2, 3, 4, 5, 6], [3]), SWEEPS.puzzle);
  });
});
