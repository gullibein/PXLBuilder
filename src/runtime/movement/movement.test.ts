/**
 * The movement architecture at work (docs/engine-architecture-proposal.md §16.3): the new abilities (wall slide,
 * wall jump, dash) in play, composed with each other and with double jump; the motion snapshot every model
 * publishes; scripts reading ability states; a model and an ability only this test knows, plugged in without any
 * change to the runtime; and the engine's profile modules agreeing with the runtime's models and abilities.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../../core/components/builtin';
import { modules, type AbilityModule, type LocomotionModule } from '../../core/engine/modules';
import { checkProfile, changedProfile, inferProfile, projectFromPreset, setGameProfile } from '../../core/engine/profile';
import { presetById } from '../../core/engine/presets';
import { ABILITY_COMPONENTS } from '../../core/engine/infer';
import { setScript } from '../../core/script/mutations';
import type { Project } from '../../core/types';
import { mapLevel } from '../../regression/games/platformers';
import { Player, varOf } from '../../regression/harness';
import { Runtime } from '../runtime';
import { abilityComponents, movementValues, registerAbility, registerLocomotion } from './index';

const registry = createBuiltinRegistry();
const withAbilities = (p: Project, comps: Record<string, Record<string, unknown>>): Project =>
  produce(p, (d) => {
    const player = d.definitions.find((x) => x.name === 'Player')!;
    for (const [type, props] of Object.entries(comps)) player.components[type] = registry.createDefault(type, props);
  });
const run = (p: Project) => {
  const rt = new Runtime(p, p.startSceneId, registry);
  return { rt, pl: new Player(rt), me: () => rt.entities.find((e) => e.alive && e.controller)! };
};

// A shaft two cells wide between walls, 9 rows high, open at the top onto a ledge to the right.
const SHAFT = [
  '..........',
  '.....#####',
  '.#..##....',
  '.#..#.....',
  '.#..#.....',
  '.#..#.....',
  '.#..#.....',
  '.#..#.....',
  '.#..#.....',
  '.#P.#.....',
  '##########',
];
// A pit 7 cells wide (a jump clears about 4), spikes in it.
const PIT = ['....................', '....................', '..P.................', '#####.......########', '#####^^^^^^^########', '####################'];

describe('wall slide and wall jump (WallJump)', () => {
  it('pressing toward a wall while falling: the slide is slow; a script reads it (self.wall_sliding)', () => {
    const p = withAbilities(mapLevel(registry, ['......', '...#..', '...#..', '...#..', '...#..', '...#..', '..P#..', '######']), { WallJump: { slideSpeed: 80 } });
    const withScriptP = produce(p, (d) => {
      const player = d.definitions.find((x) => x.name === 'Player')!;
      setScript(d, { target: 'definition', id: player.id }, { name: 'Slides', description: 'counts sliding steps', vars: [{ name: 'slid', value: 0 }], handlers: [{ when: { on: 'tick' }, if: 'self.wall_sliding', do: [{ do: 'set', var: 'slid', value: 'slid + 1' }] }] });
    });
    const { rt, pl, me } = run(withScriptP);
    pl.play(0.2);
    // Jump up beside the wall, then fall pressing right into it.
    pl.play(1.2, [{ at: 0, hold: ['jump', 'right'] }, { at: 0.3, hold: ['right'] }]);
    const slid = Number(varOf(me(), 'slid'));
    expect(slid).toBeGreaterThan(5);
    // (While sliding its fall is held to the slide speed: plus a step of gravity.)
    pl.play(0.05, [{ at: 0, hold: ['right'] }]);
    if (rt.motion(me())!.states.includes('wallSliding')) expect(me().vy).toBeLessThan(80 + 20);
  });

  it('wall jumps climb a shaft no plain jump can; without WallJump the player stays at the bottom', () => {
    const climb = (comps: Record<string, Record<string, unknown>>) => {
      const { rt, pl, me } = run(withAbilities(mapLevel(registry, SHAFT), comps));
      const start = me().y;
      pl.play(0.2);
      // A policy reading the motion snapshot: press into a wall; while sliding (or touching one in the air), jump off
      // it toward the other.
      let toward: 'left' | 'right' = 'right';
      for (let f = 0; f < 60 * 6; f++) {
        const m = rt.motion(me())!;
        const held: ('left' | 'right' | 'jump')[] = [toward];
        if (m.states.includes('grounded') && f % 40 === 0) held.push('jump');
        if (m.states.includes('wallSliding')) {
          held.push('jump');
          toward = toward === 'right' ? 'left' : 'right';
        }
        pl.hold(held);
        pl.play(1 / 60);
        if (me().y < 64) break;
      }
      return start - me().y;
    };
    expect(climb({ WallJump: {} })).toBeGreaterThan(32 * 6);
    expect(climb({})).toBeLessThan(32 * 3);
  });
});

describe('dash (Dash)', () => {
  it('a dash crosses a pit wider than any jump, gravity off meanwhile; without it the player falls in', () => {
    const cross = (comps: Record<string, Record<string, unknown>>) => {
      const { rt, pl, me } = run(withAbilities(mapLevel(registry, PIT), comps));
      pl.play(0.2);
      let level: number | null = null;
      pl.play(0.5, [{ at: 0, hold: ['right'] }, { at: 0.38, hold: ['right', 'jump'] }]);
      // At the top of the jump: dash right.
      pl.play(0.2, [{ at: 0, hold: ['right'] }]);
      const before = me().y;
      pl.tap('fire');
      if (rt.motion(me())!.states.includes('dashing')) level = me().y;
      pl.play(0.08, [{ at: 0, hold: ['right'] }]);
      const flat = level !== null ? Math.abs(me().y - level) : null;
      pl.play(1.5, [{ at: 0, hold: ['right'] }]);
      return { x: me().x, dead: me().y > 3 * 32 + 16 + 1, flat, before };
    };
    const yes = cross({ Dash: { speed: 520, duration: 0.2 } });
    expect(yes.x).toBeGreaterThan(12 * 32);
    expect(yes.dead).toBe(false);
    // (No gravity in the dash: it stays level.)
    expect(yes.flat).not.toBeNull();
    expect(yes.flat!).toBeLessThan(2);
    const no = cross({});
    expect(no.x < 12 * 32 || no.dead).toBe(true);
  });

  it('charges: one dash in the air, then none until landing; landing refills it', () => {
    const { rt, pl, me } = run(withAbilities(mapLevel(registry, ['....................', '....................', '..P.................', '####################']), { Dash: { duration: 0.1 } }));
    pl.play(0.2);
    pl.play(0.15, [{ at: 0, hold: ['jump'] }]);
    pl.tap('fire');
    expect(rt.motion(me())!.states).toContain('dashing');
    pl.play(0.2);
    pl.tap('fire');
    expect(rt.motion(me())!.states).not.toContain('dashing');
    pl.play(1.2);
    expect(me().grounded).toBe(true);
    pl.tap('fire');
    expect(rt.motion(me())!.states).toContain('dashing');
  });

  it('composes: wall jump next to a wall, double jump away from it, dash anywhere, on one character', () => {
    const { rt, pl, me } = run(withAbilities(mapLevel(registry, SHAFT), { WallJump: {}, DoubleJump: { extraJumps: 1 }, Dash: {} }));
    pl.play(0.2);
    // A full jump, pressing right into the right wall; up there, in the air beside it: let go of Jump, press again.
    pl.play(0.25, [{ at: 0, hold: ['jump', 'right'] }]);
    expect(me().grounded).toBe(false);
    pl.hold(['right']);
    pl.play(1 / 60);
    pl.tap('jump');
    expect(me().vx).toBeLessThan(0);
    // Away from the walls (out in the open level): Jump is the double jump.
    const open = run(withAbilities(mapLevel(registry, PIT), { WallJump: {}, DoubleJump: { extraJumps: 1 }, Dash: {} }));
    open.pl.play(0.2);
    open.pl.play(0.2, [{ at: 0, hold: ['jump'] }, { at: 0.1, hold: [] }]);
    const vy = open.me().vy;
    open.pl.tap('jump');
    expect(open.me().vy).toBeLessThan(vy - 100);
    open.pl.tap('fire');
    expect(open.rt.motion(open.me())!.states).toContain('dashing');
    void rt;
  });
});

describe('the motion snapshot: the same for every model', () => {
  it('says what the movement is doing (velocity, facing, heading, states, intent), for the arcade and top-down models', () => {
    const { rt, pl, me } = run(mapLevel(registry, ['..........', '..........', '..P...H...', '##########']));
    pl.play(0.3);
    expect(rt.motion(me())).toMatchObject({ model: 'arcade', states: ['grounded'], heading: null });
    pl.play(0.1, [{ at: 0, hold: ['right'] }]);
    expect(rt.motion(me())).toMatchObject({ facing: 1, intent: { x: 1, y: 0, jump: false } });
    expect(rt.motion(me())!.velocity.x).toBeGreaterThan(0);
    pl.play(0.1, [{ at: 0, hold: ['jump'] }]);
    expect(rt.motion(me())!.states).toContain('airborne');
    const td = projectFromPreset('topdown', registry);
    const t = run(produce(td, (d) => void d.scenes[0].entities.push(...[])));
    if (t.rt.entities.some((e) => e.controller)) {
      t.pl.play(0.3, [{ at: 0, hold: ['down', 'left'] }]);
      expect(t.rt.motion(t.me())).toMatchObject({ model: 'topdown', heading: { x: -1, y: 1 } });
      expect(t.rt.motion(t.me())!.states).toEqual(['walking']);
    }
  });
});

describe('extensible: a model and an ability only this test knows, with no change to the runtime', () => {
  it('a "glide" locomotion model (selected by the Character Controller movement value) and a "boost" ability plug in', () => {
    const offModel = registerLocomotion({
      id: 'test_glide',
      answersTo: ['glide'],
      floats: true,
      states: () => ['gliding'],
      step({ e, input }, abilities) {
        for (const a of abilities) if (a.override?.({ e, input, dt: 0, host: null as never })) return;
        e.vx = input.isDown('right') ? 100 : 0;
        e.vy = 0;
      },
    });
    registry.register({ type: 'TestBoost', label: 'Test boost', description: 'test only', category: 'Behavior', fields: {} });
    const offAbility = registerAbility({
      id: 'test_boost',
      component: 'TestBoost',
      worksWith: ['test_glide'],
      override({ e, input }) {
        if (!input.isDown('jump')) return false;
        e.vx = 400;
        return true;
      },
      states: () => ['boosting'],
    });
    try {
      expect(movementValues()).toContain('glide');
      const p = produce(mapLevel(registry, ['..........', '..P.......', '##########']), (d) => {
        const player = d.definitions.find((x) => x.name === 'Player')!;
        (player.components.CharacterController as Record<string, unknown>).movement = 'glide';
        player.components.TestBoost = {};
      });
      const { rt, pl, me } = run(p);
      const y = me().y;
      pl.play(0.5, [{ at: 0, hold: ['right'] }]);
      expect(me().vx).toBe(100);
      expect(me().y).toBe(y);
      pl.play(0.1, [{ at: 0, hold: ['right', 'jump'] }]);
      expect(me().vx).toBe(400);
      expect(rt.motion(me())).toMatchObject({ model: 'test_glide', states: ['gliding', 'boosting'] });
    } finally {
      offAbility();
      offModel();
    }
  });
});

describe('the profile and the runtime agree', () => {
  it('every locomotion module is a runtime model, every ability module a runtime ability (and loading reads them the same)', () => {
    for (const m of modules.list<LocomotionModule>('locomotion')) expect(movementValues(), m.id).toContain(m.controller);
    const comps = abilityComponents();
    for (const a of modules.list<AbilityModule>('ability')) {
      expect(comps, a.id).toContain(a.component);
      expect(ABILITY_COMPONENTS[a.component], a.id).toBe(a.id);
    }
  });

  it('abilities need run-and-jump movement (refused seen from above); adding and removing them in the profile gives and takes the components', () => {
    const top = changedProfile(presetById('topdown')!.profile, { abilities: ['wall_jump'] });
    const c = checkProfile(top);
    expect(c.state).toBe('incompatible');
    expect(c.state === 'incompatible' && c.reasons.join()).toMatch(/ability "wall_jump" needs locomotion:arcade/);
    const p = projectFromPreset('platformer', registry);
    const withBoth = produce(p, (d) => void setGameProfile(d, { abilities: ['wall_jump', 'dash'] }, registry));
    const player = (x: Project) => x.definitions.find((d) => d.name === 'Player')!;
    expect(Object.keys(player(withBoth).components)).toEqual(expect.arrayContaining(['WallJump', 'Dash']));
    const onlyDash = produce(withBoth, (d) => void setGameProfile(d, { abilities: ['dash'] }, registry));
    expect(player(onlyDash).components.WallJump).toBeUndefined();
    expect(player(onlyDash).components.Dash).toBeDefined();
    // A game without a stored profile: its abilities are read from its player.
    const plain = produce(projectFromPreset('platformer', registry), (d) => {
      delete d.settings.profile;
      player(d as Project).components.DoubleJump = registry.createDefault('DoubleJump', {});
    });
    expect(inferProfile(plain, registry).movement.abilities).toEqual(['double_jump']);
  });
});
