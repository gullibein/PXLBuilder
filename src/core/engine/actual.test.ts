/**
 * The remediation after the F6 audit (docs/engine-architecture-proposal.md §23): the profile never silently
 * describes another game than the one that runs. What is declared (the view, the movement model), what the game
 * actually is (each player-controlled character, each level), and the report that compares them; the audit's six
 * probes; several players; no player; isometric games made, changed and added to.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations } from '../commands/operations';
import { createBuiltinRegistry } from '../components/builtin';
import { createLevelFor, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import type { Project } from '../types';
import { boulderDash, mining, spaceShooter } from '../../regression/games/action';
import { drMario, tetris } from '../../regression/games/boards';
import { digRoom } from '../../regression/games/digging';
import { precisionRoom } from '../../regression/games/precision';
import { rpgGame, tacticsBoard } from '../../regression/games/turnBased';
import { InputState } from '../../runtime/input';
import { motionStates } from '../../runtime/movement/index';
import { Runtime } from '../../runtime/runtime';
import { describeMovement, gameFacts, levelView } from './actual';
import { PRESETS } from './presets';
import { checkGame, describeProfile, profileOf, projectFromPreset, setGameProfile, storedGameProfile } from './profile';

const registry = createBuiltinRegistry();
const ops = (p: Project, list: object[]) =>
  produce(p, (d) => {
    applyOperations(d, list as never, registry);
  });
const notes = (p: Project) => {
  const c = checkGame(p, registry);
  return c.state === 'degraded' ? c.notes : c.state === 'incompatible' ? c.reasons : [];
};
const player = (p: Project) => p.definitions.find((d) => d.name === 'Player')!;
/** A platformer with a floor and its player placed, played for a moment with these keys held. */
function played(p: Project, hold: ('right' | 'left' | 'fire' | 'jump')[], seconds = 0.6) {
  const withFloor = ops(p, [
    { op: 'draw_tiles', sceneId: p.scenes[0].id, definitionRef: p.definitions.find((d) => d.name === 'Platform')!.id, rects: [{ col: -6, row: 1, width: 24, height: 1 }] },
    { op: 'place_instance', sceneId: p.scenes[0].id, definitionRef: player(p).id, x: 16, y: 16, name: null, ref: null },
  ]);
  const rt = new Runtime(withFloor, withFloor.scenes[0].id, registry);
  const input = new InputState();
  for (let i = 0; i < 20; i++) rt.update(1 / 60, input);
  const e = rt.entities.find((x) => x.controller)!;
  const x0 = e.x;
  const states = new Set<string>();
  for (const k of hold) input.press(k);
  for (let i = 0; i < seconds * 60; i++) {
    rt.update(1 / 60, input);
    for (const s of motionStates(e)) states.add(s);
  }
  return { rt, e, moved: e.x - x0, states, errors: rt.eventLog.filter((ev) => ev.type === 'script_error') };
}

