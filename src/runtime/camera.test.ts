import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import type { CameraSettings } from '../core/model/camera';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** Ground from x = from..to (tile centers) at y=48, the player standing at `player`. */
function level(camera: Partial<CameraSettings>, opts: { from?: number; to?: number; player?: number; noTarget?: boolean } = {}) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let x = opts.from ?? -144; x <= (opts.to ?? 144); x += 32) place('Platform', { x, y: 48 });
    place('Player', { x: opts.player ?? 0, y: 16 });
    if (opts.noTarget) m.removeDefinitionComponent(d, d.definitions.find((x) => x.name === 'Player')!.id, 'CameraTarget');
    m.setCameraSettings(d, sceneId, camera);
  });
  const rt = new Runtime(project, sceneId, registry);
  rt.cam.setView(960, 600);
  rt.cam.snap();
  return { rt, input: new InputState(), p: rt.find('Player')! };
}

function run(rt: Runtime, input: InputState, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) rt.update(1 / 60, input);
}

describe('camera', () => {
  it('follows its target', () => {
    const { rt, input, p } = level({ bounds: 'none' });
    input.press('right');
    run(rt, input, 1);
    expect(rt.camera.x).toBeGreaterThan(p.x - 60);
  });

  it('limits "level": a level smaller than the screen stays centered and still', () => {
    const { rt, input, p } = level({ bounds: 'level' });
    const start = { ...rt.camera };
    expect(start.x).toBeCloseTo(0, 0);
    input.press('right');
    run(rt, input, 0.6);
    expect(p.x).toBeGreaterThan(60);
    expect(rt.camera.x).toBeCloseTo(start.x, 5);
  });

  it('limits "level": in a wide level the camera never shows past the left edge', () => {
    // Ground from -600 to 600: the level's left edge is at -616; the view is 960 wide.
    const { rt, input } = level({ bounds: 'level' }, { from: -600, to: 600, player: -560 });
    expect(rt.camera.x).toBeCloseTo(-616 + 480, 5);
    run(rt, input, 1);
    expect(rt.camera.x).toBeCloseTo(-616 + 480, 5);
  });

  it('custom limits, and zoom changes how much fits', () => {
    const custom = level({ bounds: 'custom', customBounds: { minX: -1000, minY: -400, maxX: 1000, maxY: 200 }, zoom: 2 }, { player: 0 });
    expect(custom.rt.camera.zoom).toBe(2);
    // At zoom 2 the view is 300 level-pixels tall: the bottom limit 200 holds the center at 50 or above.
    expect(custom.rt.camera.y).toBeLessThanOrEqual(200 - 150 + 1e-6);
  });

  it('look-ahead: running right, the camera is ahead of the player', () => {
    const { rt, input, p } = level({ bounds: 'none', lookAhead: 120 }, { from: -2000, to: 2000 });
    input.press('right');
    run(rt, input, 2);
    expect(rt.camera.x - p.x).toBeGreaterThan(60);
  });

  it('dead zone: small moves do not move the camera', () => {
    const { rt, input, p } = level({ bounds: 'none', deadZone: { x: 80, y: 80 } });
    const start = rt.camera.x;
    input.press('right');
    run(rt, input, 0.2);
    input.release('right');
    run(rt, input, 0.5);
    expect(p.x).toBeGreaterThan(10);
    expect(p.x).toBeLessThan(80);
    expect(rt.camera.x).toBe(start);
  });

  it('still camera: looks at fixedAt when nothing has a CameraTarget', () => {
    const { rt, input } = level({ bounds: 'none', fixedAt: { x: 300, y: -50 } }, { noTarget: true });
    run(rt, input, 0.5);
    expect(rt.camera).toMatchObject({ x: 300, y: -50 });
  });

  it('effects: shake, flash, zoom over time, a look at something, and following something else', () => {
    const { rt, input, p } = level({ bounds: 'none' }, { from: -2000, to: 2000 });
    let i = 0;
    rt.cam.random = () => [0, 1][i++ % 2];
    rt.cam.startShake(10, 0.5);
    expect(rt.cam.frame()).not.toEqual(rt.camera);
    run(rt, input, 0.6);
    expect(rt.cam.frame()).toBe(rt.camera);

    rt.cam.startFlash('#ff0000', 0.4);
    expect(rt.cam.flash()).toEqual({ color: '#ff0000', alpha: 0.8 });
    run(rt, input, 0.2);
    expect(rt.cam.flash()!.alpha).toBeCloseTo(0.4, 1);
    run(rt, input, 0.3);
    expect(rt.cam.flash()).toBeNull();

    rt.cam.zoomTo(2, 1);
    run(rt, input, 0.5);
    expect(rt.camera.zoom).toBeGreaterThan(1.2);
    expect(rt.camera.zoom).toBeLessThan(1.8);
    run(rt, input, 0.6);
    expect(rt.camera.zoom).toBe(2);

    const far = rt.spawn(rt.entities.find((e) => e.name === 'Platform')!.definitionId!, { x: 900, y: 48 })!;
    rt.cam.focusOn(far, 1);
    run(rt, input, 0.9);
    expect(rt.camera.x).toBeGreaterThan(700);
    run(rt, input, 1.5);
    expect(Math.abs(rt.camera.x - p.x)).toBeLessThan(40); // back on the player

    rt.cam.follow(null);
    const still = rt.camera.x;
    input.press('right');
    run(rt, input, 1);
    expect(rt.camera.x).toBeCloseTo(still, 5);
    rt.cam.follow(p);
    run(rt, input, 1);
    expect(Math.abs(rt.camera.x - p.x)).toBeLessThan(40);
  });

  it('restart puts the camera back to how the level starts', () => {
    const { rt, input } = level({ bounds: 'none', zoom: 1.5 });
    rt.cam.zoomTo(3, 0);
    rt.cam.startShake(10, 5);
    run(rt, input, 0.1);
    rt.restart();
    expect(rt.camera.zoom).toBe(1.5);
    expect(rt.cam.frame()).toBe(rt.camera);
  });
});

