/**
 * The play probe (docs/engine-architecture-proposal.md §24.5): a level played for a bounded time on the real runtime,
 * and what was seen reported in four parts kept apart. Here: every family of game is probed without a fault or
 * anything suspicious, and with what its kind of game is expected to show; runtime faults are faults whatever the
 * game is; suspicious things (a hero that never moves, a start that kills, a level that ends by itself) are said as
 * seen and held against a game only by a caller who says they aren't meant; a game that waits for the player isn't
 * marked for waiting; the same seed gives the same report within its budget; and the probe is no validator (an
 * uncertain level stays uncertain).
 */
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { buildAIPayload } from '../core/ai/context';
import { DEBUGGING_GUIDE } from '../core/ai/guideSections';
import { createBuiltinRegistry } from '../core/components/builtin';
import { PROBE_LIMITS, PROBE_SUSPICIONS, probeFound, probeLines, probeUnmet, type ProbeAction, type ProbeReport, type ProbeSuspicion } from '../core/debug/probeReport';
import { projectFromPreset } from '../core/engine/profile';
import { findRoles } from '../core/levelGen/roles';
import { createLevelFor, createProject } from '../core/model/factory';
import { addScene } from '../core/model/mutations';
import { createIsometricProject } from '../core/model/isometricStarter';
import { createRoguelikeProject } from '../core/model/roguelikeStarter';
import { createRpgProject } from '../core/model/rpgStarter';
import { playerReach } from '../core/reach/reach';
import { setScript } from '../core/script/mutations';
import { projectFromBundle } from '../core/serialization/serialize';
import type { Project } from '../core/types';
import { runValidators } from '../core/validation/validators';
import { boulderDash, mining, spaceShooter } from '../regression/games/action';
import { drMario, tetris } from '../regression/games/boards';
import { digRoom } from '../regression/games/digging';
import { mapGrid, mapLevel, marioLevel } from '../regression/games/platformers';
import { PRECISION_ROOM, precisionRoom } from '../regression/games/precision';
import { rpgGame, tacticsBoard } from '../regression/games/turnBased';
import { registerLocomotion } from './movement';
import { probeLevel, type ProbeOptions } from './playProbe';
import './routeBot';

const registry = createBuiltinRegistry();
const probe = (p: Project, level = 0, o?: ProbeOptions) => probeLevel(p, p.scenes[level].id, registry, o);
const def = (p: Project, name: string) => p.definitions.find((d) => d.name === name)!;
/** The game with a script on one of its objects. */
const withScript = (p: Project, name: string, raw: object) => produce(p, (d) => void setScript(d, { target: 'definition', id: def(d, name).id }, raw));
const input = (r: ProbeReport, a: ProbeAction) => r.inputs.find((i) => i.action === a);
const kinds = (r: ProbeReport) => r.suspicious.map((x) => x.kind);
const seen = (r: ProbeReport) => r.inputs.filter((i) => i.response === 'seen').map((i) => i.action);
const text = (r: ProbeReport) => probeLines(r).map((l) => l.text).join('\n');

/** A flat floor, the player at the left, an enemy patrolling at the right. */
const FLAT = ['..........', '..........', '.P......E.', '##########'];

