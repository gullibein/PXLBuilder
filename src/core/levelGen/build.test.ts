import { produce } from 'immer';
import { setLevelProfile } from '../engine/profile';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations, type Operation } from '../commands/operations';
import { createProject } from '../model/factory';
import * as m from '../model/mutations';
import { levelReachability } from '../model/reachability';
import type { Project } from '../types';
import { applyBuilt, blueprintFor, builderFor, builderInfo, buildLevel, difficultyCurve, newBuiltLevel, noBuilderReason, themeAvoids, usualLength, usualLengthFor } from './build';

const registry = createBuiltinRegistry();
const ops = (p: Project, list: unknown[]) => produce(p, (d) => void applyOperations(d, list as Operation[], registry));
const gen = (sceneId: string, extra: Record<string, unknown> = {}) => ({ op: 'generate_level', sceneId, difficulty: 2, structure: null, length: 'short', focus: [], escalate: null, avoid: [], secrets: 0, concept: null, sections: [], ...extra });

describe('levels built into a game', () => {
  it('generate_level: a new level (by its create_level ref) built whole, with the record of how, and a note saying so', () => {
    const p = createProject(registry);
    let notes: string[] = [];
    const after = produce(p, (d) => {
      const r = applyOperations(d, [{ op: 'create_level', ref: 'L2', name: 'Level 2' }, gen('L2', { structure: 'climb', focus: ['spring'], concept: 'springs up' })] as Operation[], registry);
      notes = r.notes ?? [];
    });
    const scene = after.scenes[1];
    expect(scene.madeBy).toMatchObject({ generator: 'classic', blueprint: { difficulty: 2, structure: 'climb', focus: ['spring'], concept: 'springs up' } });
    expect(scene.entities.length).toBeGreaterThan(40);
    expect(levelReachability(after, scene.id, registry).status).not.toBe('no-player');
    expect(notes.some((n) => /Level 2: built by the engine \(climb, short: 2\d by 21 cells, \d+ sections, checked: playable/.test(n))).toBe(true);
  });

  it("generate_level says what's wrong: a mechanic that isn't one, a level that can't be built", () => {
    const p = createProject(registry);
    expect(() => ops(p, [gen(p.scenes[0].id, { focus: ['lasers'] })])).toThrow(/generate_level: focus\.0/);
    const noLadder = produce(p, (d) => void (d.definitions = d.definitions.filter((x) => x.name !== 'Ladder')));
    expect(() => ops(noLadder, [gen(p.scenes[0].id, { structure: 'climb' })])).toThrow(/generate_level: A climb level needs/);
    expect(() => ops(p, [gen(p.scenes[0].id, { sections: [{ role: null, pattern: null, variant: null, harder: false, map: ['xx', '##'], legend: [{ char: '#', part: 'ground' }] }] })])).toThrow(/doesn't say what "x" is/);
  });

  it('set_level_profile keeps the kind and look; a theme that is not one is refused', () => {
    const p = createProject(registry);
    expect(ops(p, [{ op: 'set_level_profile', genre: 'classic', theme: 'castle' }]).settings.profile).toMatchObject({ generator: { id: 'sections', settings: { genre: 'classic' } }, theme: 'castle' });
    expect(() => ops(p, [{ op: 'set_level_profile', genre: 'classic', theme: 'moon' }])).toThrow(/no theme "moon"/);
  });

  it('which builder a game has: classic and puzzle platformers each their own; top-down games never', () => {
    expect(builderFor(createProject(registry), registry)).toBe('classic');
    const puzzle = produce(createProject(registry), (d) => void setLevelProfile(d, 'puzzle', 'castle', registry));
    expect(builderFor(puzzle, registry)).toBe('puzzle');
    expect(noBuilderReason(puzzle, registry)).toBeNull();
    // (What the AI is told for a puzzle game: its own patterns.)
    expect((builderInfo(puzzle, registry)!.patterns as string[]).some((x) => x.startsWith('plate_door ('))).toBe(true);
    expect(builderFor(createProject(registry, 'T', 'topdown'), registry)).toBeNull();
    expect(noBuilderReason(createProject(registry, 'T', 'topdown'), registry)).toMatch(/Only platformer/);
  });

  it('what the AI is told: structures, mechanics, and only the patterns (and variants) the game has the parts for', () => {
    const p = createProject(registry);
    const info = builderInfo(p, registry)!;
    expect(info.genre).toBe('classic');
    expect((info.patterns as string[]).some((x) => x.startsWith('pipes ('))).toBe(true);
    const noPipes = produce(p, (d) => void (d.definitions = d.definitions.filter((x) => !x.tags.includes('pipe'))));
    expect((builderInfo(noPipes, registry)!.patterns as string[]).some((x) => x.startsWith('pipes'))).toBe(false);
    expect(JSON.stringify(info).length).toBeLessThan(3500);
  });

  it('New level / Regenerate / Variation: what each asks for', () => {
    let p = createProject(registry);
    // No level built by the engine yet: a new one is difficulty 2; there is nothing to vary.
    // (Its size is the game's usual one: several screens.)
    expect(blueprintFor(p, null, 'new', 5)!.blueprint).toEqual({ difficulty: 2, length: 'very_long', seed: 5 });
    expect(blueprintFor(p, p.scenes[0].id, 'variation', 5)).toBeNull();
    const built = buildLevel(p, p.scenes[0].id, { difficulty: 3, seed: 8, focus: ['pipe'] }, registry);
    p = produce(p, (d) => void applyBuilt(d, d.scenes[0].id, built, registry));
    // New: the game's difficulty curve (the 2nd built level, after a difficulty 3 one: 3), another structure and
    // another mechanic to build around than the last.
    const next = blueprintFor(p, null, 'new', 6)!;
    // (The 2nd built level: 2 on the curve; the first was 3, so not less than 2.)
    expect(next.blueprint).toEqual({ difficulty: 2, length: 'very_long', seed: 6 });
    expect(next.avoidStructures).toEqual([(built.madeBy.fingerprint as { structure: string }).structure]);
    // Regenerate: the same blueprint, another seed.
    expect(blueprintFor(p, p.scenes[0].id, 'regenerate', 9)!.blueprint).toMatchObject({ difficulty: 3, focus: ['pipe'], seed: 9 });
    // Variation: the same structure, length and sections, another seed: the same plan built afresh.
    const v = blueprintFor(p, p.scenes[0].id, 'variation', 10)!.blueprint as { structure: string; sections: { pattern: string }[] };
    expect(v.structure).toBe((built.madeBy.fingerprint as { structure: string }).structure);
    const plan = (built.madeBy.fingerprint as { sections: string[] }).sections.filter((x) => !/^(intro|finale)/.test(x)).map((x) => x.split(':')[1].split('/')[0]);
    expect(v.sections.map((x) => x.pattern)).toEqual(plan);
    const again = buildLevel(p, p.scenes[0].id, v, registry);
    // (Its sections: the same patterns and variants; the start and goal are picked afresh.)
    const middle = (r: typeof built) => (r.madeBy.fingerprint as { sections: string[] }).sections.filter((x) => !/^(intro|finale)/.test(x)).map((x) => x.split('@')[0].split(':')[1]);
    // (In the same order; with room left over at another seed, the builder may add a rest after them.)
    expect(middle(again).slice(0, middle(built).length)).toEqual(middle(built));
    expect(again.rows).not.toEqual(built.rows);
  });

  it('how big a game\'s levels are when nobody says: several screens, never the one-screen size', () => {
    // Several screens (every third the biggest); a breather every fourth, two to three.
    expect(Array.from({ length: 9 }, (_, i) => usualLength(i + 1))).toEqual(['very_long', 'very_long', 'huge', 'long', 'very_long', 'huge', 'very_long', 'long', 'huge']);
    // The AI's generate_level without a length gets it, and the note says how big the level came out.
    const p = createProject(registry);
    const id = p.scenes[0].id;
    let notes: string[] = [];
    const first = produce(p, (d) => void (notes = applyOperations(d, [gen(id, { length: null, structure: 'run', seed: 3 }) as never], registry).notes ?? []));
    expect(first.scenes[0].madeBy!.blueprint.length).toBe('very_long');
    expect(notes.join(' ')).toMatch(/built by the engine \(run, very long: 12\d by 19 cells, \d+ sections, checked: playable/);
    // (Asked for: kept, a short one too.)
    const short = produce(p, (d) => void applyOperations(d, [gen(id, { structure: 'run', seed: 3 }) as never], registry));
    expect(short.scenes[0].madeBy!.blueprint.length).toBe('short');
    // The game's second level: several screens long, and higher than one screen's 15 rows.
    const two = produce(first, (d) => {
      const made = applyOperations(d, [{ op: 'create_level', ref: 'l2', name: 'Level 2' } as never, gen('l2', { length: null, structure: 'run', seed: 4 }) as never], registry);
      notes = made.notes ?? [];
    });
    expect(two.scenes[1].madeBy!.blueprint.length).toBe('very_long');
    const size = (two.scenes[1].madeBy!.fingerprint as { size: [number, number] }).size;
    expect(size[0]).toBeGreaterThanOrEqual(120);
    expect(size[1]).toBe(19);
    expect(usualLengthFor(two, two.scenes[1].id)).toBe('very_long');
    expect(usualLengthFor(two, null)).toBe('huge');
    // A puzzle platformer: never bigger than its builder builds.
    const puzzle = produce(two, (d) => void setLevelProfile(d, 'puzzle', 'forest', registry));
    expect(builderFor(puzzle, registry)).toBe('puzzle');
    expect(usualLengthFor(puzzle, null, registry)).toBe('long');
    expect(usualLengthFor(two, null, registry)).toBe('huge');
    expect(blueprintFor(puzzle, null, 'new', 1, registry)!.blueprint.length).toBe('long');
  });

  it('a big level can be varied and built again: the same plan (all its sections, 16 and more), the same size', { timeout: 120000 }, () => {
    // (A variation names every section of the level; plans were limited to 16, and the big levels have up to 45.)
    for (const [structure, length, seed] of [['climb', 'very_long', 1], ['run', 'huge', 2], ['loop', 'huge', 3], ['descent', 'huge', 4]] as const) {
      let p = createProject(registry);
      const id = p.scenes[0].id;
      const built = buildLevel(p, id, { difficulty: 3, structure, seed, length }, registry);
      p = produce(p, (d) => void applyBuilt(d, id, built, registry));
      const fp = (r: typeof built) => r.madeBy.fingerprint as { length: string; sections: string[]; size: [number, number] };
      expect(fp(built).sections.length, `${structure} ${length}`).toBeGreaterThan(16);
      const v = buildLevel(p, id, blueprintFor(p, id, 'variation', 77, registry)!.blueprint, registry);
      expect(v.state, `${structure} ${length} variation: ${v.notes.join('; ')}`).toBe('validated');
      expect(fp(v).length).toBe(length);
      // (Nearly all of them fit again: at another seed a few come out wider, and the last ones find no room.)
      expect(fp(v).sections.length).toBeGreaterThanOrEqual(fp(built).sections.length * 0.8);
      expect(v.rows).not.toEqual(built.rows);
      const again = buildLevel(p, id, blueprintFor(p, id, 'regenerate', 78, registry)!.blueprint, registry);
      expect(again.state, `${structure} ${length} again`).toBe('validated');
      expect(fp(again).length).toBe(length);
    }
  });

  it('the difficulty across a game: up a step every two levels, a short breather every fourth, never past 5', () => {
    const curve: number[] = [];
    let prev = 0;
    for (let n = 1; n <= 10; n++) {
      const c = difficultyCurve(n, prev);
      curve.push(c.difficulty);
      expect(c.breather).toBe(n % 4 === 0);
      prev = c.difficulty;
    }
    expect(curve).toEqual([2, 2, 3, 2, 4, 4, 5, 4, 5, 5]);
    // (Never more than a step easier than the level before.)
    expect(difficultyCurve(2, 5).difficulty).toBe(4);
  });

  it('the look rules mechanics out: no swimming in a space station, no grassy slopes in a castle', () => {
    const space = produce(createProject(registry), (d) => void setLevelProfile(d, 'classic', 'space', registry));
    expect(themeAvoids(space, registry)).toEqual(['water', 'ramp']);
    const forest = produce(createProject(registry), (d) => void setLevelProfile(d, 'classic', 'forest', registry));
    expect(themeAvoids(forest, registry)).toEqual([]);
    const sections = (p: Project) => Array.from({ length: 6 }, (_, seed) => (buildLevel(p, p.scenes[0].id, { difficulty: 3, seed, structure: 'run', length: 'long', focus: ['water', 'ramp'] }, registry).madeBy.fingerprint as { sections: string[] }).sections).flat();
    expect(sections(space).some((x) => /:(pool|slopes)\//.test(x))).toBe(false);
    expect(sections(forest).some((x) => /:(pool|slopes)\//.test(x))).toBe(true);
  }, 60000);

  it("a new built level is like the game's last one (gravity, background, camera)", () => {
    const p = produce(createProject(registry), (d) => {
      d.scenes[0].world.gravity.y = 1200;
      d.scenes[0].world.background.parallax = 0.4;
    });
    const { scene, built } = newBuiltLevel(p, 'Level 2', { difficulty: 2, seed: 3 }, registry);
    expect(scene.world.gravity.y).toBe(1200);
    expect(scene.world.background.parallax).toBe(0.4);
    const after = produce(p, (d) => {
      m.addScene(d, scene);
      applyBuilt(d, scene.id, built, registry);
    });
    expect(after.scenes[1].madeBy?.seed).toBe(3);
    expect(after.scenes[1].entities.length).toBeGreaterThan(20);
  });
});