describe('camera from rules, scripts and AI operations', () => {
  it('set_camera changes only the given settings, and rejects bad values with a clear message', async () => {
    const { applyOperations } = await import('../core/commands/operations');
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      applyOperations(d, [{ op: 'set_camera', sceneId, cameraJson: '{"zoom":1.5,"lookAhead":120}' }], registry);
    });
    expect(project.scenes[0].camera).toMatchObject({ zoom: 1.5, lookAhead: 120, bounds: 'level' });
    const bad = (json: string) => {
      try {
        produce(project, (d) => {
          applyOperations(d, [{ op: 'set_camera', sceneId, cameraJson: json }], registry);
        });
        return null;
      } catch (e) {
        return (e as Error).message;
      }
    };
    expect(bad('{"zoom":9}')).toMatch(/Camera zoom: .*4/);
    expect(bad('{"bounds":"custom"}')).toBe('Camera bounds "custom" needs customBounds');
    expect(bad('{"shake":3}')).toBe('Camera has no setting "shake"');
  });

  it('a rule shakes the screen and flashes it when the player is hurt; a script zooms in and makes the camera follow something else', async () => {
    const logic = await import('../core/logic/mutations');
    const { setScript } = await import('../core/script/mutations');
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      const def = (n: string) => d.definitions.find((x) => x.name === n)!;
      for (let x = -144; x <= 144; x += 32) m.addEntity(d, sceneId, instantiateDefinition(def('Platform'), { x, y: 48 }));
      m.addEntity(d, sceneId, instantiateDefinition(def('Player'), { x: 0, y: 16 }));
      m.addEntity(d, sceneId, instantiateDefinition(def('Hazard'), { x: 60, y: 24 }));
      const coin = instantiateDefinition(def('Coin'), { x: -120, y: -40 });
      m.addEntity(d, sceneId, coin);
      m.setCameraSettings(d, sceneId, { bounds: 'none' });
      logic.addRule(d, sceneId, {
        name: '',
        enabled: true,
        when: { event: 'damaged', subject: { kind: 'tag', tag: 'player' }, other: { kind: 'any' } },
        conditions: [],
        actions: [
          { type: 'camera_shake', strength: 8, seconds: 0.5 },
          { type: 'camera_flash', color: '#ff0000', seconds: 0.5 },
        ],
      });
      setScript(d, { target: 'instance', id: coin.id }, {
        name: 'Look at me',
        handlers: [{ when: { on: 'start' }, do: [{ do: 'camera_zoom', zoom: '2', seconds: '0' }, { do: 'camera_follow', target: 'self' }] }],
      });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    run(rt, input, 0.6);
    expect(rt.camera.zoom).toBe(2);
    expect(rt.cam.following?.name).toBe('Coin');
    expect(Math.abs(rt.camera.x - -120)).toBeLessThan(10);
    input.press('right');
    let shook = false;
    let flashed = false;
    for (let t = 0; t < 1; t += 1 / 60) {
      rt.update(1 / 60, input);
      if (rt.cam.frame() !== rt.camera) shook = true;
      if (rt.cam.flash()?.color === '#ff0000') flashed = true;
    }
    expect(rt.eventLog.some((e) => e.type === 'damaged' && e.subject === 'Player')).toBe(true);
    expect(shook && flashed).toBe(true);
  });
});
