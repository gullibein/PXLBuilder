import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { jumpTable } from '../core/model/reachability';
import type { Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';
const registry = createBuiltinRegistry();
type Cfg = { name: string; gravity: number; cc: Record<string, number>; size?: number };
const CFGS: Cfg[] = [
  { name: 'default', gravity: 980, cc: {} },
  { name: 'floaty', gravity: 500, cc: { jumpForce: 420 } },
  { name: 'heavy', gravity: 1800, cc: { jumpForce: 700 } },
  { name: 'fast', gravity: 980, cc: { speed: 340 } },
  { name: 'slow', gravity: 980, cc: { speed: 110 } },
  { name: 'big', gravity: 980, cc: {}, size: 60 },
  { name: 'small', gravity: 980, cc: {}, size: 16 },
  { name: 'sluggish accel', gravity: 980, cc: { acceleration: 400 } },
  { name: 'low air control', gravity: 980, cc: { airControl: 0.15 } },
];
function setup(cfg: Cfg, build: (place: (n: string, p: Vec2) => void) => void) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    d.scenes[0].entities = [];
    d.scenes[0].world.gravity.y = cfg.gravity;
    const pd = d.definitions.find((x) => x.name === 'Player')!;
    Object.assign(pd.components.CharacterController, cfg.cc);
    if (cfg.size) {
      (pd.components.Sprite as any).width = cfg.size; (pd.components.Sprite as any).height = cfg.size;
      if (pd.components.Collider) (pd.components.Collider as any).size = { x: cfg.size - 4, y: cfg.size };
    }
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    build(place);
  });
  return { project, sceneId };
}
function gapAttempt(cfg: Cfg, gap: number, rise: number) {
  const ph = cfg.size ?? 32;
  const { project, sceneId } = setup(cfg, (place) => {
    for (let x = -600; x < 0; x += 32) place('Platform', { x: x + 16, y: 48 });
    for (let i = 0; i < 12; i++) place('Platform', { x: (gap + i) * 32 + 16, y: 48 - rise * 32 });
    place('Player', { x: -560, y: 32 - ph / 2 });
  });
  const rt = new Runtime(project, sceneId, registry);
  const input = new InputState();
  input.press('right');
  let jumped = false, landed = false;
  for (let t = 0; t < 6; t += 1 / 60) {
    const pl = rt.find('Player')!;
    if (!jumped && pl.x + (ph - 4) / 2 >= -2) { input.press('jump'); jumped = true; }
    rt.update(1 / 60, input);
    const a = rt.find('Player')!;
    if (a.grounded && a.x > gap * 32 + 4) landed = true;
    if (a.y > 600) break;
  }
  return landed;
}
/** True when it gets hurt whichever spot (0-64 px before them) it jumps from. */
function spikeAttempt(cfg: Cfg, n: number) {
  return [0, 8, 16, 24, 32, 48, 64].every((early) => spikeOnce(cfg, n, early));
}
function spikeOnce(cfg: Cfg, n: number, early: number) {
  const ph = cfg.size ?? 32;
  const { project, sceneId } = setup(cfg, (place) => {
    for (let c = -20; c < n + 14; c++) place('Platform', { x: c * 32 + 16, y: 48 });
    for (let i = 0; i < n; i++) place('Hazard', { x: i * 32 + 16, y: 24 });
    place('Player', { x: -560, y: 32 - ph / 2 });
  });
  const rt = new Runtime(project, sceneId, registry);
  const input = new InputState();
  input.press('right');
  let jumped = false, hurt = false;
  for (let t = 0; t < 6; t += 1 / 60) {
    if (!jumped && rt.find('Player')!.x + (ph - 4) / 2 >= -early) { input.press('jump'); jumped = true; }
    rt.update(1 / 60, input);
    if (rt.eventLog.some((e) => e.type === 'damaged')) hurt = true;
    if (rt.find('Player')!.x > n * 32 + 60) break;
  }
  return hurt;
}
/**
 * The jump table (what the AI builds levels by, and what the level checker counts) comes from the player's own
 * settings and the level's gravity: checked here in play for very different players, not only the starter's.
 */
describe('the jump table holds for any player: floaty, heavy, fast, slow, big, small, sluggish', () => {
  for (const cfg of CFGS) {
    it(cfg.name, () => {
      const { project } = setup(cfg, () => {});
      const t = jumpTable(project.definitions.find((d) => d.name === 'Player')!.components as never, cfg.gravity)!;
      for (const g of t.gaps.filter((g) => g.rise >= -2)) {
        expect(gapAttempt(cfg, g.cells, g.rise), `gap ${g.cells} cells, rise ${g.rise}`).toBe(true);
        expect(gapAttempt(cfg, g.cells + 2, g.rise), `gap ${g.cells + 2} cells, rise ${g.rise}`).toBe(false);
      }
      // (It keeps a little in reserve: a climb one row higher may just be made with a perfect jump; two never.)
      expect(gapAttempt(cfg, 1, t.maxRiseRows + 2)).toBe(false);
      // Spikes: as many as the table says are cleared jumping from a sensible spot; two more hurt from wherever it jumps.
      expect(spikeAttempt(cfg, t.spikeCells.halfCellTall)).toBe(false);
      expect(spikeAttempt(cfg, t.spikeCells.halfCellTall + 2)).toBe(true);
    });
  }
});