describe('the play probe: every family of game, with what its kind is expected to show', () => {
  const rpg = rpgGame(registry);
  /** The game, its level, the keys its kind must answer, whether things must act by themselves in it. */
  const FAMILIES: [string, Project, number, ProbeAction[], boolean][] = [
    ['Mario-style platformer (a built level)', marioLevel(registry, 3).project, 0, ['left', 'right', 'jump'], false],
    ['precision platformer (wall jump, dash)', precisionRoom(registry), 0, ['left', 'right', 'jump', 'fire'], false],
    ['Lode Runner-inspired (digging)', digRoom(registry), 0, ['left', 'right', 'fire'], true],
    ['Tetris', tetris(registry), 0, ['left', 'right', 'up'], true],
    ['Dr. Mario', drMario(registry, [{ col: 3, row: 10, color: 'red' }]), 0, ['left', 'right'], true],
    ['space shooter', spaceShooter(registry), 0, ['left', 'right', 'fire'], true],
    ['mining', mining(registry), 0, ['left', 'right', 'down'], false],
    ['Boulder Dash', boulderDash(registry), 0, ['left', 'right', 'up', 'down'], false],
    ['RPG: the map', rpg, 0, ['left', 'right', 'up', 'down'], true],
    ['RPG: a battle', rpg, 1, ['up', 'down', 'jump'], false],
    ['tactics', tacticsBoard(registry), 0, ['left', 'right', 'up', 'down', 'jump'], false],
    ['starter: RPG', createRpgProject(registry), 0, ['left', 'right', 'up', 'down'], true],
    ['starter: roguelike', createRoguelikeProject(registry), 0, ['left', 'right', 'up', 'down'], false],
    ['starter: isometric', createIsometricProject(registry), 0, ['left', 'right', 'up', 'down'], true],
  ];

  it.each(FAMILIES)('%s: runs without faults, nothing suspicious, and its kind of game shows', (_name, project, level, keys, byItself) => {
    const r = probe(project, level);
    expect(r.errors, text(r)).toEqual([]);
    expect(r.suspicious, text(r)).toEqual([]);
    expect(probeFound(r)).toBe(false);
    expect(probeUnmet(r, { keys, byItself }), text(r)).toEqual([]);
    expect(r.seconds.played).toBeLessThanOrEqual(r.seconds.budget);
    expect(r.unjudged.filter((u) => /budget|slow/.test(u))).toEqual([]);
  });

  it('games saved by earlier versions (every preset) are probed without a fault or anything suspicious', () => {
    for (const name of ['classic-built', 'platformer', 'puzzle', 'topdown', 'rpg', 'roguelike', 'isometric']) {
      const loaded = projectFromBundle(JSON.parse(readFileSync(`src/core/engine/fixtures/${name}.v14.json`, 'utf8')), registry);
      const p = loaded.project!;
      const r = probeLevel(p, p.startSceneId, registry);
      expect(r.errors, `${name}\n${text(r)}`).toEqual([]);
      expect(r.suspicious, `${name}\n${text(r)}`).toEqual([]);
    }
  });

  it('what is expected is the caller\'s, by the kind of game: a shooter is asked for its fire key and for things acting by themselves, and moving alone is not enough', () => {
    const shooter = probe(spaceShooter(registry));
    expect(probeUnmet(shooter, { keys: ['left', 'right', 'fire'], byItself: true })).toEqual([]);
    expect(input(shooter, 'fire')!.what.join(' ')).toMatch(/Shot appeared/);
    expect(shooter.byItself.what.join(' ')).toMatch(/Shot appeared/);
    // The same ship without its Shooter, and no saucers: it still moves, and that is all.
    const noGun = produce(spaceShooter(registry), (d) => {
      delete def(d, 'Player').components.Shooter;
      d.scenes[0].entities = d.scenes[0].entities.filter((e) => e.name !== 'Saucer');
    });
    const r = probe(noGun);
    expect(r.errors).toEqual([]);
    expect(r.suspicious).toEqual([]);
    expect(seen(r)).toEqual(expect.arrayContaining(['left', 'right']));
    expect(probeUnmet(r, { keys: ['left', 'right', 'fire'], byItself: true })).toEqual(['nothing in the level listens to fire', 'nothing to see happened by itself']);
  });

  it('a game that waits for the player is not failed for waiting: tactics and an RPG battle take turns, mining and Boulder Dash stand still', () => {
    for (const [p, level] of [[tacticsBoard(registry), 0], [rpg, 1]] as const) {
      const r = probe(p, level);
      expect(r.byItself.expected).toBe('waits');
      expect(r.suspicious).toEqual([]);
      expect(text(r)).toMatch(/waiting for the player is right/);
      // (Its menu and cursor answer the keys.)
      expect(seen(r)).toEqual(expect.arrayContaining(['up', 'down', 'jump']));
    }
    for (const p of [mining(registry), boulderDash(registry)]) {
      const r = probe(p);
      expect(r.byItself.expected).toBe('unknown');
      expect(r.byItself.seen && !r.byItself.hiddenOnly).toBe(false);
      expect(r.suspicious).toEqual([]);
      // (Asked for by a caller who expects action, it is said plainly.)
      expect(probeUnmet(r, { byItself: true })).toEqual(['nothing to see happened by itself']);
    }
  });

  it('a level with nothing in it: nothing listens to a key, said as a note, with nothing suspicious', () => {
    const r = probe(createProject(registry, 'Empty', 'platformer'));
    expect(r.inputs).toEqual([]);
    expect(r.suspicious).toEqual([]);
    expect(r.notes.join(' ')).toMatch(/Nothing in the level listens to a key/);
    expect(r.runs).toBe(1);
  });
});

