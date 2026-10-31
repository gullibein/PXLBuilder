import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createDefinition, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { checkScript, scriptSchema } from '../core/script/language';
import { SWOOPER_SCRIPT } from '../core/script/swooper';
import type { Project } from '../core/types';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/**
 * A space shooter like the classics: no walls, a ship at the bottom that stays on screen and fires up while Space
 * is held, two rows of saucers that fly in with the Swooper script, sway, swoop down, and fire down now and then.
 */
function shooterGame(edit: (d: Project) => void = () => {}): Runtime {
  let project = createProject(registry, 'Shooter', 'topdown');
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const ship = d.definitions.find((x) => x.name === 'Player')!;
    ship.components.Shooter = registry.createDefault('Shooter', { trigger: 'key', direction: 'up', interval: 0.25, speed: 420 });
    ship.components.StayOnScreen = registry.createDefault('StayOnScreen');
    const saucer = createDefinition(
      'Saucer',
      {
        Sprite: registry.createDefault('Sprite', { width: 24, height: 16 }),
        Collider: registry.createDefault('Collider', { size: { x: 24, y: 16 }, isTrigger: true }),
        Health: registry.createDefault('Health', { maxHealth: 1, currentHealth: 1 }),
        Shooter: registry.createDefault('Shooter', { direction: 'down', interval: 2, speed: 200, targetTag: '' }),
      },
      ['enemy'],
    );
    saucer.scripts = [scriptSchema.parse({ ...SWOOPER_SCRIPT, id: 'scr_swoop' }) as never];
    m.addDefinition(d, saucer, registry);
    m.setBackground(d, sceneId, { stars: { density: 15, speed: { x: 0, y: 120 }, layers: 3, color: '#ffffff' } });
    // A still camera on the playfield (the ship doesn't drag it along).
    delete ship.components.CameraTarget;
    m.setCameraSettings(d, sceneId, { bounds: 'none', fixedAt: { x: 0, y: 0 } });
    m.addEntity(d, sceneId, instantiateDefinition(ship, { x: 0, y: 220 }));
    for (let row = 0; row < 2; row++) for (let col = 0; col < 6; col++) m.addEntity(d, sceneId, instantiateDefinition(saucer, { x: -150 + col * 60, y: -200 + row * 44 }));
    edit(d);
  });
  const rt = new Runtime(project, sceneId, registry);
  let seed = 3;
  rt.random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return rt;
}

function run(rt: Runtime, keys: Record<number, Action[]>, steps: number, each?: (i: number) => void): void {
  const input = new InputState();
  let held: Action[] = [];
  for (let i = 0; i < steps; i++) {
    if (keys[i]) {
      for (const k of held) if (!keys[i].includes(k)) input.release(k);
      for (const k of keys[i]) if (!held.includes(k)) input.press(k);
      held = keys[i];
    }
    rt.update(1 / 120, input);
    each?.(i);
  }
}

