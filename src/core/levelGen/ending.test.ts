/**
 * What ends a level, and the room it gets (docs/engine-architecture-proposal.md §24.7). The goal itself needs three
 * cells. One of its three endings, a last gap and an enemy before the goal, needs eight, and the builder keeps five
 * to seven for the ending: drawn, it never fitted, and the whole build was thrown away (about one build in four).
 * Now a level whose ending needs a few cells more is made that much longer; a game whose camera stays still keeps
 * its levels' size and gets an ending that fits. Builds that were kept before are the same to the byte.
 */
import { createHash } from 'node:crypto';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { gameCamera } from '../engine/camera';
import { projectFromPreset, setGameProfile } from '../engine/profile';
import { createProject } from '../model/factory';
import { buildLevel } from './build';
import { generateLevel, type GenerateOptions, type GenerateResult } from './generate';
import { LevelGrid } from './grid';
import { limitsFrom } from './limits';
import { patternById } from './patterns/index';
import { findRoles } from './roles';
import { playerReach } from '../reach/reach';

const registry = createBuiltinRegistry();
const game = createProject(registry);
const sha = (rows: string[]) => createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 8);
const free = (seed: number, options: GenerateOptions = {}, more: Record<string, unknown> = {}) => generateLevel(game, game.scenes[0].id, { seed, difficulty: 1 + (seed % 5), ...more }, registry, 'classic', { candidates: 1, ...options });
const fingerprint = (r: GenerateResult) => r.madeBy.fingerprint as { structure: string; length: string; size: [number, number]; sections: string[] };
const ending = (r: GenerateResult) => fingerprint(r).sections.at(-1)!.replace(/^finale:|@.*$/g, '');
const longer = (r: GenerateResult) => Number(r.notes.find((n) => /longer for its ending/.test(n))?.match(/made (\d+) cell/)?.[1] ?? 0);
/** The width a level's layout gives it, before any ending. */
const LAYOUT: Record<string, Record<string, number>> = { run: { short: 30, medium: 52, long: 76 }, hub: { short: 40, medium: 52, long: 64 }, loop: { short: 30, medium: 44, long: 58 }, climb: { short: 24, medium: 30, long: 34 }, descent: { short: 24, medium: 30, long: 34 } };

describe('the goal and its endings: what each needs', () => {
  it('the goal itself needs three cells; the ending with a last gap and enemy, eight; five are kept for whichever is drawn', () => {
    const goal = patternById('goal')!;
    const reach = playerReach(game, game.scenes[0].id, findRoles(game, registry).player!.id, registry)!;
    const lim = limitsFrom(reach.table!, 3);
    expect(goal.variants.map((v) => [v.id, goal.width(lim, 3, v.id, {})[0]])).toEqual([['pad', 3], ['gauntlet', 8], ['raised', 5]]);
    // (What the wide one adds to a level: an enemy and a gap. A level that leaves those out doesn't get it.)
    expect(goal.variants.find((v) => v.id === 'gauntlet')!.mechanics).toEqual(['enemy', 'gap']);
  });
});

