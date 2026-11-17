/**
 * F6c, progression (docs/engine-architecture-proposal.md §22.7): whole games played across their levels by the game
 * session, with no screen. Levels in their order, a branch by go_to_level, a visit and back with the level left as
 * it was, the roguelike's floors, the whole game again; the profile's progression model decides what follows a won
 * level, and another model plugs in.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { modules } from '../core/engine/modules';
import { checkGame, projectFromPreset, setGameProfile } from '../core/engine/profile';
import { createDefinition, createLevelFor, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { gameProgression, nextLevel, progressionIds, registerProgression, stagesOf, unregisterProgression } from '../core/progression/progression';
import { setScript } from '../core/script/mutations';
import type { Project } from '../core/types';
import { rpgGame } from '../regression/games/turnBased';
import { withSeed } from '../regression/harness';
import { BATTLE_KEYS } from '../regression/turns.test';
import { InputState, type Action } from './input';
import { GameSession, WON_PAUSE } from './session';

const registry = createBuiltinRegistry();
const DT = 1 / 60;

/** A game session with what the screen would be told, and a trace of what is played. */
function sessionOf(project: Project, start = 0) {
  const told: string[] = [];
  const session = new GameSession(project, project.scenes[start].id, registry, {
    leave: (rt) => told.push(`leave ${rt.baseScene.name}`),
    enter: (scene, _rt, how) => told.push(`${how.back ? 'back to' : 'enter'} ${scene.name}${how.musicFromStart ? ' (music from the start)' : ''}`),
  });
  const input = new InputState();
  const samples: string[] = [];
  let frames = 0;
  const state = () => {
    const rt = session.runtime;
    const p = rt.entities.find((e) => e.controller);
    return [session.scene.name, session.banner, session.finished ? 1 : 0, session.visiting, p ? [Math.round(p.x), Math.round(p.y)] : null, [...rt.game.entries()].sort()];
  };
  const play = (seconds: number, hold: Action[] = []) => {
    for (const a of hold) input.press(a);
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      session.step(DT, input);
      if (++frames % 6 === 0) samples.push(JSON.stringify(state()));
    }
    for (const a of hold) input.release(a);
  };
  const tap = (a: Action) => {
    play(DT, [a]);
    play(DT);
  };
  const fingerprint = () => createHash('sha256').update(samples.join('\n')).digest('hex').slice(0, 16);
  return { session, input, told, play, tap, fingerprint, state };
}

const SESSIONS: Record<string, string> = {
  'stages: three levels, won one after another': 'cdefacbb5b3bba32',
  'branch: a door to a secret level, then on': '7a717896c621c87a',
  'rpg: the map, a battle and back': '1f3c5d35e66d787a',
};
// (Recorded with the session, which is where this logic lives now: the play view had it before, and could not be
// played without a screen. That the port plays as the view did is what the browser tests show.)
const golden = (name: string, got: string) => expect(got, `${name}: its trace changed`).toBe(SESSIONS[name]);

/**
 * A platformer of three levels (One, Two, Three), each a floor with the player on it and the goal eight squares to
 * the right; the player counts the levels begun in a game variable. A level named Bonus comes last, with no goal.
 * One and Bonus also have a door to the left, which leads to Three (or does what the test says).
 */
