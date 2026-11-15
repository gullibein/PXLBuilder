import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import type { Project } from '../types';
import { applyBuilt, blueprintFor, buildLevel, builderInfo, newBuiltLevel } from './build';
import { fingerprintOfScene, shapeOfRows, similarity, type Fingerprint } from './fingerprint';
import { TOO_ALIKE } from './generate';

const registry = createBuiltinRegistry();
/** A game with only its player in level 1 (an empty first level). */
const empty = () => produce(createProject(registry), (d) => void (d.scenes[0].entities = d.scenes[0].entities.filter((e) => e.name === 'Player')));
const fpOf = (r: ReturnType<typeof buildLevel>) => r.madeBy.fingerprint as unknown as Fingerprint;

/** Ten levels added one after another, as "New level, built by the engine" does. */
function tenLevels(seed0: number, candidates?: number): { p: Project; fps: Fingerprint[] } {
  let p = empty();
  for (let i = 0; i < 10; i++) {
    const ask = blueprintFor(p, null, 'new', seed0 + i)!;
    const r = newBuiltLevel(p, `Level ${i + 2}`, ask.blueprint, registry, { ...ask, ...(candidates ? { candidates } : {}) });
    p = produce(p, (d) => {
      m.addScene(d, JSON.parse(JSON.stringify(r.scene)));
      applyBuilt(d, r.scene.id, r.built, registry);
    });
  }
  return { p, fps: p.scenes.slice(1).map((s) => fingerprintOfScene(p, s, registry)!) };
}

const pairwise = (fps: Fingerprint[]) => fps.flatMap((a, i) => fps.slice(i + 1).map((b) => similarity(a, b).score));

describe('levels unlike each other', () => {
  it('the fingerprint: shape (where the solid ground is, over an 8 × 4 grid) and counts, the same for any level size', () => {
    const { shape, counts } = shapeOfRows(['......', '..E.o.', '######']);
    expect(shape).toHaveLength(32);
    expect(Math.max(...shape)).toBe(1);
    expect(counts).toEqual({ enemies: 1, coins: 1 });
    // A level made by hand (not by the engine) gets one from its objects.
    const p = createProject(registry);
    const hand = produce(p, (d) => {
      for (let x = 16; x < 640; x += 32) m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((q) => q.name === 'Platform')!, { x, y: 304 }));
    });
    const f = fingerprintOfScene(hand, hand.scenes[0], registry)!;
    expect(f.sections).toEqual([]);
    expect(f.shape.some((v) => v > 0.5)).toBe(true);
  });

  it('similarity: a level to itself 1; its variation (the same plan, by design) high; the same blueprint with another seed low', () => {
    let p = createProject(registry);
    const a = buildLevel(p, p.scenes[0].id, { difficulty: 3, seed: 4 }, registry);
    p = produce(p, (d) => void applyBuilt(d, d.scenes[0].id, a, registry));
    const fa = fpOf(a);
    expect(similarity(fa, fa).score).toBe(1);
    const variation = buildLevel(p, p.scenes[0].id, blueprintFor(p, p.scenes[0].id, 'variation', 54)!.blueprint, registry);
    const other = buildLevel(p, p.scenes[0].id, blueprintFor(p, p.scenes[0].id, 'regenerate', 64)!.blueprint, registry);
    expect(similarity(fa, fpOf(variation)).score).toBeGreaterThan(TOO_ALIKE);
    expect(similarity(fa, fpOf(other)).score).toBeLessThan(TOO_ALIKE);
    // (A level made by hand has no sections: it is compared by its shape, kind and counts alone.)
    const hand: Fingerprint = { ...fa, sections: [], structure: null, signature: null, routes: null };
    expect(Object.keys(similarity(fa, hand).parts).sort()).toEqual(['counts', 'shape']);
  });

  it('a new level is compared with every other level of the game (made by hand too), and the least alike of a few builds kept', () => {
    // A level made by hand, then one built after it.
    const p = produce(createProject(registry), (d) => {
      for (let x = 16; x < 900; x += 32) m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((q) => q.name === 'Platform')!, { x, y: 400 }));
    });
    const { built } = newBuiltLevel(p, 'Level 2', { difficulty: 3, seed: 7 }, registry);
    expect(built.notes.some((n) => /most like Level 1 \(similarity 0\.\d+, the least alike of 3 builds\)/.test(n))).toBe(true);
    expect((built.madeBy.fingerprint as { closest?: string }).closest).toBe('Level 1');
    // Alone in the game: the first checked build, as before (no comparing to do).
    const alone = empty();
    const solo = buildLevel(alone, alone.scenes[0].id, { difficulty: 3, seed: 7 }, registry);
    expect(solo.attempts).toBeLessThanOrEqual(2);
  });

  it('ten levels of one game: none too alike, built around different things, of different structures, with many different sections', { timeout: 300000 }, () => {
    const { p, fps } = tenLevels(100);
    const scores = pairwise(fps);
    expect(Math.max(...scores)).toBeLessThan(TOO_ALIKE);
    expect(new Set(fps.map((f) => f.signature)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(fps.map((f) => f.structure)).size).toBeGreaterThanOrEqual(4);
    const sequences = fps.map((f) => f.sections.map((x) => x.split(':')[1].split('@')[0]).join(' '));
    expect(new Set(sequences).size).toBe(10);
    expect(new Set(fps.flatMap((f) => f.sections.map((x) => x.split(':')[1].split('@')[0]))).size).toBeGreaterThanOrEqual(25);
    // The difficulty rises across them (the curve, with its breathers).
    const ds = p.scenes.slice(1).map((s) => Number(s.madeBy!.blueprint.difficulty));
    expect(ds[9]).toBeGreaterThan(ds[0]);
    // Each was checked playable.
    expect(p.scenes.slice(1).every((s) => s.entities.length > 20)).toBe(true);
  });

  it('comparing a few builds makes levels less alike than taking the first', { timeout: 300000 }, () => {
    const worst = (candidates: number) => [100, 200].map((s) => Math.max(...pairwise(tenLevels(s, candidates).fps))).reduce((a, b) => a + b, 0);
    expect(worst(3)).toBeLessThanOrEqual(worst(1));
  });

  it("the AI is told the game's levels briefly (structure, what each is about, its sections)", () => {
    const { p } = tenLevels(300);
    const lines = builderInfo(p, registry)!.levels as string[];
    expect(lines).toHaveLength(10);
    expect(lines[0]).toMatch(/^Level 2: (run|climb|descent|loop|hub), about \w+ \(/);
  });
});
