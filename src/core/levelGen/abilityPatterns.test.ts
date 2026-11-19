/**
 * V1.4: ability patterns in breadth (docs/engine-architecture-proposal.md §24.6). Six sections that need more than
 * the jump, each a different thing to do. For every one: it is built only for a player that has what it requires;
 * the route solver finds the way, through the ability's own moves; the route bot plays it on the real runtime; and
 * without any one of the abilities it requires, there is no way (each ability by itself: a section that requires two
 * needs both). Players without abilities get exactly the levels they got before; building stays within its budgets.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { playRoute } from '../../runtime/routeBot';
import { applyOperations } from '../commands/operations';
import { createBuiltinRegistry } from '../components/builtin';
import { projectFromPreset, setGameProfile } from '../engine/profile';
import { playerReach, solverReach } from '../reach/reach';
import type { Project } from '../types';
import { generateLevel, type GenerateResult } from './generate';
import type { LevelGrid } from './grid';
import { allPatterns, patternById, registerPattern, unregisterPattern } from './patterns/index';
import { findRoles } from './roles';
import { solveLevel, type SolveResult } from './solver';

const registry = createBuiltinRegistry();

/** The classic platformer with these abilities (and changes to their components). */
function game(abilities: string[], tune: Record<string, Record<string, unknown>> = {}, preset = 'classic-platformer'): Project {
  return produce(projectFromPreset(preset, registry), (d) => {
    setGameProfile(d, { theme: 'forest', abilities }, registry);
    const player = d.definitions.find((x) => x.name === 'Player')!;
    for (const [component, values] of Object.entries(tune)) Object.assign(player.components[component] as object, values);
  });
}
const reachOf = (p: Project) => playerReach(p, p.scenes[0].id, findRoles(p, registry).player!.id, registry)!;
const PLAIN = game([]);
const DASH = game(['dash']);
const WALL = game(['wall_jump']);
const BOTH = game(['wall_jump', 'dash']);
const WITH: Record<string, Project> = { '': PLAIN, dash: DASH, wall_jump: WALL, 'dash,wall_jump': BOTH };
/** The same game without one of its abilities. */
const without = (abilities: string[], one: string) => WITH[abilities.filter((a) => a !== one).sort().join(',')];

function build(p: Project, blueprint: Record<string, unknown>, genre = 'classic'): { r: GenerateResult; grid: LevelGrid; sections: string[] } {
  let grid: LevelGrid | null = null;
  const r = generateLevel(p, p.scenes[0].id, { difficulty: 3, ...blueprint }, registry, genre, { candidates: 1, onBuilt: (g) => (grid = g) });
  return { r, grid: grid!, sections: (r.madeBy.fingerprint as { sections: string[] }).sections };
}
const has = (sections: string[], pattern: string) => sections.some((s) => s.includes(`:${pattern}/`));
const count = (sections: string[], pattern: string) => sections.filter((s) => s.includes(`:${pattern}/`)).length;
const solve = (grid: LevelGrid, p: Project) => solveLevel(grid, solverReach(reachOf(p))!);

/**
 * What the route does with the abilities, in order: each of their moves with what makes it what it is ("far": across
 * more than a jump clears; "up": higher than a jump gets; "wall": it ends holding a wall), a jump onto a wall, and a
 * jump that follows a kick (off the ledge the kick landed on).
 */
function doing(path: SolveResult['path']): string[] {
  const lim = reachOf(PLAIN).limits!(5);
  const out: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    // (Only the abilities' moves and jumps: the rest of the level's furniture, a ladder, a spring, is not the section's.)
    if (b.move !== 'dash' && b.move !== 'wall_jump' && b.move !== 'jump') continue;
    const far = Math.abs(b.col - a.col) - 1 > lim.gap(0);
    const up = a.row - b.row > lim.maxRise;
    if (b.move === 'jump' && !b.mode) {
      // (A plain jump counts only when it follows a kick: the jump from the ledge the kick landed on.)
      if (out.at(-1) === 'wall_jump') out.push('jump');
      continue;
    }
    out.push(`${b.move}${far ? ':far' : ''}${up ? ':up' : ''}${b.mode ? ':wall' : ''}`);
  }
  // (A climb between two walls is as many kicks as it is high: one kind of thing.)
  return out.filter((m, i) => !(m.startsWith('wall_jump') && out[i - 1]?.startsWith('wall_jump')));
}