describe('declared, actual, and the report that compares them', () => {
  it('every preset\'s new game agrees with itself: nothing to report, its levels seen as declared, its players moving as declared', () => {
    for (const preset of PRESETS) {
      const p = projectFromPreset(preset.id, registry);
      const facts = gameFacts(p, registry);
      expect(checkGame(p, registry).state, preset.id).toBe('ok');
      for (const l of facts.levels) expect(l.view, `${preset.id} ${l.name}`).toBe(preset.profile.view);
      for (const pl of facts.players) expect(pl.model, `${preset.id} ${pl.name}`).toBe(preset.profile.movement.model);
    }
  });

  it('the games of the regression suite agree with themselves too (boards, shooter, mining, Boulder Dash, RPG, tactics, the precision and digging rooms)', () => {
    const games: [string, Project][] = [['tetris', tetris(registry)], ['dr mario', drMario(registry, [{ col: 2, row: 10, color: 'red' }])], ['shooter', spaceShooter(registry)], ['mining', mining(registry)], ['boulder dash', boulderDash(registry)], ['rpg', rpgGame(registry)], ['tactics', tacticsBoard(registry)], ['tactics (stored)', tacticsBoard(registry, true)], ['dig', digRoom(registry)], ['precision', precisionRoom(registry)]];
    for (const [name, p] of games) expect(checkGame(p, registry).state, name).toBe('ok');
  });

  it('a game without a player-controlled object: movement is "not in use", which is no error and no incompatibility', () => {
    for (const p of [tetris(registry), drMario(registry, [{ col: 2, row: 10, color: 'red' }]), tacticsBoard(registry), tacticsBoard(registry, true)]) {
      const facts = gameFacts(p, registry);
      expect(facts.players.filter((pl) => p.scenes.some((s) => s.entities.some((e) => e.definitionId === pl.id)))).toEqual([]);
      expect(checkGame(p, registry).state).toBe('ok');
    }
    // No object with a controller at all: said in so many words.
    const none = produce(tetris(registry), (d) => {
      for (const def of d.definitions) delete def.components.CharacterController;
    });
    expect(gameFacts(none, registry).players).toEqual([]);
    expect(describeMovement(gameFacts(none, registry))).toMatch(/^not in use/);
    expect(describeProfile(profileOf(none, registry), gameFacts(none, registry))).toMatch(/players: not in use/);
    expect(profileOf(none, registry).movement.abilities).toEqual([]);
    expect(checkGame(none, registry).state).toBe('ok');
    expect(new Runtime(none, none.scenes[0].id, registry).eventLog.filter((e) => e.type === 'script_error')).toEqual([]);
  });
});

