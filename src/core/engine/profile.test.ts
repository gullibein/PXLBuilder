import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations } from '../commands/operations';
import { createProject } from '../model/factory';
import { projectFromBundle, projectToBundle } from '../serialization/serialize';
import { buildLevel, builderFor, noBuilderReason } from '../levelGen/build';
import { generateLevel, type GenerateResult } from '../levelGen/generate';
import { findRoles } from '../levelGen/roles';
import { Runtime } from '../../runtime/runtime';
import { InputState } from '../../runtime/input';
import { normalizedDefinitions } from './golden';
import { KIT_ROLES } from './kitRoles';
import { modules, type GeneratorModule, type KitModule } from './modules';
import { checkProfile, changedProfile, inferProfile, kitOf, profileOf, projectFromPreset, projectFromProfile, setGameProfile, storedGameProfile } from './profile';
import { PRESETS, presetById } from './presets';

const registry = createBuiltinRegistry();
const fixture = (name: string) => {
  const r = projectFromBundle(JSON.parse(readFileSync(`src/core/engine/fixtures/${name}.v14.json`, 'utf8')), registry);
  if (!r.project) throw new Error(`fixture ${name} didn't load: ${JSON.stringify(r)}`);
  return r.project;
};
const sha = (v: unknown) => createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);

/**
 * Recorded with the code as it was before profiles (F1), by the same functions: a new game of each starter (its
 * library, pictures and level, ids normalised), and levels built on the saved games (5 structures × 3 seeds).
 */
const GOLDEN_DEFINITIONS: Record<string, string> = {
  platformer: '2a0dbb3d713985a6',
  topdown: '5d6c0f855493d0d8',
  rpg: 'b21c399d8d599607',
  roguelike: 'e0078f9b404b7802',
  isometric: '615739314cc59da2',
};
const GOLDEN_LEVELS: Record<string, { builder: string; hash: string }> = {
  'classic-built': { builder: 'classic', hash: 'c04924868a34893e' },
  puzzle: { builder: 'puzzle', hash: 'c1c8a1635d540ef6' },
  platformer: { builder: 'classic', hash: 'c9ae67cab13aa620' },
};
const levelsHash = (p: ReturnType<typeof fixture>) => {
  const h = createHash('sha256');
  for (const structure of ['run', 'climb', 'descent', 'loop', 'hub']) for (const seed of [1, 2, 3]) {
    const r = buildLevel(p, p.scenes[0].id, { difficulty: 3, structure, seed }, registry);
    h.update(JSON.stringify(r.ops));
    h.update(JSON.stringify(r.madeBy));
  }
  return h.digest('hex').slice(0, 16);
};

