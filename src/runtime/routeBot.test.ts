import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { applyOperations } from '../core/commands/operations';
import { createProject } from '../core/model/factory';
import { generateLevel } from '../core/levelGen/generate';
import { LevelGrid, ROLE_CHARS } from '../core/levelGen/grid';
import { playerLimits } from '../core/levelGen/limits';
import { findRoles, type Role } from '../core/levelGen/roles';
import { solveLevel } from '../core/levelGen/solver';
import { STRUCTURES } from '../core/levelGen/blueprint';
import { playRoute } from './routeBot';

const registry = createBuiltinRegistry();
const base = createProject(registry);
const roles = findRoles(base, registry);
const lim = playerLimits(base, base.scenes[0].id, roles.player!.id, registry, 5)!;
const byChar = new Map(Object.entries(ROLE_CHARS).map(([r, ch]) => [ch, r as Role]));

/** A level from rows of role characters, as the game has it (applied), and its grid. */
function level(rows: string[]) {
  const g = new LevelGrid(rows[0].length, rows.length, roles);
  rows.forEach((row, r) => [...row].forEach((ch, c) => ch !== '.' && g.fill(byChar.get(ch)!, c, r, c, r)));
  const p = produce(base, (d) => void applyOperations(d, g.toOperations(d.scenes[0].id), registry));
  return { p, g };
}

describe('the route bot: playing a level on the real runtime', () => {
  it('runs, jumps gaps and steps, climbs a ladder, and gets to the goal along the solver’s route', () => {
    const { p, g } = level(['..............', '...........G..', '........#H####', '.........H....', '.P....##.H....', '###..#########']);
    const route = solveLevel(g, lim);
    expect(route.goal).toBe(true);
    const r = playRoute(p, p.scenes[0].id, route.path, registry);
    expect(r).toMatchObject({ won: true });
  });

  it('a jump the level checker would not see as too wide for the real arc fails in play (a route forced over a 6-cell gap)', () => {
    const { p } = level(['............', '.P.......G..', '###......###']);
    const r = playRoute(p, p.scenes[0].id, [{ col: 1, row: 1, move: 'start' }, { col: 9, row: 1, move: 'jump' }], registry);
    expect(r.won).toBe(false);
    expect(r.stuck?.move).toBe('jump');
  });

  it('levels the engine builds are won in play (all structures; levels with moving platforms skipped, enemies left out: the bot does not fight)', { timeout: 120000 }, () => {
    let played = 0;
    let won = 0;
    let skipped = 0;
    const lost: string[] = [];
    for (const structure of STRUCTURES)
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        let grid: LevelGrid | null = null;
        const built = generateLevel(base, base.scenes[0].id, { difficulty: 3, structure, seed, length: 'short', avoid: ['enemy'] }, registry, 'classic', { onBuilt: (gr) => (grid = gr), candidates: 1 });
        const p = produce(base, (d) => void applyOperations(d, built.ops, registry));
        const r = playRoute(p, p.scenes[0].id, solveLevel(grid!, lim).path, registry);
        if (r.skipped) {
          skipped++;
          continue;
        }
        played++;
        if (r.won) won++;
        else lost.push(`${structure} seed ${seed}: ${r.stuck?.move} ${JSON.stringify(r.stuck?.from)}→${JSON.stringify(r.stuck?.to)}`);
      }
    // (The bot is simpler than a player: a few misses are its own; most levels must be won.)
    expect(won / played, `won ${won} of ${played} (${skipped} skipped): ${lost.join('; ')}`).toBeGreaterThanOrEqual(0.8);
    expect(played).toBeGreaterThanOrEqual(25);
  });
});