/** The six, with who they are for, the variants to try, and what the player does in each. */
const PATTERNS: { id: string; needs: string[]; variants: (string | null)[]; does: string[] }[] = [
  { id: 'dash_gap', needs: ['dash'], variants: ['plain', 'spikes'], does: ['dash:far'] },
  { id: 'dash_rise', needs: ['dash'], variants: ['cliff', 'wall'], does: ['dash:up'] },
  { id: 'wall_shaft', needs: ['wall_jump'], variants: [null], does: ['jump:wall', 'wall_jump'] },
  { id: 'kick_back', needs: ['wall_jump'], variants: ['block', 'oneway'], does: ['jump:wall', 'wall_jump', 'jump'] },
  { id: 'dash_shaft', needs: ['dash', 'wall_jump'], variants: [null], does: ['dash:up:wall', 'wall_jump'] },
  { id: 'dash_cling', needs: ['dash', 'wall_jump'], variants: ['pit', 'spikes'], does: ['dash:far:wall', 'wall_jump', 'jump'] },
];
const forPattern = (needs: string[]) => WITH[[...needs].sort().join(',')];

describe('V1.4: six sections that need more than the jump, each a different thing to do', () => {
  it('the patterns that require a capability: these six, two of them requiring both', () => {
    const requiring = allPatterns().filter((p) => p.requires?.length);
    expect(requiring.map((p) => p.id).sort()).toEqual(PATTERNS.map((p) => p.id).sort());
    for (const p of PATTERNS) expect([...patternById(p.id)!.requires!].sort(), p.id).toEqual([...p.needs].sort());
    expect(PATTERNS.filter((p) => p.needs.length === 2).map((p) => p.id)).toEqual(['dash_shaft', 'dash_cling']);
    // (What each is about, for a level's focus: the abilities it requires.)
    for (const p of PATTERNS) expect([...patternById(p.id)!.mechanics].sort(), p.id).toEqual([...p.needs].sort());
  });

  it('what the player does differs from one to the next: six different sequences of moves, not one obstacle in six sizes', () => {
    const seen = new Map<string, string>();
    for (const p of PATTERNS) {
      const who = forPattern(p.needs);
      const { grid, sections } = build(who, { seed: 2, structure: 'run', length: 'short', sections: [{ pattern: p.id, ...(p.variants[0] ? { variant: p.variants[0] } : {}) }] });
      expect(has(sections, p.id), p.id).toBe(true);
      const moves = doing(solve(grid, who).path);
      expect(moves, p.id).toEqual(p.does);
      seen.set(p.id, moves.join(' > '));
    }
    expect(new Set(seen.values()).size).toBe(PATTERNS.length);
  });
});

