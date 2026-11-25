import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { STRUCTURES } from './blueprint';
import { generateLevel, unneededPuzzles } from './generate';
import type { LevelGrid } from './grid';
import { playerLimits } from './limits';
import { findRoles } from './roles';
import { solveLevel } from './solver';

const registry = createBuiltinRegistry();
const project = createProject(registry);
const sceneId = project.scenes[0].id;
const roles = findRoles(project, registry);
const reach = playerLimits(project, sceneId, roles.player!.id, registry, 5)!;

/** A puzzle level of these sections (and its grid, as checked). */
function build(blueprint: Record<string, unknown>) {
  let grid: LevelGrid | null = null;
  const r = generateLevel(project, sceneId, { difficulty: 3, structure: 'run', length: 'short', ...blueprint }, registry, 'puzzle', { onBuilt: (g) => (grid = g), candidates: 1 });
  return { r, grid: grid! };
}

describe('the puzzle platformer: every puzzle needed', () => {
  it('each puzzle pattern builds, is solvable, and is not solvable without its lever, key, crate or teleporter', () => {
    const cases: [string, string[], (g: LevelGrid) => void][] = [
      ['lever_door', ['hill', 'pit', 'perch'], (g) => g.placed.filter((p) => p.role === 'switch').forEach((p) => g.unplace(p.ref))],
      ['key_door', ['hill', 'pit', 'perch'], (g) => g.placed.filter((p) => p.role === 'key').forEach((p) => g.unplace(p.ref))],
      ['plate_door', ['push', 'drop'], (g) => g.rows().forEach((row, r) => [...row].forEach((ch, c) => ch === 'C' && g.clear(c, r, c, r)))],
      ['crate_step', ['near', 'far'], (g) => g.rows().forEach((row, r) => [...row].forEach((ch, c) => ch === 'C' && g.clear(c, r, c, r)))],
      ['teleport', ['wall', 'up'], (g) => g.placed.filter((p) => p.role === 'teleporter').forEach((p) => g.unplace(p.ref))],
    ];
    for (const [pattern, variants, takeAway] of cases)
      for (const variant of variants)
        for (const seed of [1, 2]) {
          const { r, grid } = build({ seed, sections: [{ pattern, variant }] });
          const what = `${pattern}/${variant} seed ${seed}`;
          expect(r.state, what).toBe('validated');
          expect((r.madeBy.fingerprint as { sections: string[] }).sections.some((s) => s.includes(`${pattern}/${variant}`)), what).toBe(true);
          expect(solveLevel(grid, reach).goal, what).toBe(true);
          const without = grid.clone();
          takeAway(without);
          expect(solveLevel(without, reach).goal, `${what}, without its puzzle`).toBe(false);
          expect(unneededPuzzles(grid, reach), what).toEqual([]);
        }
  });

  it('a puzzle piece the level can be won without is found (a lever that opens nothing)', () => {
    const { grid } = build({ seed: 3, sections: [{ pattern: 'crate_step', variant: 'near' }] });
    const g = grid.clone();
    const ground = g.rows().findIndex((row) => row.includes('P'));
    const col = g.rows()[ground].indexOf('P') + 1;
    g.place({ role: 'switch', col, row: ground, ref: 'spare' });
    expect(unneededPuzzles(g, reach)).toEqual([`the lever at ${col},${ground}`]);
  });

  it('levels of every structure: all validated, each with a puzzle, every puzzle needed', { timeout: 120000 }, () => {
    let n = 0;
    const kinds = new Set<string>();
    const started = performance.now();
    for (const structure of STRUCTURES)
      for (const difficulty of [1, 3, 5])
        for (const seed of [1, 2, 3]) {
          let grid: LevelGrid | null = null;
          const r = generateLevel(project, sceneId, { difficulty, structure, seed }, registry, 'puzzle', { onBuilt: (g) => (grid = g), candidates: 1 });
          const what = `${structure} d${difficulty} seed ${seed}`;
          expect(r.state, what).toBe('validated');
          expect(r.madeBy.generator).toBe('puzzle');
          const sections = (r.madeBy.fingerprint as { sections: string[] }).sections.map((s) => s.split(':')[1].split('/')[0]);
          const puzzles = sections.filter((s) => ['lever_door', 'key_door', 'plate_door', 'crate_step', 'teleport', 'locked_goal'].includes(s));
          expect(puzzles.length, what).toBeGreaterThan(0);
          puzzles.forEach((p) => kinds.add(p));
          expect(unneededPuzzles(grid!, reach), what).toEqual([]);
          n++;
        }
    expect(n).toBe(45);
    // (All the kinds of puzzle come up.)
    expect([...kinds].sort()).toEqual(['crate_step', 'key_door', 'lever_door', 'locked_goal', 'plate_door', 'teleport']);
    // (Fast enough for the level menu: well under a second a level on average.)
    expect((performance.now() - started) / n).toBeLessThan(1000);
  });

  it('a puzzle level is built no bigger than long (every puzzle in a bigger one took too long to prove needed), and says so', () => {
    const r = generateLevel(project, sceneId, { difficulty: 3, structure: 'run', length: 'huge', seed: 2 }, registry, 'puzzle', { candidates: 1 });
    expect(r.state).toBe('validated');
    expect(r.madeBy.fingerprint).toMatchObject({ length: 'long' });
    expect(r.rows[0].length).toBeLessThan(90);
    expect(r.notes.join(' | ')).toMatch(/built long, not huge: a puzzle level is built no bigger/);
    // (Asked for long, or nothing: no such note.)
    expect(generateLevel(project, sceneId, { difficulty: 3, structure: 'run', length: 'long', seed: 2 }, registry, 'puzzle', { candidates: 1 }).notes.join(' | ')).not.toMatch(/no bigger/);
  });
});
