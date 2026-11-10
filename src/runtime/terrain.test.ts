import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createDefinition, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { levelMap } from '../core/model/levelMap';
import { levelReachability } from '../core/model/reachability';
import type { Project, Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** Ground (Platform) from x=-208 to 208 with its top at y=32, the Player at `player`, and what `extra` adds. */
function world(player: Vec2, extra: (place: (name: string, pos: Vec2) => void, d: Project) => void) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    delete d.definitions.find((x) => x.name === 'Enemy')!.components.Patrol;
    const tile = (name: string, collider: Record<string, unknown>) =>
      m.addDefinition(d, createDefinition(name, { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', collider) }, ['platform']), registry);
    // A thin bridge (8 px), its top 8 px above the player's head.
    m.addDefinition(d, createDefinition('Plank', { Sprite: registry.createDefault('Sprite', { width: 32, height: 8 }), Collider: registry.createDefault('Collider', { size: { x: 32, y: 8 }, oneWay: true }) }, ['platform']), registry);
    tile('RampUp', { shape: 'slopeRight' });
    tile('RampDown', { shape: 'slopeLeft' });
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let x = -208; x <= 208; x += 32) place('Platform', { x, y: 48 });
    place('Player', player);
    extra(place, d);
  });
  const rt = new Runtime(project, sceneId, registry);
  const input = new InputState();
  const p = () => rt.find('Player')!;
  const run = (seconds: number, each?: () => void) => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      rt.update(1 / 60, input);
      each?.();
    }
  };
  return { rt, input, p, run };
}

describe('jump-through platforms (Collider.oneWay)', () => {
  // A thin bridge over the player (its top at y=-8: standing on it, the player's middle is at y=-24).
  const bridge = (place: (n: string, p: Vec2) => void) => {
    for (let x = -48; x <= 48; x += 32) place('Plank', { x, y: -4 });
  };

  it('the player jumps up through it from below and lands on top', () => {
    const g = world({ x: 0, y: 16 }, bridge);
    g.run(0.3);
    g.input.press('jump');
    let highest = Infinity;
    g.run(0.4, () => (highest = Math.min(highest, g.p().y)));
    g.input.release('jump');
    g.run(1.2);
    expect(highest).toBeLessThan(-24);
    expect(g.p().y).toBeCloseTo(-24, 0);
    expect(g.p().grounded).toBe(true);
  });

  it('it walks through its sides, and Down + Jump drops it through to the ground below', () => {
    const g = world({ x: -150, y: 16 }, bridge);
    g.input.press('right');
    g.run(2, () => g.p().x > -20 && g.input.release('right'));
    expect(g.p().x).toBeGreaterThan(-20);
    expect(g.p().x).toBeLessThan(40);
    expect(g.p().y).toBeCloseTo(16, 0);
    // Up onto it, then down through it.
    g.input.press('jump');
    g.run(0.4);
    g.input.release('jump');
    g.run(1);
    expect(g.p().y).toBeCloseTo(-24, 0);
    g.input.press('down');
    g.input.press('jump');
    g.run(0.05);
    g.input.release('jump');
    g.input.release('down');
    g.run(1);
    expect(g.p().y).toBeCloseTo(16, 0);
  });
});

