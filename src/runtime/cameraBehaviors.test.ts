/**
 * F5: the camera as a pipeline of behaviours chosen by the game's profile
 * (docs/engine-architecture-proposal.md §20). follow is the camera as it was (its goldens: regression/camera.test);
 * here: rooms (camera zones: lock, slide, cut), velocity look-ahead, a profile without follow, and that play and the
 * compatibility report agree on what is active.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { CAMERA_BEHAVIORS, cameraStatus } from '../core/engine/camera';
import { modules } from '../core/engine/modules';
import { PRESETS } from '../core/engine/presets';
import { changedProfile, checkGame, checkProfile, projectFromPreset, setGameProfile } from '../core/engine/profile';
import type { CameraSettings } from '../core/model/camera';
import { createDefinition, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { migrateProject } from '../core/serialization/migrations';
import { FORMAT_VERSION } from '../core/serialization/version';
import type { Project, Vec2 } from '../core/types';
import { CameraController } from './camera';
import { cameraBehaviorIds, registerCameraBehavior, ROOM_SLIDE, zoneAt } from './cameraBehaviors';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();
const VIEW = { width: 320, height: 192 };

interface Opts {
  camera?: string[];
  settings?: Partial<CameraSettings>;
  /** Zones as [x, y, width, height, transition?] (centres). */
  zones?: [number, number, number, number, ('slide' | 'cut')?][];
  preset?: string;
  player?: Vec2;
  /** Ground tiles from x = 16 to this (side view). */
  floorTo?: number;
}

/** A level of the preset: a floor (side view), the player, camera zones as objects, the profile's camera as given. */
function game(o: Opts = {}): Project {
  const base = projectFromPreset(o.preset ?? 'platformer', registry);
  const sceneId = base.scenes[0].id;
  const side = (o.preset ?? 'platformer') === 'platformer';
  return produce(base, (d) => {
    d.scenes[0].entities = [];
    if (o.camera) setGameProfile(d, { camera: o.camera }, registry);
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    if (side) for (let x = 16; x <= (o.floorTo ?? 1264); x += 32) place('Platform', { x, y: 176 });
    const player = d.definitions.find((x) => x.components.CharacterController)!;
    m.addEntity(d, sceneId, instantiateDefinition(player, o.player ?? { x: 48, y: 144 }));
    (o.zones ?? []).forEach(([x, y, w, h, transition], i) => {
      const def = createDefinition(`Room ${i + 1}`, { Sprite: registry.createDefault('Sprite', { width: w, height: h, visible: false }), CameraZone: registry.createDefault('CameraZone', { transition: transition ?? 'slide' }) }, []);
      m.addDefinition(d, def, registry);
      m.addEntity(d, sceneId, instantiateDefinition(def, { x, y }));
    });
    m.setCameraSettings(d, sceneId, { bounds: 'none', ...o.settings });
  });
}

function play(project: Project) {
  const rt = new Runtime(project, project.scenes[0].id, registry);
  rt.cam.setView(VIEW.width, VIEW.height);
  rt.cam.snap();
  const input = new InputState();
  const me = rt.entities.find((e) => e.controller)!;
  const run = (seconds: number, hold: Action[] = [], each?: () => void) => {
    for (const a of ['left', 'right', 'up', 'down', 'jump'] as const) (hold.includes(a) ? input.press(a) : input.release(a));
    for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
      rt.update(1 / 60, input);
      each?.();
    }
  };
  return { rt, me, run, cam: rt.cam.camera };
}

/** Two rooms side by side, each exactly one screen: x 0..320 and 320..640. */
const TWO_ROOMS: Opts['zones'] = [[160, 96, 320, 192], [480, 96, 320, 192]];

