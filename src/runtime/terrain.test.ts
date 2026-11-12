import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createDefinition, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { levelMap } from '../core/model/levelMap';
import { jumpTable, levelReachability } from '../core/model/reachability';
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

describe('the jump table the AI builds by is what the player really does', () => {
  const table = () => {
    const p = createProject(registry);
    return jumpTable(p.definitions.find((d) => d.name === 'Player')!.components as never, 980)!;
  };
  /** A floor ending at x=0 (its top at y=32), a gap of `gap` empty cells, then a floor `rise` rows higher; the player runs and jumps at the edge. */
  function attempt(gap: number, rise: number, spikes = 0): { landed: boolean; hurt: boolean } {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let x = -400; x < 0; x += 32) place('Platform', { x: x + 16, y: 48 });
      if (spikes) {
        // The floor goes on under the spikes (Hazard: half a cell tall), then more floor.
        for (let i = 0; i < spikes + 12; i++) place('Platform', { x: i * 32 + 16, y: 48 });
        for (let i = 0; i < spikes; i++) place('Hazard', { x: i * 32 + 16, y: 24 });
      } else for (let i = 0; i < 10; i++) place('Platform', { x: (gap + i) * 32 + 16, y: 48 - rise * 32 });
      place('Player', { x: -360, y: 16 });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    input.press('right');
    let jumped = false;
    let hurt = false;
    let landed = false;
    for (let t = 0; t < 4; t += 1 / 60) {
      const pl = rt.find('Player')!;
      // Jump as its front reaches the edge of the floor, or a step before spikes (as a player does).
      if (!jumped && pl.x + 14 >= (spikes ? -14 : -2)) {
        input.press('jump');
        jumped = true;
      }
      rt.update(1 / 60, input);
      if (rt.eventLog.some((e) => e.type === 'damaged')) hurt = true;
      const after = rt.find('Player')!;
      if (after.grounded && after.x > (spikes ? spikes * 32 : gap * 32) + 4) landed = true;
      if (after.y > 400) break;
    }
    return { landed, hurt };
  }

  it('every gap in the table is cleared, and one two cells wider is not', () => {
    const t = table();
    for (const { rise, cells } of t.gaps.filter((g) => g.rise >= -2)) {
      expect(attempt(cells, rise).landed, `rise ${rise}, ${cells} cells`).toBe(true);
      expect(attempt(cells + 2, rise).landed, `rise ${rise}, ${cells + 2} cells`).toBe(false);
    }
    // One row higher than the table's most is out of reach whatever the gap.
    expect(attempt(1, t.maxRiseRows + 1).landed).toBe(false);
  });

  it('a row of spikes as wide as the table says is jumped over unhurt; two more is not', () => {
    const t = table();
    expect(attempt(0, 0, t.spikeCells.halfCellTall)).toEqual({ landed: true, hurt: false });
    expect(attempt(0, 0, t.spikeCells.halfCellTall + 2).hurt).toBe(true);
  });
});

describe('a double jump counts (almost) twice as high, as a player who knows it times it', () => {
  /** Lower floor (top y=32), a crate or not under a two-cell gap in a floor `rows` rows up; the player double-jumps (second press at `second` s) and moves right. */
  function tryIt(rows: number, crate: boolean, second: number) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      d.definitions.find((x) => x.name === 'Player')!.components.DoubleJump = registry.createDefault('DoubleJump', { extraJumps: 1 }) as never;
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let x = -320; x < 320; x += 32) place('Platform', { x: x + 16, y: 48 });
      for (let x = -320; x < 320; x += 32) if (x < 0 || x >= 64) place('Platform', { x: x + 16, y: 48 - rows * 32 });
      if (crate) place('Crate', { x: 32, y: 16 });
      place('Player', { x: 32, y: crate ? -16 : 16 });
      place('Goal', { x: 200, y: 16 - rows * 32 });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    for (let t = 0; t < 0.5; t += 1 / 60) rt.update(1 / 60, input);
    input.press('jump');
    let landed = false;
    for (let t = 0; t < 2; t += 1 / 60) {
      if (Math.abs(t - (second - 0.02)) < 1 / 120) input.release('jump');
      else if (t > second) input.press('jump');
      if (t > 0.3) input.press('right');
      rt.update(1 / 60, input);
      const pl = rt.find('Player')!;
      if (pl.grounded && pl.y < 48 - rows * 32) landed = true;
    }
    const r = levelReachability(project, sceneId, registry);
    // (The upper floor: whether the checker counts it reached.)
    const top = 32 - rows * 32;
    return { landed, checker: r.status === 'ok' && r.surfaces.some((s) => Math.abs(s.top - top) < 2 && s.left >= 0 && s.reached) };
  }

  it('the most rows up the table allows is reached with the second jump at the top of the first; a floor three rows over a crate (through a gap) counts as reachable, and is', () => {
    const p = createProject(registry);
    const comps = { ...p.definitions.find((d) => d.name === 'Player')!.components, DoubleJump: { extraJumps: 1 } };
    const rows = jumpTable(comps as never, 980)!.maxRiseRows;
    expect(rows).toBe(3);
    expect(tryIt(rows, false, 0.35)).toEqual({ landed: true, checker: true });
    expect(tryIt(4, true, 0.35)).toEqual({ landed: true, checker: true });
    // Four rows up without the crate is out of reach, and the checker says so.
    expect(tryIt(4, false, 0.35)).toEqual({ landed: false, checker: false });
  });
});

