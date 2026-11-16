/**
 * F3: the collision world behind the GeometryQuery interface (docs/engine-architecture-proposal.md §18). Ramps of
 * any height (45° ramps exactly as before, gentle ones new), probes that report a surface's normal and angle, and
 * cells: tiles dug out that fill in again and trap what is inside, and a board's squares.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../../core/components/builtin';
import { createDefinition, createProject, instantiateDefinition } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { levelMap } from '../../core/model/levelMap';
import { levelReachability } from '../../core/model/reachability';
import { rampOf, RAMP_SHAPES } from '../../core/model/ramps';
import { setScript } from '../../core/script/mutations';
import type { Project, Vec2 } from '../../core/types';
import { modules } from '../../core/engine/modules';
import { presetById } from '../../core/engine/presets';
import { InputState } from '../input';
import { Runtime } from '../runtime';
import { CollisionWorld, slopeSurface } from './world';
import type { Slope } from './types';

const registry = createBuiltinRegistry();

/** Ground along y = 48 (its top at 32); a slope (two squares of gentle ramp, or one 45° ramp) up to ground one square higher (top at 0), the goal on it. */
function hill(ramps: { shape: string; x: number }[], jumpForce = 140): { project: Project; sceneId: string } {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    for (const shape of new Set(ramps.map((r) => r.shape)))
      m.addDefinition(d, createDefinition(shape, { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', { shape }) }, ['platform']), registry);
    // (A weak jumper: about 10 px high, so only the slope gets it up.)
    d.definitions.find((x) => x.name === 'Player')!.components.CharacterController.jumpForce = jumpForce;
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let x = -208; x <= 240; x += 32) place('Platform', { x, y: 48 });
    for (const r of ramps) place(r.shape, { x: r.x, y: 16 });
    const top = Math.max(...ramps.map((r) => r.x), -1000) + 32;
    for (let x = ramps.length ? top : 80; x <= 240; x += 32) place('Platform', { x, y: 16 });
    place('Goal', { x: 208, y: -16 });
    place('Player', { x: -150, y: 16 });
  });
  return { project, sceneId };
}

const GENTLE = [{ shape: 'slopeRightLow', x: 16 }, { shape: 'slopeRightHigh', x: 48 }];

function walkRight(project: Project, sceneId: string, seconds: number, onFrame?: (rt: Runtime) => void): Runtime {
  const rt = new Runtime(project, sceneId, registry);
  const input = new InputState();
  input.press('right');
  for (let i = 0; i < seconds * 60; i++) {
    rt.update(1 / 60, input);
    onFrame?.(rt);
  }
  return rt;
}