describe('V1.4: each section, by itself: built, solved through the ability, played by the bot, and needing every ability it requires', () => {
  for (const p of PATTERNS)
    for (const variant of p.variants) {
      const name = `${p.id}${variant ? `/${variant}` : ''}`;
      it(`${name} (requires ${p.needs.join(' and ')})`, { timeout: 120000 }, () => {
        const who = forPattern(p.needs);
        let builtTimes = 0;
        for (const seed of [1, 2, 3, 4, 5])
          for (const difficulty of [2, 4]) {
            const what = `${name} seed ${seed} difficulty ${difficulty}`;
            const { r, grid, sections } = build(who, { seed, difficulty, structure: 'run', length: 'short', sections: [{ pattern: p.id, ...(variant ? { variant } : {}) }] });
            // (Whatever was built is validated; where this section had no room, another took its place, and that is said.)
            expect(r.state, what).toBe('validated');
            if (!has(sections, p.id)) {
              expect(r.notes.join(' '), what).toMatch(new RegExp(`pattern "${p.id}" can't be built here`));
              continue;
            }
            builtTimes++;
            // The solver's route goes through the moves of every ability it requires…
            const route = solve(grid, who);
            expect(route.goal, what).toBe(true);
            for (const ability of p.needs) expect(route.path.map((q) => q.move), what).toContain(ability);
            // …the level says so, and that the bot played it…
            expect(r.notes.join(' '), what).toMatch(new RegExp(`it needs the player's ${p.needs.join(' and ')}`));
            expect(r.notes.join(' '), what).toMatch(/the route bot played it to the goal/);
            // …it is played here too, on the level as the editor would have it…
            const level = produce(who, (d) => void applyOperations(d, r.ops, registry));
            const played = playRoute(level, level.scenes[0].id, route.path, registry);
            expect(played.won, `${what}: the bot ${played.stuck ? `got stuck on a ${played.stuck.move}` : 'did not win'}`).toBe(true);
            // …and without any ONE of the abilities it requires, there is no way to the goal.
            for (const ability of p.needs) expect(solve(grid, without(p.needs, ability)).goal, `${what}: without ${ability}`).toBe(false);
            expect(solve(grid, PLAIN).goal, `${what}: without any`).toBe(false);
          }
        // (Built most of the time when asked for by name: ten tries here.)
        expect(builtTimes, name).toBeGreaterThanOrEqual(7);
      });
    }

  it('the two that require both abilities need both: a player with the dash alone, or with wall jumps alone, has no way', { timeout: 60000 }, () => {
    for (const id of ['dash_shaft', 'dash_cling'])
      for (const seed of [1, 2, 3]) {
        const { grid, sections } = build(BOTH, { seed, structure: 'run', length: 'short', sections: [{ pattern: id }] });
        expect(has(sections, id), `${id} seed ${seed}`).toBe(true);
        expect([solve(grid, BOTH).goal, solve(grid, DASH).goal, solve(grid, WALL).goal, solve(grid, PLAIN).goal], `${id} seed ${seed}`).toEqual([true, false, false, false]);
        // (Both moves are in the route, the dash first: it is what gets the player to the wall.)
        const moves = solve(grid, BOTH).path.map((q) => q.move).filter((m) => m === 'dash' || m === 'wall_jump');
        expect(moves.slice(0, 2), `${id} seed ${seed}`).toEqual(['dash', 'wall_jump']);
      }
  });
});

describe('V1.4: only for a player that has what a section requires', () => {
  it('asked for by name for a player without it: another section takes its place, and that is said; never in free levels', { timeout: 120000 }, () => {
    const lacking: [Project, string[]][] = [
      [PLAIN, ['dash_gap', 'dash_rise', 'wall_shaft', 'kick_back', 'dash_shaft', 'dash_cling']],
      [DASH, ['wall_shaft', 'kick_back', 'dash_shaft', 'dash_cling']],
      [WALL, ['dash_gap', 'dash_rise', 'dash_shaft', 'dash_cling']],
    ];
    for (const [p, ids] of lacking) {
      for (const id of ids) {
        const named = build(p, { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: id }] });
        expect(has(named.sections, id), id).toBe(false);
        expect(named.r.notes.join(' '), id).toMatch(new RegExp(`pattern "${id}" can't be built here`));
        expect(named.r.state, id).toBe('validated');
      }
      for (let seed = 1; seed <= 8; seed++) {
        const { sections } = build(p, { seed, difficulty: seed % 2 ? 2 : 4, avoid: ['mover'] });
        for (const id of ids) expect(has(sections, id), `${id} seed ${seed}`).toBe(false);
      }
    }
  });

  it('a section is for a player who needs its ability for it: no kick back onto a ledge for one whose dash gets it up there; no dash upward for a dash that only goes sideways', { timeout: 60000 }, () => {
    // (With a dash upward the cliff a kick and a jump get up is no higher than the dash lifts: the kick isn't needed.)
    const kick = patternById('kick_back')!;
    const widthFor = (p: Project) => {
      const reach = reachOf(p);
      return kick.width(reach.limits!(3), 3, 'block', reach.capabilities, (ids) => ({ rise: ids.includes('wall_jump') && reach.capabilities.dash ? reach.limits!(5).maxRise + reach.capabilities.dash.up : reach.limits!(5).maxRise, gap: 0 }));
    };
    expect(widthFor(WALL)[0]).toBeLessThan(20);
    expect(widthFor(BOTH)[0]).toBe(Infinity);
    for (let seed = 1; seed <= 6; seed++) expect(has(build(BOTH, { seed, structure: 'run', focus: ['wall_jump'] }).sections, 'kick_back'), `seed ${seed}`).toBe(false);
    const named = build(BOTH, { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: 'kick_back' }] });
    expect(has(named.sections, 'kick_back')).toBe(false);
    // A dash that only goes sideways lifts nothing: no dash_rise, no dash_shaft; the gap it still crosses.
    const sideways = game(['wall_jump', 'dash'], { Dash: { directions: 'horizontal' } });
    expect(reachOf(sideways).capabilities.dash).toEqual({ cells: 2, up: 0 });
    for (const id of ['dash_rise', 'dash_shaft']) expect(has(build(sideways, { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: id }] }).sections, id), id).toBe(false);
    expect(has(build(sideways, { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: 'dash_gap' }] }).sections, 'dash_gap')).toBe(true);
    // (And for that player the kick is needed again: its ledge is built.)
    expect(has(build(sideways, { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: 'kick_back' }] }).sections, 'kick_back')).toBe(true);
  });

  it('sized from the abilities\' own numbers: a weaker kick, a one-cell ledge; a longer dash, a wider pit before the cliff face', { timeout: 60000 }, () => {
    const ledgeCells = (grid: LevelGrid) => Math.max(...grid.rows().map((row) => (row.match(/-+/g) ?? ['']).reduce((n, x) => Math.max(n, x.length), 0)));
    const kb = { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: 'kick_back', variant: 'oneway' }] };
    expect(ledgeCells(build(WALL, kb).grid)).toBe(2);
    expect(ledgeCells(build(game(['wall_jump'], { WallJump: { jumpX: 100 } }), kb).grid)).toBe(1);
    /** The widest run of open floor in the row under the one the player starts in. */
    const widestPit = (grid: LevelGrid) => {
      const rows = grid.rows();
      const floor = rows[rows.findIndex((r) => r.includes('P')) + 1];
      return Math.max(...(floor.replace(/^[^#]*|[^#]*$/g, '').match(/[^#]+/g) ?? ['']).map((x) => x.length));
    };
    const dc = { seed: 1, difficulty: 5, structure: 'run', length: 'medium', sections: [{ pattern: 'dash_cling', variant: 'pit' }] };
    const short = build(BOTH, dc);
    const long = build(game(['wall_jump', 'dash'], { Dash: { speed: 700, duration: 0.25 } }), dc);
    expect(has(short.sections, 'dash_cling') && has(long.sections, 'dash_cling')).toBe(true);
    const jump = reachOf(PLAIN).limits!(5).gap(0);
    // (Wider than a jump reaches the face across by a cell at least; with the longer dash, wider still.)
    expect(widestPit(short.grid)).toBe(jump + 2);
    expect(widestPit(long.grid)).toBeGreaterThan(widestPit(short.grid));
  });
});

