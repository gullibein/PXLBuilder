/**
 * V1.2 (docs/engine-architecture-proposal.md §24.3): every ability is one definition. Double jump and ledge grab
 * moved onto it (T1 closed); the lifecycle of the registry is a rule, with tests; and the first ability for
 * characters seen from above, a dodge roll, which shows the registration is not for platformers.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { produce } from 'immer';
import { describe, expect, it, vi } from 'vitest';
import { applyOperations } from '../core/commands/operations';
import { componentRegistry, createBuiltinRegistry } from '../core/components/builtin';
import { ComponentRegistry } from '../core/components/registry';
import { gameFacts } from '../core/engine/actual';
import { modules } from '../core/engine/modules';
import { checkGame, profileChoices, profileOf, projectFromPreset, setGameProfile } from '../core/engine/profile';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { jumpTable } from '../core/model/reachability';
import { resolveEntity } from '../core/model/resolve';
import { playerReach, reachAbilityIds } from '../core/reach/reach';
import { keysRead, MEMBERS, type BehaviorScript } from '../core/script/language';
import { setScript } from '../core/script/mutations';
import { checkComponents, gameFromText, projectToBundle } from '../core/serialization/serialize';
import type { Project } from '../core/types';
import { boulderDash, spaceShooter } from '../regression/games/action';
import { mapLevel } from '../regression/games/platformers';
import { CONTROL_ACTIONS, DEFAULT_CONTROLS, keyMap } from '../core/model/controls';
import { keyHints } from '../editor/play/PlayView';
import { InputState, PAD_BUTTONS, type Action } from '../runtime/input';
import { abilityComponents, abilityKeys } from '../runtime/movement/index';
import { Runtime } from '../runtime/runtime';
import { abilityDefinitions, registerAbility, unregisterAbility } from './index';
import type { AbilityDefinition } from './types';

const registry = createBuiltinRegistry();
const controller = (p: Project) => p.definitions.find((d) => d.components.CharacterController)!;

describe('T1 closed: every ability is one definition, registered once', () => {
  it('the five there are: each a definition with its component, its movement models, its runtime part; what else each has is its own', () => {
    expect(abilityDefinitions().map((d) => [d.id, d.component.type, d.worksWith, !!d.reach?.table, !!d.reach?.move, !!d.bot])).toEqual([
      ['double_jump', 'DoubleJump', ['arcade'], true, false, false],
      ['ledge_grab', 'LedgeGrab', ['arcade'], true, false, false],
      ['wall_jump', 'WallJump', ['arcade'], false, true, true],
      ['dash', 'Dash', ['arcade'], false, true, true],
      ['dodge_roll', 'DodgeRoll', ['topdown'], false, false, false],
    ]);
    // Every system has exactly these, from the definitions.
    const ids = abilityDefinitions().map((d) => d.id);
    expect(modules.list('ability').map((x) => x.id)).toEqual(ids);
    expect(profileChoices().choices.abilities).toEqual(ids);
    expect([...abilityComponents()].sort()).toEqual(abilityDefinitions().map((d) => d.component.type).sort());
    for (const d of abilityDefinitions()) expect(registry.get(d.component.type), d.id).toBe(d.component);
    expect(reachAbilityIds()).toEqual(['double_jump', 'ledge_grab', 'wall_jump', 'dash']);
  });

  it('there is no other way to register one: the runtime keeps no ability list of its own, and the old tables are gone', async () => {
    const src = new URL('../', import.meta.url).pathname;
    expect(existsSync(join(src, 'runtime/movement/abilities.ts'))).toBe(false);
    expect(Object.keys(await import('../runtime/movement/index'))).not.toContain('registerAbility');
    expect(Object.keys(await import('../core/reach/reach'))).not.toContain('registerReachAbility');
    expect(Object.keys(await import('../core/engine/infer'))).not.toContain('ABILITY_COMPONENTS');
  });

  it('the code that implements or registers an ability is in src/abilities and nowhere else', () => {
    const SRC = new URL('../', import.meta.url).pathname;
    const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : /\.tsx?$/.test(f) && !/\.test\.|\.generated\./.test(f) ? [join(dir, f)] : []));
    const code = (f: string) => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // A component type declared, a module registered by hand, runtime state kept, a script name or a bot step by name.
    const implementing = /type: '(DoubleJump|LedgeGrab|WallJump|Dash|DodgeRoll)'|ability\('|beh\.(doubleJump|ledgeGrab)|components\.(DoubleJump|LedgeGrab)\b|c\.(DoubleJump|LedgeGrab)\b|to\.move === '(dash|wall_jump|wall_slide)'|case '(dashing|wall_sliding|rolling)'/;
    const where = files(SRC).filter((f) => implementing.test(code(f))).map((f) => f.slice(SRC.length)).sort();
    expect(where).toEqual(['abilities/dash.ts', 'abilities/dodgeRoll.ts', 'abilities/doubleJump.ts', 'abilities/ledgeGrab.ts', 'abilities/wallJump.ts']);
  });

  it('double jump and ledge grab are in the jump table by what their definitions add (more jumps in the air, a ledge caught above the peak)', () => {
    const plat = projectFromPreset('platformer', registry);
    const comps = (extra: Record<string, unknown>) => ({ ...resolveEntity(plat, instantiateDefinition(controller(plat), { x: 0, y: 0 }), registry).components, ...extra }) as never;
    const plain = jumpTable(comps({}), 980)!;
    const two = jumpTable(comps({ DoubleJump: { extraJumps: 1 } }), 980)!;
    const grab = jumpTable(comps({ LedgeGrab: {} }), 980)!;
    const top = (t: typeof plain) => Math.max(...t.gaps.map((g) => g.rise));
    expect(top(two)).toBeGreaterThan(top(plain) + 1);
    expect(top(grab)).toBeGreaterThan(top(plain));
    expect(grab.gaps.find((g) => g.rise === 0)).toEqual(plain.gaps.find((g) => g.rise === 0));
    // And the reach says so: judged by the table, the arcade moves and the bot alike; no capability of their own yet.
    const withBoth = produce(plat, (d) => void setGameProfile(d, { abilities: ['double_jump', 'ledge_grab'] }, registry));
    const r = playerReach(withBoth, withBoth.scenes[0].id, controller(withBoth).id, registry)!;
    expect(r.abilities).toEqual(['double_jump', 'ledge_grab']);
    for (const id of ['double_jump', 'ledge_grab']) for (const by of ['table', 'moves', 'simulator'] as const) expect(r.covers[by], `${id} by ${by}`).toContain(id);
    expect(r.approximate).toEqual([]);
    expect(r.capabilities).toEqual({});
  });
});

describe('the lifecycle of the registry: a rule, not an accident', () => {
  it('the engine\'s abilities are registered by importing src/abilities, which every part that reads abilities imports: each entry point alone has them all', async () => {
    const all = ['double_jump', 'ledge_grab', 'wall_jump', 'dash', 'dodge_roll'];
    const components = ['DoubleJump', 'LedgeGrab', 'WallJump', 'Dash', 'DodgeRoll'];
    // Each import below is the first of a fresh module graph: nothing else was loaded before it.
    const fresh = async <T>(path: string): Promise<T> => {
      vi.resetModules();
      return (await import(path)) as T;
    };
    // The editor's components (and so the inspector, add_component, the AI's component list).
    const builtin = await fresh<typeof import('../core/components/builtin')>('../core/components/builtin');
    for (const c of components) expect(builtin.componentRegistry.has(c) && builtin.createBuiltinRegistry().has(c), `components: ${c}`).toBe(true);
    // The runtime (the editor's play, and the exported game: its player page loads the play view, which loads this).
    const movement = await fresh<typeof import('../runtime/movement/index')>('../runtime/movement/index');
    expect([...movement.abilityComponents()].sort()).toEqual([...components].sort());
    const rt = await fresh<typeof import('../runtime/runtime')>('../runtime/runtime');
    expect(typeof rt.Runtime).toBe('function');
    expect((await import('./index')).abilityDefinitions().map((d) => d.id)).toEqual(all);
    // The profile's modules, the script language, the reach model, the level builder's vocabulary, the route bot.
    expect((await fresh<typeof import('../core/engine/modules')>('../core/engine/modules')).modules.list('ability').map((x) => x.id)).toEqual(all);
    const lang = await fresh<typeof import('../core/script/language')>('../core/script/language');
    for (const n of ['dashing', 'wall_sliding', 'rolling']) expect(lang.MEMBERS[n], n).toBeTruthy();
    expect((await fresh<typeof import('../core/reach/reach')>('../core/reach/reach')).reachAbilityIds()).toEqual(['double_jump', 'ledge_grab', 'wall_jump', 'dash']);
    expect((await fresh<typeof import('../core/levelGen/blueprint')>('../core/levelGen/blueprint')).mechanics()).toEqual(expect.arrayContaining(['wall_jump', 'dash']));
    expect((await fresh<typeof import('../runtime/routeBot')>('../runtime/routeBot')).botMoves()).toEqual(expect.arrayContaining(['wall_slide', 'wall_jump', 'dash']));
    vi.resetModules();
  });

  it('the exported game\'s page and the editor load the same play view, so the same runtime and the same abilities', () => {
    const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    expect(src('player/main.tsx')).toMatch(/from '\.\.\/editor\/play\/PlayView'/);
    expect(src('editor/play/PlayView.tsx')).toMatch(/from '\.\.\/\.\.\/runtime\/session'/);
    expect(src('runtime/movement/index.ts')).toMatch(/from '\.\.\/\.\.\/abilities\/index'/);
  });

  const SHOUT: AbilityDefinition = { id: 'test_shout', describe: 'a test', component: { type: 'TestShout', label: 'Shout', description: 'a test', category: 'Behavior', fields: { loud: { kind: 'number', default: 3 } } }, worksWith: ['arcade', 'topdown'], order: 60, runtime: { states: () => ['shouting'] } };

  it('never too late: a component registry made before an ability is registered has its component from then on (and no longer once it is taken out)', () => {
    const early = createBuiltinRegistry();
    expect(early.has('TestShout')).toBe(false);
    const off = registerAbility(SHOUT);
    try {
      for (const r of [early, registry, componentRegistry]) {
        expect(r.get('TestShout')).toBe(SHOUT.component);
        expect(r.createDefault('TestShout')).toEqual({ loud: 3 });
        expect(r.validate('TestShout', { loud: 'very' })[0].field).toBe('loud');
        // (Listed with the other abilities' components, among the behaviours.)
        const types = r.list().map((c) => c.type);
        expect(types.indexOf('TestShout')).toBe(types.indexOf('DodgeRoll') + 1);
        expect(types.indexOf('TestShout')).toBeLessThan(types.indexOf('Goal'));
      }
    } finally {
      off();
    }
    for (const r of [early, registry, componentRegistry]) expect(r.has('TestShout')).toBe(false);
  });

  it('a game already running has it too: the character\'s next step uses an ability registered meanwhile', () => {
    const p = produce(mapLevel(registry, ['P...', '####']), (d) => void (controller(d).components.TestShout = { loud: 3 }));
    const rt = new Runtime(p, p.scenes[0].id, registry);
    const input = new InputState();
    const e = rt.entities.find((x) => x.controller)!;
    rt.update(1 / 60, input);
    expect(rt.motion(e)!.states).not.toContain('shouting');
    const off = registerAbility(SHOUT);
    try {
      rt.update(1 / 60, input);
      expect(rt.motion(e)!.states).toContain('shouting');
    } finally {
      off();
    }
    rt.update(1 / 60, input);
    expect(rt.motion(e)!.states).not.toContain('shouting');
  });

  it('registered wrongly, it is refused at once: the same id or component twice, a setting whose default is not valid', () => {
    expect(() => registerAbility({ ...SHOUT, id: 'dash' })).toThrow(/Two abilities with the id "dash"/);
    expect(() => registerAbility({ ...SHOUT, component: { ...SHOUT.component, type: 'Dash' } })).toThrow(/Two abilities with the component "Dash"/);
    expect(() => registerAbility({ ...SHOUT, component: { ...SHOUT.component, fields: { loud: { kind: 'number', default: 'x' as never } } } })).toThrow(/Default for TestShout.loud is invalid/);
    // A component type a registry has itself can't be an ability's as well.
    const own = new ComponentRegistry({ list: () => [SHOUT.component] });
    expect(() => own.register(SHOUT.component)).toThrow(/already registered/);
    expect(abilityDefinitions().some((d) => d.id === 'test_shout')).toBe(false);
  });

  it('a game that has the component of an ability that isn\'t registered: said when it loads and in the report (it does nothing), never passed over', () => {
    const p = produce(projectFromPreset('platformer', registry), (d) => void (controller(d).components.TestShout = { loud: 3 }));
    expect(checkComponents(p, registry)).toEqual(['Object "Player": unknown component type "TestShout"']);
    const check = checkGame(p, registry);
    expect(check.state === 'degraded' && check.notes).toEqual(['Player: there is no "TestShout" component in this engine (an ability or behaviour that isn\'t registered), so it does nothing']);
    expect(profileOf(p, registry).movement.abilities).toEqual([]);
    // Registered: nothing to report, and the profile has it.
    const off = registerAbility(SHOUT);
    try {
      expect(checkGame(p, registry).state).toBe('ok');
      expect(profileOf(p, registry).movement.abilities).toEqual(['test_shout']);
    } finally {
      off();
      unregisterAbility('test_shout');
    }
  });
});

describe('the dodge roll: an ability for characters seen from above', () => {
  /** A game from above (or at an angle) with its player on an open floor at 16,16, with a Dodge Roll. */
  function arena(preset: 'topdown' | 'isometric' = 'topdown', settings: Record<string, unknown> = {}, roll = true): Project {
    return produce(projectFromPreset(preset, registry), (d) => {
      const sceneId = d.scenes[0].id;
      d.scenes[0].entities = d.scenes[0].entities.filter((e) => !d.definitions.find((x) => x.id === e.definitionId)?.components.CharacterController);
      if (roll) controller(d).components.DodgeRoll = registry.createDefault('DodgeRoll', settings);
      m.addEntity(d, sceneId, instantiateDefinition(controller(d), { x: 16, y: 16 }));
    });
  }
  function play(p: Project) {
    const rt = new Runtime(p, p.scenes[0].id, registry);
    const input = new InputState();
    const e = rt.entities.find((x) => x.controller)!;
    const run = (seconds: number, hold: Action[] = []) => {
      for (const a of hold) input.press(a);
      let rolled = 0;
      for (let i = 0; i < Math.round(seconds * 120); i++) {
        rt.update(1 / 120, input);
        if (rt.motion(e)!.states.includes('rolling')) rolled++;
      }
      for (const a of hold) input.release(a);
      return rolled / 120;
    };
    return { rt, input, e, run };
  }

  it('walking right and Shift (the special move\'s own key): a quick roll the same way, about twice as fast, for its duration; then it walks on; no steering meanwhile', () => {
    const g = play(arena());
    g.run(0.3, ['right']);
    const walking = g.e.vx;
    g.input.press('right');
    g.input.press('special');
    const x0 = g.e.x;
    // (The roll begun, Up is held as well for the rest of it.)
    const rolled = g.run(1 / 120) + g.run(0.22 - 1 / 120, ['up']);
    expect(rolled).toBeGreaterThan(0.2);
    // (Up was held all the while: the roll keeps its way.)
    expect(g.e.x - x0).toBeGreaterThan(walking * 0.22 * 1.8);
    expect(Math.abs(g.e.y - 16)).toBeLessThan(1);
    g.input.release('special');
    g.run(0.3);
    expect(g.rt.motion(g.e)!.states).not.toContain('rolling');
    expect(g.e.vx).toBeCloseTo(walking, 0);
    expect(g.rt.scripts.errors).toEqual([]);
  });

  it('standing still, it rolls the way it last headed; a wait before the next roll; its key and numbers are its component\'s', () => {
    const g = play(arena('topdown', { cooldown: 1 }));
    g.run(0.2, ['down']);
    g.run(0.3);
    const y0 = g.e.y;
    g.input.press('special');
    g.run(0.3);
    g.input.release('special');
    expect(g.e.y - y0).toBeGreaterThan(60);
    // Again at once: still waiting.
    g.run(0.3);
    const y1 = g.e.y;
    g.input.press('special');
    expect(g.run(0.2)).toBe(0);
    g.input.release('special');
    expect(Math.abs(g.e.y - y1)).toBeLessThan(1);
    // After the wait: again.
    g.run(0.8);
    g.input.press('special');
    expect(g.run(0.2)).toBeGreaterThan(0.15);
    g.input.release('special');
    // Another key, a slower and longer roll.
    const other = play(arena('topdown', { key: 'interact', speed: 200, duration: 0.5 }));
    other.input.press('jump');
    expect(other.run(0.2)).toBe(0);
    other.input.release('jump');
    other.input.press('interact');
    expect(other.run(0.6)).toBeCloseTo(0.5, 1);
  });

  it('it can\'t be hurt while it rolls (and can again after); with dodges off, it can', () => {
    const g = play(arena());
    g.input.press('right');
    g.input.press('special');
    g.run(0.1);
    expect(g.e.invincible).toBeGreaterThan(0);
    g.run(0.4);
    expect(g.e.invincible).toBe(0);
    const open = play(arena('topdown', { dodges: false }));
    open.input.press('right');
    open.input.press('special');
    expect(open.run(0.1)).toBeGreaterThan(0.05);
    expect(open.e.invincible).toBe(0);
  });

  it('walls stop a roll as they stop walking', () => {
    const p = produce(arena(), (d) => {
      const wall = d.definitions.find((x) => x.name === 'Wall')!;
      for (const y of [-16, 16, 48]) m.addEntity(d, d.scenes[0].id, instantiateDefinition(wall, { x: 112, y }));
    });
    const g = play(p);
    g.input.press('right');
    g.run(0.2);
    g.input.press('special');
    g.run(0.5);
    // (Its right side at the wall's left side: 112 - 16.)
    const body = g.rt.boxOf(g.e)!;
    expect(body.x + body.hw).toBeLessThanOrEqual(96.01);
    expect(g.e.x).toBeGreaterThan(60);
  });

  it('seen at an angle too: it rolls the way walking goes there (the keys point as they do on the screen), further in the same time', () => {
    // (In the isometric starter the blocks beside the start stop it one way: the roll is stopped by them as walking is.)
    const moved = (roll: boolean) => {
      const g = play(arena('isometric', {}, roll));
      g.run(0.2, ['down']);
      const [x0, y0] = [g.e.x, g.e.y];
      g.input.press('down');
      g.input.press('special');
      const rolled = g.run(0.22);
      return { dx: g.e.x - x0, dy: g.e.y - y0, rolled, iso: g.rt.camera.iso === true };
    };
    const walk = moved(false);
    const roll = moved(true);
    expect(walk.iso && roll.iso).toBe(true);
    expect(walk.rolled).toBe(0);
    expect(roll.rolled).toBeGreaterThan(0.2);
    // The same way (Down on the screen is along the level's diagonal: here its y, the blocks holding its x), over twice as far.
    expect(walk.dy).toBeGreaterThan(15);
    expect(roll.dy).toBeGreaterThan(walk.dy * 2);
    expect(Math.sign(roll.dx)).toBe(Math.sign(walk.dx));
    // Its speed along that way is the roll's own, shared between the two axes of the diagonal.
    expect(roll.dy / 0.22).toBeCloseTo(420 / Math.SQRT2, -1);
  });

  it('scripts read self.rolling; the profile shows it for the character that has it; nothing to report', () => {
    expect(MEMBERS.rolling).toBe('mid-roll (DodgeRoll)');
    const p = produce(arena(), (d) => void setScript(d, { target: 'definition', id: controller(d).id }, { name: 'Watch', description: '', vars: [{ name: 'rolled', value: 0 }], handlers: [{ when: { on: 'tick' }, if: 'self.rolling', do: [{ do: 'set', var: 'rolled', value: '1' }] }] }));
    const g = play(p);
    g.run(0.1);
    expect(g.e.scripts.at(-1)!.vars.get('rolled')).toBe(0);
    g.input.press('special');
    g.run(0.1);
    expect(g.e.scripts.at(-1)!.vars.get('rolled')).toBe(1);
    expect(profileOf(p, registry).movement.abilities).toEqual(['dodge_roll']);
    expect(gameFacts(p, registry).players.map((x) => x.abilities.map((a) => `${a.id}:${a.works}`))).toEqual([['dodge_roll:true']]);
    expect(checkGame(p, registry).state).toBe('ok');
  });

  it('given through the profile to a game from above; on a run-and-jump character it is refused when asked for, reported when it is there, and does nothing in play', () => {
    const top = produce(projectFromPreset('topdown', registry), (d) => void setGameProfile(d, { abilities: ['dodge_roll'] }, registry));
    expect(controller(top).components.DodgeRoll).toEqual(registry.createDefault('DodgeRoll'));
    expect(() => produce(projectFromPreset('platformer', registry), (d) => void setGameProfile(d, { abilities: ['dodge_roll'] }, registry))).toThrow(/ability "dodge_roll" needs locomotion:topdown/);
    // By the AI's own operation on a platformer's player: there, and said to do nothing.
    const plat = mapLevel(registry, ['........', 'P.......', '########']);
    const odd = produce(plat, (d) => void applyOperations(d, [{ op: 'add_component', target: 'definition', id: controller(plat).id, component: 'DodgeRoll', propsJson: '{}' } as never], registry));
    const check = checkGame(odd, registry);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(/Player: its DodgeRoll \(dodge_roll\) needs topdown movement, so on this character it does nothing/);
    expect(profileOf(odd, registry).movement.abilities).toEqual([]);
    // In play: Space is its jump, as ever; Shift does nothing; it never rolls.
    const a = play(plat);
    const b = play(odd);
    for (const g of [a, b]) {
      g.run(0.3);
      g.input.press('right');
      g.input.press('jump');
      g.input.press('special');
    }
    expect(b.run(0.5)).toBe(0);
    a.run(0.5);
    expect([b.e.x, b.e.y]).toEqual([a.e.x, a.e.y]);
  });

  it('the games from above of the regression suite have no roll unless given one: they play as they did (a shooter\'s Space still fires)', () => {
    for (const p of [spaceShooter(registry), boulderDash(registry)]) {
      expect(gameFacts(p, registry).players.flatMap((x) => x.abilities)).toEqual([]);
      const g = play(p);
      g.input.press('jump');
      g.input.press('special');
      expect(g.run(0.3)).toBe(0);
    }
  });

  it('a key of its own: given the roll, a shooter keeps every key it had (Space and X still fire, as often); Shift rolls, and Space does not', () => {
    const shots = (p: Project, keys: Action[]) => {
      const g = play(p);
      for (const k of keys) g.input.press(k);
      const rolled = g.run(2);
      return { fired: g.rt.eventLog.filter((e) => e.type === 'shot' && e.subject === g.e.name).length, rolled };
    };
    const plain = spaceShooter(registry);
    const withRoll = produce(plain, (d) => void (controller(d).components.DodgeRoll = registry.createDefault('DodgeRoll')));
    expect(checkGame(withRoll, registry).state).toBe('ok');
    for (const key of ['jump', 'fire'] as Action[]) {
      const before = shots(plain, [key]);
      const after = shots(withRoll, [key]);
      expect(before.fired, key).toBeGreaterThan(3);
      expect(after.fired, key).toBe(before.fired);
      expect(after.rolled, key).toBe(0);
    }
    // Shift rolls; firing goes on meanwhile.
    const both = shots(withRoll, ['fire', 'special']);
    expect(both.rolled).toBeGreaterThan(0.2);
    expect(both.fired).toBe(shots(plain, ['fire']).fired);
  });

  it('the special move is an action like the others: Shift by default, the right shoulder button on a controller, a key a game can change; scripts can listen to it', () => {
    expect(CONTROL_ACTIONS).toContain('special');
    expect(DEFAULT_CONTROLS.special).toEqual(['ShiftLeft', 'ShiftRight']);
    // No other action has its keys.
    for (const a of CONTROL_ACTIONS) if (a !== 'special') for (const k of DEFAULT_CONTROLS[a]) expect(DEFAULT_CONTROLS.special, a).not.toContain(k);
    expect([PAD_BUTTONS[5], PAD_BUTTONS[6]]).toEqual(['special', 'special']);
    expect(keyMap(undefined).ShiftLeft).toBe('special');
    // A game gives it another key (the AI's set_controls, the Controls dialog).
    const p = produce(arena(), (d) => void applyOperations(d, [{ op: 'set_controls', controlsJson: '{"special":["C"]}' } as never], registry));
    expect(keyMap(p.settings.controls).KeyC).toBe('special');
    expect(keyMap(p.settings.controls).ShiftLeft).toBeUndefined();
    // A script of the game's own on the same key.
    const q = produce(arena('topdown', {}, false), (d) => void setScript(d, { target: 'definition', id: controller(d).id }, { name: 'Shout', description: '', vars: [{ name: 'n', value: 0 }], handlers: [{ when: { on: 'key', key: 'special', edge: 'pressed' }, if: null, do: [{ do: 'set', var: 'n', value: 'n + 1' }] }] }));
    const g = play(q);
    g.input.press('special');
    g.run(0.1);
    expect(g.e.scripts.at(-1)!.vars.get('n')).toBe(1);
  });

  it('the play screen is told which keys the player\'s abilities listen to: its hints say "Shift rolls" (the game\'s own key when it has one), and a touch button is shown for it', () => {
    const p = arena();
    const g = play(p);
    expect(abilityKeys(g.e)).toEqual([{ action: 'special', does: 'rolls' }]);
    expect(keyHints(p, true, false, false, false, false, abilityKeys(g.e))).toBe('Arrows move · Shift rolls');
    const own = produce(p, (d) => void applyOperations(d, [{ op: 'set_controls', controlsJson: '{"special":["C"]}' } as never], registry));
    expect(keyHints(own, true, false, false, false, false, abilityKeys(play(own).e))).toBe('Arrows move · C rolls');
    // Its component set to another key: that one.
    expect(abilityKeys(play(arena('topdown', { key: 'fire' })).e)).toEqual([{ action: 'fire', does: 'rolls' }]);
    // A dash says its key too; a character without such an ability, none.
    const dasher = produce(mapLevel(registry, ['P...', '####']), (d) => void (controller(d).components.Dash = registry.createDefault('Dash')));
    expect(abilityKeys(play(dasher).e)).toEqual([{ action: 'fire', does: 'dashes', how: 'the way you hold (also up and diagonally)' }]);
    expect(keyHints(dasher, false, false, false, false, false, abilityKeys(play(dasher).e))).toMatch(/X dashes the way you hold \(also up and diagonally\)/);
    // (One that only goes sideways says no more than that.)
    const sideways = produce(dasher, (d) => void ((controller(d).components.Dash as { directions: string }).directions = 'horizontal'));
    expect(abilityKeys(play(sideways).e)).toEqual([{ action: 'fire', does: 'dashes' }]);
    expect(abilityKeys(play(arena('topdown', {}, false)).e)).toEqual([]);
  });
});