describe('a low ceiling over the way to a step: the checker knows the head hits it', () => {
  /** Floor (top y=32); a platform `up` rows over the floor (cols 4-6); a one-row step right after it (cols 7-8); a coin behind the step; a wall. */
  function room(up: number) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = -8; c <= 12; c++) place('Platform', { x: c * 32 + 16, y: 48 });
      for (let r = 0; r < 6; r++) place('Platform', { x: 12 * 32 + 16, y: 16 - r * 32 });
      for (const c of [4, 5, 6]) place('Platform', { x: c * 32 + 16, y: 48 - (up + 1) * 32 });
      for (const c of [7, 8]) place('Platform', { x: c * 32 + 16, y: 16 });
      place('Coin', { x: 10 * 32 + 16, y: 16 });
      place('Player', { x: -100, y: 16 });
    });
    return { project, sceneId };
  }
  /** Runs right and jumps from `at` (x); true when it gets past the step. */
  function attempt(project: Project, sceneId: string, at: number) {
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    input.press('right');
    let jumped = false;
    for (let t = 0; t < 4; t += 1 / 60) {
      const p = rt.find('Player')!;
      if (!jumped && p.x >= at) {
        input.press('jump');
        jumped = true;
      }
      rt.update(1 / 60, input);
      if (rt.find('Player')!.x > 9 * 32) return true;
    }
    return false;
  }

  it('with one row of room under the platform, no jump gets onto the step (in play), and the checker says the coin is out of reach', () => {
    const { project, sceneId } = room(1);
    for (let at = 0; at <= 7 * 32; at += 8) expect(attempt(project, sceneId, at), `jump at ${at}`).toBe(false);
    const r = levelReachability(project, sceneId, registry);
    expect(r.status === 'ok' && r.unreachable.things.map((t) => t.name)).toEqual(['Coin']);
  });

  it('with two rows of room it is easy, and the checker agrees', () => {
    const { project, sceneId } = room(2);
    expect([0, 64, 128, 160, 192].some((at) => attempt(project, sceneId, at))).toBe(true);
    const r = levelReachability(project, sceneId, registry);
    expect(r.status === 'ok' && r.unreachable.things).toEqual([]);
  });
});

describe('spikes on the floor are jumped over, as far as the jump really clears them (a low ceiling caps it)', () => {
  /** Floor (top y=32) with `n` spikes from x=0; a coin past them; a ceiling `room` rows over the floor (0: none). The player runs and jumps a step before them. */
  function spikes(n: number, room: number) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = -12; c < n + 10; c++) {
        place('Platform', { x: c * 32 + 16, y: 48 });
        if (room) place('Platform', { x: c * 32 + 16, y: 16 - room * 32 });
      }
      for (let i = 0; i < n; i++) place('Hazard', { x: i * 32 + 16, y: 24 });
      place('Coin', { x: (n + 6) * 32 + 16, y: 16 });
      place('Player', { x: -300, y: 16 });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    input.press('right');
    let jumped = false;
    let hurt = false;
    for (let t = 0; t < 4; t += 1 / 60) {
      if (!jumped && rt.find('Player')!.x + 14 >= -14) {
        input.press('jump');
        jumped = true;
      }
      rt.update(1 / 60, input);
      if (rt.eventLog.some((e) => e.type === 'damaged')) hurt = true;
      if (rt.find('Player')!.x > n * 32 + 40) break;
    }
    const r = levelReachability(project, sceneId, registry);
    return { hurt, checker: r.status === 'ok' && r.unreachable.things.length === 0 };
  }

  it('two spikes: cleared, and counted; three (the jump table says two): hurt, and the coin past them is reported', () => {
    expect(spikes(2, 0)).toEqual({ hurt: false, checker: true });
    expect(spikes(3, 0)).toEqual({ hurt: true, checker: false });
  });

  it('under a ceiling two rows over the floor even two spikes hurt, and the checker says so; three rows of room is enough', () => {
    expect(spikes(2, 2)).toEqual({ hurt: true, checker: false });
    expect(spikes(2, 3)).toEqual({ hurt: false, checker: true });
  });
});