describe('F3: ramps of any height', () => {
  it('a 45° ramp has exactly the surface it had before the collision world (the old formula, every pixel)', () => {
    for (const dir of [1, -1] as const) {
      const s: Slope = { x: 48, y: 16, hw: 16, hh: 16, dir, lo: 0, hi: 1 };
      for (let x = 30; x <= 66; x += 0.5) {
        const t = Math.max(0, Math.min(1, (x - (s.x - s.hw)) / (2 * s.hw)));
        expect(slopeSurface(s, x)).toBe(s.y + s.hh - (dir === 1 ? t : 1 - t) * 2 * s.hh);
      }
    }
  });

  it('every ramp shape is known in one place, with its direction and rise', () => {
    expect(RAMP_SHAPES.sort()).toEqual(['slopeLeft', 'slopeLeftHigh', 'slopeLeftLow', 'slopeRight', 'slopeRightHigh', 'slopeRightLow']);
    expect(rampOf('slopeRightLow')).toEqual({ dir: 1, lo: 0, hi: 0.5 });
    expect(rampOf('slopeLeftHigh')).toEqual({ dir: -1, lo: 0.5, hi: 1 });
    expect(rampOf('box')).toBeNull();
    const options = (registry.require('Collider').fields.shape as unknown as { options: string[] }).options;
    for (const s of RAMP_SHAPES) expect(options).toContain(s);
  });

  it('a gentle slope (half a square up per square) is walked up, on its surface all the way, onto the ground above', () => {
    const { project, sceneId } = hill(GENTLE);
    const feet: { x: number; y: number }[] = [];
    const rt = walkRight(project, sceneId, 3, (rt) => {
      const p = rt.entities.find((e) => e.controller)!;
      feet.push({ x: p.x, y: rt.boxOf(p)!.y + rt.boxOf(p)!.hh });
    });
    // Over the slope (x 0..64) its feet keep to the surface: half a pixel up for each pixel across (±2 px).
    const on = feet.filter((f) => f.x > 4 && f.x < 60);
    expect(on.length).toBeGreaterThan(5);
    for (const f of on) expect(Math.abs(f.y - (32 - f.x / 2))).toBeLessThan(3);
    // (It never went down on the way up.)
    for (let i = 1; i < feet.length; i++) if (feet[i].x > 0 && feet[i].x < 64) expect(feet[i].y).toBeLessThanOrEqual(feet[i - 1].y + 0.01);
    expect(rt.completed).not.toBeNull();
  });

  it('the solver walks it too (the two halves as one slope); without it the step is out of reach', () => {
    const { project, sceneId } = hill(GENTLE);
    const reach = levelReachability(project, sceneId, registry);
    expect(reach.status === 'ok' && reach.unreachable.things).toEqual([]);
    const flat = hill([]);
    const without = levelReachability(flat.project, flat.sceneId, registry);
    expect(without.status === 'ok' && without.unreachable.things.map((t) => t.name)).toEqual(['Goal']);
    // (And the map shown to the AI says what it is.)
    const map = levelMap(project, sceneId, registry)!;
    expect(map.legend['/']).toMatch(/gentle ramp/);
  });

  it('a gentle slope is slower to climb than a 45° one is steep: the same rise takes twice the width', () => {
    const steep = hill([{ shape: 'slopeRight', x: 16 }]);
    const gentle = hill(GENTLE);
    const when = (p: { project: Project; sceneId: string }) => {
      let at = -1;
      let f = 0;
      walkRight(p.project, p.sceneId, 3, (rt) => {
        f++;
        const e = rt.entities.find((x) => x.controller)!;
        if (at < 0 && rt.boxOf(e)!.y + rt.boxOf(e)!.hh <= 0.5) at = f;
      });
      return at;
    };
    const [a, b] = [when(steep), when(gentle)];
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
  });
});

describe('F3: probes (GeometryQuery.probe): what a sensor ray meets, which way it faces, how steep', () => {
  const world = new CollisionWorld();
  const tile = (x: number, y: number, extra: Record<string, unknown> = {}) => ({ x, y, collider: { ox: 0, oy: 0, hw: 16, hh: 16, trigger: false, ...extra }, friction: 0.2 }) as never;
  world.rebuild([tile(16, 48), tile(80, 16), tile(144, 16, { slope: 1 }), tile(208, 16, { slope: 1, rise: [0, 0.5] }), tile(272, 48, { oneWay: true })], [], () => []);

  it('a floor faces up, flat; a wall faces the way the ray came from, upright', () => {
    const floor = world.probe({ x: 16, y: 0 }, { x: 0, y: 1 }, 64)!;
    expect(floor.kind).toBe('solid');
    expect(floor.normal).toEqual({ x: 0, y: -1 });
    expect(floor.angle).toBe(0);
    expect(floor.point.y).toBeCloseTo(32, 0);
    const wall = world.probe({ x: 40, y: 16 }, { x: 1, y: 0 }, 64)!;
    expect(wall.normal).toEqual({ x: -1, y: 0 });
    expect(wall.angle).toBeCloseTo(Math.PI / 2);
  });

  it('a 45° ramp faces up and back at 45°; a gentle one at atan(1/2) (26.6°)', () => {
    const steep = world.probe({ x: 144, y: -40 }, { x: 0, y: 1 }, 80)!;
    expect(steep.kind).toBe('slope');
    expect(steep.angle).toBeCloseTo(Math.PI / 4);
    expect(steep.normal.x).toBeCloseTo(-Math.SQRT1_2);
    expect(steep.normal.y).toBeCloseTo(-Math.SQRT1_2);
    expect(steep.point.y).toBeCloseTo(16, 0);
    const gentle = world.probe({ x: 208, y: -40 }, { x: 0, y: 1 }, 80)!;
    expect(gentle.angle).toBeCloseTo(Math.atan(0.5));
    expect((gentle.angle * 180) / Math.PI).toBeCloseTo(26.57, 1);
    // (Half way across a lower half: a quarter of the square up.)
    expect(gentle.point.y).toBeCloseTo(32 - 8, 0);
  });

  it('a jump-through platform is met from above only; nothing in range is null', () => {
    expect(world.probe({ x: 272, y: 0 }, { x: 0, y: 1 }, 64)!.kind).toBe('oneWay');
    expect(world.probe({ x: 272, y: 80 }, { x: 0, y: -1 }, 64)).toBeNull();
    expect(world.probe({ x: 400, y: 0 }, { x: 0, y: 1 }, 64)).toBeNull();
  });
});

