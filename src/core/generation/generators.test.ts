/**
 * F6a: level generators behind one interface, chosen by the game's profile
 * (docs/engine-architecture-proposal.md §22.1). What they build is pinned by goldens (regression/generators.test,
 * regression/validation.test's sweeps); here: that every caller goes through the interface, that only an active
 * generator builds (in play, in the editor's example, for the AI) and the compatibility report says the same, that
 * existing games keep their random levels, and that a new generator plugs in.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { boulderDash, mining, spaceShooter } from '../../regression/games/action';
import { drMario, tetris } from '../../regression/games/boards';
import { roguelike } from '../../regression/generators.test';
import { Runtime } from '../../runtime/runtime';
import { buildAIPayload } from '../ai/context';
import { createBuiltinRegistry } from '../components/builtin';
import { gamePlayGenerators, generatorStatus, GENERATORS, registerGeneratorKind, selectedGenerators, unregisterGeneratorKind } from '../engine/generators';
import { modules, type GeneratorModule } from '../engine/modules';
import { PRESETS } from '../engine/presets';
import { checkGame, profileOf, projectFromPreset, setGameProfile } from '../engine/profile';
import { buildLevel, builderFor } from '../levelGen/build';
import { instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { migrateProject } from '../serialization/migrations';
import type { Project } from '../types';
import { playGeneratorFor, playGeneratorIds, registerPlayGenerator, unregisterPlayGenerator } from './playGenerators';

const registry = createBuiltinRegistry();
const at = (rt: Runtime) => rt.entities.map((e) => [e.name, e.x, e.y]);
const play = (p: Project, floor = 1) => new Runtime(p, p.scenes[0].id, registry, new Map([['floor', floor]]));

describe('F6a: one interface, and nothing round it', () => {
  it('every generator is declared once, registered as a module with no pointer to old code, and implemented', () => {
    const mods = modules.list<GeneratorModule>('generator');
    expect(mods.map((g) => g.id).sort()).toEqual(GENERATORS.map((g) => g.id).sort());
    expect(mods.filter((g) => g.pointsTo)).toEqual([]);
    for (const g of mods) expect(g.when === 'edit' ? !!g.build : !!g.atPlay, g.id).toBe(true);
    expect(playGeneratorIds()).toEqual(GENERATORS.filter((g) => g.when === 'play').map((g) => g.id));
  });

  it('no code builds a level round the interface: only the generator modules call the generators', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes('.generated.')) files.push(p);
      }
    };
    walk('src');
    const callers = (name: RegExp, allowed: string[]) =>
      files.filter((f) => name.test(readFileSync(f, 'utf8')) && !allowed.some((a) => f.replace(/\\/g, '/').endsWith(a))).map((f) => f.replace(/\\/g, '/'));
    // The dungeon's own functions: its file, and its play-time generator.
    expect(callers(/\b(generateDungeon|withDungeon)\(/, ['core/model/dungeon.ts', 'core/generation/playGenerators.ts'])).toEqual([]);
    // The sections builder: its file, and its module.
    expect(callers(/\bgenerateLevel\(/, ['core/levelGen/generate.ts', 'core/engine/modules.ts'])).toEqual([]);
    // (The dungeon's file is imported for its types, its default recipe, the next level and a new seed: not to build.)
    const importers = files.filter((f) => /import \{[^}]*\b(generateDungeon|withDungeon|buildLevel)\b[^}]*\} from '[^']*model\/dungeon'/.test(readFileSync(f, 'utf8'))).map((f) => f.replace(/\\/g, '/'));
    expect(importers).toEqual(['src/core/generation/playGenerators.ts']);
  });

  it('presets: the roguelike has the dungeon generator active; the platformers build with sections; the others have none', () => {
    const byPreset = Object.fromEntries(PRESETS.map((p) => [p.id, selectedGenerators(p.profile)]));
    expect(byPreset).toEqual({ platformer: ['sections'], 'classic-platformer': ['sections'], 'puzzle-platformer': ['sections'], topdown: [], rpg: [], roguelike: ['dungeon'], isometric: [] });
    expect([...gamePlayGenerators(projectFromPreset('roguelike', registry))]).toEqual(['dungeon']);
    expect([...gamePlayGenerators(projectFromPreset('platformer', registry))]).toEqual([]);
  });

  it('boards, shooters, mining and Boulder Dash: nothing is generated in their play; a level builder is theirs only if their profile has one', () => {
    for (const g of [tetris(registry), drMario(registry, []), spaceShooter(registry), mining(registry), boulderDash(registry)]) {
      expect(playGeneratorFor(g, g.scenes[0]), g.name).toBeNull();
      expect([...gamePlayGenerators(g)], g.name).toEqual([]);
      // (Made on the top-down preset: no builder. The mining game is made on the platformer preset: it has that one's.)
      expect(builderFor(g, registry), g.name).toBe(selectedGenerators(profileOf(g, registry)).includes('sections') ? 'classic' : null);
      expect(checkGame(g, registry).state, g.name).toBe('ok');
    }
  });
});

describe('F6a: only an active generator builds, and the report says the same', () => {
  /** The roguelike with the dungeon generator taken out of its profile (its level keeps its recipe). */
  const without = () => produce(roguelike({ seed: 7 }), (d) => void setGameProfile(d, { generator: null }, registry));

  it('active: the level is built at play, the editor shows its example, the AI is told of it; nothing to report', () => {
    const p = roguelike({ seed: 7 });
    const rt = play(p);
    expect(rt.dungeon).not.toBeNull();
    expect(rt.entities.length).toBeGreaterThan(p.scenes[0].entities.length + 20);
    expect(playGeneratorFor(p, p.scenes[0])?.id).toBe('dungeon');
    expect(checkGame(p, registry).state).toBe('ok');
    const ctx = buildAIPayload(p, { kind: 'level', sceneId: p.scenes[0].id } as never, registry) as unknown as { level: { generator: { example: { rooms?: number; things?: number } } } };
    expect(ctx.level.generator.example.things).toBeGreaterThan(20);
  });

  it('not selected: the recipe is not built (the level plays as placed by hand), no example, and the report names the level', () => {
    const p = without();
    expect(p.scenes[0].generator).toBeTruthy();
    const rt = play(p);
    expect(rt.dungeon).toBeNull();
    expect(rt.entities.length).toBe(p.scenes[0].entities.length);
    expect(playGeneratorFor(p, p.scenes[0])).toBeNull();
    const check = checkGame(p, registry);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(new RegExp(`${p.scenes[0].name}.*doesn't select the generator "dungeon".*not built`));
    const ctx = buildAIPayload(p, { kind: 'level', sceneId: p.scenes[0].id } as never, registry) as unknown as { level: { generator: { example: { problems: string[] } } }; game: { works?: string[] } };
    expect(ctx.level.generator.example.problems.join(' ')).toMatch(/not built/);
    expect(ctx.game.works?.join(' ')).toMatch(/dungeon/);
    // (Keeping its example as objects has nothing to keep: said.)
    expect(() => produce(p, (d) => m.keepDungeon(d, d.scenes[0].id, registry))).toThrow(/isn't built in this game/);
  });

  it('selected again beside another builder: built again, exactly as before', () => {
    const again = produce(without(), (d) => void setGameProfile(d, { alsoGenerators: ['dungeon'] }, registry));
    expect(profileOf(again, registry).generator).toMatchObject({ id: null, also: ['dungeon'] });
    expect(at(play(again))).toEqual(at(play(roguelike({ seed: 7 }))));
  });

  it('while editing: a profile with no level builder builds nothing, and says why (no other builder steps in)', () => {
    const p = produce(projectFromPreset('platformer', registry), (d) => void setGameProfile(d, { generator: null }, registry));
    expect(() => buildLevel(p, p.scenes[0].id, { difficulty: 3, seed: 1 }, registry)).toThrow(/no level builder/);
    const top = projectFromPreset('topdown', registry);
    expect(() => buildLevel(top, top.scenes[0].id, { difficulty: 3, seed: 1 }, registry)).toThrow(/Only platformer levels/);
    // (With one: built.)
    const ok = projectFromPreset('classic-platformer', registry);
    expect(buildLevel(ok, ok.scenes[0].id, { difficulty: 3, seed: 1 }, registry).ops.length).toBeGreaterThan(0);
  });
});

