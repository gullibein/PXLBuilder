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
import { planCrawl } from './crawl';

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

describe('Slime: crawls over floors, walls, ceilings and ladders to the player', () => {
  /** The slime (the Enemy with the Slime script) at `at`, the player at `player`, the level's blocks and ladders. */
  function slimeGame(at: Vec2, player: Vec2, blocks: Vec2[], ladders: Vec2[] = [], settings: Record<string, unknown> = {}, keepScripts = false) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d: Project) => {
      const enemy = d.definitions.find((x) => x.name === 'Enemy')!;
      delete enemy.components.Patrol;
      // (Only moving here: touching the player would send it back to its start.)
      enemy.scripts = [...(keepScripts ? (enemy.scripts ?? []) : []), scriptSchema.parse({ ...expandReadyScript({ ready: 'Slime', settings }), id: 'scr_slime' }) as never];
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (const b of blocks) place('Platform', b);
      for (const l of ladders) place('Ladder', l);
      place('Player', player);
      place('Enemy', at);
    });
    const rt = new Runtime(project, sceneId, registry);
    let seed = 7;
    rt.random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const input = new InputState();
    const slime = () => rt.entities.find((e) => e.name === 'Enemy')!;
    const run = (seconds: number, each: () => void) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        rt.update(1 / 60, input);
        each();
      }
    };
    return { rt, slime, run, player: () => rt.find('Player')! };
  }
  const row = (y: number, x0: number, x1: number) => Array.from({ length: (x1 - x0) / 32 + 1 }, (_, i) => ({ x: x0 + i * 32, y }));
  const column = (x: number, y0: number, y1: number) => Array.from({ length: (y1 - y0) / 32 + 1 }, (_, i) => ({ x, y: y0 + i * 32 }));

  it('climbs up a wall to the player standing on top of it, its underside turned to the wall', () => {
    const g = slimeGame({ x: -80, y: 16 }, { x: 80, y: -112 }, [...row(48, -144, 144), ...column(80, -80, 16)]);
    let closest = Infinity;
    let climbed = false;
    let turned = false;
    g.run(10, () => {
      const s = g.slime();
      closest = Math.min(closest, Math.hypot(s.x - g.player().x, s.y - g.player().y));
      if (Math.abs(s.x - 48) < 2 && s.y < -40) climbed = true;
      if (Math.abs(s.angle - 270) < 5 || Math.abs(s.angle + 90) < 5) turned = true;
    });
    expect(climbed).toBe(true);
    expect(turned).toBe(true);
    expect(closest).toBeLessThan(36);
  });

  it('crawls along the ceiling and drops onto the player below', () => {
    const g = slimeGame({ x: -80, y: -80 }, { x: 80, y: 16 }, [...row(48, -144, 144), ...row(-112, -144, 144)]);
    let fell = false;
    let upsideDown = false;
    let closest = Infinity;
    g.run(8, () => {
      const s = g.slime();
      if (s.vy > 250) fell = true;
      if (Math.abs(Math.abs(s.angle) - 180) < 5) upsideDown = true;
      closest = Math.min(closest, Math.hypot(s.x - g.player().x, s.y - g.player().y));
    });
    expect(upsideDown).toBe(true);
    expect(fell).toBe(true);
    expect(closest).toBeLessThan(36);
  });

  it('goes up a ladder standing in the open to a platform it could not get to otherwise', () => {
    const blocks = [...row(48, -144, 144), ...row(-112, 48, 144)];
    const ladder = column(16, -80, 16);
    const withLadder = slimeGame({ x: -100, y: 16 }, { x: 112, y: -144 }, blocks, ladder);
    let up = Infinity;
    withLadder.run(10, () => (up = Math.min(up, withLadder.slime().y)));
    expect(up).toBeLessThan(-130);
    const without = slimeGame({ x: -100, y: 16 }, { x: 112, y: -144 }, blocks);
    let up2 = Infinity;
    without.run(6, () => (up2 = Math.min(up2, without.slime().y)));
    expect(up2).toBeGreaterThan(-20);
  });

  it('dropping onto the player hurts it (the enemy keeps its own Hurts on touch script)', () => {
    const g = slimeGame({ x: 80, y: -80 }, { x: 80, y: 16 }, [...row(48, -144, 144), ...row(-112, -144, 144)], [], {}, true);
    g.run(2, () => {});
    expect(g.rt.eventLog.some((e) => e.type === 'damaged')).toBe(true);
  });

  it('with sight, it waits stuck where it is until it sees the player that near', () => {
    const g = slimeGame({ x: -112, y: 16 }, { x: 112, y: 16 }, [...row(48, -144, 144), ...column(0, -48, 16)], [], { sight: 120 });
    let moved = 0;
    g.run(3, () => (moved = Math.max(moved, Math.abs(g.slime().x + 112))));
    expect(moved).toBeLessThan(1);
  });
});

describe('planCrawl: the way a crawler plans', () => {
  // A long room two squares tall: floor and ceiling.
  const solidAt = (_x: number, y: number) => (y > 32 && y < 64) || (y > -64 && y < -32);
  const world = (random: () => number) => ({ solidAt, ladderAt: () => false, canSee: () => true, random, time: 0 });

  it('without wander it always takes the shortest way; with wander some ways go another way', () => {
    const shortest = planCrawl(world(Math.random), 32, { x: -240, y: 16 }, { x: 240, y: 16 }, 0);
    expect(shortest).toHaveLength(15);
    expect(shortest.every((c) => c.y === 16)).toBe(true);
    let seed = 1;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const ways = new Set(Array.from({ length: 12 }, () => JSON.stringify(planCrawl(world(rnd), 32, { x: -240, y: 16 }, { x: 240, y: 16 }, 1.5))));
    expect(ways.size).toBeGreaterThan(1);
  });

  it('drops from the ceiling when that is the way to something below', () => {
    const tall = { ...world(Math.random), solidAt: (_x: number, y: number) => (y > 32 && y < 64) || (y > -128 && y < -96) };
    const way = planCrawl(tall, 32, { x: -240, y: -80 }, { x: 240, y: 16 }, 0);
    expect(way.some((c) => c.drop)).toBe(true);
    expect(way.at(-1)).toMatchObject({ x: 240, y: 16 });
  });
});