describe('F5: rooms (camera zones)', () => {
  it('a room locks: the view stays on the room while the player walks about in it', () => {
    const { run, cam, me } = play(game({ camera: ['follow', 'rooms'], zones: TWO_ROOMS }));
    expect([cam.x, cam.y]).toEqual([160, 96]);
    const seen: number[] = [];
    run(0.8, ['right'], () => seen.push(cam.x));
    expect(me.x).toBeGreaterThan(150);
    expect(me.x).toBeLessThan(320);
    expect(new Set(seen)).toEqual(new Set([160]));
  });

  it('walking out slides to the next room in half a second, play going on; then that room locks', () => {
    const { rt, run, cam, me } = play(game({ camera: ['follow', 'rooms'], zones: TWO_ROOMS, player: { x: 290, y: 144 } }));
    const xs: number[] = [];
    let slidFrames = 0;
    run(1.2, ['right'], () => {
      xs.push(cam.x);
      if (rt.cam.sliding) slidFrames++;
    });
    expect(me.x).toBeGreaterThan(330);
    // It slid (not cut): a run of frames in between, each further on; about ROOM_SLIDE long.
    expect(slidFrames / 60).toBeCloseTo(ROOM_SLIDE, 1);
    const moving = xs.filter((x) => x > 160.5 && x < 479.5);
    expect(moving.length).toBeGreaterThan(20);
    for (let i = 1; i < moving.length; i++) expect(moving[i]).toBeGreaterThanOrEqual(moving[i - 1]);
    expect(cam.x).toBeCloseTo(480, 3);
    // And back: it slides back to the first room.
    run(2.4, ['left']);
    expect(me.x).toBeLessThan(320);
    expect(cam.x).toBeCloseTo(160, 3);
  });

  it('a zone set to cut: the view is on the next room at once', () => {
    const { rt, run, cam, me } = play(game({ camera: ['follow', 'rooms'], zones: [[160, 96, 320, 192], [480, 96, 320, 192, 'cut']], player: { x: 300, y: 144 } }));
    const xs = new Set<number>();
    run(0.6, ['right'], () => xs.add(Math.round(cam.x)));
    expect(me.x).toBeGreaterThan(320);
    expect([...xs].sort((a, b) => a - b)).toEqual([160, 480]);
    expect(rt.cam.sliding).toBe(false);
  });

  it('a room bigger than the screen: the camera follows inside it and never shows past its edges; outside every zone it follows as usual', () => {
    const { rt, run, cam, me } = play(game({ camera: ['follow', 'rooms'], zones: [[320, 96, 640, 192]], player: { x: 48, y: 144 } }));
    let most = 0;
    run(4, ['right'], () => {
      if (me.x <= 640) most = Math.max(most, rt.cam.visible().maxX);
    });
    expect(most).toBeGreaterThan(600);
    expect(most).toBeLessThanOrEqual(640 + 1e-6);
    // Past the zone: no limits any more, the camera is on the player.
    expect(me.x).toBeGreaterThan(700);
    run(1, []);
    expect(Math.abs(cam.x - me.x)).toBeLessThan(2);
  });

  it('seen from above too (rooms of a dungeon, up and down): nothing about rooms is for platformers', () => {
    const { run, cam, me } = play(game({ preset: 'topdown', camera: ['follow', 'rooms'], zones: [[160, 96, 320, 192], [160, 288, 320, 192]], player: { x: 160, y: 150 } }));
    expect([cam.x, cam.y]).toEqual([160, 96]);
    run(1.5, ['down']);
    expect(me.y).toBeGreaterThan(192);
    expect(cam.x).toBeCloseTo(160, 3);
    expect(cam.y).toBeCloseTo(288, 3);
  });

  it('zones overlapping: the smallest one the target is in counts (a room inside a wider area)', () => {
    const big = { id: 'big', rect: { minX: 0, minY: 0, maxX: 1000, maxY: 400 }, transition: 'slide' as const };
    const small = { id: 'small', rect: { minX: 100, minY: 100, maxX: 300, maxY: 200 }, transition: 'cut' as const };
    expect(zoneAt([big, small], { x: 150, y: 150 })?.id).toBe('small');
    expect(zoneAt([big, small], { x: 500, y: 150 })?.id).toBe('big');
    expect(zoneAt([big, small], { x: 2000, y: 150 })).toBeNull();
  });

  it('the player dies in a room: the view stays on the room (no jump to the level\'s middle) and is on its room again after', () => {
    const { rt, run, cam, me } = play(game({ camera: ['follow', 'rooms'], zones: TWO_ROOMS, player: { x: 400, y: 144 } }));
    expect(cam.x).toBe(480);
    rt.gameplay.die(me, null);
    const xs = new Set<number>();
    run(2, [], () => xs.add(Math.round(cam.x)));
    expect([...xs]).toEqual([480]);
    expect(me.alive).toBe(true);
  });
});

