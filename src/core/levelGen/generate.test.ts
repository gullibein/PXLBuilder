import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations } from '../commands/operations';
import { createProject, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { levelReachability, winProblems } from '../model/reachability';
import { resolveEntity } from '../model/resolve';
import type { Project } from '../types';
import { STRUCTURES } from './blueprint';
import { generateLevel, LevelGenError } from './generate';
import { playerLimits } from './limits';
import { findRoles } from './roles';

const registry = createBuiltinRegistry();
const starter = () => createProject(registry);
const build = (p: Project, bp: Record<string, unknown>) => generateLevel(p, p.scenes[0].id, bp, registry);
const sections = (r: ReturnType<typeof build>) => (r.madeBy.fingerprint as { sections: string[] }).sections;
const apply = (p: Project, r: ReturnType<typeof build>) => produce(p, (d) => void applyOperations(d, r.ops, registry));

/** The widest run of empty columns in the ground row of a one-floor level (its widest gap). */
function widestGap(rows: string[]): number {
  const ground = rows[rows.length - 1];
  let best = 0;
  let n = 0;
  for (const ch of ground.slice(1, -1)) {
    n = ch === '#' ? 0 : n + 1;
    best = Math.max(best, n);
  }
  return best;
}

describe('the level builder (classic platformer)', () => {
  it('every structure, at every difficulty, builds levels that pass every check', { timeout: 60000 }, () => {
    const p = starter();
    for (const structure of STRUCTURES)
      for (let difficulty = 1; difficulty <= 5; difficulty += 2)
        for (const seed of [1, 2]) {
          const r = build(p, { difficulty, structure, seed, length: 'medium' });
          expect(r.state, `${structure} d${difficulty} seed ${seed}: ${r.notes.join('; ')}`).toBe('validated');
          const after = apply(p, r);
          const id = after.scenes[0].id;
          expect(winProblems(after, id, registry)).toEqual([]);
          expect(r.rows.join('').match(/P/g)?.length).toBe(1);
          if (structure !== 'hub') expect(r.rows.join('').match(/G/g)?.length).toBe(1);
          expect(r.madeBy.fingerprint).toMatchObject({ structure });
        }
  });

  it('the same blueprint and seed build the same level; another seed another one', () => {
    const p = starter();
    const a = build(p, { difficulty: 3, seed: 777 });
    const b = build(p, { difficulty: 3, seed: 777 });
    expect(b.ops).toEqual(a.ops);
    expect(b.madeBy).toEqual(a.madeBy);
    const others = [778, 779, 780].map((seed) => build(p, { difficulty: 3, seed }).rows.join('\n'));
    expect(others.every((o) => o !== a.rows.join('\n'))).toBe(true);
  });

  it('nothing is changed until the operations are applied; then it is an ordinary level, the old one gone', () => {
    const p = produce(starter(), (d) => {
      // Something far outside where the new level goes.
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Coin')!, { x: -900, y: -600 }));
    });
    const before = JSON.stringify(p);
    const r = build(p, { difficulty: 2, structure: 'run', seed: 5, length: 'short', avoid: ['mover'] });
    expect(JSON.stringify(p)).toBe(before);
    const after = apply(p, r);
    const scene = after.scenes[0];
    expect(scene.entities.some((e) => e.transform.position.x === -900)).toBe(false);
    expect(scene.entities.filter((e) => resolveEntity(after, e, registry).components.CharacterController)).toHaveLength(1);
    expect(levelReachability(after, scene.id, registry).status).toBe('ok');
  });

  it("gaps follow the player's jump: never wider than it can clear, wider for a stronger jump", { timeout: 60000 }, () => {
    const withJump = (jumpForce: number, speed: number) =>
      produce(starter(), (d) => {
        const cc = d.definitions.find((x) => x.name === 'Player')!.components.CharacterController!;
        cc.jumpForce = jumpForce;
        cc.speed = speed;
      });
    const weak = withJump(300, 160);
    const strong = withJump(480, 300);
    const lim = (p: Project) => playerLimits(p, p.scenes[0].id, findRoles(p, registry).player!.id, registry, 5)!;
    const gaps = (p: Project) => Array.from({ length: 10 }, (_, seed) => widestGap(build(p, { difficulty: 5, structure: 'run', seed, length: 'long', avoid: ['mover', 'spring', 'floating'] }).rows));
    const weakGaps = gaps(weak);
    expect(Math.max(...weakGaps)).toBeLessThanOrEqual(lim(weak).gap(-4));
    expect(Math.max(...gaps(strong))).toBeGreaterThan(lim(weak).gap(0));
  });

  it("focus, escalation and avoid steer the build", () => {
    const p = starter();
    const count = (bp: Record<string, unknown>, what: RegExp) => Array.from({ length: 8 }, (_, seed) => sections(build(p, { difficulty: 3, length: 'long', structure: 'run', seed, ...bp })).filter((s) => what.test(s)).length).reduce((a, b) => a + b, 0);
    expect(count({ focus: ['spring'] }, /:spring\//)).toBeGreaterThan(count({}, /:spring\//) * 1.5);
    expect(count({ avoid: ['enemy'] }, /:enemy\//)).toBe(0);
    // Escalating: each spring section at least as hard as the one before.
    for (let seed = 0; seed < 6; seed++) {
      const ds = sections(build(p, { difficulty: 2, length: 'long', structure: 'run', seed, focus: ['spring'], escalate: 'spring' })).filter((s) => /:spring\//.test(s)).map((s) => Number(s.split('@')[1]));
      for (let i = 1; i < ds.length; i++) expect(ds[i]).toBeGreaterThanOrEqual(ds[i - 1]);
    }
    // Secrets: bonus caches.
    expect(count({ secrets: 2 }, /:bonus\//)).toBeGreaterThan(count({}, /:bonus\//));
  }, 60000);

  it('the AI can direct it section by section: named patterns and variants in its order, and a section drawn as a map', () => {
    const p = starter();
    const r = build(p, {
      difficulty: 3, structure: 'run', length: 'medium', seed: 9,
      sections: [
        { pattern: 'pipes', variant: 'steps' },
        { pattern: 'spring', variant: 'route', role: 'twist' },
        { role: 'test', custom: { rows: ['..o..', '.===.', '#####'], legend: { '#': 'ground', '=': 'ledge', o: 'coin' } } },
      ],
    });
    expect(r.state).toBe('validated');
    const s = sections(r);
    expect(s.slice(1, 4).map((x) => x.split('@')[0].replace(/^\w+:/, ''))).toEqual(['pipes/steps', 'spring/route', 'custom/custom']);
    expect(s.slice(2, 4).map((x) => x.split(':')[0])).toEqual(['twist', 'test']);
    // After the AI's sections, the builder only fills with rests (and the goal).
    expect(s.slice(4).every((x) => /^(rest|finale):/.test(x))).toBe(true);
  });

  it("says what it can't do: a part the game lacks, a custom section with an unknown character, a structure it can't build", () => {
    const p = starter();
    expect(() => build(p, { difficulty: 2, seed: 1, sections: [{ custom: { rows: ['xx', '##'], legend: { '#': 'ground' } } }] })).toThrow(/doesn't say what "x" is/);
    expect(() => build(p, { difficulty: 2, seed: 1, sections: [{ custom: { rows: ['LL', '##'], legend: { '#': 'ground', L: 'lava' } } }] })).toThrow(/no object for it/);
    const noLadder = produce(starter(), (d) => void (d.definitions = d.definitions.filter((x) => x.name !== 'Ladder')));
    expect(() => build(noLadder, { difficulty: 2, seed: 1, structure: 'climb' })).toThrow(LevelGenError);
    // A pattern whose parts the game lacks: another is used, and that is said.
    const noPipes = produce(starter(), (d) => void (d.definitions = d.definitions.filter((x) => !x.tags.includes('pipe'))));
    const r = build(noPipes, { difficulty: 2, seed: 3, structure: 'run', sections: [{ pattern: 'pipes' }] });
    expect(r.notes.some((n) => /"pipes" can't be built/.test(n))).toBe(true);
    expect(sections(r).some((x) => x.includes(':pipes/'))).toBe(false);
  });

  it('a hub: the key at one end, the goal behind a door that needs it at the other', () => {
    const p = starter();
    const r = build(p, { difficulty: 3, structure: 'hub', seed: 4, length: 'medium' });
    const after = apply(p, r);
    const scene = after.scenes[0];
    expect(scene.relationships.map((x) => x.type)).toEqual(['requires']);
    const name = (id: string) => resolveEntity(after, scene.entities.find((e) => e.id === id)!, registry).name;
    const rel = scene.relationships[0] as unknown as { source: { id: string }; target: { id: string } };
    expect([name(rel.source.id), name(rel.target.id)]).toEqual(['Door', 'Key']);
  });

  it('records how the level was made: builder, seed, the blueprint, each pattern with its version', () => {
    const r = build(starter(), { difficulty: 2, seed: 31, concept: 'gentle start' });
    expect(r.madeBy).toMatchObject({ generator: 'classic', version: 1, seed: 31, blueprint: { difficulty: 2, seed: 31, concept: 'gentle start' } });
    expect(Object.values(r.madeBy.patterns).every((v) => v >= 1)).toBe(true);
    expect(Object.keys(r.madeBy.patterns)).toContain('start');
  });
});