describe('a respawn is a fresh start for a character\'s abilities (the rule, and what it replaced)', () => {
  // Before V1.2 the engine was of two minds: a dash was refilled by a respawn, a double jump was not (its count
  // was kept elsewhere on the character and survived). Measured on the commit before: a character that had used
  // its air jump and came back in mid-air had none until it landed, while its dash was ready. Now every ability's
  // state is its own and is cleared together: after a respawn a character has what it has when a level starts.
  /** A character with these ability components, placed three rows up in the air (so it also comes back there). */
  function inTheAir(components: string[]) {
    const p = produce(mapLevel(registry, ['............', '............', '............', '............', 'P...........', '############']), (d) => {
      for (const c of components) controller(d).components[c] = registry.createDefault(c);
      d.scenes[0].entities.find((e) => e.definitionId === controller(d).id)!.transform.position.y -= 96;
    });
    const rt = new Runtime(p, p.scenes[0].id, registry);
    const input = new InputState();
    const e = rt.entities.find((x) => x.controller)!;
    const tick = (n: number) => {
      for (let i = 0; i < n; i++) rt.update(1 / 120, input);
    };
    const tap = (k: Action) => {
      input.press(k);
      tick(2);
      input.release(k);
      tick(2);
    };
    /** Jump pressed in the air: did it jump again? */
    const airJump = () => {
      const vy = e.vy;
      tap('jump');
      return e.vy < vy - 100;
    };
    const dash = () => {
      const vx = Math.abs(e.vx);
      tap('fire');
      return Math.abs(e.vx) > vx + 100;
    };
    tick(3);
    return { rt, e, tick, airJump, dash };
  }

  it('double jump: all its jumps at the level\'s start, none left once used, all again after a respawn (in mid-air too) and after landing', () => {
    const g = inTheAir(['DoubleJump']);
    expect(g.airJump()).toBe(true);
    g.tick(20);
    expect(g.airJump()).toBe(false);
    g.rt.respawn(g.e, 'died');
    g.tick(3);
    expect(g.e.grounded).toBe(false);
    expect(g.airJump()).toBe(true);
    expect(g.airJump()).toBe(false);
    // Landing refills it, as ever.
    g.tick(200);
    expect(g.e.grounded).toBe(true);
    g.rt.update(1 / 120, new InputState());
    const input = new InputState();
    input.press('jump');
    g.rt.update(1 / 120, input);
    input.release('jump');
    for (let i = 0; i < 30; i++) g.rt.update(1 / 120, input);
    expect(g.e.grounded).toBe(false);
  });

  it('two extra jumps: two after a respawn, not more; a setting lowered in play is the most it has', () => {
    const p = inTheAir(['DoubleJump']);
    (p.e.base.components.DoubleJump as { extraJumps: number }).extraJumps = 2;
    p.rt.respawn(p.e, 'died');
    p.tick(3);
    expect([p.airJump(), (p.tick(20), p.airJump()), (p.tick(20), p.airJump())]).toEqual([true, true, false]);
    p.rt.respawn(p.e, 'died');
    p.tick(3);
    (p.e.base.components.DoubleJump as { extraJumps: number }).extraJumps = 1;
    expect([p.airJump(), (p.tick(20), p.airJump())]).toEqual([true, false]);
  });

  it('dash: the same rule (as it always was for a dash)', () => {
    const g = inTheAir(['Dash']);
    expect(g.dash()).toBe(true);
    g.tick(40);
    expect(g.dash()).toBe(false);
    g.rt.respawn(g.e, 'died');
    g.tick(3);
    expect(g.dash()).toBe(true);
  });

  it('both on one character: both are back after a respawn', () => {
    const g = inTheAir(['DoubleJump', 'Dash']);
    expect(g.airJump()).toBe(true);
    g.tick(10);
    expect(g.dash()).toBe(true);
    g.tick(40);
    expect([g.airJump(), g.dash()]).toEqual([false, false]);
    g.rt.respawn(g.e, 'died');
    g.tick(3);
    expect(g.airJump()).toBe(true);
    g.tick(10);
    expect(g.dash()).toBe(true);
  });

  it('dodge roll: the wait before the next roll is over after a respawn', () => {
    const p = produce(projectFromPreset('topdown', registry), (d) => {
      controller(d).components.DodgeRoll = registry.createDefault('DodgeRoll', { cooldown: 5 });
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(controller(d), { x: 16, y: 16 }));
    });
    const rt = new Runtime(p, p.scenes[0].id, registry);
    const input = new InputState();
    const e = rt.entities.find((x) => x.controller)!;
    const roll = () => {
      input.press('special');
      let rolled = false;
      for (let i = 0; i < 60; i++) {
        rt.update(1 / 120, input);
        if (i === 1) input.release('special');
        rolled ||= rt.motion(e)!.states.includes('rolling');
      }
      return rolled;
    };
    expect(roll()).toBe(true);
    expect(roll()).toBe(false);
    rt.respawn(e, 'died');
    // (Keys held through a respawn don't count until let go: none is held here.)
    rt.update(1 / 120, input);
    expect(roll()).toBe(true);
  });
});