describe('slopes (Collider shape slopeRight / slopeLeft)', () => {
  // A hill: ramp up (◢) at x=16, a flat top from 48 to 112, ramp down (◣) at 144; the top's surface at y=0.
  const hill = (place: (n: string, p: Vec2) => void) => {
    place('RampUp', { x: 16, y: 16 });
    for (let x = 48; x <= 112; x += 32) place('Platform', { x, y: 16 });
    place('RampDown', { x: 144, y: 16 });
  };

  it('the player walks up the ramp, over the top and down the other side, feet on the ground all the way', () => {
    const g = world({ x: -120, y: 16 }, hill);
    g.run(0.2);
    g.input.press('right');
    const ys: number[] = [];
    let airborne = 0;
    g.run(6, () => {
      if (g.p().x > 190) return g.input.release('right');
      ys.push(g.p().y);
      if (!g.p().grounded) airborne++;
    });
    expect(g.p().x).toBeGreaterThan(190);
    expect(Math.min(...ys)).toBeCloseTo(-16, 0);
    expect(g.p().y).toBeCloseTo(16, 0);
    // Never off the ground (a frame or two at the corners at most), and no jumps in height from one step to the next.
    expect(airborne).toBeLessThan(4);
    const steps = ys.slice(1).map((y, i) => Math.abs(y - ys[i]));
    expect(Math.max(...steps)).toBeLessThan(6);
  });

  it('halfway up the ramp it stands still (and goes back down it to the left)', () => {
    const g = world({ x: -30, y: 16 }, hill);
    g.run(0.2);
    g.input.press('right');
    g.run(0.22);
    g.input.release('right');
    g.run(0.6);
    const y = g.p().y;
    expect(y).toBeLessThan(14);
    expect(y).toBeGreaterThan(-14);
    expect(g.p().grounded).toBe(true);
    g.run(0.5);
    expect(g.p().y).toBeCloseTo(y, 1);
    g.input.press('left');
    g.run(0.6);
    expect(g.p().y).toBeCloseTo(16, 0);
    expect(g.p().x).toBeLessThan(-30);
  });

  it('a patrolling enemy walks up and over the hill instead of turning at the ramp', () => {
    const g = world({ x: -190, y: 16 }, (place, d) => {
      hill(place);
      d.definitions.find((x) => x.name === 'Enemy')!.components.Patrol = registry.createDefault('Patrol', { speed: 80, turnAtLedges: true, startDirection: 'right' });
      place('Enemy', { x: -60, y: 17 });
    });
    let furthest = -Infinity;
    g.run(4, () => (furthest = Math.max(furthest, g.rt.entities.find((e) => e.name === 'Enemy')!.x)));
    expect(furthest).toBeGreaterThan(130);
  });
});

describe('the level checker and the map the AI reads know ramps and jump-through platforms', () => {
  it("a floor up a ramp counts as reachable even for a player who can't jump up to it; the map shows / \\ and -", () => {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      const tile = (name: string, collider: Record<string, unknown>) =>
        m.addDefinition(d, createDefinition(name, { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', collider) }, ['platform']), registry);
      tile('RampUp', { shape: 'slopeRight' });
      tile('RampDown', { shape: 'slopeLeft' });
      tile('Plank', { oneWay: true });
      // A weak jumper: about 10 px high.
      d.definitions.find((x) => x.name === 'Player')!.components.CharacterController.jumpForce = 140;
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let x = -208; x <= 208; x += 32) place('Platform', { x, y: 48 });
      // Two rows of hill: ramps up to a first step, then up again to a top with the Goal on it.
      place('RampUp', { x: 16, y: 16 });
      for (let x = 48; x <= 176; x += 32) place('Platform', { x, y: 16 });
      place('RampUp', { x: 80, y: -16 });
      for (let x = 112; x <= 176; x += 32) place('Platform', { x, y: -16 });
      place('RampDown', { x: -48, y: 16 });
      place('Plank', { x: -144, y: -48 });
      place('Goal', { x: 144, y: -48 });
      place('Player', { x: -150, y: 16 });
    });
    const reach = levelReachability(project, sceneId, registry);
    expect(reach.status).toBe('ok');
    if (reach.status !== 'ok') return;
    expect(reach.unreachable.things).toEqual([]);
    const map = levelMap(project, sceneId, registry)!;
    const text = map.rows.join('\n');
    expect(text).toContain('/');
    expect(text).toContain('\\');
    expect(text).toContain('-');
    expect(map.legend['/']).toMatch(/ramp rising to the right/);
    expect(map.legend['-']).toMatch(/jump-through/);
  });

  it('without the ramps the same floors are out of its reach', () => {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.definitions.find((x) => x.name === 'Player')!.components.CharacterController.jumpForce = 140;
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let x = -208; x <= 208; x += 32) place('Platform', { x, y: 48 });
      for (let x = 48; x <= 176; x += 32) place('Platform', { x, y: 16 });
      for (let x = 112; x <= 176; x += 32) place('Platform', { x, y: -16 });
      place('Goal', { x: 144, y: -48 });
      place('Player', { x: -150, y: 16 });
    });
    const reach = levelReachability(project, sceneId, registry);
    expect(reach.status === 'ok' && reach.unreachable.things.map((t) => t.name)).toEqual(['Goal']);
  });
});