describe('two ramps in a row (a staircase of ramps, each on the ground or a block)', () => {
  /** Ground (top y=32); a Ramp at cell 0, a block at cell 1 with a Ramp on it, then ground two cells high from cell 2 on. */
  function stairs(crate: boolean) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      const cell = (name: string, c: number, r: number) => place(name, { x: c * 32 + 16, y: r * 32 + 16 });
      for (let c = -8; c <= 16; c++) cell('Platform', c, 1);
      cell('Ramp', 0, 0);
      cell('Platform', 1, 0);
      cell('Ramp', 1, -1);
      for (let c = 2; c <= 16; c++) {
        cell('Platform', c, 0);
        cell('Platform', c, -1);
      }
      if (crate) cell('Crate', -2, 0);
      place('Player', { x: crate ? -140 : -120, y: 16 });
    });
    return { rt: new Runtime(project, sceneId, registry), input: new InputState() };
  }

  it('the player runs up both ramps without bumping into the ground at their tops, and back down', () => {
    const { rt, input } = stairs(false);
    input.press('right');
    let slowest = Infinity;
    for (let t = 0; t < 1.6; t += 1 / 120) {
      rt.update(1 / 120, input);
      const p = rt.find('Player')!;
      if (p.x > -10 && p.x < 90) slowest = Math.min(slowest, p.vx);
    }
    expect(slowest).toBeGreaterThan(190);
    expect(rt.find('Player')!.y).toBeCloseTo(-48, 0);
    input.release('right');
    input.press('left');
    slowest = Infinity;
    for (let t = 0; t < 1.6; t += 1 / 120) {
      rt.update(1 / 120, input);
      const p = rt.find('Player')!;
      if (p.x > -10 && p.x < 90) slowest = Math.min(slowest, -p.vx);
    }
    expect(slowest).toBeGreaterThan(190);
    expect(rt.find('Player')!.y).toBeCloseTo(16, 0);
  });

  it('a crate is pushed up both ramps onto the high ground', () => {
    const { rt, input } = stairs(true);
    input.press('right');
    for (let t = 0; t < 2.2; t += 1 / 120) rt.update(1 / 120, input);
    const c = rt.find('Crate')!;
    expect(c.x).toBeGreaterThan(96);
    expect(c.y).toBeCloseTo(-48, 0);
  });
});

describe('a coin over a pool is reached by swimming up and jumping out at the surface', () => {
  /** Floors either side of a pool 6 cells wide, its surface level with them (y=32); a coin over its middle, `up` rows above it. */
  function pool(up: number) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = -6; c < 0; c++) place('Platform', { x: c * 32 + 16, y: 48 });
      for (let c = 6; c < 12; c++) place('Platform', { x: c * 32 + 16, y: 48 });
      for (let c = -6; c < 12; c++) place('Platform', { x: c * 32 + 16, y: 176 });
      for (let c = 0; c < 6; c++) {
        place('Water', { x: c * 32 + 16, y: 48 });
        for (const y of [80, 112, 144]) place('Deep water', { x: c * 32 + 16, y });
      }
      place('Coin', { x: 96, y: 32 - up * 32 - 16 });
      place('Player', { x: -100, y: 16 });
    });
    // In play: walk in, then swim up under the coin and keep jumping.
    let tapped = false;
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    for (let t = 0; t < 4; t += 1 / 120) {
      const p = rt.find('Player')!;
      if (p.x < 90) input.press('right');
      else input.release('right');
      // A stroke whenever it sinks; a jump as soon as its head is out at the surface (as a player does).
      const headOut = p.x > 0 && p.y - 16 < 32;
      if (p.vy < 0 && input.isDown('jump')) {
        // (Rising out of the water: Jump held all the way, as for any full jump.)
      } else if (!tapped && ((headOut && p.vy > -60) || (!headOut && p.vy > 60))) {
        input.press('jump');
        tapped = true;
      } else {
        input.release('jump');
        tapped = false;
      }
      rt.update(1 / 120, input);
    }
    const r = levelReachability(project, sceneId, registry);
    return { collected: !rt.find('Coin')?.alive, checker: r.status === 'ok' && r.unreachable.things.length === 0 };
  }

  it('two rows over the water: collected, and counted; four rows: neither', () => {
    expect(pool(2)).toEqual({ collected: true, checker: true });
    expect(pool(4)).toEqual({ collected: false, checker: false });
  });
});
