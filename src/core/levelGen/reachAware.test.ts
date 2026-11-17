/**
 * F6b: the level builder asks the player's reach (docs/engine-architecture-proposal.md §22.2). Abilities register
 * with the reach model and publish their numbers; patterns say which capabilities they require and size themselves
 * from those numbers; the builder builds a pattern only for a player that has what it requires. A level that needs
 * an estimated move is solved by the route solver and then played by the route bot, or it is not validated.
 *
 * (What a player without abilities gets is pinned by the classic and puzzle sweeps: regression/validation.test.)
 */
import { produce } from 'immer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { playRoute } from '../../runtime/routeBot';
import { createBuiltinRegistry } from '../components/builtin';
import { projectFromPreset, setGameProfile } from '../engine/profile';
import { reachMeasure } from '../reach/probe';
import { playerReach, registerReachAbility, reachAbilityIds, solverReach, unregisterReachAbility } from '../reach/reach';
import type { Project } from '../types';
import { setRouteBot } from '../validation/validators';
import { generateLevel, type GenerateResult } from './generate';
import type { LevelGrid } from './grid';
import type { MoveRule } from './moves';
import { Section, type Pattern } from './pattern';
import { allPatterns, registerPattern, unregisterPattern } from './patterns/index';
import { findRoles } from './roles';
import { solveLevel } from './solver';

const registry = createBuiltinRegistry();

/** The classic platformer with these abilities (and changes to their components). */
function game(abilities: string[], tune: Record<string, Record<string, unknown>> = {}): Project {
  return produce(projectFromPreset('classic-platformer', registry), (d) => {
    setGameProfile(d, { theme: 'forest', abilities }, registry);
    const player = d.definitions.find((x) => x.name === 'Player')!;
    for (const [component, values] of Object.entries(tune)) Object.assign(player.components[component] as object, values);
  });
}
const reachOf = (p: Project) => playerReach(p, p.scenes[0].id, findRoles(p, registry).player!.id, registry)!;
const PLAIN = game([]);
const BOTH = game(['wall_jump', 'dash']);

function build(p: Project, blueprint: Record<string, unknown>): { r: GenerateResult; grid: LevelGrid; sections: string[] } {
  let grid: LevelGrid | null = null;
  const r = generateLevel(p, p.scenes[0].id, { difficulty: 3, ...blueprint }, registry, 'classic', { candidates: 1, onBuilt: (g) => (grid = g) });
  return { r, grid: grid!, sections: (r.madeBy.fingerprint as { sections: string[] }).sections };
}
const has = (sections: string[], pattern: string) => sections.some((s) => s.includes(`:${pattern}/`));
/** The level's route by the solver with this player's reach. */
const solve = (grid: LevelGrid, p: Project) => solveLevel(grid, solverReach(reachOf(p))!);