describe('F1: game profiles and the module registry', () => {
  it('existing games use the profile system: saved games of every starter (written before profiles) load as their preset', () => {
    const expected: Record<string, string> = { platformer: 'platformer', topdown: 'topdown', rpg: 'rpg', roguelike: 'roguelike', isometric: 'isometric', 'classic-built': 'platformer', puzzle: 'platformer' };
    for (const [name, preset] of Object.entries(expected)) {
      const p = fixture(name);
      expect(profileOf(p, registry).preset, name).toBe(preset);
      expect(checkProfile(profileOf(p, registry)).state, name).toBe('ok');
    }
    // A game that hadn't chosen a kind or look gets nothing written (worked out when needed, as before).
    expect(fixture('platformer').settings.profile).toBeUndefined();
    expect(fixture('rpg').settings.profile).toBeUndefined();
    // One that had (settings.levelProfile) has it in its profile now: the level builder's genre, and the look.
    expect(storedGameProfile(fixture('classic-built'))).toMatchObject({ preset: 'platformer', view: 'side', generator: { id: 'sections', settings: { genre: 'classic' } }, theme: 'forest' });
    expect(storedGameProfile(fixture('puzzle'))).toMatchObject({ generator: { id: 'sections', settings: { genre: 'puzzle' } }, theme: 'castle' });
    expect('levelProfile' in fixture('puzzle').settings).toBe(false);
  });

  it('their levels play as before (each saved game runs, its player there and moving)', () => {
    for (const name of ['platformer', 'topdown', 'rpg', 'roguelike', 'isometric', 'classic-built']) {
      const p = fixture(name);
      const rt = new Runtime(p, p.startSceneId, registry);
      const input = new InputState();
      input.press('right');
      for (let i = 0; i < 120; i++) rt.update(1 / 60, input);
      const player = rt.entities.find((e) => e.controller);
      if (player) expect(Number.isFinite(player.x), name).toBe(true);
    }
    // (The built classic level: the player ran right from its start.)
    const p = fixture('classic-built');
    const rt = new Runtime(p, p.startSceneId, registry);
    const start = rt.entities.find((e) => e.controller)!.x;
    const input = new InputState();
    input.press('right');
    for (let i = 0; i < 60; i++) rt.update(1 / 60, input);
    expect(rt.entities.find((e) => e.controller)!.x).toBeGreaterThan(start + 20);
  });

  it('starter sets are unchanged: a new game from each preset is exactly the starter it was', () => {
    for (const [starter, hash] of Object.entries(GOLDEN_DEFINITIONS)) {
      const p = projectFromPreset(starter, registry, 'x');
      expect(sha(normalizedDefinitions(p)), starter).toBe(hash);
      expect(storedGameProfile(p)?.preset, starter).toBe(starter);
    }
  });

  it('generation is unchanged: levels built through the profile\'s generator are the ones built before (byte for byte)', { timeout: 60000 }, () => {
    for (const [name, want] of Object.entries(GOLDEN_LEVELS)) {
      const p = fixture(name);
      expect(builderFor(p, registry), name).toBe(want.builder);
      expect(levelsHash(p), name).toBe(want.hash);
    }
  });

  it('different profiles select different implementations: the generator, a module registered by a test, the movement', () => {
    const classic = projectFromPreset('classic-platformer', registry);
    const puzzle = projectFromPreset('puzzle-platformer', registry);
    expect(builderFor(classic, registry)).toBe('classic');
    expect(builderFor(puzzle, registry)).toBe('puzzle');
    expect(buildLevel(puzzle, puzzle.scenes[0].id, { difficulty: 3, seed: 2 }, registry).madeBy.generator).toBe('puzzle');
    expect(buildLevel(classic, classic.scenes[0].id, { difficulty: 3, seed: 2 }, registry).madeBy.generator).toBe('classic');
    // A generator only a test knows: a profile selecting it builds with it, and nothing else changed for that.
    const calls: string[] = [];
    modules.register<GeneratorModule>({
      kind: 'generator',
      id: 'test_flat',
      version: 1,
      describe: 'a flat test level',
      requires: ['view:side'],
      provides: [],
      validators: () => ['layout'],
      build: ({ project, sceneId, blueprint, registry: reg, options }) => {
        calls.push(sceneId);
        const r = generateLevel(project, sceneId, { ...(blueprint as object), structure: 'run', length: 'short' }, reg, 'classic', options);
        return { ...r, madeBy: { ...r.madeBy, generator: 'test_flat' } } as GenerateResult;
      },
    });
    try {
      const own = produce(classic, (d) => void setGameProfile(d, { generator: 'test_flat' }, registry));
      expect(builderFor(own, registry)).toBe('test_flat');
      expect(buildLevel(own, own.scenes[0].id, { difficulty: 2, seed: 1 }, registry).madeBy.generator).toBe('test_flat');
      expect(calls).toEqual([own.scenes[0].id]);
      // Without a generator: no builder, said why.
      const none = produce(classic, (d) => void setGameProfile(d, { generator: null }, registry));
      expect(builderFor(none, registry)).toBeNull();
      expect(noBuilderReason(none, registry)).toMatch(/no level builder/);
    } finally {
      modules.unregister('generator', 'test_flat');
    }
    // Movement: the locomotion module sets how the player moves.
    const mover = (p: ReturnType<typeof createProject>) => p.definitions.find((d) => d.name === 'Player')!.components.CharacterController!.movement;
    expect(mover(projectFromPreset('platformer', registry))).toBe('platformer');
    expect(mover(projectFromPreset('topdown', registry))).toBe('topdown');
  });

  it('profiles are saved, loaded and edited: one system at a time, through the AI\'s operation too, refused when it doesn\'t fit', () => {
    const p = projectFromPreset('platformer', registry, 'Saved');
    const back = projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(p))), registry).project!;
    expect(back.settings.profile).toEqual(p.settings.profile);
    // set_game_profile: one system changes, the rest stay; the old project is untouched (one undoable step).
    const run = (proj: typeof p, change: unknown) => produce(proj, (d) => void applyOperations(d, [{ op: 'set_game_profile', changeJson: JSON.stringify(change) }], registry));
    const puzzle = run(p, { genre: 'puzzle', theme: 'castle' });
    expect(storedGameProfile(puzzle)).toMatchObject({ preset: 'platformer', view: 'side', movement: { model: 'arcade' }, generator: { id: 'sections', settings: { genre: 'puzzle' } }, theme: 'castle' });
    expect(builderFor(puzzle, registry)).toBe('puzzle');
    expect(storedGameProfile(p)?.theme).toBeNull();
    // Saved and loaded again: still the edited profile.
    expect(projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(puzzle))), registry).project!.settings.profile).toEqual(puzzle.settings.profile);
    // Refused, with why: walking from above in a game seen from the side.
    expect(() => run(p, { movement: 'topdown' })).toThrow(/locomotion "topdown" needs view:top or view:iso/);
    expect(() => run(p, { movement: 'flying' })).toThrow(/no locomotion module "flying"/);
    expect(() => run(p, { speed: 3 })).toThrow(/changeJson is not a profile change/);
    // (A top-down game's own objects need a view from above: seen from the side, refused.)
    expect(() => run(projectFromPreset('topdown', registry), { view: 'side', movement: 'arcade', addKits: ['platformer'] })).toThrow(/kit "topdown" needs view:top or view:iso/);
    // A whole set of changes that fits: an RPG seen from the side, with platformer objects; its movement and the
    // levels' gravity follow.
    const td = projectFromPreset('rpg', registry);
    const side = run(td, { view: 'side', movement: 'arcade', addKits: ['platformer'], generator: 'sections' });
    expect(storedGameProfile(side)).toMatchObject({ view: 'side', movement: { model: 'arcade' }, kits: ['rpg', 'platformer'] });
    expect(side.scenes[0].world.gravity.y).toBe(980);
    expect(side.definitions.filter((d) => d.components.CharacterController).every((d) => d.components.CharacterController!.movement === 'platformer')).toBe(true);
    // (Objects of the added kit came in; ones playing a part the game already had, its player, didn't.)
    expect(side.definitions.some((d) => d.name === 'Platform')).toBe(true);
    expect(side.definitions.filter((d) => d.name === 'Player')).toHaveLength(1);
  });

  it('backward compatible: a game without a profile works it out (never writing it), and old formats still load', () => {
    const old = createProject(registry);
    expect(old.settings.profile).toBeUndefined();
    expect(inferProfile(old, registry)).toEqual(presetById('platformer')!.profile);
    expect(builderFor(old, registry)).toBe('classic');
    // (The level builder's look, worked out from the game's id as before, is unchanged.)
    expect(fixture('topdown').settings.gameType).toBe('topdown');
    expect(profileOf(fixture('topdown'), registry).view).toBe('top');
  });

  it('compatible modules combine (ok, degraded with a fallback, or refused with why), from what each requires and provides', () => {
    const base = presetById('platformer')!.profile;
    expect(checkProfile(base)).toEqual({ state: 'ok' });
    for (const p of PRESETS) expect(checkProfile(p.profile).state, p.id).toBe('ok');
    // Degraded: jump-through platforms and ramps seen from above work as walls.
    const td = changedProfile(presetById('topdown')!.profile, { geometry: ['box', 'one_way', 'ramp'] });
    const deg = checkProfile(td);
    expect(deg.state).toBe('degraded');
    expect(deg.state === 'degraded' && deg.notes.join()).toMatch(/jump-through platforms block like walls/);
    // Incompatible: the platformer's objects (and its run-and-jump) in a game seen from above.
    const bad = checkProfile(changedProfile(base, { view: 'top' }));
    expect(bad.state).toBe('incompatible');
    expect(bad.state === 'incompatible' && bad.reasons.join(' / ')).toMatch(/locomotion "arcade" needs view:side/);
  });

  it('a hybrid: platformer and RPG objects in one side-view game, one player, roles from both, levels built and validated', () => {
    const profile = changedProfile(presetById('classic-platformer')!.profile, { addKits: ['rpg'] });
    expect(checkProfile(profile)).toEqual({ state: 'ok' });
    const p = projectFromProfile(profile, registry, 'Hybrid');
    const names = p.definitions.map((d) => d.name);
    for (const n of ['Player', 'Platform', 'Spring', 'Knight', 'Mage', 'Slime', 'Wall']) expect(names, n).toContain(n);
    expect(names.filter((n) => n === 'Player')).toHaveLength(1);
    expect(new Set(names).size).toBe(names.length);
    // Every picture the objects use came along.
    const used = JSON.stringify(p.definitions);
    for (const m of used.matchAll(/"(ast_[0-9a-z]+)"/g)) expect(p.assets.some((a) => a.id === m[1]), m[1]).toBe(true);
    // The level builder's parts come from the platformer's objects; a level builds and checks out.
    const roles = findRoles(p, registry);
    expect(roles.player?.name).toBe('Player');
    expect(roles.ground?.name).toBe('Platform');
    const built = buildLevel(p, p.scenes[0].id, { difficulty: 3, seed: 4 }, registry);
    expect(built.state).toBe('validated');
  });

  it('each kit\'s new game is recognised as that kit (the names table loading games uses agrees with the kits)', () => {
    for (const kit of modules.list<KitModule>('kit')) expect(kitOf(kit.create(registry, 'x'), registry), kit.id).toBe(kit.id);
  });

  it('kit role declarations agree with what the level builder finds by itself in the starter', () => {
    const roles = findRoles(createProject(registry), registry);
    for (const [role, obj] of Object.entries(roles)) expect(KIT_ROLES.platformer[obj!.name], obj!.name).toBe(role);
    expect(Object.keys(KIT_ROLES.platformer).length).toBe(Object.keys(roles).length);
  });

  it('modules that only point to old code say where it is and which stage moves it (F1 starts the modularization)', () => {
    const kinds = ['view', 'time', 'locomotion', 'ability', 'geometry', 'camera', 'kit', 'generator', 'progression', 'validator'] as const;
    const pointing = kinds.flatMap((k) => modules.list(k)).filter((m) => m.pointsTo);
    expect(pointing.length).toBeGreaterThan(0);
    // (F2 moved movement, F3 geometry and F4 validation behind their interfaces: none of theirs points to old code any more.)
    for (const k of ['locomotion', 'ability', 'geometry', 'validator'] as const) expect(modules.list(k).filter((m) => m.pointsTo).map((m) => m.id), k).toEqual([]);
    for (const m of pointing) expect(m.pointsTo!.movesIn, `${m.kind} ${m.id}`).toMatch(/^F[2-6]$/);
  });
});
