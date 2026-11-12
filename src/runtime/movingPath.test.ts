import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createDefinition, createProject, instantiateDefinition } from '../core/model/factory';
import { hurtsScript } from '../core/model/ruleScripts';
import { reachabilityProblems } from '../core/model/reachability';
import * as m from '../core/model/mutations';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** A Stone moving along an L: right 64, then up 64 (a point on the way, then the end). */
function platform(loop: boolean) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  let id = '';
  project = produce(project, (d) => {
    d.scenes[0].entities = [];
    const e = instantiateDefinition(d.definitions.find((x) => x.name === 'Stone')!, { x: 0, y: 0 });
    id = e.id;
    m.addEntity(d, sceneId, e);
    m.addEntityComponent(d, sceneId, id, 'MovingPlatform', registry, { speed: 64, pause: 0, loop });
    m.setPlatformPath(d, sceneId, id, { points: [{ x: 64, y: 0 }], offset: { x: 64, y: -64 } }, registry);
  });
  const rt = new Runtime(project, sceneId, registry);
  const input = new InputState();
  const at = () => rt.entities.find((e) => e.id === id)!;
  const track: { t: number; x: number; y: number }[] = [];
  for (let t = 0; t < 6; t += 1 / 120) {
    rt.update(1 / 120, input);
    track.push({ t, x: Math.round(at().x), y: Math.round(at().y) });
  }
  return track;
}

describe('a moving platform follows its path: through its points to the end, and back (or round)', () => {
  it('back and forth: right to the corner, up to the end, then the same way back', () => {
    const track = platform(false);
    const when = (x: number, y: number, after = 0) => track.find((p) => p.t >= after && Math.abs(p.x - x) <= 1 && Math.abs(p.y - y) <= 1)?.t ?? -1;
    const corner = when(64, 0);
    const end = when(64, -64);
    expect(corner).toBeGreaterThan(0.9);
    expect(corner).toBeLessThan(1.1);
    expect(end).toBeGreaterThan(1.9);
    // While going up it stays over the corner (an L, not a diagonal).
    expect(track.filter((p) => p.t > corner + 0.1 && p.t < end - 0.1).every((p) => Math.abs(p.x - 64) <= 1)).toBe(true);
    // Back: past the corner again, then home.
    const backCorner = when(64, 0, end + 0.1);
    expect(backCorner).toBeGreaterThan(end);
    expect(when(0, 0, backCorner + 0.1)).toBeGreaterThan(backCorner);
  });

  it('loop: from the end straight back to the start (a diagonal), then round again', () => {
    const track = platform(true);
    const end = track.find((p) => p.x === 64 && p.y === -64)!.t;
    // Halfway home it is on the diagonal.
    const mid = track.find((p) => p.t > end + 0.2 && p.t < end + 1.4 && Math.abs(p.x - 32) <= 2);
    expect(mid && Math.abs(mid.y + 32) <= 3).toBe(true);
    // Then round again: right along the bottom.
    const home = track.find((p) => p.t > end && p.x === 0 && p.y === 0)!.t;
    expect(track.some((p) => p.t > home + 0.3 && p.y === 0 && p.x > 10)).toBe(true);
  });
});

describe('a moving platform over lava: riding it must not touch the lava', () => {
  /** Floors either side of a 4-cell pit full of lava (its top level with the floors' tops, y=32); a Stone crossing it, `up` rows above the lava's top row. */
  function pit(up: number) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    let id = '';
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const lava = createDefinition('Lava', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32, color: '#ff5a1f' }), Collider: registry.createDefault('Collider', { isTrigger: true }) }, ['lava'], 'Hot.', [hurtsScript({ amount: 1, who: ['player'] })]);
      m.addDefinition(d, lava, registry);
      const place = (name: string, pos: { x: number; y: number }) => {
        const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos);
        m.addEntity(d, sceneId, e);
        return e.id;
      };
      for (let c = -6; c < 0; c++) place('Platform', { x: c * 32 + 16, y: 48 });
      for (let c = 4; c < 10; c++) place('Platform', { x: c * 32 + 16, y: 48 });
      for (let c = 0; c < 4; c++) for (const y of [48, 80]) place('Lava', { x: c * 32 + 16, y });
      for (let c = -6; c < 10; c++) place('Platform', { x: c * 32 + 16, y: 112 });
      // The platform's row: the lava's top row (y=48) or `up` rows over it.
      id = place('Stone', { x: 16, y: 48 - up * 32 });
      m.addEntityComponent(d, sceneId, id, 'MovingPlatform', registry, { offset: { x: 96, y: 0 }, speed: 48, pause: 0.3 });
      place('Player', { x: 16, y: 48 - up * 32 - 32 });
    });
    const problems = reachabilityProblems(project, sceneId, registry).map((p) => p.text);
    // In play: standing still on the platform while it crosses.
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    let hurt = false;
    for (let t = 0; t < 4; t += 1 / 120) {
      rt.update(1 / 120, input);
      if (rt.eventLog.some((e) => e.type === 'damaged')) hurt = true;
    }
    return { hurt, said: problems.some((t) => /Standing on Stone, the player touches Lava/.test(t)) };
  }

  it('moving along the lava\'s top row: hurt riding it, and the checker says so; a row higher: safe, nothing said', () => {
    expect(pit(0)).toEqual({ hurt: true, said: true });
    expect(pit(1)).toEqual({ hurt: false, said: false });
  });
});
