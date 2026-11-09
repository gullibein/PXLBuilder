import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { ENEMY_SCRIPTS } from '../core/script/enemies';
import { checkScript, scriptSchema } from '../core/script/language';
import { expandReadyScript } from '../core/script/ready';
import type { Project, Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/**
 * Ground from x=-144 to 144 (its top at y=32), the Player at `player`, and the Enemy (its Patrol taken away) with
 * the ready-made script by name, its settings given, at `at`. `extra` places more (walls: Platform).
 */
function game(ready: string, settings: Record<string, unknown>, at: Vec2, player: Vec2 = { x: -120, y: 16 }, extra: (place: (name: string, pos: Vec2) => void) => void = () => {}) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d: Project) => {
    const enemy = d.definitions.find((x) => x.name === 'Enemy')!;
    delete enemy.components.Patrol;
    enemy.scripts = [...(enemy.scripts ?? []), scriptSchema.parse({ ...expandReadyScript({ ready, settings }), id: 'scr_enemy' }) as never];
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let x = -144; x <= 144; x += 32) place('Platform', { x, y: 48 });
    place('Player', player);
    place('Enemy', at);
    extra(place);
  });
  const rt = new Runtime(project, sceneId, registry);
  const input = new InputState();
  const enemy = () => rt.entities.find((e) => e.name === 'Enemy')!;
  const run = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      rt.update(1 / 60, input);
      each?.();
    }
  };
  return { rt, input, enemy, run, player: () => rt.find('Player')! };
}

describe('ready-made enemy behaviors (side games)', () => {
  it('each one is a correct script, with its settings', () => {
    for (const [name, s] of Object.entries(ENEMY_SCRIPTS)) {
      expect(checkScript({ ...s, id: 'x' }, createProject(registry)), name).toEqual({ script: expect.anything() });
      expect(s.vars.some((v) => v.setting), name).toBe(true);
    }
  });

  it('Walker keeps going one way and walks off the end of the platform…', () => {
    const g = game('Walker', { start: 'right', speed: 80 }, { x: 60, y: 16 });
    let maxY = -Infinity;
    g.run(3, () => (maxY = Math.max(maxY, g.enemy().y)));
    expect(maxY).toBeGreaterThan(100);
  });

  it('…or, with turn_at_ledges ticked, turns there and walks back', () => {
    const g = game('Walker', { start: 'right', speed: 80, turn_at_ledges: true }, { x: 60, y: 16 });
    let maxX = -Infinity;
    g.run(3, () => (maxX = Math.max(maxX, g.enemy().x)));
    expect(g.enemy().y).toBeLessThan(20);
    expect(maxX).toBeGreaterThan(110);
    expect(g.enemy().x).toBeLessThan(maxX - 40);
  });

  it('Walker turns when it hits a wall', () => {
    const g = game('Walker', { start: 'right', speed: 80 }, { x: 20, y: 16 }, undefined, (place) => place('Platform', { x: 112, y: 16 }));
    let maxX = -Infinity;
    g.run(3, () => (maxX = Math.max(maxX, g.enemy().x)));
    expect(maxX).toBeLessThan(96);
    expect(g.enemy().x).toBeLessThan(40);
  });

  it('Chaser goes after the player…', () => {
    const g = game('Chaser', {}, { x: 110, y: 16 });
    g.run(2.5);
    expect(g.enemy().x).toBeLessThan(0);
  });

  it('…but with sight it only does once it sees the player that near: else it walks about, not falling off', () => {
    const g = game('Chaser', { sight: 60 }, { x: 110, y: 16 });
    let minX = Infinity;
    g.run(4, () => (minX = Math.min(minX, g.enemy().x)));
    expect(minX).toBeGreaterThan(-60);
    expect(g.enemy().y).toBeLessThan(20);
  });

  it('Hopper sits, then hops toward the player', () => {
    const g = game('Hopper', { rest: 0.5 }, { x: 100, y: 16 });
    let minY = Infinity;
    g.run(3, () => (minY = Math.min(minY, g.enemy().y)));
    expect(minY).toBeLessThan(-10);
    expect(g.enemy().x).toBeLessThan(80);
  });

  it('Wave flyer flies one way bobbing up and down, never falling', () => {
    const g = game('Wave flyer', { height: 20 }, { x: 100, y: -60 });
    let minY = Infinity;
    let maxY = -Infinity;
    g.run(3, () => ((minY = Math.min(minY, g.enemy().y)), (maxY = Math.max(maxY, g.enemy().y))));
    expect(g.enemy().x).toBeLessThan(0);
    expect(maxY - minY).toBeGreaterThan(30);
    expect(maxY).toBeLessThan(-20);
  });

  it('Dropper waits up high while the player is away…', () => {
    const g = game('Dropper', {}, { x: 60, y: -100 });
    g.run(2);
    expect(Math.abs(g.enemy().y + 100)).toBeLessThan(1);
  });

  it('…crashes down when the player is underneath, then rises back to where it was', () => {
    const g = game('Dropper', { rest: 0.3, rise_speed: 120 }, { x: 60, y: -100 }, { x: 60, y: 16 });
    let maxY = -Infinity;
    g.run(0.8, () => (maxY = Math.max(maxY, g.enemy().y)));
    expect(maxY).toBeGreaterThan(-20);
    // (The player moves away so it stays up.)
    g.rt.find('Player')!.x = -120;
    g.run(2.5);
    expect(Math.abs(g.enemy().y + 100)).toBeLessThan(2);
  });

  it('Charger stops when it sees the player on its floor, then charges fast', () => {
    const g = game('Charger', { windup: 0.3 }, { x: 110, y: 16 });
    let fastest = 0;
    g.run(1.5, () => (fastest = Math.max(fastest, Math.abs(g.enemy().vx))));
    expect(fastest).toBeGreaterThan(200);
  });

  it('Shy ghost floats closer while the player looks away, and stays still while looked at', () => {
    // The player faces right: a ghost on its left creeps up, one on its right waits.
    const behind = game('Shy ghost', {}, { x: -60, y: -20 }, { x: 40, y: 16 });
    behind.player().facing = 1;
    behind.run(1.5);
    expect(behind.enemy().x).toBeGreaterThan(-40);
    const ahead = game('Shy ghost', {}, { x: 120, y: -20 }, { x: 40, y: 16 });
    ahead.player().facing = 1;
    ahead.run(1.5);
    expect(Math.abs(ahead.enemy().x - 120)).toBeLessThan(1);
  });
});