describe('the play probe: what it reads from the level, whatever the game', () => {
  it('who listens to each key: the movement model, an ability, a Shooter, a script, each named', () => {
    const r = probe(precisionRoom(registry));
    expect(input(r, 'left')!.listeners).toEqual([{ who: 'Player', how: 'moves with it', when: 'always', engine: true }]);
    expect(input(r, 'up')!.listeners[0]).toMatchObject({ when: 'sometimes' });
    expect(input(r, 'fire')!.listeners.map((l) => l.how)).toEqual(['dashes with it']);
    const shooter = probe(spaceShooter(registry));
    expect(input(shooter, 'fire')!.listeners).toEqual([{ who: 'Player', how: 'shoots with it', when: 'always', engine: true }]);
    // (Seen from above, Space fires too.)
    expect(input(shooter, 'jump')!.listeners.map((l) => l.how)).toContain('shoots with it too');
    const board = probe(tetris(registry));
    expect(input(board, 'left')!.listeners).toEqual([{ who: 'Board', how: 'listens to it in its script "Tetris"', when: 'sometimes', engine: false }]);
    // (Nothing listens to Fire in Tetris: it is not tried, and not missed.)
    expect(input(board, 'fire')).toBeUndefined();
  });

  it('a key for some places only (a ladder\'s Up) that does nothing where it was tried is said without blame', () => {
    const r = probe(mapLevel(registry, FLAT));
    expect(input(r, 'up')!.response).toBe('none');
    const line = probeLines(r).find((l) => l.text.startsWith('up:'))!;
    expect(line.ok).toBeNull();
    expect(line.text).toMatch(/changed nothing where it was tried/);
    expect(r.suspicious).toEqual([]);
  });

  it('a key that only answers after another (a game that starts paused until Jump): found, and said so', () => {
    const titled = withScript(mapLevel(registry, FLAT), 'Enemy', {
      name: 'Title',
      vars: [],
      handlers: [
        { when: { on: 'start' }, if: null, do: [{ do: 'pause' }] },
        { when: { on: 'key', key: 'jump', edge: 'pressed' }, if: null, do: [{ do: 'resume' }] },
      ],
    });
    const r = probe(titled);
    expect(r.suspicious, text(r)).toEqual([]);
    expect(input(r, 'jump')).toMatchObject({ response: 'seen' });
    expect(input(r, 'left')).toMatchObject({ response: 'seen', after: 'jump' });
    expect(input(r, 'right')).toMatchObject({ response: 'seen', after: 'jump' });
    expect(text(r)).toMatch(/left: Player moved \(only after jump\)/);
    // (Paused from its start, it waits: its patrol standing still is not suspicious.)
    expect(r.byItself).toMatchObject({ seen: false, expected: 'waits' });
    expect(text(r)).toMatch(/it is paused from its start, as at a title: waiting for the player is right/);
  });

  it('things set to act by themselves are expected to: one patrol shut in is a note, every one of them still is suspicious', () => {
    const one = probe(mapLevel(registry, ['...........', '.P...E.#E#.', '###########']));
    expect(one.byItself.expected).toBe('yes');
    expect(one.byItself.still).toEqual(['Enemy (patrols)']);
    expect(one.notes.join(' ')).toMatch(/Enemy \(patrols\) didn't move/);
    expect(one.suspicious).toEqual([]);
    const all = probe(mapLevel(registry, ['.......', '.P..#E#', '#######']));
    expect(kinds(all)).toEqual(['nothing_acts']);
    expect(all.suspicious[0].text).toMatch(/Nothing set to act by itself did \(Enemy patrols\)/);
    expect(probeFound(all)).toBe(false);
  });
});

describe('the play probe: runtime faults, wrong whatever the game is', () => {
  it('a runtime error only a key brings out: in the errors, with the key', () => {
    const r = probe(withScript(mapLevel(registry, FLAT), 'Player', { name: 'Oops', vars: [], handlers: [{ when: { on: 'key', key: 'interact', edge: 'pressed' }, if: null, do: [{ do: 'set_game', var: 'who', value: 'self' }] }] }));
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ where: 'Player (Oops)', pressing: 'interact' });
    expect(r.errors[0].message).toMatch(/set_game: "who" can only be a number, text or true\/false/);
    expect(probeFound(r)).toBe(true);
    expect(probeLines(r)[0]).toMatchObject({ part: 'runs', ok: false });
    expect(probeLines(r)[0].text).toMatch(/^Runtime fault in Player \(Oops\)/);
    // (A fault counts for every caller, whatever it expects.)
    expect(probeUnmet(r, {})).toHaveLength(1);
    // (The other parts are still reported: the level otherwise plays.)
    expect(seen(r)).toEqual(expect.arrayContaining(['left', 'right', 'jump']));
  });

  it('a level that asks for a level that isn\'t there: the error the game itself gives', () => {
    const r = probe(withScript(mapLevel(registry, FLAT), 'Player', { name: 'Go', vars: [], handlers: [{ when: { on: 'key', key: 'interact', edge: 'pressed' }, if: null, do: [{ do: 'go_to_level', level: 'Nowhere' }] }] }));
    expect(r.errors.map((e) => e.message).join(' ')).toMatch(/there is no level "Nowhere"/);
  });

  it('a movement model that isn\'t there: the error at the start', () => {
    const p = produce(mapLevel(registry, FLAT), (d) => {
      (def(d, 'Player').components.CharacterController as Record<string, unknown>).movement = 'hover';
    });
    const r = probe(p);
    expect(r.errors.map((e) => e.message).join(' ')).toMatch(/no movement model "hover"/);
    expect(r.errors[0].pressing).toBeNull();
    // (Nothing listens to the movement keys: none is tried, none is praised.)
    expect(input(r, 'left')).toBeUndefined();
  });

  it('the engine stopping, a place that is no number: faults; a level that doesn\'t repeat, a model that doesn\'t say its keys: not judged (movement models only this test has)', () => {
    const using = (movement: string) =>
      produce(mapLevel(registry, ['..........', '.P........', '##########']), (d) => {
        (def(d, 'Player').components.CharacterController as Record<string, unknown>).movement = movement;
      });
    let calls = 0;
    const offs = [
      registerLocomotion({ id: 'test_throws', answersTo: ['test_throws'], floats: true, keys: { move: ['left', 'right'], sometimes: [] }, states: () => [], step: ({ input }) => void (input.isDown('left') && (null as unknown as { x: number }).x) }),
      registerLocomotion({ id: 'test_nan', answersTo: ['test_nan'], floats: true, keys: { move: ['left', 'right'], sometimes: [] }, states: () => [], step: ({ e, input }) => void (input.isDown('right') && (e.x = NaN)) }),
      registerLocomotion({ id: 'test_drift', answersTo: ['test_drift'], floats: true, keys: { move: ['left', 'right'], sometimes: [] }, states: () => [], step: ({ e }) => void (e.x += calls++ % 7) }),
      registerLocomotion({ id: 'test_silent', answersTo: ['test_silent'], floats: true, states: () => [], step: ({ e, input }) => void (e.vx = input.isDown('right') ? 100 : 0) }),
    ];
    try {
      const thrown = probe(using('test_throws'));
      expect(thrown.errors[0]).toMatchObject({ where: 'the engine', pressing: 'left' });
      expect(thrown.errors[0].message).toMatch(/it stopped after \d\.\d s/);
      expect(probeFound(thrown)).toBe(true);
      const nan = probe(using('test_nan'));
      expect(nan.errors[0]).toMatchObject({ where: 'Player', pressing: 'right' });
      expect(nan.errors[0].message).toMatch(/its place or speed stopped being a number after \d\.\d s/);
      expect(probeFound(nan)).toBe(true);
      const drift = probe(using('test_drift'));
      expect(drift.unjudged.join(' ')).toMatch(/doesn't play the same twice from the same seed/);
      expect(drift.inputs.every((i) => i.response === 'not_tried')).toBe(true);
      expect(drift.suspicious).toEqual([]);
      expect(drift.errors).toEqual([]);
      // A model that doesn't say which keys it reads isn't judged on them (no key is made up for it).
      const silent = probe(using('test_silent'));
      expect(silent.unjudged.join(' ')).toMatch(/Player's movement \("test_silent"\) doesn't say which keys it reads/);
      expect(silent.suspicious).toEqual([]);
    } finally {
      offs.forEach((off) => off());
    }
  });
});