describe('F3: cells (tiles dug out that fill in again; a board\'s squares)', () => {
  /** A floor of diggable bricks at row 2 (y 64..96) over solid rock; who stands where; a script that digs. */
  function pit(placeEnemy: boolean) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      const brick = d.definitions.find((x) => x.name === 'Platform')!;
      brick.tags.push('diggable');
      m.addDefinition(d, createDefinition('Rock', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }), Collider: registry.createDefault('Collider', {}) }, ['platform']), registry);
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = 0; c < 10; c++) place('Platform', { x: c * 32 + 16, y: 80 });
      for (let c = 0; c < 10; c++) place('Rock', { x: c * 32 + 16, y: 112 });
      place('Player', { x: 48, y: 48 });
      if (placeEnemy) {
        place('Enemy', { x: 208, y: 48 });
        delete d.definitions.find((x) => x.name === 'Enemy')!.components.Patrol;
      }
    });
    return { project, sceneId };
  }

  it('a dug tile is gone (not solid, not drawn) for its seconds, then back; rock is not dug; a square is dug once', () => {
    const { project, sceneId } = pit(false);
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    rt.update(1 / 60, input);
    const version = rt.world.version;
    expect(rt.dig(144, 80, 1, 'diggable')).toBe(true);
    expect(rt.dig(144, 80, 1, 'diggable')).toBe(false);
    expect(rt.dig(144, 112, 1, 'diggable')).toBe(false);
    expect(rt.dugAt(150, 70)).toBe(true);
    rt.update(1 / 60, input);
    expect(rt.world.version).toBeGreaterThan(version);
    expect(rt.world.cell(4, 2)).toMatchObject({ solid: false, state: 'dug' });
    expect(rt.world.solidAt(144, 80)).toBe(false);
    expect(rt.renderList().some((r) => r.transform.position.x === 144 && r.transform.position.y === 80)).toBe(false);
    for (let i = 0; i < 62; i++) rt.update(1 / 60, input);
    expect(rt.dugAt(144, 80)).toBe(false);
    expect(rt.world.cell(4, 2)).toMatchObject({ solid: true, state: null });
    expect(rt.world.solidAt(144, 80)).toBe(true);
  });

  it('the player in a hole that fills in is caught (dies, back at its start); a guard in one is defeated', () => {
    const { project, sceneId } = pit(true);
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    rt.update(1 / 60, input);
    const player = rt.entities.find((e) => e.controller)!;
    const guard = rt.entities.find((e) => e.tags.includes('enemy'))!;
    rt.dig(48, 80, 0.5, 'diggable');
    rt.dig(208, 80, 0.5, 'diggable');
    for (let i = 0; i < 20; i++) rt.update(1 / 60, input);
    // (Both dropped into their holes: a square down.)
    expect(Math.floor(player.y / 32)).toBe(2);
    expect(Math.floor(guard.y / 32)).toBe(2);
    for (let i = 0; i < 20; i++) rt.update(1 / 60, input);
    expect(guard.alive).toBe(false);
    const died = rt.eventLog.filter((e) => e.type === 'died').map((e) => e.subjectId);
    expect(died).toContain(player.id);
    expect(died).toContain(guard.id);
    // (The player comes back at its start, on the brick that filled in.)
    for (let i = 0; i < 120; i++) rt.update(1 / 60, input);
    expect(player.alive).toBe(true);
    expect(Math.round(player.x)).toBe(48);
    expect(Math.floor(player.y / 32)).toBe(1);
  });

  it('dug for good (0 seconds) never fills in; the level again has every tile back', () => {
    const { project, sceneId } = pit(false);
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    rt.update(1 / 60, input);
    rt.dig(240, 80, 0, 'diggable');
    for (let i = 0; i < 300; i++) rt.update(1 / 60, input);
    expect(rt.dugAt(240, 80)).toBe(true);
    expect(rt.world.cell(7, 2).state).toBe('dug');
    expect(rt.world.cell(7, 2).until).toBeNull();
    rt.restart();
    rt.update(1 / 60, input);
    expect(rt.world.cell(7, 2)).toMatchObject({ solid: true, state: null });
  });

  it('a script digs (dig) and asks (dug_at, in_cell)', () => {
    const { project: base, sceneId } = pit(false);
    const project = produce(base, (d) => {
      const pl = d.definitions.find((x) => x.name === 'Player')!;
      setScript(d, { target: 'definition', id: pl.id }, {
        name: 'Digger',
        description: '',
        vars: [{ name: 'seen', value: 0 }, { name: 'me_here', value: 0 }],
        handlers: [
          { when: { on: 'key', key: 'fire', edge: 'pressed' }, if: null, do: [{ do: 'dig', x: 'self.x + self.facing * 32', y: 'self.y + 32', seconds: '2', tag: 'diggable' }] },
          { when: { on: 'tick' }, if: null, do: [{ do: 'set', var: 'seen', value: 'dug_at(80, 80)' }, { do: 'set', var: 'me_here', value: 'in_cell(self.x, self.y, "player")' }] },
        ],
      } as never);
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    for (let i = 0; i < 10; i++) rt.update(1 / 60, input);
    const me = rt.entities.find((e) => e.controller)!;
    const v = (n: string) => me.scripts.find((s) => s.vars.has(n))!.vars.get(n);
    expect(v('seen')).toBe(false);
    expect(v('me_here')).toBe(true);
    input.press('fire');
    rt.update(1 / 60, input);
    input.release('fire');
    rt.update(1 / 60, input);
    expect(v('seen')).toBe(true);
    expect(rt.world.cell(2, 2).state).toBe('dug');
  });

  it('a board\'s squares: what is in each, by tag (for boards, grids, generators)', () => {
    const { project, sceneId } = pit(true);
    const rt = new Runtime(project, sceneId, registry);
    rt.update(1 / 60, new InputState());
    expect(rt.world.cell(1, 1).things).toContain('player');
    expect(rt.world.cell(6, 1).things).toContain('enemy');
    expect(rt.world.cell(3, 1).things).toEqual([]);
    expect(rt.inCell(48, 48, 'player')).toBe(true);
    expect(rt.inCell(48, 48, 'enemy')).toBe(false);
  });
});

describe('F3: the profile and the geometry agree', () => {
  it('the geometry modules point to no old code; every preset lists geometry the registry has; boards and digging (cells) in every preset', () => {
    expect(modules.list('geometry').filter((x) => x.pointsTo)).toEqual([]);
    for (const id of ['platformer', 'topdown', 'rpg', 'roguelike', 'isometric']) {
      const p = presetById(id)!.profile;
      for (const g of p.geometry) expect(modules.get('geometry', g), `${id}: ${g}`).toBeTruthy();
      expect(p.geometry, id).toContain('cells');
    }
    // Ramps (and jump-through platforms) need a side view; seen from above they block like walls (the fallback).
    expect(modules.get('geometry', 'ramp')!.requires).toEqual(['view:side']);
    expect(modules.get('geometry', 'cells')!.requires).toEqual([]);
  });
});