describe('F5: the profile decides what the camera does (and the report says the same)', () => {
  it('zones in a game whose profile has no "rooms": not used in play (the camera goes through), and the report says so', () => {
    const p = game({ zones: TWO_ROOMS, player: { x: 290, y: 144 } });
    const { rt, run, cam, me } = play(p);
    expect(rt.cameraBehaviors).toEqual(['follow']);
    run(1, ['right']);
    expect(me.x).toBeGreaterThan(330);
    expect(Math.abs(cam.x - me.x)).toBeLessThan(20);
    const check = checkGame(p, registry);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(/Room 1.*doesn't select the camera behaviour "rooms".*camera zones are not used/);
    expect(checkGame(game({ camera: ['follow', 'rooms'], zones: TWO_ROOMS }), registry).state).toBe('ok');
  });

  it('a profile without "follow": the camera stays still though the player has a Camera Target; said in the report', () => {
    const p = game({ camera: [], settings: { fixedAt: { x: 200, y: 96 } } });
    const { rt, run, cam, me } = play(p);
    expect(rt.cameraBehaviors).toEqual([]);
    run(1, ['right']);
    expect(me.x).toBeGreaterThan(150);
    expect([cam.x, cam.y]).toEqual([200, 96]);
    const check = checkGame(p, registry);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(/doesn't select the camera behaviour "follow".*stays still/);
  });

  it('rooms without follow: the still camera is held on the room the player is in (one-screen rooms)', () => {
    const { run, cam, me } = play(game({ camera: ['rooms'], zones: TWO_ROOMS, player: { x: 290, y: 144 } }));
    expect(cam.x).toBe(160);
    run(1.2, ['right']);
    expect(me.x).toBeGreaterThan(320);
    expect(cam.x).toBeCloseTo(480, 3);
  });

  it('seen at an angle, rooms are selected but not supported: not active, and the profile check says what happens instead', () => {
    const iso = changedProfile(PRESETS.find((p) => p.id === 'isometric')!.profile, { camera: ['follow', 'rooms'] });
    const s = cameraStatus(iso);
    expect(s).toMatchObject({ selected: ['follow', 'rooms'], active: ['follow'] });
    expect(s.unsupported[0]).toMatchObject({ id: 'rooms' });
    const check = checkProfile(iso);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(/camera zones are not used/);
    // (And an unknown behaviour is refused.)
    expect(checkProfile(changedProfile(iso, { camera: ['follow', 'spin'] })).state).toBe('incompatible');
  });

  it('velocity look-ahead without follow: selected but not supported; it does nothing, and the profile check says so', () => {
    const p = changedProfile(PRESETS[0].profile, { camera: ['velocity_look_ahead'] });
    expect(cameraStatus(p).active).toEqual([]);
    const check = checkProfile(p);
    expect(check.state === 'degraded' && check.notes.join(' ')).toMatch(/nothing to look ahead of/);
    const { run, cam } = play(game({ camera: ['velocity_look_ahead'], settings: { fixedAt: { x: 200, y: 96 } } }));
    run(1, ['right']);
    expect([cam.x, cam.y]).toEqual([200, 96]);
  });

  it('every camera behaviour declared is implemented and registered once; none points to old code; every preset follows', () => {
    expect(cameraBehaviorIds().sort()).toEqual(CAMERA_BEHAVIORS.map((b) => b.id).sort());
    expect(modules.list('camera').map((b) => b.id)).toEqual(CAMERA_BEHAVIORS.map((b) => b.id));
    expect(modules.list('camera').filter((b) => b.pointsTo)).toEqual([]);
    for (const p of PRESETS) expect(cameraStatus(p.profile).active, p.id).toEqual(['follow']);
  });

  it('a new behaviour plugs in: registered, named in the pipeline, it changes the plan (no change to the controller)', () => {
    registerCameraBehavior('test_lift', () => ({ id: 'test_lift', apply: (plan) => void (plan.goal = plan.goal && { x: plan.goal.x, y: plan.goal.y - 50 }) }));
    const cam = new CameraController();
    const target = { x: 100, y: 100, vx: 0, vy: 0, facing: 1, alive: true } as never;
    const settings: CameraSettings = { zoom: 1, lookAhead: 0, deadZone: { x: 0, y: 0 }, bounds: 'none', customBounds: null, fixedAt: null };
    cam.reset(settings, target, 0.999, null, ['follow', 'test_lift']);
    for (let i = 0; i < 30; i++) cam.update(1 / 60);
    expect(cam.camera.y).toBeCloseTo(50, 0);
    expect(cam.behaviors).toEqual(['follow', 'test_lift']);
  });

  it('a game saved before F5 opens unchanged (format 17: only the version)', () => {
    const old = { formatVersion: 16, name: 'Old', settings: { profile: PRESETS[0].profile } };
    expect(migrateProject(structuredClone(old))).toEqual({ ...old, formatVersion: FORMAT_VERSION });
  });
});

describe('F5: velocity look-ahead', () => {
  /** How far ahead of the player the camera is after running right for two seconds. */
  const lead = (camera: string[], settings: Partial<CameraSettings> = {}) => {
    const { run, cam, me } = play(game({ camera, settings }));
    run(2, ['right']);
    return cam.x - me.x;
  };

  it('running, the camera looks further ahead than following alone; standing again, it comes back', () => {
    const plain = lead(['follow']);
    const fast = lead(['follow', 'velocity_look_ahead']);
    expect(fast).toBeGreaterThan(plain + 30);
    const { run, cam, me } = play(game({ camera: ['follow', 'velocity_look_ahead'] }));
    run(2, ['right']);
    run(3, []);
    expect(Math.abs(cam.x - me.x)).toBeLessThan(3);
  });

  it('never further than the level\'s speedLookAhead; 0 is following alone', () => {
    expect(lead(['follow', 'velocity_look_ahead'], { speedLookAhead: 40 })).toBeLessThanOrEqual(40);
    expect(lead(['follow', 'velocity_look_ahead'], { speedLookAhead: 300 })).toBeGreaterThan(lead(['follow', 'velocity_look_ahead'], { speedLookAhead: 40 }));
    expect(lead(['follow', 'velocity_look_ahead'], { speedLookAhead: 0 })).toBeCloseTo(lead(['follow']), 6);
  });

  it('a jump does not bob the view (side view); seen from above, moving down looks ahead downward', () => {
    const heights = (camera: string[]) => {
      const { run, cam } = play(game({ camera }));
      const ys: number[] = [];
      run(1, ['jump'], () => ys.push(cam.y));
      return ys;
    };
    expect(heights(['follow', 'velocity_look_ahead'])).toEqual(heights(['follow']));
    const down = (camera: string[]) => {
      const { run, cam, me } = play(game({ preset: 'topdown', camera, player: { x: 160, y: 100 } }));
      run(1.5, ['down']);
      return cam.y - me.y;
    };
    expect(down(['follow', 'velocity_look_ahead'])).toBeGreaterThan(down(['follow']) + 20);
  });
});