describe('F6a: existing games keep their random levels', () => {
  it('a roguelike saved without a stored profile: the generator is worked out from the game, and it builds the same', () => {
    const p = roguelike({ seed: 9 });
    const old = produce(p, (d) => void delete d.settings.profile);
    expect(selectedGenerators(profileOf(old, registry))).toEqual(['dungeon']);
    expect(at(play(old, 2))).toEqual(at(play(p, 2)));
  });

  it('a top-down game given a random level: the profile selects the generator as the recipe is set (stored), or it is worked out (not stored)', () => {
    const base = projectFromPreset('topdown', registry);
    expect(selectedGenerators(profileOf(base, registry))).toEqual([]);
    const stored = produce(base, (d) => m.setGenerator(d, d.scenes[0].id, { seed: 3 }));
    expect(stored.settings.profile!.generator).toMatchObject({ id: null, also: ['dungeon'] });
    expect(play(stored).dungeon).not.toBeNull();
    const worked = produce(base, (d) => {
      delete d.settings.profile;
      m.setGenerator(d, d.scenes[0].id, { seed: 3 });
    });
    expect(worked.settings.profile).toBeUndefined();
    expect(selectedGenerators(profileOf(worked, registry))).toEqual(['dungeon']);
    expect(at(play(worked))).toEqual(at(play(stored)));
  });

  it('format 18: a saved game with a random level and a profile that doesn\'t select the generator gets it; others are untouched', () => {
    const profile = PRESETS.find((p) => p.id === 'topdown')!.profile;
    const saved = { formatVersion: 17, name: 'Old', settings: { profile }, scenes: [{ name: 'Depths', generator: { style: 'rooms' } }, { name: 'Town' }] };
    const now = migrateProject(structuredClone(saved)) as typeof saved & { settings: { profile: typeof profile } };
    expect(now.settings.profile.generator).toEqual({ id: null, settings: {}, also: ['dungeon'] });
    const plain = { formatVersion: 17, name: 'Plain', settings: { profile }, scenes: [{ name: 'Town' }] };
    expect((migrateProject(structuredClone(plain)) as typeof plain).settings).toEqual(plain.settings);
    const rogue = { formatVersion: 17, name: 'Rogue', settings: { profile: PRESETS.find((p) => p.id === 'roguelike')!.profile }, scenes: [{ name: 'Floor', generator: {} }] };
    expect((migrateProject(structuredClone(rogue)) as typeof rogue).settings).toEqual(rogue.settings);
  });
});

