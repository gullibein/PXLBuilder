/**
 * F6c: turn-taking as a capability the game's profile selects beside the engine's one clock, real time
 * (docs/engine-architecture-proposal.md §22.7). Real time and turns in one game; refused, and said, where the
 * profile doesn't select turns; existing games keep theirs; another turn system plugs in.
 * (What turn-based games do, frame by frame, is pinned in regression/turns.test.)
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { modules } from '../core/engine/modules';
import { PRESETS } from '../core/engine/presets';
import { checkGame, checkProfile, changedProfile, profileOf, projectFromPreset, setGameProfile } from '../core/engine/profile';
import { TURN_SYSTEMS, gameTurns, turnStatus } from '../core/engine/turns';
import { createDefinition, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { checkScript } from '../core/script/language';
import { setScript } from '../core/script/mutations';
import { migrateProject } from '../core/serialization/migrations';
import type { Project } from '../core/types';
import { boulderDash, mining, spaceShooter } from '../regression/games/action';
import { drMario, tetris } from '../regression/games/boards';
import { rpgGame, tacticsBoard } from '../regression/games/turnBased';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';
import { registerTurnSystem, turnSystemIds, unregisterTurnSystem, type TurnSystem } from './turnSystem';

const registry = createBuiltinRegistry();

/** Random numbers that are the same every run (mulberry32). */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function play(p: Project, scene = 0) {
  const rt = new Runtime(p, p.scenes[scene].id, registry);
  // (The same random numbers every run: what wanders by itself goes the same way.)
  rt.random = seededRandom(5);
  const input = new InputState();
  const step = (seconds: number) => {
    for (let i = 0; i < Math.max(1, Math.round(seconds * 120)); i++) rt.update(1 / 120, input);
  };
  const tap = (a: Action) => {
    input.press(a);
    step(1 / 120);
    input.release(a);
    step(2 / 120);
  };
  return { rt, input, step, tap };
}

describe('F6c: one clock, and turn-taking beside it', () => {
  it('the engine has one time model (real time); turn systems are declared once, registered, implemented; none points to old code', () => {
    expect(modules.list('time').map((t) => t.id)).toEqual(['realtime']);
    expect(modules.list('turns').map((t) => t.id)).toEqual(TURN_SYSTEMS.map((t) => t.id));
    expect(turnSystemIds()).toEqual(TURN_SYSTEMS.map((t) => t.id));
    expect([...modules.list('time'), ...modules.list('turns')].filter((x) => x.pointsTo)).toEqual([]);
  });

  it('presets: every game runs in real time; the RPG also takes turns; the roguelike\'s steps are its scripts\' own (no turn system)', () => {
    for (const p of PRESETS) expect(p.profile.time, p.id).toBe('realtime');
    expect(Object.fromEntries(PRESETS.map((p) => [p.id, p.profile.turns ?? []]))).toEqual({ platformer: [], 'classic-platformer': [], 'puzzle-platformer': [], topdown: [], rpg: ['team_turns'], roguelike: [], isometric: [] });
    for (const p of PRESETS) expect(checkProfile(p.profile).state, p.id).toBe('ok');
    const rogue = new Runtime(projectFromPreset('roguelike', registry), projectFromPreset('roguelike', registry).scenes[0].id, registry);
    expect(rogue.turns).toBeNull();
  });
});