describe('an ending wider than the cells left: the level is made that much longer', () => {
  it('no build is thrown away for its ending any more; the gap-and-enemy ending is built (it never was); every level checks out', { timeout: 120000 }, () => {
    let builds = 0;
    let first = 0;
    const endings: Record<string, number> = {};
    const grown: number[] = [];
    for (let seed = 1; seed <= 60; seed++) {
      const r = free(seed);
      expect(r.state, `seed ${seed}`).toBe('validated');
      builds += r.attempts;
      if (r.attempts === 1) first++;
      endings[ending(r)] = (endings[ending(r)] ?? 0) + 1;
      const f = fingerprint(r);
      const more = longer(r);
      // A level is as wide as its layout, or wider by exactly what its ending needed (one to three cells).
      expect(f.size[0], `seed ${seed}`).toBe(LAYOUT[f.structure][f.length] + more);
      expect(r.rows.every((row) => row.length === f.size[0]), `seed ${seed}`).toBe(true);
      if (more) {
        grown.push(more);
        expect(more).toBeLessThanOrEqual(3);
        expect(ending(r), `seed ${seed}`).toBe('goal/gauntlet');
        // (Walled at both ends as ever, and the goal in it.)
        expect(r.rows.every((row) => row[0] === '#' && row.at(-1) === '#'), `seed ${seed}`).toBe(true);
        expect(r.rows.join('')).toContain('G');
      }
    }
    // (Before: 84 builds for these 60 levels, 43 from the first build, and not one gap-and-enemy ending.)
    expect(builds).toBeLessThanOrEqual(66);
    expect(first).toBeGreaterThanOrEqual(56);
    expect(endings['goal/gauntlet']).toBeGreaterThanOrEqual(8);
    expect(grown.length).toBe(endings['goal/gauntlet']);
    expect(Object.keys(endings).sort()).toEqual(['goal/gauntlet', 'goal/pad', 'goal/raised', 'locked_goal/pad']);
  });

  it('on a level of several floors the other floors are as they were: the new cells beside them are wall', { timeout: 60000 }, () => {
    let seen = 0;
    for (let seed = 1; seed <= 40 && seen < 3; seed++) {
      for (const structure of ['climb', 'descent', 'loop']) {
        const r = free(seed, {}, { structure, difficulty: 3 });
        const more = longer(r);
        if (!more) continue;
        seen++;
        expect(r.state).toBe('validated');
        const kept = free(seed, { fixedSize: true }, { structure, difficulty: 3 });
        // (The same build with the size kept: the same level but for its ending.)
        expect(kept.attempts).toBe(r.attempts);
        const goalRow = r.rows.findIndex((row) => row.includes('G'));
        const atRight = r.rows[goalRow].indexOf('G') > r.rows[0].length / 2;
        // Where the new columns are: just inside the wall the last floor ends at.
        const at = atRight ? kept.rows[0].length - 1 : 1;
        r.rows.forEach((row, y) => {
          const without = row.slice(0, at) + row.slice(at + more);
          const added = row.slice(at, at + more);
          // A row of another floor: what it had, with wall where the level grew. (The last floor's own rows hold its ending.)
          if (without === kept.rows[y]) expect(/^#*$|^\.*$/.test(added), `seed ${seed} ${structure} row ${y}: ${added}`).toBe(true);
        });
        // (Most rows are other floors', and they did match.)
        expect(r.rows.filter((row, y) => row.slice(0, at) + row.slice(at + more) === kept.rows[y]).length).toBeGreaterThan(r.rows.length / 2);
      }
    }
    expect(seen).toBeGreaterThanOrEqual(3);
  });

  it('a level that leaves enemies out is not given the ending with an enemy (it used to be drawn for it, and thrown away)', { timeout: 60000 }, () => {
    let builds = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const r = free(seed, {}, { structure: 'run', length: 'short', difficulty: 3, avoid: ['enemy', 'mover'] });
      builds += r.attempts;
      expect(r.state, `seed ${seed}`).toBe('validated');
      expect(ending(r), `seed ${seed}`).not.toBe('goal/gauntlet');
      expect(longer(r)).toBe(0);
      // (No enemy in the cells the ending has: the last eight columns before the wall.)
      expect(r.rows.map((row) => row.slice(-9)).join(''), `seed ${seed}`).not.toContain('E');
    }
    expect(builds).toBeLessThanOrEqual(36);
  });
});