describe('the key hints say every key the game uses, and what it does here', () => {
  const game = createProject(registry, 'City', 'topdown');
  it('a key a script listens to is in the hints (a car was stolen with the action key, and no hint said so)', () => {
    // No lever, no gun: only the arrows, as before.
    expect(keyHints(game, true, false, false, false)).toBe('Arrows move');
    // The game's script handles the action key, and reads the fire key.
    expect(keyHints(game, true, false, false, false, false, [], ['interact'])).toBe('Arrows move · E uses');
    expect(keyHints(game, true, false, false, false, false, [], ['fire', 'interact', 'jump'])).toBe('Arrows move · Space acts · E uses · X fires');
    // (A gun says "shoots", with or without a script.)
    expect(keyHints(game, true, false, true, false, false, [], ['fire'])).toBe('Arrows move · X shoots');
    const script = { id: 's', name: 'Crime', description: '', enabled: true, vars: [], states: [], handlers: [{ when: { on: 'key', key: 'interact', edge: 'pressed' }, state: null, if: "pressed('fire') or key(\"jump\")", do: [] }] } as unknown as BehaviorScript;
    expect([...keysRead([script])].sort()).toEqual(['fire', 'interact', 'jump']);
    expect([...keysRead([{ ...script, enabled: false }])]).toEqual([]);
  });

  it('the game says what a key does in its own words (set_controls "names"), with its own keys', () => {
    const named = produce(game, (d) => void applyOperations(d, [{ op: 'set_controls', controlsJson: '{"fire":["Space"],"interact":["X"],"jump":["Z"],"names":{"interact":"steals a car or gets out","fire":"shoots"}}' } as never], registry));
    expect(named.settings.keyNames).toEqual({ interact: 'steals a car or gets out', fire: 'shoots' });
    expect(keyHints(named, true, false, true, false, false, [], ['interact'])).toBe('Arrows move · X steals a car or gets out · Space shoots');
    // Names alone leave the keys as they are; an empty name takes one away; "{}" puts everything back.
    const more = produce(named, (d) => void applyOperations(d, [{ op: 'set_controls', controlsJson: '{"names":{"fire":""}}' } as never], registry));
    expect(more.settings.controls).toEqual(named.settings.controls);
    expect(more.settings.keyNames).toEqual({ interact: 'steals a car or gets out' });
    const back = produce(named, (d) => void applyOperations(d, [{ op: 'set_controls', controlsJson: '{}' } as never], registry));
    expect(back.settings.controls).toBeUndefined();
    expect(back.settings.keyNames).toBeUndefined();
    // Only the keys a game can give a meaning to; said plainly otherwise.
    expect(() => produce(game, (d) => void applyOperations(d, [{ op: 'set_controls', controlsJson: '{"names":{"left":"turns"}}' } as never], registry))).toThrow(/a name can be given to jump, interact, fire, special/);
    // They are saved with the game.
    const { project: reopened } = gameFromText(JSON.stringify(projectToBundle(named)), registry);
    expect(reopened.settings.keyNames).toEqual({ interact: 'steals a car or gets out', fire: 'shoots' });
  });
});