describe('F6c: real time and turns in one game', () => {
  it('an RPG: its map runs in real time (the hero walks, an enemy wanders), its battle level takes turns; one profile for both', () => {
    const p = rpgGame(registry);
    expect(gameTurns(p)).toEqual(['team_turns']);
    const map = play(p, 0);
    const wanderer = map.rt.entities.find((e) => e.name === 'Enemy')!;
    const hero = map.rt.entities.find((e) => e.controller)!;
    const [wx, hx] = [wanderer.x, hero.x];
    map.input.press('right');
    map.step(0.5);
    expect(hero.x).toBeGreaterThan(hx + 20);
    expect(wanderer.x !== wx || wanderer.y !== 240).toBe(true);
    expect(map.rt.turns!.team()).toBe('');
    // The battle: the same game, in turns.
    const battle = play(p, 1);
    battle.step(0.1);
    expect(battle.rt.turns!.team()).toBe('hero');
    expect(battle.rt.turns!.round()).toBe(1);
    expect(battle.rt.scripts.errors).toEqual([]);
  });

  /** One level: a hero and an imp who fight in turns, and an enemy that patrols by itself beside them. */
  const mixed = () =>
    produce(rpgGame(registry), (d) => {
      const scene = d.scenes[0];
      scene.entities = [];
      const place = (name: string, x: number, y: number) => m.addEntity(d, scene.id, instantiateDefinition(d.definitions.find((q) => q.name === name)!, { x, y }));
      place('Knight', 368, 112);
      place('Imp', 112, 112);
      place('Enemy', 240, 304);
      place(d.definitions.find((q) => q.components.CharacterController)!.name, 240, 400);
    });

  it('one level: a battle in turns starts, goes on and ends while something else keeps moving in real time; then the player walks again', () => {
    const { rt, step, tap, input } = play(mixed());
    const patrol = rt.entities.find((e) => e.name === 'Enemy')!;
    const knight = rt.entities.find((e) => e.name === 'Knight')!;
    const imp = rt.entities.find((e) => e.name === 'Imp')!;
    const player = rt.entities.find((e) => e.controller)!;
    step(0.1);
    expect(rt.turns!.team()).toBe('hero');
    expect(rt.turns!.isActing(knight)).toBe(true);
    // While the knight's menu waits for a choice, real time goes on: the patroller walks.
    const seen = new Set<string>();
    for (let i = 0; i < 10; i++) {
      step(0.2);
      seen.add(`${Math.round(patrol.x)},${Math.round(patrol.y)}`);
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(rt.turns!.isActing(knight)).toBe(true);
    expect(rt.turns!.round()).toBe(1);
    // The fight, turn by turn, to its end (Fight, the imp; the imp answers; again).
    for (let round = 0; round < 4 && imp.alive; round++) {
      tap('interact');
      tap('interact');
      step(1.2);
    }
    expect(imp.alive).toBe(false);
    expect(rt.turns!.over()).toBe(true);
    // (The wanderer goes on moving, as all along, whichever way it picks.)
    const after = new Set<string>();
    for (let i = 0; i < 10; i++) {
      step(0.3);
      after.add(`${Math.round(patrol.x)},${Math.round(patrol.y)}`);
    }
    expect(after.size).toBeGreaterThan(3);
    // The battle over, no menu up: the keys are the player's again, in real time.
    expect(rt.kit.menu).toBeNull();
    const x = player.x;
    input.press('right');
    step(0.4);
    expect(player.x).toBeGreaterThan(x + 10);
    expect(rt.scripts.errors).toEqual([]);
  });
});

describe('F6c: the profile decides whether anything takes turns (and the report says the same)', () => {
  const START = { name: 'Fight', description: '', vars: [], handlers: [{ when: { on: 'start' }, if: null, do: [{ do: 'start_turns', teams: ['player', 'enemy'], pick: [] }] }] };
  /** The platformer starter with its player and an enemy standing on a floor. */
  const platformer = () =>
    produce(projectFromPreset('platformer', registry), (d) => {
      const place = (name: string, x: number, y: number) => m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((q) => q.name === name)!, { x, y }));
      d.scenes[0].entities = [];
      for (let x = 16; x <= 304; x += 32) place('Platform', x, 112);
      place('Player', 48, 80);
      place('Enemy', 240, 80);
    });

  it('a script that takes turns, set on an object: the game\'s stored profile selects turn-taking with it; it works', () => {
    const p = produce(platformer(), (d) => void setScript(d, { target: 'definition', id: d.definitions.find((x) => x.name === 'Player')!.id }, START));
    expect(p.settings.profile!.turns).toEqual(['team_turns']);
    const { rt, step } = play(p);
    step(0.1);
    expect(rt.scripts.errors).toEqual([]);
    expect(rt.turns!.round()).toBe(1);
    expect(checkGame(p, registry).state).toBe('ok');
  });

  it('turn-taking taken out of the profile: turn statements are refused with a script error, nothing takes turns, and the report names the object', () => {
    const p = produce(platformer(), (d) => {
      setScript(d, { target: 'definition', id: d.definitions.find((x) => x.name === 'Player')!.id }, START);
      setGameProfile(d, { turns: [] }, registry);
    });
    expect(p.settings.profile!.turns).toBeUndefined();
    const { rt, step } = play(p);
    step(0.1);
    expect(rt.turns).toBeNull();
    expect(rt.kit.turns).toBeNull();
    expect(rt.scripts.errors.map((e) => e.message).join(' ')).toMatch(/need turn-taking, which this game's profile doesn't select/);
    const check = checkGame(p, registry);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(/Player.*doesn't select turns.*nothing takes turns/);
    // (The rest of the kit is for any game: a menu needs no turn-taking.)
    const menu = produce(platformer(), (d) => void setScript(d, { target: 'definition', id: d.definitions.find((x) => x.name === 'Player')!.id }, { name: 'Ask', description: '', vars: [], handlers: [{ when: { on: 'start' }, if: null, do: [{ do: 'menu', items: ['Yes', 'No'], title: 'Ready?', cancel: false, at: 'center' }] }] }));
    expect(menu.settings.profile!.turns).toBeUndefined();
    const m2 = play(menu);
    m2.step(0.1);
    expect(m2.rt.kit.menu?.items).toEqual(['Yes', 'No']);
    expect(m2.rt.scripts.errors).toEqual([]);
  });

  it('tactics: with a stored profile or a worked-out one, its turns go on; taken out of the profile, they stop, and that is said', () => {
    for (const stored of [true, false]) {
      const p = tacticsBoard(registry, stored);
      expect(gameTurns(p), `stored ${stored}`).toEqual(['team_turns']);
      expect(!!p.settings.profile, `stored ${stored}`).toBe(stored);
    }
    const off = produce(tacticsBoard(registry, true), (d) => void setGameProfile(d, { turns: [] }, registry));
    const { rt, step } = play(off);
    step(0.2);
    expect(rt.kit.turns).toBeNull();
    expect(checkGame(off, registry).state).toBe('degraded');
  });

  it('boards, shooters, mining and Boulder Dash take no turns: no turn system for them, nothing reported', () => {
    for (const g of [tetris(registry), drMario(registry, []), spaceShooter(registry), mining(registry), boulderDash(registry)]) {
      expect(gameTurns(g), g.name).toEqual([]);
      expect(new Runtime(g, g.scenes[0].id, registry).turns, g.name).toBeNull();
      expect(checkGame(g, registry).state, g.name).toBe('ok');
    }
  });

  it('an unknown turn system in a profile is refused', () => {
    expect(checkProfile(changedProfile(PRESETS[0].profile, { turns: ['initiative'] })).state).toBe('incompatible');
    expect(turnStatus(changedProfile(PRESETS[0].profile, { turns: ['team_turns'] })).active).toEqual(['team_turns']);
  });
});

