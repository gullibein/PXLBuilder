/**
 * F6c's non-regression goldens for turn-based play (docs/engine-architecture-proposal.md §22.3): a tactics round,
 * an RPG's map in real time and its battle in turns, the roguelike a step at a time. Recorded before turn-taking
 * became a capability the profile selects; they must stay identical. (REGRESSION_RECORD=1 prints them.)
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { projectFromPreset } from '../core/engine/profile';
import * as m from '../core/model/mutations';
import type { Project } from '../core/types';
import type { Action } from '../runtime/input';
import { Runtime } from '../runtime/runtime';
import { rpgGame, tacticsBoard, turnState } from './games/turnBased';
import { Player, withSeed } from './harness';

const registry = createBuiltinRegistry();
const RECORD = !!process.env.REGRESSION_RECORD;
const golden = (name: string, got: string, want: string) => {
  if (RECORD) console.log(`GOLDEN ${JSON.stringify(name)}: '${got}',`);
  else expect(got, `${name}: its trace changed`).toBe(want);
};

/** Plays keys one after another (a tap each, then a wait), tracing the game's state. */
export function playKeys(project: Project, sceneIndex: number, keys: (Action | number)[], game?: Map<string, number | string | boolean>): { rt: Runtime; fingerprint: string } {
  return withSeed(5, () => {
    const rt = new Runtime(project, project.scenes[sceneIndex].id, registry, game);
    const pl = new Player(rt);
    const trace = (r: Runtime) => turnState(r);
    pl.play(0.1, [], trace, 2);
    for (const k of keys) {
      if (typeof k === 'number') pl.play(k, [], trace, 4);
      else {
        pl.tap(k, trace);
        pl.play(0.05, [], trace, 2);
      }
    }
    return { rt, fingerprint: pl.fingerprint() };
  });
}

/** A round of tactics, key by key. */
export const TACTICS_KEYS: (Action | number)[] = [
  // The knight: its menu, Move, the cursor three squares right, there; then Attack the goblin beside it.
  'interact', 'interact', 'right', 'right', 'right', 'interact', 1.3, 'interact', 'right', 'interact', 0.3,
  // The cursor to the archer (three left, two down): its menu, Wait.
  'left', 'left', 'left', 'down', 'down', 'interact', 'down', 'down', 'interact',
  // The goblins' turn; then round 2: the first unit again, Wait.
  3, 'interact', 'down', 'down', 'interact', 1,
];
/** Fight the first imp; the mage's Magic on it; the imp answers; round 2: fight, fight; victory and back. */
export const BATTLE_KEYS: (Action | number)[] = ['interact', 'interact', 'down', 'interact', 'interact', 1, 'interact', 'interact', 'interact', 'interact', 0.2, 2.2];

const TURNS: Record<string, string> = {
  'tactics round': 'e60c79f8964e0c61',
  'tactics round (stored profile)': 'e60c79f8964e0c61',
  'rpg battle': 'de8adaec68671869',
  'rpg map': '68aed06099dfffa5',
  'rpg starter battle': 'c98a375b8b1160fe',
  roguelike: '75b8fb5cf4ae0deb',
};

describe('F6c non-regression: turn-based games play as they did', () => {
  it('tactics: a round by the cursor and the menu (move, attack, wait), the enemies\' answer, the next round', () => {
    const a = playKeys(tacticsBoard(registry), 0, TACTICS_KEYS);
    expect(a.rt.scripts.errors).toEqual([]);
    expect(a.rt.kit.turns?.number).toBeGreaterThanOrEqual(2);
    expect(a.rt.entities.find((e) => e.name === 'Goblin')!.health!.current).toBeLessThan(4);
    golden('turns: tactics round', a.fingerprint, TURNS['tactics round']);
    // (The same game with a stored profile, as the top-down preset gives: the same round.)
    const b = playKeys(tacticsBoard(registry, true), 0, TACTICS_KEYS);
    expect(b.rt.scripts.errors).toEqual([]);
    golden('turns: tactics round (stored profile)', b.fingerprint, TURNS['tactics round (stored profile)']);
  });

  it('RPG: the battle in turns (menus, the monsters\' answer, victory, experience and gold, asking to go back)', () => {
    const r = playKeys(rpgGame(registry), 1, BATTLE_KEYS);
    expect(r.rt.scripts.errors).toEqual([]);
    expect(r.rt.returnRequest?.result).toBe('won');
    golden('turns: rpg battle', r.fingerprint, TURNS['rpg battle']);
  });

  it('RPG: the map in real time (the hero walks, an enemy wanders by itself), until the slime asks for its battle', () => {
    withSeed(6, () => {
      const p = rpgGame(registry);
      const rt = new Runtime(p, p.scenes[0].id, registry);
      const pl = new Player(rt);
      const wanderer = () => rt.entities.find((e) => e.name === 'Enemy');
      const at = wanderer() ? [wanderer()!.x, wanderer()!.y] : null;
      pl.play(1.2, [{ at: 0, hold: ['right'] }], turnState, 4);
      expect(rt.visitRequest?.level).toBe('Battle');
      // (Real time: no turns were started on the map, and what moves by itself moved.)
      expect(rt.kit.turns).toBeNull();
      if (at) expect([wanderer()!.x, wanderer()!.y]).not.toEqual(at);
      golden('turns: rpg map', pl.fingerprint(), TURNS['rpg map']);
    });
  });

  it('the RPG starter\'s own battle level plays its first round', () => {
    const p = projectFromPreset('rpg', registry);
    const r = playKeys(p, 1, ['interact', 'interact', 1.5, 'interact', 'interact', 1.5]);
    expect(r.rt.scripts.errors).toEqual([]);
    expect(r.rt.kit.turns).not.toBeNull();
    golden('turns: rpg starter battle', r.fingerprint, TURNS['rpg starter battle']);
  });

  it('roguelike: nothing moves until the hero steps; each step, the world answers', () => {
    withSeed(7, () => {
      const p = produce(projectFromPreset('roguelike', registry), (d) => void m.setGenerator(d, d.scenes[0].id, { seed: 3 }));
      const rt = new Runtime(p, p.scenes[0].id, registry);
      const pl = new Player(rt);
      const where = (r: Runtime) => r.entities.filter((e) => e.health).map((e) => [e.name, Math.round(e.x), Math.round(e.y), e.health!.current]);
      pl.play(1, [], where, 6);
      const still = JSON.stringify(where(rt));
      pl.play(1.5, [], where, 6);
      // (Left alone, the world stands still.)
      expect(JSON.stringify(where(rt))).toBe(still);
      for (const k of ['right', 'down', 'left', 'up', 'interact', 'right', 'right', 'down'] as Action[]) {
        pl.tap(k, where);
        pl.play(0.4, [], where, 6);
      }
      expect(rt.scripts.errors).toEqual([]);
      golden('turns: roguelike', pl.fingerprint(), TURNS.roguelike);
    });
  });
});
