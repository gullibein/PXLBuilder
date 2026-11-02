import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createIsometricProject } from '../core/model/isometricStarter';
import { ISO_TILES } from '../core/model/isoTiles';
import { resolveEntity } from '../core/model/resolve';
import { InputState } from '../runtime/input';
import { Runtime } from '../runtime/runtime';
import { cameraKeeping, isoLiftFor, isoLookOf, isoOrder, isoVolume, isoProject, isoUnproject, screenToWorld, worldToScreen } from './renderer';

const registry = createBuiltinRegistry();

describe('the isometric view', () => {
  it('a grid square is a diamond twice as wide as tall; screen and level points go both ways', () => {
    expect(isoProject({ x: 32, y: 0 })).toEqual({ x: 16, y: 8 });
    expect(isoProject({ x: 0, y: 32 })).toEqual({ x: -16, y: 8 });
    const cam = { x: 100, y: 40, zoom: 2, iso: true };
    const view = { width: 800, height: 600 };
    for (const p of [{ x: 0, y: 0 }, { x: 333, y: -71 }, { x: -12.5, y: 900 }]) {
      expect(isoUnproject(isoProject(p)).x).toBeCloseTo(p.x);
      const back = screenToWorld(cam, view, worldToScreen(cam, view, p));
      expect(back.x).toBeCloseTo(p.x);
      expect(back.y).toBeCloseTo(p.y);
    }
    // The camera's point is in the middle; zooming round a point keeps it there.
    expect(worldToScreen(cam, view, cam)).toEqual({ x: 400, y: 300 });
    const keep = cameraKeeping(cam, view, { x: 50, y: 50 }, { x: 120, y: 90 }, 3);
    const s = worldToScreen(keep, view, { x: 50, y: 50 });
    expect(s.x).toBeCloseTo(120);
    expect(s.y).toBeCloseTo(90);
  });

  it('the starter: blocks on the ground first, then walls and characters back to front', () => {
    const project = createIsometricProject(registry);
    const scene = project.scenes[0];
    expect(scene.world.view).toBe('iso');
    const all = scene.entities.map((e) => resolveEntity(project, e, registry));
    const looks = new Map(all.map((e) => [e.name, isoLookOf(e)]));
    expect(looks.get('Grass')).toBe('iso_floor');
    expect(looks.get('Cobblestone')).toBe('iso_block');
    expect(looks.get('Player')).toBe('stand');
    const order = isoOrder(all);
    const firstUpright = order.findIndex((e) => !['iso_floor', 'flat'].includes(isoLookOf(e)));
    expect(order.slice(firstUpright).every((e) => !['iso_floor', 'flat'].includes(isoLookOf(e)))).toBe(true);
    const depth = order.slice(firstUpright).map((e) => e.transform.position.x + e.transform.position.y);
    expect(depth).toEqual([...depth].sort((a, b) => a - b));
    // The user's blocks: whole, 16 × 16.
    for (const a of Object.values(ISO_TILES)) expect(a.rows.length === 16 && a.rows.every((r) => r.length === 16)).toBe(true);
  });

  it('blocks fill the space between their bottom and top; stacking puts the next one on the top', () => {
    const project = createIsometricProject(registry);
    const all = project.scenes[0].entities.map((e) => resolveEntity(project, e, registry));
    const grass = all.find((e) => e.name.startsWith('Grass'))!;
    const stone = all.find((e) => e.name.startsWith('Cobblestone'))!;
    // A floor block's top is the ground; a wall block stands on it.
    expect(isoVolume(grass)).toEqual({ bottom: -16, top: 0 });
    expect(isoVolume(stone)).toEqual({ bottom: 0, top: 16 });
    // On the stone's top: another stone one block up, or grass whose top is two blocks up.
    expect(isoLiftFor(stone, 16)).toBe(16);
    expect(isoLiftFor(grass, 16)).toBe(32);
    const raised = { ...grass, transform: stone.transform, components: { ...grass.components, Sprite: { ...grass.components.Sprite, isoLift: 32 } } };
    expect(isoVolume(raised)).toEqual({ bottom: 16, top: 32 });
    // Drawn after (in front of) what it stands on.
    const order = isoOrder([raised, stone]);
    expect(order[0]).toBe(stone);
  });

  it('played, the arrow keys go the way they point on the screen; water and walls are in the way', () => {
    const project = createIsometricProject(registry);
    const rt = new Runtime(project, project.scenes[0].id, registry);
    const input = new InputState();
    const player = rt.entities.find((e) => e.controller)!;
    expect(rt.cam.frame().iso).toBe(true);
    const from = { x: player.x, y: player.y };
    input.press('right');
    for (let i = 0; i < 30; i++) rt.update(1 / 120, input);
    input.release('right');
    // Right on the screen: +x and -y in the level, the same amount (straight across the screen).
    expect(player.x - from.x).toBeGreaterThan(5);
    expect(from.y - player.y).toBeCloseTo(player.x - from.x, 0);
    const p = isoProject({ x: player.x - from.x, y: player.y - from.y });
    expect(Math.abs(p.y)).toBeLessThan(0.5);
    // Up the screen for a long time: the water at the island's edge stops it.
    input.press('up');
    for (let i = 0; i < 600; i++) rt.update(1 / 120, input);
    expect(player.x).toBeGreaterThan(0);
    expect(player.y).toBeGreaterThan(0);
  });
});