describe('V1.4: free levels use them, one after another, within the budgets', () => {
  it('a climb after a climb: where the ground is as high as it may go, the next one starts down in a pit (two shafts in one level)', { timeout: 60000 }, () => {
    for (const seed of [1, 2, 3]) {
      const { r, grid, sections } = build(BOTH, { seed, structure: 'run', length: 'long', sections: [{ pattern: 'wall_shaft' }, { pattern: 'dash_shaft' }, { pattern: 'dash_cling' }] });
      expect(['wall_shaft', 'dash_shaft', 'dash_cling'].filter((x) => has(sections, x)), `seed ${seed}`).toEqual(['wall_shaft', 'dash_shaft', 'dash_cling']);
      expect(r.state, `seed ${seed}`).toBe('validated');
      expect(r.notes.join(' '), `seed ${seed}`).toMatch(/the route bot played it to the goal/);
      expect([solve(grid, DASH).goal, solve(grid, WALL).goal], `seed ${seed}`).toEqual([false, false]);
    }
  });

  it('levels about the abilities, on one floor: every one validated and played, and all five sections of a player with both come up', { timeout: 240000 }, () => {
    const seen: Record<string, number> = {};
    let n = 0;
    const t0 = Date.now();
    for (let seed = 1; seed <= 12; seed++)
      for (const focus of [['dash', 'wall_jump'], ['wall_jump']]) {
        const { r, sections } = build(BOTH, { seed, difficulty: seed % 2 ? 3 : 4, structure: 'run', length: seed % 3 ? 'medium' : 'long', focus, avoid: ['mover'] });
        n++;
        expect(r.state, `seed ${seed} ${focus.join('+')}`).toBe('validated');
        const used = PATTERNS.filter((p) => has(sections, p.id));
        for (const p of used) seen[p.id] = (seen[p.id] ?? 0) + count(sections, p.id);
        if (used.length) expect(r.notes.join(' '), `seed ${seed}`).toMatch(/the route bot played it to the goal/);
      }
    const each = (Date.now() - t0) / n;
    console.log(`V1.4: ${n} levels about the abilities: ${JSON.stringify(seen)}; ${each.toFixed(0)} ms each`);
    for (const id of ['dash_gap', 'dash_rise', 'wall_shaft', 'dash_shaft', 'dash_cling']) expect(seen[id] ?? 0, id).toBeGreaterThan(0);
    expect(seen.kick_back ?? 0).toBe(0);
    // (The builder's budget: well under the three seconds a level may take.)
    expect(each).toBeLessThan(3000);
  });

  it('a player with wall jumps alone gets both of its sections; one with the dash alone, both of its own', { timeout: 120000 }, () => {
    const sweep = (p: Project, focus: string) => {
      const seen = new Set<string>();
      for (let seed = 1; seed <= 10; seed++) {
        const { r, sections } = build(p, { seed, structure: 'run', length: 'medium', focus: [focus], avoid: ['mover'] });
        expect(r.state, `seed ${seed}`).toBe('validated');
        for (const q of PATTERNS) if (has(sections, q.id)) seen.add(q.id);
      }
      return [...seen].sort();
    };
    expect(sweep(WALL, 'wall_jump')).toEqual(['kick_back', 'wall_shaft']);
    expect(sweep(DASH, 'dash')).toEqual(['dash_gap', 'dash_rise']);
  });

  it('levels of several floors have room for a two-row climb only: the higher climbs are not picked there (not picked and failing)', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { r, sections } = build(BOTH, { seed, structure: 'climb', focus: ['dash', 'wall_jump'], avoid: ['mover'] });
      expect(r.state, `seed ${seed}`).toBe('validated');
      for (const id of ['wall_shaft', 'dash_shaft', 'dash_cling']) expect(has(sections, id), `${id} seed ${seed}`).toBe(false);
    }
    // (What a pattern says it climbs, for this player.)
    const reach = reachOf(BOTH);
    const measure = (ids: readonly string[]) => ({ rise: ids.includes('wall_jump') ? 3 : ids.includes('dash') ? 1 : 3, gap: 0 });
    expect(patternById('dash_shaft')!.climbs!(reach.limits!(3), reach.capabilities, measure)).toBe(4);
    expect(patternById('dash_cling')!.climbs!(reach.limits!(3), reach.capabilities, measure)).toBe(3);
  });

  it('the same seed gives the same level, verdict and notes', { timeout: 60000 }, () => {
    for (const bp of [{ seed: 7, difficulty: 4, structure: 'run', focus: ['dash', 'wall_jump'] }, { seed: 3, structure: 'run', length: 'short', sections: [{ pattern: 'dash_cling' }] }]) {
      const a = build(BOTH, bp);
      const b = build(BOTH, bp);
      expect(b.r.rows).toEqual(a.r.rows);
      expect([b.r.state, b.r.attempts, b.r.notes]).toEqual([a.r.state, a.r.attempts, a.r.notes]);
    }
  });
});

