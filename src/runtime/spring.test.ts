import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Vec2 } from '../core/types';
import { jumpTable, levelReachability } from '../core/model/reachability';
import { InputState } from './input';
import { Runtime } from './runtime';
const registry = createBuiltinRegistry();
function world(spring: boolean) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    d.scenes[0].entities = [];
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let c = -6; c <= 6; c++) place('Platform', { x: c * 32 + 16, y: 48 });
    if (spring) place('Spring', { x: 16, y: 16 });
    place('Player', { x: 16, y: spring ? -100 : 16 });
  });
  return { rt: new Runtime(project, sceneId, registry), input: new InputState() };
}
describe('the Spring: half a jump, or two jumps high with Jump held (or pressed just before or after it lands)', () => {
  it('bounces as high as the player\'s own jump says', () => {
    const r = measure();
    const h = r['normal jump'];
    expect(r['no key'] / h).toBeCloseTo(0.5, 1);
    expect(r['held from the start'] / h).toBeCloseTo(2, 1);
    // Letting go of Jump on the way up doesn't cut a launch short.
    expect(r['held, let go just after the bounce'] / h).toBeCloseTo(2, 1);
    // The right moment: just before landing, or just after.
    expect(r['pressed and let go 0.05 s before landing'] / h).toBeCloseTo(2, 1);
    expect(r['pressed 0.08 s after landing'] / h).toBeGreaterThan(1.9);
    // Too late: only the bounce.
    expect(r['pressed 0.3 s after landing'] / h).toBeCloseTo(0.5, 1);
  });
});

function measure(): Record<string, number> {
  const out: Record<string, number> = {};
  { // normal jump height
    const { rt, input } = world(false);
    for (let t = 0; t < 0.3; t += 1 / 120) rt.update(1 / 120, input);
    const y0 = rt.find('Player')!.y; input.press('jump'); let best = 1e9;
    for (let t = 0; t < 1.5; t += 1 / 120) { rt.update(1 / 120, input); best = Math.min(best, rt.find('Player')!.y); }
    out['normal jump'] = y0 - best;
  }
  // spring top at y=32-16=16; player's bottom on it → centre y = 0
  const trial = (name: string, act: (t: number, landedAt: number | null, input: InputState) => void) => {
    const { rt, input } = world(true);
    let landedAt: number | null = null; let best = 1e9; let wasDown = false; let peakAfter = false;
    for (let t = 0; t < 3; t += 1 / 120) {
      act(t, landedAt, input);
      rt.update(1 / 120, input);
      const p = rt.find('Player')!;
      if (landedAt === null && p.vy < 0 && wasDown) landedAt = t;
      if (p.vy > 0) wasDown = true;
      if (landedAt !== null && !peakAfter) { best = Math.min(best, p.y); if (p.vy > 0 && t - landedAt > 0.02) peakAfter = true; }
    }
    out[name] = 0 - best;
  };
  trial('no key', () => {});
  trial('held from the start', (t, _l, i) => { if (t < 0.01) i.press('jump'); });
  trial('held, let go just after the bounce', (t, l, i) => { if (t < 0.01) i.press('jump'); if (l !== null && t > l + 0.05) i.release('jump'); });
  trial('pressed 0.08 s after landing', (t, l, i) => { if (l !== null && t > l + 0.08 && t < l + 0.09) i.press('jump'); });
  trial('pressed 0.3 s after landing', (t, l, i) => { if (l !== null && t > l + 0.3 && t < l + 0.31) i.press('jump'); });
  trial('pressed and let go 0.05 s before landing', (t, _l, i) => { if (t > 0.33 && t < 0.34) i.press('jump'); if (t > 0.36) i.release('jump'); });
  return out;
}

describe('the level checker and the jump table know springs', () => {
  /** Floor (top y=32); a Spring at cell 0 (or not); a ledge `rows` rows over the floor from cell 1 on, a coin on it; the player comes down onto the spring. */
  function ledge(rows: number, spring: boolean) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = -8; c <= 8; c++) place('Platform', { x: c * 32 + 16, y: 48 });
      for (let c = 1; c <= 6; c++) place('Platform', { x: c * 32 + 16, y: 48 - rows * 32 });
      if (spring) place('Spring', { x: 16, y: 16 });
      place('Coin', { x: 5 * 32 + 16, y: 16 - rows * 32 });
      place('Player', { x: 14, y: -40 });
    });
    // In play: dropped onto the spring holding Jump; once its feet are over the ledge, it steers right onto it.
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    let reached = false;
    input.press('jump');
    const top = 32 - rows * 32;
    for (let t = 0; t < 4; t += 1 / 120) {
      const p = rt.find('Player')!;
      if (p.y + 16 < top - 2) input.press('right');
      rt.update(1 / 120, input);
      const q = rt.find('Player')!;
      if (q.grounded && q.y < top) reached = true;
    }
    const r = levelReachability(project, sceneId, registry);
    return { reached, checker: r.status === 'ok' && r.unreachable.things.length === 0, table: jumpTable(project.definitions.find((x) => x.name === 'Player')!.components as never, 980)! };
  }

  it('a ledge springRows rows up is reached from a spring (and counted); one row higher is not; without the spring it is out of reach', () => {
    const { table } = ledge(1, true);
    expect(table.springRows).toBe(4);
    expect(ledge(table.springRows, true)).toMatchObject({ reached: true, checker: true });
    expect(ledge(table.springRows + 1, true)).toMatchObject({ reached: false, checker: false });
    expect(ledge(table.springRows, false).checker).toBe(false);
  });
});

describe('a spring shows its squashed "sprung" look for a moment as it bounces something', () => {
  it('sprung just after the bounce, its normal look again a little later', () => {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = -3; c <= 3; c++) place('Platform', { x: c * 32 + 16, y: 48 });
      place('Spring', { x: 16, y: 16 });
      place('Player', { x: 16, y: -60 });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    const spring = () => rt.entities.find((e) => e.base.name === 'Spring')!;
    let seen = false;
    let bouncedAt = -1;
    for (let t = 0; t < 1.5 && !seen; t += 1 / 120) {
      rt.update(1 / 120, input);
      if (rt.lookOf(spring()).situation === 'sprung') {
        seen = true;
        bouncedAt = t;
      }
    }
    expect(seen).toBe(true);
    const sprungLook = project.definitions.find((x) => x.name === 'Spring')!.components.SpriteStates!.sprung;
    expect(rt.lookOf(spring()).assetId).toBe(sprungLook);
    for (let t = 0; t < 0.3; t += 1 / 120) rt.update(1 / 120, input);
    expect(rt.lookOf(spring()).situation).not.toBe('sprung');
    expect(bouncedAt).toBeGreaterThan(0);
  });
});
