import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { LevelGrid, ROLE_CHARS } from './grid';
import { playerLimits } from './limits';
import { findRoles, type Role } from './roles';
import { solveLevel } from './solver';

const registry = createBuiltinRegistry();
const project = createProject(registry);
const roles = findRoles(project, registry);
// The starter player: jumps 1 row up, clears 4 cells level, 2 cells of spikes.
const lim = playerLimits(project, project.scenes[0].id, roles.player!.id, registry, 5)!;
const byChar = new Map(Object.entries(ROLE_CHARS).map(([r, ch]) => [ch, r as Role]));

/** A grid from rows of role characters (P player, G goal, # ground, = ledge, b brick, ^ spikes, H ladder…). */
function grid(rows: string[], placed: { role: Role; col: number; row: number; ref: string }[] = [], links: { type: 'requires' | 'controls' | 'teleports_to'; from: string; to: string }[] = []): LevelGrid {
  const g = new LevelGrid(rows[0].length, rows.length, roles);
  rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && g.fill(byChar.get(ch)!, c, r, c, r)));
  for (const p of placed) g.place(p);
  for (const l of links) g.link(l);
  return g;
}

describe('the route solver', () => {
  it('walks, jumps within reach, and gets to the goal; finds the way', () => {
    const r = solveLevel(grid(['.........', '.P....G..', '###..####']), lim);
    expect(r.goal).toBe(true);
    expect(r.path.map((p) => p.move)).toContain('jump');
    expect(r.path.at(-1)).toMatchObject({ col: 6, row: 1 });
  });

  it('a gap wider than the jump, or a step up higher than it, is not crossed', () => {
    expect(solveLevel(grid(['..........', '.P.....G..', '##.....###']), lim).goal).toBe(false);
    expect(solveLevel(grid(['......', '....G.', '...###', '.P.###', '######']), lim).goal).toBe(false);
  });

  it('what the level checker does not model: a wall in the way of a jump, a ceiling over the take-off', () => {
    // A pillar in the middle of the gap, three rows high: the jump hits it.
    expect(solveLevel(grid(['..........', '....#.....', '....#.....', '.P..#..G..', '###.#.####']), lim).goal).toBe(false);
    // Room to jump, under open sky: fine; under a ceiling right over the head: no.
    expect(solveLevel(grid(['.......', '.P..G..', '##..###']), lim).goal).toBe(true);
    expect(solveLevel(grid(['#######', '.P..G..', '##..###']), lim).goal).toBe(false);
  });

  it('spikes are never stood in; a run of them longer than the player clears is not jumped', () => {
    expect(solveLevel(grid(['.........', '.P.^^..G.', '#########']), lim).goal).toBe(true);
    expect(solveLevel(grid(['............', '.P.^^^^^^.G.', '############']), lim).goal).toBe(false);
  });

  it('ladders up, a spring to a ledge too high to jump, swimming across water', () => {
    expect(solveLevel(grid(['......', '...G..', '..H###', '..H...', '.PH...', '######']), lim).goal).toBe(true);
    expect(solveLevel(grid(['......G.', '....===.', '........', '........', '.P.S....', '########']), lim).goal).toBe(true);
    // (Without the spring, that ledge is too high.)
    expect(solveLevel(grid(['......G.', '....===.', '........', '........', '.P......', '########']), lim).goal).toBe(false);
    expect(solveLevel(grid(['............', '.P........G.', '##~~~~~~~###', '##wwwwwww###', '############']), lim).goal).toBe(true);
  });

  it('coins it can never get to are found (on top of bricks three rows up); coins over a gap are taken mid-jump', () => {
    const high = solveLevel(grid(['..........', '...ooo....', '...bbb....', '..........', '.P......G.', '##########']), lim);
    expect(high.goal).toBe(true);
    expect(high.unreached.map((u) => u.role)).toEqual(['coin', 'coin', 'coin']);
    expect(solveLevel(grid(['.........', '....o....', '.........', '.P....G..', '###..####']), lim).unreached).toEqual([]);
  });

  it('a door is a wall until its key is held: a key behind its own door is a level that cannot be won; the right order passes', () => {
    const level = ['..........', '..........', '.P......G.', '##########'];
    // The key on the near side, the door before the goal: passes.
    const ok = solveLevel(grid(level, [{ role: 'key', col: 3, row: 2, ref: 'key' }, { role: 'door', col: 6, row: 2, ref: 'door' }], [{ type: 'requires', from: 'door', to: 'key' }]), lim);
    expect(ok.goal).toBe(true);
    // The key behind the door it opens: never.
    const locked = solveLevel(grid(level, [{ role: 'key', col: 7, row: 2, ref: 'key' }, { role: 'door', col: 5, row: 2, ref: 'door' }], [{ type: 'requires', from: 'door', to: 'key' }]), lim);
    expect(locked.goal).toBe(false);
    expect(locked.unreached.map((u) => u.role).sort()).toEqual(['goal', 'key']);
  });
});