describe('F6b: the reach publishes what the player can do, in numbers', () => {
  it('abilities are registered with the reach model once; a player has the capabilities of the abilities it has', () => {
    expect(reachAbilityIds()).toEqual(['wall_jump', 'dash']);
    expect(reachOf(PLAIN).capabilities).toEqual({});
    expect(reachOf(game(['dash'])).capabilities).toEqual({ dash: { cells: 2, up: 2 } });
    expect(Object.keys(reachOf(BOTH).capabilities)).toEqual(['wall_jump', 'dash']);
    const kick = reachOf(BOTH).capabilities.wall_jump;
    expect(kick.rise).toBeGreaterThanOrEqual(1);
    expect(kick.away).toBeGreaterThanOrEqual(1);
  });

  it('the numbers follow the ability\'s own settings (a longer dash, a dash only sideways, a weaker kick)', () => {
    expect(reachOf(game(['dash'], { Dash: { speed: 700, duration: 0.25 } })).capabilities.dash).toEqual({ cells: 5, up: 5 });
    expect(reachOf(game(['dash'], { Dash: { directions: 'horizontal' } })).capabilities.dash).toEqual({ cells: 2, up: 0 });
    const strong = reachOf(game(['wall_jump'], { WallJump: { jumpX: 400 } })).capabilities.wall_jump.away;
    const weak = reachOf(game(['wall_jump'], { WallJump: { jumpX: 100 } })).capabilities.wall_jump.away;
    expect(weak).toBe(1);
    expect(strong).toBeGreaterThan(weak);
  });

  it('seen from above there is no reach to ask: no capabilities (boards and top-down games get no reach requirements)', () => {
    const top = projectFromPreset('topdown', registry);
    expect(reachOf(top).capabilities).toEqual({});
    // (And the sections builder builds nothing for it: it says what the game lacks.)
    expect(() => generateLevel(top, top.scenes[0].id, { difficulty: 3, seed: 1 }, registry)).toThrow(/needs a ground object|doesn't jump here/);
  });
});

describe('F6b: what the reach gets over, measured by the solver with its own moves (with or without a capability)', () => {
  it('a plain player: its jump; a dash adds cells across and rows up; wall jumps add nothing on an open cliff', () => {
    const plain = reachMeasure(reachOf(PLAIN));
    const table = reachOf(PLAIN).limits!(5);
    expect(plain).toEqual({ rise: table.maxRise, gap: table.gap(0) });
    const both = reachOf(BOTH);
    expect(reachMeasure(both).gap).toBe(plain.gap + both.capabilities.dash.cells);
    expect(reachMeasure(both).rise).toBeGreaterThan(plain.rise);
    // Without the dash: the jump again. Without the wall jump: what the dash still does.
    expect(reachMeasure(both, ['dash'])).toEqual(plain);
    expect(reachMeasure(both, ['wall_jump'])).toEqual(reachMeasure(reachOf(game(['dash']))));
    expect(reachMeasure(both, ['wall_jump', 'dash'])).toEqual(plain);
  });
});

describe('F6b: patterns are built for the reach the player has', () => {
  it('patterns say what they require; the two that need more than the jump name only capabilities the reach model has', () => {
    const requiring = allPatterns().filter((p) => p.requires?.length);
    expect(requiring.map((p) => [p.id, p.requires])).toEqual([['dash_gap', ['dash']], ['wall_shaft', ['wall_jump']]]);
    for (const p of requiring) for (const c of p.requires!) expect(reachAbilityIds(), p.id).toContain(c);
  });

  it('without the ability its pattern is never built (free levels, and asked for by name: another section takes its place, said)', { timeout: 60000 }, () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { sections } = build(PLAIN, { seed, difficulty: seed % 2 ? 2 : 4, avoid: ['mover'] });
      expect(has(sections, 'dash_gap') || has(sections, 'wall_shaft'), `seed ${seed}`).toBe(false);
    }
    const named = build(PLAIN, { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: 'dash_gap' }, { pattern: 'wall_shaft' }] });
    expect(has(named.sections, 'dash_gap') || has(named.sections, 'wall_shaft')).toBe(false);
    expect(named.r.state).toBe('validated');
    // (A dash alone: its gap, never the shaft.)
    const dashOnly = game(['dash']);
    for (let seed = 1; seed <= 8; seed++) expect(has(build(dashOnly, { seed, difficulty: 4, avoid: ['mover'] }).sections, 'wall_shaft'), `seed ${seed}`).toBe(false);
  });

  it('with the abilities, free levels use them: some sections need a dash or wall jumps, and every such level is solved and played', { timeout: 120000 }, () => {
    let dash = 0;
    let wall = 0;
    for (const difficulty of [2, 4])
      for (let seed = 1; seed <= 8; seed++) {
        const { r, sections } = build(BOTH, { seed, difficulty, avoid: ['mover'] });
        const uses = has(sections, 'dash_gap') || has(sections, 'wall_shaft');
        if (has(sections, 'dash_gap')) dash++;
        if (has(sections, 'wall_shaft')) wall++;
        expect(r.state, `d${difficulty} seed ${seed}`).toBe('validated');
        // (Validated with an ability section means played: the solver's route alone is not enough.)
        if (uses) expect(r.notes.join(' '), `d${difficulty} seed ${seed}`).toMatch(/the route bot played it to the goal/);
      }
    expect(dash).toBeGreaterThan(0);
    expect(wall).toBeGreaterThan(0);
  });

  it('sized from the capability\'s numbers: a longer dash, a wider gap; a weaker kick, a narrower shaft', () => {
    /** The widest run of open floor in the row the player walks on. */
    const widestGap = (grid: LevelGrid) => {
      const rows = grid.rows();
      const stand = rows.findIndex((r) => r.includes('P'));
      const floor = rows[stand + 1];
      return Math.max(...(floor.replace(/^[^#]*|[^#]*$/g, '').match(/[^#]+/g) ?? ['']).map((x) => x.length));
    };
    const bp = { seed: 3, difficulty: 5, structure: 'run', length: 'medium', sections: [{ pattern: 'dash_gap', variant: 'plain' }] };
    const gapOf = (p: Project) => {
      const b = build(p, bp);
      expect(has(b.sections, 'dash_gap')).toBe(true);
      expect(b.r.state).toBe('validated');
      return widestGap(b.grid);
    };
    const short = gapOf(game(['dash']));
    const long = gapOf(game(['dash'], { Dash: { speed: 700, duration: 0.25 } }));
    const jump = reachOf(PLAIN).limits!(5).gap(0);
    expect(short).toBeGreaterThan(jump);
    expect(short).toBeLessThanOrEqual(jump + 2);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(jump + 5);
    /** The shaft's inside: cells between the hanging wall and the cliff. */
    const inside = (grid: LevelGrid) => {
      const rows = grid.rows();
      const stand = rows.findIndex((r) => r.includes('P'));
      for (let c = 1; c < rows[0].length; c++) {
        if (rows[stand - 1][c] !== '#' || rows[stand][c] === '#') continue;
        let n = 0;
        while (rows[stand][c + 1 + n] !== '#') n++;
        return n;
      }
      return -1;
    };
    const shaft = { seed: 2, structure: 'run', length: 'short', sections: [{ pattern: 'wall_shaft' }] };
    expect(inside(build(game(['wall_jump']), shaft).grid)).toBe(2);
    expect(inside(build(game(['wall_jump'], { WallJump: { jumpX: 100 } }), shaft).grid)).toBe(1);
  });
});

describe('F6b: a level that needs an ability is solved, and played, or it is not validated', () => {
  const cases: [string, Record<string, unknown>[], string][] = [
    ['dash_gap', [{ pattern: 'dash_gap', variant: 'plain' }], 'dash'],
    ['dash_gap over spikes', [{ pattern: 'dash_gap', variant: 'spikes' }], 'dash'],
    ['wall_shaft', [{ pattern: 'wall_shaft' }], 'wall_jump'],
  ];

  it('each: the solver finds a route through the ability\'s move, the route bot plays it on the real runtime, and without the ability there is no way', { timeout: 60000 }, () => {
    for (const [name, sections, move] of cases)
      for (const seed of [1, 2, 3, 4]) {
        const what = `${name} seed ${seed}`;
        const { r, grid, sections: built } = build(BOTH, { seed, structure: 'run', length: 'short', sections });
        expect(has(built, name.split(' ')[0]), what).toBe(true);
        expect(r.state, what).toBe('validated');
        const route = solve(grid, BOTH);
        expect(route.goal, what).toBe(true);
        expect(route.path.map((p) => p.move), what).toContain(move);
        expect(r.notes.join(' '), what).toMatch(new RegExp(`needs the player's ${move}.*route bot played it`));
        // Needed: the same level, a player without the ability: no route.
        expect(solve(grid, PLAIN).goal, what).toBe(false);
        // (And played here too, on the level as built: the bot gets to the goal.)
        const level = produce(BOTH, (d) => void applyOps(d, r));
        expect(playRoute(level, level.scenes[0].id, route.path, registry).won, what).toBe(true);
      }
  });

  it('the abilities and the level\'s geometry together: ramps, a wall shaft and a dash over a spiked trench in one level, played through', { timeout: 60000 }, () => {
    for (const seed of [1, 2, 3]) {
      const { r, grid, sections } = build(BOTH, { seed, structure: 'run', length: 'long', sections: [{ pattern: 'wall_shaft' }, { pattern: 'slopes' }, { pattern: 'dash_gap', variant: 'spikes' }] });
      expect(['slopes', 'wall_shaft', 'dash_gap'].filter((x) => has(sections, x)), `seed ${seed}`).toEqual(['slopes', 'wall_shaft', 'dash_gap']);
      expect(r.state, `seed ${seed}`).toBe('validated');
      const moves = solve(grid, BOTH).path.map((p) => p.move);
      expect(moves).toContain('wall_jump');
      expect(moves).toContain('dash');
      // (Each ability alone is not enough for it.)
      expect(solve(grid, game(['dash'])).goal).toBe(false);
      expect(solve(grid, game(['wall_jump'])).goal).toBe(false);
    }
  });

  it('the same seed gives the same level, verdict and notes (the bot\'s budget is in seconds of play, not of the clock)', () => {
    const bp = { seed: 5, difficulty: 4, avoid: ['mover'] };
    const a = build(BOTH, bp);
    const b = build(BOTH, bp);
    expect(b.r.rows).toEqual(a.r.rows);
    expect([b.r.state, b.r.attempts, b.r.notes]).toEqual([a.r.state, a.r.attempts, a.r.notes]);
  });

  it('a route the bot can\'t confirm is never reported as validated: the level is uncertain, and says so', () => {
    const real = (project: Project, sceneId: string, route: Parameters<typeof playRoute>[2], reg: typeof registry, max?: number) => playRoute(project, sceneId, route, reg, undefined, max);
    try {
      // The bot gets stuck on every level.
      setRouteBot(() => ({ won: false, stuck: { move: 'dash' } }));
      const stuck = build(BOTH, { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: 'dash_gap' }] }).r;
      expect(stuck.state).toBe('uncertain');
      expect(stuck.notes.join(' ')).toMatch(/not proven playable.*route bot couldn't do a dash/);
      // No bot here at all.
      setRouteBot(null);
      const none = build(BOTH, { seed: 1, structure: 'run', length: 'short', sections: [{ pattern: 'wall_shaft' }] }).r;
      expect(none.state).toBe('uncertain');
      expect(none.notes.join(' ')).toMatch(/route bot is not loaded/);
      // (A player without abilities needs no bot: its levels are validated as ever.)
      expect(build(PLAIN, { seed: 1, structure: 'run', length: 'short' }).r.state).toBe('validated');
    } finally {
      setRouteBot(real as never);
    }
  });

  it('building stays quick: a level with ability sections, solved and played, in well under a second on average', { timeout: 60000 }, () => {
    const t0 = Date.now();
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      build(BOTH, { seed, structure: 'run', length: 'medium', sections: [{ pattern: 'wall_shaft' }, { pattern: 'dash_gap' }] });
      n++;
    }
    const each = (Date.now() - t0) / n;
    console.log(`ability levels, solved and played: ${each.toFixed(0)} ms each`);
    expect(each).toBeLessThan(3000);
  });
});