function threeLevels(door: Record<string, unknown> = { do: 'go_to_level', level: 'three' }): Project {
  return produce(createProject(registry), (d) => {
    const def = (name: string) => d.definitions.find((x) => x.name === name)!;
    setScript(d, { target: 'definition', id: def('Player').id }, { name: 'Count', description: '', vars: [], handlers: [{ when: { on: 'start' }, if: null, do: [{ do: 'set_game', var: 'begun', value: "game_value('begun', 0) + 1" }] }] });
    const exit = createDefinition('Secret door', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', { size: { x: 28, y: 28 }, isTrigger: true }) });
    m.addDefinition(d, exit, registry);
    setScript(d, { target: 'definition', id: exit.id }, { name: 'Leads on', description: '', vars: [], handlers: [{ when: { on: 'contact' }, if: "has_tag(other, 'player')", do: [door as never] }] });
    d.scenes[0].name = 'One';
    for (const name of ['Two', 'Three', 'Bonus']) m.addScene(d, createLevelFor(d, name));
    for (const scene of d.scenes) {
      const place = (name: string, x: number, y: number) => m.addEntity(d, scene.id, instantiateDefinition(def(name), { x, y }));
      for (let x = -160; x <= 288; x += 32) place('Platform', x, 48);
      place('Player', 0, 16);
      if (scene.name !== 'Bonus') place('Goal', 256, 16);
      if (scene.name === 'One' || scene.name === 'Bonus') place('Secret door', -128, 16);
    }
  });
}

describe('F6c: a game played across its levels (the session, no screen)', () => {
  it('levels in their order: a won level shows "Level complete!", then the next one; the last ends the game; the game\'s variables go along', () => {
    const { session, told, play, fingerprint } = sessionOf(threeLevels());
    expect(session.scene.name).toBe('One');
    play(0.2);
    expect(session.runtime.game.get('begun')).toBe(1);
    // To the goal (eight squares): won.
    play(2, ['right']);
    expect(session.runtime.completed).not.toBeNull();
    expect(session.banner).toBe('Level complete!');
    expect(session.scene.name).toBe('One');
    play(WON_PAUSE + 0.1);
    expect(session.scene.name).toBe('Two');
    expect(session.banner).toBeNull();
    expect(session.runtime.game.get('begun')).toBe(2);
    play(2, ['right']);
    play(WON_PAUSE + 0.1);
    expect(session.scene.name).toBe('Three');
    // The last of the stages? No: Bonus follows Three in the order.
    play(2, ['right']);
    play(WON_PAUSE + 0.1);
    expect(session.scene.name).toBe('Bonus');
    expect(session.runtime.game.get('begun')).toBe(4);
    expect(told).toEqual(['leave One', 'enter Two', 'leave Two', 'enter Three', 'leave Three', 'enter Bonus']);
    golden('stages: three levels, won one after another', fingerprint());
  });

  it('the last level won: "You finished the game!", play stops; R plays the level again', () => {
    const p = produce(threeLevels(), (d) => void m.removeScene(d, d.scenes[3].id));
    const { session, play } = sessionOf(p, 2);
    play(2, ['right']);
    expect(session.banner).toBe('You finished the game!');
    expect(session.finished).toBe(true);
    const time = session.runtime.time;
    play(3);
    expect(session.runtime.time).toBe(time);
    expect(session.scene.name).toBe('Three');
    expect(session.banner).toBe('You finished the game!');
    session.restart();
    play(0.2);
    expect(session.finished).toBe(false);
    expect(session.banner).toBeNull();
    expect(session.runtime.completed).toBeNull();
  });

  it('a branch: go_to_level by name (any case) goes on to that level, whatever the order; a level that is not there is a script error', () => {
    const { session, told, play, fingerprint } = sessionOf(threeLevels());
    play(1.2, ['left']);
    expect(session.scene.name).toBe('Three');
    expect(session.runtime.game.get('begun')).toBe(2);
    expect(told).toEqual(['leave One', 'enter Three']);
    play(2, ['right']);
    play(WON_PAUSE + 0.1);
    expect(session.scene.name).toBe('Bonus');
    golden('branch: a door to a secret level, then on', fingerprint());
    // A level that isn't there.
    const wrong = threeLevels({ do: 'go_to_level', level: 'Nowhere' });
    const w = sessionOf(wrong);
    w.play(1.2, ['left']);
    expect(w.session.scene.name).toBe('One');
    expect(w.session.runtime.eventLog.filter((e) => e.type === 'script_error').length).toBeGreaterThan(0);
    expect(w.told).toEqual([]);
  });

  it('an RPG: the map, into a battle (the map waits as it was), the battle won in turns, back on the map where the hero stood; gold and experience kept', () => {
    withSeed(5, () => {
      const { session, told, play, tap, fingerprint } = sessionOf(rpgGame(registry));
      play(0.2);
      expect(session.scene.name).toBe('Level 1');
      // Right, into the slime.
      play(1.5, ['right']);
      expect(session.scene.name).toBe('Battle');
      expect(session.visiting).toBe(1);
      const battle = session.runtime;
      expect(battle.turns!.team()).toBe('hero');
      for (const k of BATTLE_KEYS) {
        if (session.scene.name !== 'Battle') break;
        if (typeof k === 'number') play(k);
        else {
          tap(k);
          play(0.05);
        }
      }
      play(0.5);
      expect(session.scene.name).toBe('Level 1');
      expect(session.visiting).toBe(0);
      const map = session.runtime;
      expect(map.paused).toBe(false);
      expect(map.visitResult).toBe('won');
      // The slime is gone (its script, on "level_returned" with "won"), the hero is where the battle began.
      expect(map.entities.find((e) => e.name === 'Slime' && e.alive)).toBeUndefined();
      const hero = map.entities.find((e) => e.controller)!;
      expect(hero.x).toBeGreaterThan(150);
      expect(Number(map.game.get('gold') ?? 0)).toBeGreaterThan(0);
      expect(told).toEqual(['leave Level 1', 'enter Battle', 'leave Battle', 'back to Level 1']);
      // And the map goes on in real time.
      const x = hero.x;
      play(0.5, ['left']);
      expect(hero.x).toBeLessThan(x - 10);
      expect(map.scripts.errors).toEqual([]);
      expect(battle.scripts.errors).toEqual([]);
      golden('rpg: the map, a battle and back', fingerprint());
    });
  });

  it('a level left for a visit is kept exactly: its time stands still while away and what moved by itself is where it was', () => {
    withSeed(5, () => {
      const { session, play } = sessionOf(rpgGame(registry));
      play(1.5, ['right']);
      expect(session.scene.name).toBe('Battle');
      const map = session['visits' as keyof GameSession] as unknown as { runtime: GameSession['runtime'] }[];
      const left = map[0].runtime;
      const wanderer = left.entities.find((e) => e.name === 'Enemy')!;
      const [time, x, y] = [left.time, wanderer.x, wanderer.y];
      play(2);
      expect([left.time, wanderer.x, wanderer.y]).toEqual([time, x, y]);
      expect(left.paused).toBe(true);
    });
  });

  it('restart_game: the first level again, the game\'s variables anew, the music from its start', () => {
    const p = threeLevels({ do: 'restart_game' });
    const { session, told, play } = sessionOf(p, 3);
    play(0.2);
    session.runtime.game.set('begun', 7);
    // Left, to the door (no longer than it takes: the keys stay held into the game begun again).
    for (let i = 0; i < 120 && session.scene.name === 'Bonus'; i++) play(DT, ['left']);
    expect(session.scene.name).toBe('One');
    play(0.2);
    expect(session.runtime.game.get('begun')).toBe(1);
    expect(told).toEqual(['leave Bonus', 'enter One (music from the start)']);
  });

  it('the roguelike: the stairs lead a floor deeper (its level built anew, by the level restarting: the same play goes on), the floor number goes along', () => {
    withSeed(7, () => {
      const p = produce(projectFromPreset('roguelike', registry), (d) => void m.setGenerator(d, d.scenes[0].id, { seed: 3 }));
      const { session, play, told } = sessionOf(p);
      play(0.3);
      const first = session.runtime;
      const hero = first.entities.find((e) => e.controller)!;
      const stairs = first.entities.find((e) => /stairs/i.test(e.name))!;
      expect(stairs).toBeDefined();
      const where = () => session.runtime.entities.filter((e) => e !== session.runtime.entities.find((q) => q.controller)).map((e) => `${e.name}@${Math.round(e.x)},${Math.round(e.y)}`).sort().join(' ');
      const layout = where();
      // (Carried onto the stairs: the test is of what the stairs do, not of the way there.)
      hero.x = stairs.x;
      hero.y = stairs.y;
      play(0.5);
      // (The stairs restart the level, which builds it anew for the floor: no other level, so nothing for the session.)
      expect(session.runtime).toBe(first);
      expect(session.runtime.game.get('floor')).toBe(2);
      expect(session.scene.id).toBe(p.scenes[0].id);
      expect(told).toEqual([]);
      expect(session.finished).toBe(false);
      expect(where()).not.toBe(layout);
      expect(session.runtime.scripts.errors).toEqual([]);
    });
  });
});

describe('F6c: the profile selects the progression model', () => {
  it('stages is the engine\'s model: every preset selects it, it is registered with no pointer to old code, and levels generators use as parts are not stages', () => {
    expect(progressionIds()).toEqual(['stages']);
    expect(modules.list('progression').map((x) => [x.id, x.pointsTo])).toEqual([['stages', undefined]]);
    const p = threeLevels();
    expect(gameProgression(p)!.id).toBe('stages');
    expect(stagesOf(p).map((s) => s.name)).toEqual(['One', 'Two', 'Three', 'Bonus']);
    // Two is a room template of One's random levels: no stage.
    const withParts = produce(p, (d) => void (d.scenes[0].generator = { ...(d.scenes[0].generator ?? {}), templates: [d.scenes[1].id] } as never));
    expect(stagesOf(withParts).map((s) => s.name)).toEqual(['One', 'Three', 'Bonus']);
    expect(nextLevel(withParts, withParts.scenes[0].id)!.name).toBe('Three');
    expect(nextLevel(p, p.scenes[3].id)).toBeNull();
  });

  it('a profile whose progression model is not there: said (incompatible), and a won level is followed by nothing', () => {
    const p = produce(threeLevels(), (d) => {
      setGameProfile(d, {}, registry);
      (d.settings.profile as { progression: { model: string } }).progression.model = 'rooms_world';
    });
    const check = checkGame(p, registry);
    expect(check.state === 'incompatible' && check.reasons.join(' ')).toMatch(/there is no progression module "rooms_world"/);
    expect(gameProgression(p)).toBeNull();
    const { session, play, told } = sessionOf(p);
    play(2, ['right']);
    play(WON_PAUSE + 1);
    expect(session.scene.name).toBe('One');
    expect(session.finished).toBe(true);
    expect(told).toEqual([]);
    // (What scripts ask is the same without a model: the door still leads to Three.)
    const again = sessionOf(p);
    again.play(1.2, ['left']);
    expect(again.session.scene.name).toBe('Three');
  });

  describe('another model plugs in', () => {
    beforeAll(() => {
      // Levels from the last to the first (a test's model).
      registerProgression({
        id: 'test_backwards',
        next: (project, sceneId) => project.scenes[project.scenes.findIndex((s) => s.id === sceneId) - 1] ?? null,
      });
      modules.register({ kind: 'progression', id: 'test_backwards', version: 1, describe: 'from the last level to the first (a test)', requires: [], provides: ['progression:test_backwards'] });
    });
    afterAll(() => {
      unregisterProgression('test_backwards');
      modules.unregister('progression', 'test_backwards');
    });

    it('selected in the profile, it decides what follows a won level; nothing else changes', () => {
      const p = produce(threeLevels(), (d) => {
        setGameProfile(d, {}, registry);
        (d.settings.profile as { progression: { model: string } }).progression.model = 'test_backwards';
      });
      expect(checkGame(p, registry).state).toBe('ok');
      const { session, play } = sessionOf(p, 2);
      play(2, ['right']);
      play(WON_PAUSE + 0.1);
      expect(session.scene.name).toBe('Two');
      play(2, ['right']);
      play(WON_PAUSE + 0.1);
      expect(session.scene.name).toBe('One');
      play(2, ['right']);
      expect(session.banner).toBe('You finished the game!');
      // The same game with stages: forwards.
      const forwards = sessionOf(threeLevels(), 2);
      forwards.play(2, ['right']);
      forwards.play(WON_PAUSE + 0.1);
      expect(forwards.session.scene.name).toBe('Bonus');
    });
  });
});

describe('F6c: where the progression code is', () => {
  const src = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  it('the play view decides nothing about levels: it has no level order, starts no level itself and reads no script request', () => {
    const view = src('editor/play/PlayView.tsx');
    for (const word of ['nextLevel', 'new Runtime(', 'goRequest', 'visitRequest', 'returnRequest', 'restartGameRequested', 'startSceneId)', 'core/model/dungeon']) expect(view.includes(word), word).toBe(false);
    expect(view).toContain('new GameSession(');
  });

  it('the dungeon generator knows nothing of what follows a level; the session asks the progression model', () => {
    expect(src('core/model/dungeon.ts')).not.toMatch(/nextLevel|templateLevels/);
    const session = src('runtime/session.ts');
    expect(session).toContain('gameProgression(project)?.next(');
    expect(session).not.toMatch(/scenes\.(slice|findIndex)|scenes\[[^0]/);
  });
});