describe('V1.4: players without these abilities get exactly the levels they got', () => {
  it('classic and puzzle levels of a plain player are the same with the ability patterns as without them (row for row)', { timeout: 240000 }, () => {
    const ids = PATTERNS.map((p) => p.id);
    const puzzle = game([], {}, 'puzzle-platformer');
    const sweep = () => {
      const out: string[] = [];
      for (let seed = 1; seed <= 10; seed++) {
        out.push(build(PLAIN, { seed, difficulty: seed % 2 ? 2 : 4 }).r.rows.join('\n'));
        out.push(build(puzzle, { seed, difficulty: 3 }, 'puzzle').r.rows.join('\n'));
      }
      return out;
    };
    const withThem = sweep();
    const taken = ids.map((id) => patternById(id)!);
    try {
      for (const id of ids) unregisterPattern(id);
      expect(sweep()).toEqual(withThem);
    } finally {
      for (const p of taken) if (!patternById(p.id)) registerPattern(p);
    }
    // (A double jump and a ledge grab are in the jump table, not capabilities: their levels are sized as ever.)
    const doubler = game(['double_jump']);
    expect(reachOf(doubler).capabilities).toEqual({});
    for (let seed = 1; seed <= 4; seed++) for (const id of ids) expect(has(build(doubler, { seed }).sections, id), `${id} seed ${seed}`).toBe(false);
  });
});
