import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { MECHANICS, SECTION_ROLES } from './blueprint';
import { generateLevel } from './generate';
import { allPatterns } from './patterns/index';
import { findRoles } from './roles';

const registry = createBuiltinRegistry();

describe('the pattern library', () => {
  it('every pattern has its id, a version, words, known mechanics and kinds of section, and variants', () => {
    const roles = Object.keys(findRoles(createProject(registry), registry));
    for (const p of allPatterns()) {
      expect(p.version, p.id).toBeGreaterThanOrEqual(1);
      expect(p.name.length, p.id).toBeGreaterThan(10);
      expect(p.variants.length, p.id).toBeGreaterThan(0);
      for (const m of p.mechanics) expect(MECHANICS, p.id).toContain(m);
      for (const f of p.fits) expect(SECTION_ROLES, p.id).toContain(f);
      // (Everything it needs is a part the starter game has, or the moving platform it can do without.)
      for (const r of [...p.needs, ...p.variants.flatMap((v) => v.needs ?? [])]) expect([...roles, 'mover'], `${p.id}: ${r}`).toContain(r);
    }
  });

  it('every variant of every pattern builds into a level that checks out (asked for by name, a few seeds)', { timeout: 120000 }, () => {
    const p = createProject(registry);
    const failures: string[] = [];
    for (const pat of allPatterns()) {
      if (['start', 'goal', 'key_end', 'locked_goal'].includes(pat.id)) continue;
      // (A pattern that requires a capability the starter's player lacks is never built for it, even asked for by
      // name: another section takes its place. With the capability: core/levelGen/reachAware.test.ts.)
      if (pat.requires?.length) {
        const r = generateLevel(p, p.scenes[0].id, { difficulty: 3, structure: 'run', length: 'short', seed: 1, sections: [{ pattern: pat.id }] }, registry);
        const built = (r.madeBy.fingerprint as { sections: string[] }).sections;
        if (built.some((x) => x.includes(`:${pat.id}/`))) failures.push(`${pat.id} was built for a player without ${pat.requires.join(', ')}`);
        continue;
      }
      for (const v of pat.variants) {
        const difficulty = Math.max(3, v.minDifficulty ?? 1);
        for (const seed of [1, 2, 3]) {
          let r: ReturnType<typeof generateLevel>;
          try {
            r = generateLevel(p, p.scenes[0].id, { difficulty, structure: 'run', length: 'short', seed, sections: [{ pattern: pat.id, variant: v.id }] }, registry);
          } catch (e) {
            failures.push(`${pat.id}/${v.id} seed ${seed}: ${(e as Error).message}`);
            continue;
          }
          const s = (r.madeBy.fingerprint as { sections: string[] }).sections;
          if (r.state !== 'validated' || !s.some((x) => x.includes(`:${pat.id}/${v.id}@`))) failures.push(`${pat.id}/${v.id} seed ${seed}: ${r.state}, ${s.join(' ')} ${r.notes.join('; ')}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