describe('the audit\'s probes: the profile can no longer describe another game in silence', () => {
  const plat = () => projectFromPreset('platformer', registry);

  it('H1: the player set to walk top-down and the level\'s gravity taken away, by the AI\'s own operations: both said, by name', () => {
    const p = plat();
    const h1 = ops(p, [
      { op: 'set_component_field', target: 'definition', id: player(p).id, component: 'CharacterController', field: 'movement', valueJson: '"topdown"' },
      { op: 'set_world', sceneId: p.scenes[0].id, gravityX: 0, gravityY: 0, backgroundColor: null, view: null },
    ]);
    // Declared: unchanged (nobody chose another view or model). Actual: as the game is.
    expect([profileOf(h1, registry).view, profileOf(h1, registry).movement.model]).toEqual(['side', 'arcade']);
    const facts = gameFacts(h1, registry);
    expect(facts.players.map((x) => [x.name, x.model])).toEqual([['Player', 'topdown']]);
    expect(facts.levels.map((l) => l.view)).toEqual(['top']);
    const said = notes(h1).join('\n');
    expect(checkGame(h1, registry).state).toBe('degraded');
    expect(said).toMatch(/Player moves by "topdown" \(its Character Controller\), not by the profile's "arcade": it plays as its own setting says/);
    expect(said).toMatch(/"Level 1" is seen from above \(no gravity\), not as the game's view says \(side\)/);
    // The platformer kit's objects need a side view, so declaring this game "seen from above" is refused: the
    // report stays until the game and its profile agree again (here: the two edits taken back).
    expect(() => produce(h1, (d) => void setGameProfile(d, { view: 'top', movement: 'topdown', generator: null }, registry))).toThrow(/kit "platformer" needs view:side/);
    const back = ops(h1, [
      { op: 'set_component_field', target: 'definition', id: player(p).id, component: 'CharacterController', field: 'movement', valueJson: '"platformer"' },
      { op: 'set_world', sceneId: p.scenes[0].id, gravityX: 0, gravityY: 980, backgroundColor: null, view: null },
    ]);
    expect(checkGame(back, registry).state).toBe('ok');
  });

  it('H2: a Dash component added to the player: the profile has the ability at once (it is the player\'s), the player dashes, nothing to report', () => {
    const p = plat();
    const h2 = ops(p, [{ op: 'add_component', target: 'definition', id: player(p).id, component: 'Dash', propsJson: '{}' }]);
    // (Whatever is stored for abilities is not read.)
    expect(storedGameProfile(h2)!.movement.abilities).toEqual([]);
    expect(profileOf(h2, registry).movement.abilities).toEqual(['dash']);
    expect(played(h2, ['right', 'fire']).states.has('dashing')).toBe(true);
    expect(checkGame(h2, registry).state).toBe('ok');
  });

  it('H2c: the ability chosen in the profile, then its component taken off the player: the profile no longer has it, and the player does not dash', () => {
    const with_ = produce(plat(), (d) => void setGameProfile(d, { abilities: ['dash'] }, registry));
    expect(player(with_).components.Dash).toBeDefined();
    const h2c = ops(with_, [{ op: 'remove_component', target: 'definition', id: player(with_).id, component: 'Dash' }]);
    expect(profileOf(h2c, registry).movement.abilities).toEqual([]);
    expect(played(h2c, ['right', 'fire']).states.has('dashing')).toBe(false);
    expect(checkGame(h2c, registry).state).toBe('ok');
  });

  it('H3: a movement model that is not there: the character ignores the movement keys (no other model in its place), one runtime error, and the report names it; the level still starts', () => {
    const h3 = produce(plat(), (d) => void ((player(d).components.CharacterController as { movement: string }).movement = 'hover'));
    const g = played(h3, ['right', 'jump']);
    expect(Math.abs(g.moved)).toBeLessThan(0.01);
    expect(g.states.size).toBe(0);
    // It is still in the level, standing on the floor (gravity is the level's, not the model's).
    expect(g.e.alive && g.e.grounded).toBe(true);
    expect(g.errors.length).toBe(1);
    expect(String(g.errors[0].detail?.message)).toMatch(/there is no movement model "hover" \(there are: platformer, topdown\): Player ignores the movement keys/);
    expect(g.rt.motion(g.e)!.model).toBe('hover');
    expect(gameFacts(h3, registry).players[0]).toMatchObject({ movement: 'hover', model: null });
    expect(notes(h3).join('\n')).toMatch(/Player: there is no movement model "hover", so it ignores the movement keys/);
    // (The others in the level play on: an enemy placed beside it still walks.)
  });

  it('H5: one level without gravity in a side-view game: named, with what stays as the game\'s view has it', () => {
    const two = produce(plat(), (d) => {
      m.addScene(d, createLevelFor(d, 'Space'));
      d.scenes[1].world.gravity = { x: 0, y: 0 };
    });
    expect(gameFacts(two, registry).levels.map((l) => [l.name, l.view])).toEqual([['Level 1', 'side'], ['Space', 'top']]);
    const said = notes(two);
    expect(said.length).toBe(1);
    expect(said[0]).toMatch(/"Space" is seen from above \(no gravity\), not as the game's view says \(side\): it plays as it is set, while what the game's view decides \(ramps and jump-through platforms, camera zones, the level builder\) stays as for "side"/);
    // (And so it does: the level's geometry is the game's, unchanged by this work.)
    const rt = new Runtime(two, two.scenes[1].id, registry);
    expect([...rt.geometry].sort()).toEqual(['box', 'cells', 'one_way', 'ramp']);
  });

  it('H6: the view set to isometric: every level is drawn and walked at an angle (and back again), not only declared so', () => {
    const top = produce(projectFromPreset('topdown', registry), (d) => {
      m.addScene(d, createLevelFor(d, 'Two'));
      const hero = d.definitions.find((x) => x.components.CharacterController)!;
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(hero, { x: 48, y: 48 }));
    });
    const iso = produce(top, (d) => void setGameProfile(d, { view: 'iso' }, registry));
    expect(iso.scenes.map((s) => s.world.view)).toEqual(['iso', 'iso']);
    expect(gameFacts(iso, registry).levels.map((l) => l.view)).toEqual(['iso', 'iso']);
    expect(checkGame(iso, registry).state).toBe('ok');
    // Played: the runtime's camera is isometric, and "right" goes the way it points on the screen (down the level's rows too).
    const walk = (p: Project) => {
      const rt = new Runtime(p, p.scenes[0].id, registry);
      const input = new InputState();
      const e = rt.entities.find((x) => x.controller)!;
      const [x, y] = [e.x, e.y];
      input.press('right');
      for (let i = 0; i < 30; i++) rt.update(1 / 60, input);
      return { iso: rt.camera.iso === true, dx: e.x - x, dy: e.y - y };
    };
    const flat = walk(top);
    const angled = walk(iso);
    expect(flat.iso).toBe(false);
    expect(Math.abs(flat.dy)).toBeLessThan(0.01);
    expect(angled.iso).toBe(true);
    expect(Math.abs(angled.dy)).toBeGreaterThan(5);
    // Back to a view from above: flat again, every level.
    const back = produce(iso, (d) => void setGameProfile(d, { view: 'top' }, registry));
    expect(back.scenes.map((s) => s.world.view)).toEqual([undefined, undefined]);
    expect(walk(back).iso).toBe(false);
    expect(checkGame(back, registry).state).toBe('ok');
  });
});

describe('several players, each by itself', () => {
  /** A side-view game with a second player-controlled object: a top-down "Drone" with a Dash and a WallJump component. */
  const two = () =>
    produce(projectFromPreset('platformer', registry), (d) => {
      const drone = JSON.parse(JSON.stringify(player(d))) as Project['definitions'][number];
      drone.id = 'def_drone';
      drone.name = 'Drone';
      (drone.components.CharacterController as { movement: string }).movement = 'topdown';
      drone.components.Dash = registry.createDefault('Dash', {});
      d.definitions.push(drone);
      player(d).components.DoubleJump = registry.createDefault('DoubleJump', {});
    });

  it('the facts list both, with their own movement and abilities; neither stands for the other', () => {
    const facts = gameFacts(two(), registry);
    expect(facts.players.map((p) => [p.name, p.model, p.abilities.map((a) => `${a.id}:${a.works}`)])).toEqual([
      ['Player', 'arcade', ['double_jump:true']],
      ['Drone', 'topdown', ['dash:false']],
    ]);
    expect(describeMovement(facts)).toBe('Player: arcade + double_jump; Drone: topdown + dash (does nothing)');
  });

  it('the game\'s abilities are those that work on someone: the drone\'s dash is not one; the report says the drone moves otherwise and that its dash does nothing', () => {
    const p = two();
    expect(profileOf(p, registry).movement.abilities).toEqual(['double_jump']);
    const said = notes(p).join('\n');
    expect(said).toMatch(/Drone moves by "topdown" \(its Character Controller\), not by the profile's "arcade"/);
    expect(said).toMatch(/Drone: its Dash \(dash\) needs arcade movement, so on this character it does nothing/);
    expect(said).not.toMatch(/Player/);
    // (And in play it does nothing: the runtime gives an ability only to a model it works with.)
    const rt = new Runtime(ops(p, [{ op: 'place_instance', sceneId: p.scenes[0].id, definitionRef: 'def_drone', x: 16, y: 16, name: null, ref: null }]), p.scenes[0].id, registry);
    const input = new InputState();
    input.press('right');
    input.press('fire');
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      rt.update(1 / 60, input);
      for (const s of motionStates(rt.entities.find((e) => e.controller)!)) seen.add(s);
    }
    expect(seen.has('dashing')).toBe(false);
  });

  it('an ability chosen in the profile goes to the characters it works on (the player), not to the drone; taken away, it leaves everyone', () => {
    const on = produce(two(), (d) => void setGameProfile(d, { abilities: ['double_jump', 'wall_jump'] }, registry));
    expect(player(on).components.WallJump).toBeDefined();
    expect(on.definitions.find((d) => d.name === 'Drone')!.components.WallJump).toBeUndefined();
    const off = produce(on, (d) => void setGameProfile(d, { abilities: [] }, registry));
    expect(player(off).components.WallJump).toBeUndefined();
    expect(player(off).components.DoubleJump).toBeUndefined();
    expect(profileOf(off, registry).movement.abilities).toEqual([]);
  });

  it('a placed copy that moves otherwise than its object (its own override) is listed by itself, with its level', () => {
    const p = produce(projectFromPreset('platformer', registry), (d) => {
      const e = instantiateDefinition(player(d), { x: 0, y: 0 }, 'Ghost');
      e.components.CharacterController = { movement: 'topdown' };
      m.addEntity(d, d.scenes[0].id, e);
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(player(d), { x: 64, y: 0 }));
    });
    expect(gameFacts(p, registry).players.map((x) => [x.name, x.level, x.model])).toEqual([['Player', null, 'arcade'], ['Ghost', 'Level 1', 'topdown']]);
    expect(notes(p).join('\n')).toMatch(/Ghost \(in Level 1\) moves by "topdown"/);
  });

  it('a preset chosen for a game whose player has abilities: they stay, as far as the preset\'s movement has them', () => {
    const dash = produce(projectFromPreset('platformer', registry), (d) => void setGameProfile(d, { abilities: ['dash'] }, registry));
    const classic = produce(dash, (d) => void setGameProfile(d, { preset: 'classic-platformer' }, registry));
    expect(player(classic).components.Dash).toBeDefined();
    expect(profileOf(classic, registry).movement.abilities).toEqual(['dash']);
  });
});