describe('F6c: games saved before keep their turns (format 19)', () => {
  it('a roguelike\'s stored "time turns" becomes real time (as it always played); a tactics game\'s stored profile gets turn-taking; others are untouched', () => {
    const rogue = { formatVersion: 18, name: 'Rogue', settings: { profile: { ...PRESETS.find((p) => p.id === 'roguelike')!.profile, time: 'turns' } }, definitions: [], scenes: [] };
    const r = migrateProject(structuredClone(rogue)) as typeof rogue;
    expect(r.settings.profile.time).toBe('realtime');
    expect(r.settings.profile.turns).toBeUndefined();
    const tactics = tacticsBoard(registry, true);
    const saved = { ...JSON.parse(JSON.stringify(tactics)), formatVersion: 18 };
    delete saved.settings.profile.turns;
    const t = migrateProject(saved) as unknown as Project;
    expect(t.settings.profile!.turns).toEqual(['team_turns']);
    const plain = { formatVersion: 18, name: 'Plain', settings: { profile: PRESETS[0].profile }, definitions: [{ name: 'A', scripts: [{ handlers: [{ do: [{ do: 'signal', name: 'x' }] }] }] }], scenes: [] };
    expect((migrateProject(structuredClone(plain)) as typeof plain).settings.profile).toEqual(plain.settings.profile);
    // (Without a stored profile nothing is written: it is worked out.)
    const none = { formatVersion: 18, name: 'None', settings: {}, definitions: [], scenes: [] };
    expect((migrateProject(structuredClone(none)) as typeof none).settings).toEqual({});
  });

  it('the game opened plays its round exactly as before', () => {
    const tactics = tacticsBoard(registry, true);
    const saved = { ...JSON.parse(JSON.stringify(tactics)), formatVersion: 18 };
    delete saved.settings.profile.turns;
    const opened = migrateProject(saved) as unknown as Project;
    const { rt, step, tap } = play(opened);
    step(0.1);
    tap('interact');
    expect(rt.kit.menu?.items).toEqual(['Move', 'Attack', 'Wait']);
    expect(rt.scripts.errors).toEqual([]);
  });
});