describe('F6a: a new generator plugs in', () => {
  it('a play-time generator only a test knows: declared, registered, selected by a profile; it builds its levels in play; nothing else changed for it', () => {
    const calls: number[] = [];
    registerGeneratorKind({ id: 'test_ring', version: 1, when: 'play', describe: 'a ring of walls', requires: [], without: 'no ring is built' });
    registerPlayGenerator({
      id: 'test_ring',
      applies: (scene) => scene.name === 'Ring',
      build({ project, scene, floor, seed }) {
        calls.push(floor);
        const wall = project.definitions.find((d) => d.name === 'Wall')!;
        const ring = [0, 1, 2, 3].map((i) => ({ ...instantiateDefinition(wall, { x: 16 + i * 32, y: 16 }), id: `ring_${i}` }));
        return { scene: { ...scene, entities: [...ring, ...scene.entities] }, built: null, seed: seed ?? 1, patchRefused: false };
      },
      example: () => ({ entities: [], start: null, stairs: null, rooms: 0, roomList: [], locked: null, problems: [] }),
    });
    modules.register<GeneratorModule>({ kind: 'generator', id: 'test_ring', version: 1, when: 'play', describe: 'a ring of walls', requires: [], provides: ['generator:test_ring'], without: 'no ring is built', validators: () => [] });
    try {
      const base = produce(projectFromPreset('topdown', registry), (d) => void (d.scenes[0].name = 'Ring'));
      // Not selected: not built.
      expect(play(base).entities.filter((e) => e.id.startsWith('ring_')).length).toBe(0);
      const p = produce(base, (d) => void setGameProfile(d, { alsoGenerators: ['test_ring'] }, registry));
      expect(generatorStatus(profileOf(p, registry)).active).toEqual(['test_ring']);
      expect(play(p, 3).entities.filter((e) => e.id.startsWith('ring_')).length).toBe(4);
      expect(calls).toEqual([3]);
      expect(checkGame(p, registry).state).toBe('ok');
    } finally {
      unregisterPlayGenerator('test_ring');
      unregisterGeneratorKind('test_ring');
      modules.unregister('generator', 'test_ring');
    }
  });
});