describe('the play probe: suspicious things are said as seen, and held against a game only by a caller who says they aren\'t meant', () => {
  /** Seen, said without a judgement, no fault; unmet only for a caller who says this kind isn't meant in its game. */
  const onlySuspicious = (r: ProbeReport, kind: ProbeSuspicion, words: RegExp) => {
    expect(r.errors, text(r)).toEqual([]);
    expect(probeFound(r)).toBe(false);
    const found = r.suspicious.find((s) => s.kind === kind);
    expect(found?.text, text(r)).toMatch(words);
    const line = probeLines(r).find((l) => l.text === found!.text)!;
    expect(line).toMatchObject({ part: 'suspicious', ok: null });
    // A caller that says nothing about it: nothing unmet. One that says it isn't meant: unmet, by its kind.
    expect(probeUnmet(r, {})).toEqual([]);
    expect(probeUnmet(r, { notMeant: PROBE_SUSPICIONS.filter((k) => !kinds(r).includes(k)) })).toEqual([]);
    expect(probeUnmet(r, { notMeant: [kind] })).toEqual([`not meant (${kind}): ${found!.text}`]);
    expect(probeUnmet(r, { notMeant: 'any' })).toHaveLength(r.suspicious.length);
  };

  it('meant: a level that ends by itself (a title card that goes on to the game): an early win is seen, and is no fault', () => {
    // "Chapter 1" shows and the level completes itself: the game then goes on to its next level.
    const game = produce(withScript(mapLevel(registry, ['.......', '.P.....', '#######']), 'Player', { name: 'Title card', vars: [], handlers: [{ when: { on: 'start' }, if: null, do: [{ do: 'message', text: 'Chapter 1', seconds: 2 }, { do: 'complete_level' }] }] }), (d) => {
      addScene(d, createLevelFor(d, 'The game'));
    });
    const r = probe(game);
    onlySuspicious(r, 'early_win', /The level was won 0\.\d s after it started, with no key pressed/);
  });

  it('not meant: the same early win in a level whose goal was put on the start by mistake, for a caller who says so', () => {
    const p = produce(mapLevel(registry, ['.......', '.P...G.', '#######']), (d) => {
      const scene = d.scenes[0];
      const player = scene.entities.find((e) => e.name === 'Player')!;
      const goal = scene.entities.find((e) => e.definitionId === findRoles(d, registry).goal!.id)!;
      goal.transform.position = { ...player.transform.position };
    });
    const r = probe(p);
    // (The probe sees the same thing in both, and can't tell them apart: the caller does.)
    expect(kinds(r)).toContain('early_win');
    expect(probeFound(r)).toBe(false);
    expect(probeUnmet(r, { notMeant: ['early_win'] })).toHaveLength(1);
  });

  it('meant: an opening that kills (the hero is dropped onto spikes, or into a pit, as the first beat): an early setback is seen, and is no fault', () => {
    for (const rows of [['.....', '.P...', '#^^^#'], ['.....', '.P...', '.....', '...##']]) {
      const r = probe(mapLevel(registry, rows));
      onlySuspicious(r, 'early_setback', /Whatever was pressed, Player (was put back at its start|died) within 2 s of the start \(\d+ runs\)/);
    }
    // (Hurt later, with no key pressed: an enemy walks into a hero who stands still. A note, not even suspicious.)
    const later = probe(mapLevel(registry, FLAT));
    expect(later.suspicious).toEqual([]);
    expect(later.notes.join(' ')).toMatch(/With no key pressed, Player died after \d/);
  });

  it('meant: a hero that stays where it is (a turret that only shoots): immobile is seen, its fire key answers, and it is no fault', () => {
    const turret = produce(spaceShooter(registry), (d) => {
      const cc = def(d, 'Player').components.CharacterController as Record<string, unknown>;
      cc.speed = 0;
    });
    const r = probe(turret);
    onlySuspicious(r, 'immobile', /Player never left its place: pressing left, right, up, down didn't move it/);
    expect(kinds(r)).toEqual(['immobile']);
    // (What its kind of game is asked for is all there: it fires, and the saucers act.)
    expect(probeUnmet(r, { keys: ['fire'], byItself: true })).toEqual([]);
    // A platformer's hero that only turns is the same thing seen; its caller says a hero must move.
    const stuck = produce(mapLevel(registry, ['..........', '.P........', '##########']), (d) => {
      const cc = def(d, 'Player').components.CharacterController as Record<string, unknown>;
      cc.speed = 0;
      cc.jumpForce = 0;
    });
    const s = probe(stuck);
    expect(s.suspicious[0]).toMatchObject({ kind: 'immobile' });
    expect(s.suspicious[0].text).toMatch(/Player never left its place: pressing left, right, jump didn't move it \(it only turned, or something else changed\)/);
    expect(probeUnmet(s, { notMeant: ['immobile'] })).toHaveLength(1);
    expect(probeFound(s)).toBe(false);
  });

  it('a game paused for good at its start: the hero never moves and its fire key does nothing, both suspicious', () => {
    const stuck = withScript(spaceShooter(registry), 'Player', { name: 'Stuck', vars: [], handlers: [{ when: { on: 'start' }, if: null, do: [{ do: 'pause' }] }] });
    const r = probe(stuck);
    expect(kinds(r)).toEqual(['immobile', 'silent_shooter']);
    expect(r.suspicious[1].text).toMatch(/Pressing fire changed nothing, though Player shoots with it/);
    expect(r.byItself.seen).toBe(false);
    expect(probeFound(r)).toBe(false);
    expect(probeUnmet(r, { notMeant: 'any' })).toHaveLength(2);
  });

  it('things made without end: many things is seen (the limit kept), the run stops there, and it is no fault', () => {
    const base = mapLevel(registry, ['..........', '.P........', '##########']);
    const flood = withScript(base, 'Player', { name: 'Flood', vars: [], handlers: [{ when: { on: 'tick' }, if: null, do: [{ do: 'spawn', object: def(base, 'Coin').id, x: 'self.x + 300', y: 'self.y - 300', tag: null }] }] });
    const r = probe(flood);
    onlySuspicious(r, 'many_things', /Many things are made and stay: 5\d\d after \d\.\d s \(\d+ at the start\)\. The probe stopped that run there/);
    expect(r.unjudged.join(' ')).toMatch(/The keys were not tried: the level stopped by itself/);
    expect(r.seconds.played).toBeLessThan(6);
  });

  it('every kind of suspicion is one of the six, each a measure with its limit; none makes a fault, and no game of any family shows one', () => {
    expect(PROBE_SUSPICIONS).toEqual(['immobile', 'silent_shooter', 'nothing_acts', 'early_setback', 'early_win', 'many_things']);
    // (The families' test above holds `suspicious` empty for all fourteen games.)
    const r = probe(spaceShooter(registry));
    expect(r.suspicious).toEqual([]);
    expect(probeUnmet(r, { notMeant: 'any' })).toEqual([]);
  });
});

describe('the play probe: bounded, repeatable, and no validator', () => {
  it('the same game, seed and budget give the same report; the seed is the level\'s chance', () => {
    const p = createRoguelikeProject(registry);
    const a = probe(p, 0, { seed: 7 });
    const b = probe(p, 0, { seed: 7 });
    expect(b).toEqual(a);
    expect(a.seed).toBe(7);
    // (Another seed: another dungeon, so the report may differ, but no less in order.)
    const c = probe(p, 0, { seed: 8 });
    expect(c.errors).toEqual([]);
    expect(c.suspicious).toEqual([]);
    const shooter = spaceShooter(registry);
    expect(probe(shooter, 0, { seed: 3 })).toEqual(probe(shooter, 0, { seed: 3 }));
  });

  it('it leaves the game and Math.random as they were', () => {
    const p = tetris(registry);
    const before = JSON.stringify(p);
    const random = Math.random;
    probe(p);
    expect(JSON.stringify(p)).toBe(before);
    expect(Math.random).toBe(random);
  });

  it('the budget is kept, and what didn\'t fit is said to be unjudged (never passed over in silence)', () => {
    const p = spaceShooter(registry);
    const full = probe(p);
    expect(full.seconds.played).toBeLessThanOrEqual(90);
    const small = probe(p, 0, { budget: 15 });
    expect(small.seconds.played).toBeLessThanOrEqual(15);
    expect(small.inputs.filter((i) => i.response === 'not_tried').length).toBeGreaterThan(0);
    expect(small.unjudged.join(' ')).toMatch(/Not tried: .*The budget \(15 s of play\) was used up/);
    // (What wasn't tried is neither suspicious nor a pass.)
    expect(small.suspicious).toEqual([]);
    expect(probeUnmet(small, { keys: ['fire'] })).toEqual(['fire was not tried']);
    const none = probe(p, 0, { budget: 7 });
    expect(none.unjudged.join(' ')).toMatch(/The keys were not tried: the budget \(7 s of play\) was used up/);
    const nothing = probe(p, 0, { budget: 0 });
    expect(nothing.runs).toBe(0);
    expect(nothing.unjudged.join(' ')).toMatch(/Nothing was played/);
  });

  it('a level too slow to play stops the probe, and says so', () => {
    const r = probe(marioLevel(registry, 3).project, 0, { maxMs: 0.001 });
    expect(r.unjudged.join(' ')).toMatch(/slow to play here: the probe stopped/);
    expect(r.suspicious).toEqual([]);
  });

  it('a room template is not played on its own: said, with nothing run', () => {
    const p = produce(createRoguelikeProject(registry), (d) => {
      const vault = createLevelFor(d, 'Vault');
      addScene(d, vault);
      d.scenes[0].generator!.templates = [vault.id];
    });
    const r = probe(p, 1);
    expect(r.runs).toBe(0);
    expect(r.unjudged.join(' ')).toMatch(/room template.*not played on its own/);
    expect(r.suspicious).toEqual([]);
  });

  it('it is no validator: a level the validators leave uncertain stays uncertain, whatever the probe saw; its report never says validated, winnable, balanced or correct', () => {
    const p = precisionRoom(registry);
    const reach = playerReach(p, p.scenes[0].id, findRoles(p, registry).player!.id, registry)!;
    const target = { project: p, sceneId: p.scenes[0].id, registry, grid: mapGrid(p, registry, PRECISION_ROOM), reach, mechanics: reach.abilities };
    const before = runValidators(['layout', 'cell_solver'], target);
    expect(before.state).toBe('uncertain');
    const r = probe(p);
    expect(probeFound(r)).toBe(false);
    const after = runValidators(['layout', 'cell_solver'], target);
    expect(after.state).toBe('uncertain');
    expect(after.uncertain).toEqual(before.uncertain);
    // (The report has no word for a verdict, and no field a validator reads.)
    const words = JSON.stringify(r) + text(r);
    expect(words).not.toMatch(/validated|winnable|balanced|correct|can be won|is fair/i);
    expect(Object.keys(r)).not.toContain('state');
    expect(PROBE_LIMITS).toMatch(/does not say the level can be won, is fair, or plays as meant/);
  });

  it('the AI is told what a play check saw only when there is one, in its parts, with what it does not say', () => {
    const p = spaceShooter(registry);
    const ctx = { kind: 'level', sceneId: p.scenes[0].id, point: null } as never;
    expect(buildAIPayload(p, ctx, registry).debug).not.toHaveProperty('playCheck');
    const report = probe(p);
    const told = buildAIPayload(p, ctx, registry, undefined, null, undefined, { report, changedSince: false }).debug.playCheck!;
    expect(told.lines[0]).toMatch(/^runs: It ran without runtime faults/);
    expect(told.lines).toContain('inputs: fire: a Shot appeared.');
    expect(told.lines.some((l) => l.startsWith('by_itself: With no key pressed:'))).toBe(true);
    expect(told.note).toMatch(/Nothing was changed since this check\. .*does not say the level can be won/);
    expect(told.seed).toBe(1);
    // (Small: a line for each part, not the runs themselves.)
    expect(JSON.stringify(told).length).toBeLessThan(1500);
    const older = buildAIPayload(p, ctx, registry, undefined, null, undefined, { report, changedSince: true }).debug.playCheck!;
    expect(older.note).toMatch(/The game was changed after this check/);
    // Something suspicious goes to the AI marked as that, never as a fault or a failure, and the guide says to leave
    // it alone if it is meant.
    const turret = produce(p, (d) => {
      (def(d, 'Player').components.CharacterController as Record<string, unknown>).speed = 0;
    });
    const seenIn = buildAIPayload(turret, ctx, registry, undefined, null, undefined, { report: probe(turret), changedSince: false }).debug.playCheck!;
    expect(seenIn.lines.filter((l) => l.startsWith('suspicious: '))).toHaveLength(1);
    expect(seenIn.lines.join('\n')).toMatch(/^suspicious: Player never left its place/m);
    expect(seenIn.lines.join('\n')).not.toMatch(/^(failures?|faults?):|Runtime fault/m);
    expect(DEBUGGING_GUIDE).toMatch(/"suspicious": things that often mean a mistake and may as well be how this game is meant to play/);
    expect(DEBUGGING_GUIDE).toMatch(/if it looks meant, say so and change nothing/);
    // A check of another level says nothing about this one.
    const other = { ...report, sceneId: 'another' };
    expect(buildAIPayload(p, ctx, registry, undefined, null, undefined, { report: other, changedSince: false }).debug).not.toHaveProperty('playCheck');
  });

  it('the momentum platformer is V3: not made, not probed, not counted', () => {
    expect(() => projectFromPreset('momentum', registry)).toThrow(/There is no preset "momentum"/);
  });
});