describe('isometric games: made, added to, changed', () => {
  it('a level\'s view is its own: drawn at an angle, else pulled by gravity, else neither', () => {
    expect(levelView({ gravity: { x: 0, y: 980 } })).toBe('side');
    expect(levelView({ gravity: { x: 0, y: 0 } })).toBe('top');
    expect(levelView({ gravity: { x: 0, y: 0 }, view: 'iso' })).toBe('iso');
  });

  it('a new level in an isometric game is isometric (by the editor\'s New level and by the AI\'s create_level)', () => {
    const iso = projectFromPreset('isometric', registry);
    expect(iso.scenes[0].world.view).toBe('iso');
    expect(createLevelFor(iso, 'Level 2').world.view).toBe('iso');
    const more = ops(iso, [{ op: 'create_level', ref: 'l2', name: 'Level 2' }]);
    expect(more.scenes.map((s) => s.world.view)).toEqual(['iso', 'iso']);
    expect(checkGame(more, registry).state).toBe('ok');
    // (And a flat game's new level is flat, as ever.)
    expect(createLevelFor(projectFromPreset('topdown', registry), 'Level 2').world.view).toBeUndefined();
  });

  it('one level of an isometric game set flat (set_world): named in the report; the others stay as they are', () => {
    const iso = ops(projectFromPreset('isometric', registry), [{ op: 'create_level', ref: 'l2', name: 'Flat one' }]);
    const mixed = ops(iso, [{ op: 'set_world', sceneId: iso.scenes[1].id, gravityX: null, gravityY: null, backgroundColor: null, view: 'flat' }]);
    expect(gameFacts(mixed, registry).levels.map((l) => l.view)).toEqual(['iso', 'top']);
    expect(notes(mixed).join('\n')).toMatch(/"Flat one" is seen from above \(no gravity\), not as the game's view says \(iso\)/);
  });

  it('isometric with run-and-jump movement is refused when asked for (nothing is written), as before', () => {
    const p = projectFromPreset('platformer', registry);
    expect(() => produce(p, (d) => void setGameProfile(d, { view: 'iso' }, registry))).toThrow(/doesn't go together/);
    expect(p.scenes[0].world.view).toBeUndefined();
  });
});