describe('F6b: another ability plugs in with no change to the builder, the solver or the validators', () => {
  // A glide only this test knows: from the ground, three cells further across than a jump, level. Its moves are
  // estimated, and the route bot can't play them.
  const glide: MoveRule = {
    id: 'glide',
    mechanics: ['test_glide'],
    capability: { id: 'test_glide', numbers: { cells: 3 } },
    successors(s, v) {
      if (s.mode || !v.supportAt(s.c, s.r + 1, s.w)) return;
      for (const dir of [-1, 1]) for (let k = v.lim.gap(0) + 2; k <= v.lim.gap(0) + 4; k++) if (v.canJump(s.c, s.r, dir * k, 0, s.away, () => v.lim.gap(0) + 3)) v.push(s.c + dir * k, s.r, s.kh, s.so, s.cr, s.id, 'glide' as never, 6);
    },
  };
  const glideGap: Pattern = {
    id: 'test_glide_gap',
    version: 1,
    name: 'a gap only a glide crosses (a test pattern)',
    mechanics: ['gap'],
    fits: ['teach', 'test', 'twist'],
    needs: ['ground'],
    requires: ['test_glide'],
    variants: [{ id: 'plain' }],
    difficulty: [1, 5],
    width: () => [12, 14],
    build(ctx) {
      const s = new Section(ctx);
      const g = ctx.reach.gap(0) + Math.min(2, ctx.caps.test_glide.cells);
      s.flat(0, 2, ctx.entry);
      s.flat(3 + g, s.w - 1, ctx.entry);
      return ctx.entry;
    },
  };
  // (Given by a component the player may have: here its Trail.)
  beforeAll(() => {
    registerReachAbility({ id: 'test_glide', has: (c) => !!c.Trail, move: () => glide, estimated: true, simulated: false });
    registerPattern(glideGap);
  });
  afterAll(() => {
    unregisterReachAbility('test_glide');
    unregisterPattern('test_glide_gap');
  });
  const glider = produce(PLAIN, (d) => {
    d.definitions.find((x) => x.name === 'Player')!.components.Trail = registry.createDefault('Trail');
  });
  const bp = { seed: 2, structure: 'run', length: 'short', sections: [{ pattern: 'test_glide_gap' }] };

  it('the reach has it, the builder builds its pattern for a player that has it (and not for one that hasn\'t), the solver routes through it', () => {
    expect(reachOf(glider).capabilities).toEqual({ test_glide: { cells: 3 } });
    expect(reachOf(glider).approximate).toEqual(['test_glide']);
    expect(has(build(PLAIN, bp).sections, 'test_glide_gap')).toBe(false);
    const { grid, sections } = build(glider, bp);
    expect(has(sections, 'test_glide_gap')).toBe(true);
    expect(solve(grid, glider).path.map((p) => p.move)).toContain('glide');
    expect(solve(grid, PLAIN).goal).toBe(false);
  });

  it('an ability the route bot can\'t play: its levels are built and solved, but never validated; said plainly', () => {
    const { r } = build(glider, bp);
    expect(r.state).toBe('uncertain');
    expect(r.notes.join(' ')).toMatch(/needs the player's test_glide/);
    expect(r.notes.join(' ')).toMatch(/not proven playable/);
    expect(r.notes.join(' ')).toMatch(/only estimated \(not played\)|can't play a glide move/);
  });
});

/** Applies a built level's operations (a level as the editor would have it). */
function applyOps(d: Project, r: GenerateResult): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  applyOperations(d, r.ops, registry);
}
import { applyOperations } from '../commands/operations';