describe('water to swim in (Liquid)', () => {
  /** Banks at ground level on both sides (their top at y=32), a pool between them three rows deep (its floor's top at y=128). */
  function pool(player: Vec2) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      m.addDefinition(
        d,
        createDefinition('Pool water', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', { isTrigger: true }), Liquid: registry.createDefault('Liquid') }, ['water']),
        registry,
      );
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let x = -240; x <= -80; x += 32) place('Platform', { x, y: 48 });
      for (let x = 80; x <= 240; x += 32) place('Platform', { x, y: 48 });
      for (const y of [80, 112]) (place('Platform', { x: -80, y }), place('Platform', { x: 80, y }));
      for (let x = -80; x <= 80; x += 32) place('Platform', { x, y: 144 });
      for (let x = -48; x <= 48; x += 32) for (const y of [48, 80, 112]) place('Pool water', { x, y });
      place('Player', player);
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    const p = () => rt.find('Player')!;
    const run = (seconds: number, each?: (t: number) => void) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        rt.update(1 / 60, input);
        each?.(t);
      }
    };
    return { rt, input, p, run };
  }

  it('falling in, the player sinks slowly to the bottom and moves slower there', () => {
    const g = pool({ x: -130, y: 16 });
    g.input.press('right');
    let fastestSink = 0;
    let fastestInWater = 0;
    g.run(0.6);
    g.input.release('right');
    g.run(4, () => {
      if (g.p().inLiquid) {
        fastestSink = Math.max(fastestSink, g.p().vy);
      }
    });
    expect(fastestSink).toBeLessThan(95);
    expect(g.p().y).toBeCloseTo(112, 0);
    g.input.press('left');
    g.run(1, () => (fastestInWater = Math.max(fastestInWater, Math.abs(g.p().vx))));
    g.input.release('left');
    const speed = Number(g.rt.find('Player')!.controller!.speed);
    expect(fastestInWater).toBeLessThan(speed * 0.6);
    expect(fastestInWater).toBeGreaterThan(speed * 0.4);
  });

  it('Jump swims up a stroke at a time, and at the surface it jumps out onto the bank', () => {
    const g = pool({ x: 0, y: 112 });
    g.run(0.5);
    // One stroke: up, then sinking slowly again.
    g.input.press('jump');
    g.run(0.05);
    g.input.release('jump');
    let top = Infinity;
    g.run(0.8, () => (top = Math.min(top, g.p().y)));
    expect(top).toBeLessThan(112 - 16);
    expect(top).toBeGreaterThan(40);
    // Strokes all the way up, toward the right bank, and out onto it.
    g.input.press('right');
    g.run(5, (t) => {
      // (Jump held a moment each time, as a player does to leap out.)
      // (Out on the bank: it stops there.)
      if (g.p().x > 110) return (g.input.release('right'), g.input.release('jump'));
      if (Math.round(t * 60) % 30 === 0) g.input.press('jump');
      else if (Math.round(t * 60) % 30 === 12) g.input.release('jump');
    });
    expect(g.p().x).toBeGreaterThan(90);
    expect(g.p().y).toBeCloseTo(16, 0);
    expect(g.p().inLiquid).toBeNull();
  });
});

describe('the level checker knows swimming', () => {
  it('a goal on the far bank of a pool too wide to jump is reachable by swimming across (and not without the water)', () => {
    const level = (water: boolean) => {
      let project = createProject(registry);
      const sceneId = project.scenes[0].id;
      project = produce(project, (d) => {
        m.addDefinition(d, createDefinition('Pool water', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', { isTrigger: true }), Liquid: registry.createDefault('Liquid') }, ['water']), registry);
        const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
        // Banks, and a pool 9 cells wide and 3 deep between them.
        for (let x = -432; x <= -176; x += 32) place('Platform', { x, y: 48 });
        for (let x = 176; x <= 432; x += 32) place('Platform', { x, y: 48 });
        for (const y of [80, 112]) (place('Platform', { x: -176, y }), place('Platform', { x: 176, y }));
        for (let x = -176; x <= 176; x += 32) place('Platform', { x, y: 144 });
        if (water) for (let x = -144; x <= 144; x += 32) for (const y of [48, 80, 112]) place('Pool water', { x, y });
        place('Goal', { x: 300, y: 16 });
        place('Player', { x: -300, y: 16 });
      });
      return { project, sceneId };
    };
    const wet = level(true);
    const r = levelReachability(wet.project, wet.sceneId, registry);
    expect(r.status === 'ok' && r.unreachable.things).toEqual([]);
    expect(levelMap(wet.project, wet.sceneId, registry)!.rows.join('\n')).toContain('~');
    const dry = level(false);
    const r2 = levelReachability(dry.project, dry.sceneId, registry);
    expect(r2.status === 'ok' && r2.unreachable.things.map((t) => t.name)).toEqual(['Goal']);
  });
});