describe('a game whose camera stays still keeps its levels\' size', () => {
  it('with the size kept, the ending is one that fits the cells left; nothing is thrown away for it either', { timeout: 120000 }, () => {
    let builds = 0;
    const endings = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const r = free(seed, { fixedSize: true });
      builds += r.attempts;
      expect(r.state, `seed ${seed}`).toBe('validated');
      const f = fingerprint(r);
      expect(f.size[0], `seed ${seed}`).toBe(LAYOUT[f.structure][f.length]);
      expect(longer(r)).toBe(0);
      endings.add(ending(r));
    }
    expect([...endings].sort()).toEqual(['goal/pad', 'goal/raised', 'locked_goal/pad']);
    expect(builds).toBeLessThanOrEqual(46);
  });

  it('the engine says which: a camera that follows lets a level be longer; a still camera (the level is the screen) doesn\'t', { timeout: 120000 }, () => {
    const follows = projectFromPreset('classic-platformer', registry);
    const still = produce(follows, (d) => void setGameProfile(d, { camera: [] }, registry));
    expect(gameCamera(follows)).toContain('follow');
    expect(gameCamera(still)).not.toContain('follow');
    let grew = 0;
    for (let seed = 1; seed <= 24; seed++) {
      const bp = { seed, difficulty: 3, structure: 'run', length: 'short' };
      const a = buildLevel(follows, follows.scenes[0].id, bp, registry, { candidates: 1 });
      const b = buildLevel(still, still.scenes[0].id, bp, registry, { candidates: 1 });
      if (longer(a)) grew++;
      expect(longer(b), `seed ${seed}`).toBe(0);
      // (A short level on one floor is one screen wide: thirty cells.)
      expect(fingerprint(b).size, `seed ${seed}`).toEqual([30, 15]);
      expect(b.state, `seed ${seed}`).toBe('validated');
    }
    expect(grew).toBeGreaterThan(0);
  });
});

describe('levels that were kept before are the same to the byte', () => {
  // The rows of free classic levels (the starter game, difficulty 1 + seed % 5), hashed with the builder as it was
  // before this change (version 2).
  const BEFORE: Record<number, string> = { 2: 'dee1cc78', 3: '29d64f60', 5: '61fe5d47', 6: '986e8ef6', 7: '850ed207', 9: '28a23543', 10: '4dc7ca52', 11: '56552f6d', 12: '772de3ff', 13: 'ed67a0b0', 1: '22fb55a4', 4: '6a9c3466', 8: '79f345cc', 14: 'd14e4e76' };

  it('a seed that never drew the wide ending still gives its level; one whose build was thrown away for it now gives that build', { timeout: 60000 }, () => {
    for (const seed of [2, 3, 5, 6, 7, 9, 10, 11, 12, 13]) {
      const r = free(seed);
      expect(sha(r.rows), `seed ${seed}`).toBe(BEFORE[seed]);
    }
    // (These four took two or three builds before. Now: fewer, and another level than the one they got then.)
    const now: Record<number, string> = { 1: 'b865e1ca', 4: '71c0553a', 8: '7184ab01', 14: '83ec2770' };
    for (const seed of [1, 4, 8, 14]) {
      const r = free(seed);
      expect(sha(r.rows), `seed ${seed}`).toBe(now[seed]);
      expect(sha(r.rows), `seed ${seed}`).not.toBe(BEFORE[seed]);
    }
    // The record says which builder made a level: its version went up with this.
    expect(free(2).madeBy).toMatchObject({ generator: 'classic', version: 3 });
  });
});

describe('the grid: made wider', () => {
  it('new columns go in where asked; what was beyond moves over, things placed by themselves with it; a copy put back restores the width', () => {
    const roles = findRoles(game, registry);
    const g = new LevelGrid(6, 3, roles);
    g.fill('ground', 0, 2, 5, 2);
    g.fill('ground', 5, 0, 5, 2);
    g.place({ role: 'goal', col: 4, row: 1, ref: 'goal1' });
    g.place({ role: 'goal', col: 1, row: 1, ref: 'goal2' });
    const before = g.clone();
    g.widen(5, 2, (row) => (row === 2 ? 'ground' : null));
    expect(g.width).toBe(8);
    expect(g.rows()).toEqual(['.......#', '.......#', '########']);
    // (At column 5 and beyond: moved. Before it: where it was.)
    g.widen(2, 1, () => null);
    expect(g.rows()).toEqual(['........#', '........#', '##.######']);
    expect(g.placed.map((p) => [p.ref, p.col])).toEqual([['goal1', 5], ['goal2', 1]]);
    expect(() => g.widen(40, 1, () => null)).toThrow(/can't be widened at column 40/);
    g.restore(before);
    expect([g.width, g.rows()[0].length, g.placed.map((p) => p.col)]).toEqual([6, 6, [4, 1]]);
    expect(g.clone().width).toBe(6);
  });
});