describe('F6c: another turn system plugs in', () => {
  it('registered, declared, selected by a profile: the turn statements of scripts go to it; nothing else changed for it', () => {
    const calls: string[] = [];
    const make = (): TurnSystem => ({
      id: 'test_initiative',
      start: (teams) => void calls.push(`start ${teams.join(',')}`),
      give: (u) => void calls.push(`give ${u.name}`),
      done: (u) => void calls.push(`done ${u.name}`),
      endTurn: () => void calls.push('end'),
      setOrder: () => undefined,
      team: () => 'everyone',
      round: () => 7,
      over: () => false,
      isActing: () => true,
      hasActed: () => false,
    });
    registerTurnSystem('test_initiative', make);
    TURN_SYSTEMS.push({ id: 'test_initiative', version: 1, describe: 'by initiative (a test)', requires: [], without: 'nothing takes turns' });
    modules.register({ kind: 'turns', id: 'test_initiative', version: 1, describe: 'by initiative (a test)', requires: [], provides: ['turns:test_initiative'] });
    try {
      const p = produce(projectFromPreset('topdown', registry), (d) => {
        const def = createDefinition('Fighter', { Sprite: registry.createDefault('Sprite', {}) }, ['hero']);
        const c = checkScript({ id: 'scr_f', name: 'Fight', description: '', vars: [{ name: 'seen_round', value: 0 }], handlers: [{ when: { on: 'start' }, if: null, do: [{ do: 'start_turns', teams: ['hero'], pick: [] }, { do: 'set', var: 'seen_round', value: 'turn_number' }, { do: 'done' }] }] }, d);
        if ('error' in c) throw new Error(c.error);
        def.scripts = [c.script];
        m.addDefinition(d, def, registry);
        m.addEntity(d, d.scenes[0].id, instantiateDefinition(def, { x: 48, y: 48 }));
        setGameProfile(d, { turns: ['test_initiative'] }, registry);
      });
      expect(profileOf(p, registry).turns).toEqual(['test_initiative']);
      const { rt, step } = play(p);
      step(0.1);
      expect(rt.turns!.id).toBe('test_initiative');
      expect(calls).toEqual(['start hero', 'done Fighter']);
      expect(rt.entities.find((e) => e.name === 'Fighter')!.scripts[0].vars.get('seen_round')).toBe(7);
      // (The kit's own team turns were never started.)
      expect(rt.kit.turns).toBeNull();
    } finally {
      unregisterTurnSystem('test_initiative');
      TURN_SYSTEMS.pop();
      modules.unregister('turns', 'test_initiative');
    }
  });
});