describe('a space shooter', () => {
  it('the Swooper script checks out', () => {
    expect(checkScript({ ...SWOOPER_SCRIPT, id: 'x' }, createProject(registry))).toEqual({ script: expect.anything() });
  });

  it('saucers fly in one after another to their places, sway there, swoop down now and then and come back', () => {
    const rt = shooterGame();
    const saucers = () => rt.entities.filter((e) => e.name === 'Saucer');
    const states = (s: string) => saucers().filter((e) => e.scripts[0].state === s).length;
    run(rt, {}, 10);
    expect(states('enter')).toBe(12);
    // They start off screen, above it.
    expect(saucers().every((e) => e.y < rt.cam.visible().minY)).toBe(true);
    let allHome = -1;
    const seen = new Set<string>();
    const arrived = new Set<string>();
    run(rt, {}, 120 * 30, (i) => {
      for (const e of saucers()) {
        seen.add(e.scripts[0].state);
        if (e.scripts[0].state === 'home') arrived.add(e.id);
      }
      if (allHome < 0 && arrived.size === 12) allHome = i;
    });
    expect(allHome).toBeGreaterThan(0);
    expect(allHome / 120).toBeLessThan(11);
    expect([...seen].sort()).toEqual(['back', 'dive', 'enter', 'fall', 'home']);
  });

  it('flying in, they keep apart: no two on screen ever overlap', () => {
    const rt = shooterGame();
    let closest = Infinity;
    run(rt, {}, 120 * 14, () => {
      const v = rt.cam.visible();
      const flying = rt.entities.filter((e) => e.name === 'Saucer' && e.y > v.minY && e.scripts[0].state === 'enter');
      for (let i = 0; i < flying.length; i++)
        for (let j = i + 1; j < flying.length; j++) {
          const gap = Math.max(Math.abs(flying[i].x - flying[j].x) - 24, Math.abs(flying[i].y - flying[j].y) - 16);
          closest = Math.min(closest, gap);
        }
    });
    // (Positive: a gap between their boxes all the time.)
    expect(closest).toBeGreaterThan(0);
  });

  it('enemies fire at their own random times, not all at once', () => {
    const rt = shooterGame();
    const firstShot = new Map<string, number>();
    run(rt, {}, 120 * 12, (i) => {
      for (const ev of rt.eventLog) if (ev.type === 'shot' && ev.subject === 'Saucer' && ev.subjectId && !firstShot.has(ev.subjectId)) firstShot.set(ev.subjectId, i);
    });
    const times = [...firstShot.values()];
    expect(times.length).toBe(12);
    // Spread out: many different moments.
    expect(new Set(times).size).toBeGreaterThan(8);
  });

  it('the ship fires while Space (or X) is held, every interval; it can\'t leave the screen; no walls', () => {
    const rt = shooterGame();
    const shots = () => rt.eventLog.filter((e) => e.type === 'shot' && e.subject === 'Player').length;
    run(rt, { 0: ['jump'], 120: [] }, 130);
    // 1 s held at 0.25 s: 4 or 5 shots.
    expect(shots()).toBeGreaterThanOrEqual(4);
    run(rt, { 0: ['fire'], 60: [] }, 70);
    expect(shots()).toBeGreaterThanOrEqual(6);
    // Pushing left and down for a long time: stops at the screen's edge.
    run(rt, { 0: ['left', 'down'] }, 600);
    const ship = rt.find('Player')!;
    const v = rt.cam.visible();
    expect(ship.x - ship.collider!.hw).toBeGreaterThanOrEqual(v.minX - 0.01);
    expect(ship.y + ship.collider!.hh).toBeLessThanOrEqual(v.maxY + 0.01);
    expect(ship.x).toBeLessThan(v.minX + 40);
    expect(rt.entities.some((e) => e.name === 'Wall')).toBe(false);
  });
});

describe('shots with their own look', () => {
  it('a drawn shot object is fired turned the way it flies, with a fading tail; the built-in one takes a color and size', () => {
    const rt = shooterGame((d) => {
      const bolt = createDefinition(
        'Laser Bolt',
        {
          Sprite: registry.createDefault('Sprite', { width: 16, height: 6, color: '#5ef2ff' }),
          Collider: registry.createDefault('Collider', { size: { x: 16, y: 6 }, isTrigger: true }),
          Glow: registry.createDefault('Glow', { color: '#5ef2ff', size: 10 }),
          Trail: registry.createDefault('Trail', { color: '#2a9df4', length: 0.2 }),
        },
        [],
      );
      m.addDefinition(d, bolt, registry);
      const ship = d.definitions.find((x) => x.name === 'Player')!;
      // (By name works too.)
      ship.components.Shooter.projectile = 'Laser Bolt';
      const saucer = d.definitions.find((x) => x.name === 'Saucer')!;
      saucer.components.Shooter = registry.createDefault('Shooter', { direction: 'down', interval: 0.5, variation: 0, speed: 200, targetTag: '', shotColor: '#ff3355', shotSize: 5 });
    });
    run(rt, { 0: ['fire'] }, 120);
    const shots = rt.entities.filter((e) => e.alive && e.projectile);
    const bolt = shots.find((e) => e.base.name === 'Laser Bolt')!;
    expect(bolt).toBeTruthy();
    // Fired up: turned -90° (drawn pointing right).
    expect(Math.round(bolt.angle)).toBe(-90);
    const drawn = rt.renderList().find((r) => r.name === 'Laser Bolt')!;
    expect(drawn.transform.rotation).toBe(-90);
    expect(drawn.trail!.length).toBeGreaterThan(5);
    // The tail is behind it: below the bolt, which flies up.
    expect(drawn.trail![0].y).toBeGreaterThan(drawn.trail!.at(-1)!.y);
    const pellet = shots.find((e) => e.base.name === 'Shot');
    expect(pellet?.base.components.Sprite.color).toBe('#ff3355');
    expect(pellet?.base.components.Sprite.width).toBe(5);
  });
});
