import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createIsometricProject } from '../core/model/isometricStarter';
import { ISO_TILES } from '../core/model/isoTiles';
import { resolveEntity } from '../core/model/resolve';
import { InputState } from '../runtime/input';
import { Runtime } from '../runtime/runtime';
import { cameraKeeping, insideOutline, isoAutoPicture, isoShapeNames, isoLiftOf, isoScreenBox, isoLiftFor, isoLookOf, isoOrder, isoVolume, isoProject, isoUnproject, screenToWorld, worldToScreen } from './renderer';

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

  it('the starter: drawn row of squares by row from the back, each row from the bottom up', () => {
    const project = createIsometricProject(registry);
    const scene = project.scenes[0];
    expect(scene.world.view).toBe('iso');
    const all = scene.entities.map((e) => resolveEntity(project, e, registry));
    const looks = new Map(all.map((e) => [e.name, isoLookOf(e)]));
    expect(looks.get('Grass')).toBe('iso_floor');
    expect(looks.get('Cobblestone')).toBe('iso_block');
    expect(looks.get('Player')).toBe('stand');
    const order = isoOrder(all);
    const key = (e: (typeof order)[number]) => {
      const v = isoVolume(e);
      const r = v ? 0 : 8;
      return { c: Math.floor((e.transform.position.x + r) / 32) + Math.floor((e.transform.position.y + r) / 32), h: v ? v.bottom : Number(e.components.Sprite?.isoLift ?? 0) };
    };
    for (let n = 1; n < order.length; n++) {
      const a = key(order[n - 1]);
      const b = key(order[n]);
      expect(a.c < b.c || (a.c === b.c && a.h <= b.h)).toBe(true);
    }
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

  it('a floor raised half a block is drawn after the ground behind it and before the ground in front (its sunken half hidden)', () => {
    const project = createIsometricProject(registry);
    const all = project.scenes[0].entities.map((e) => resolveEntity(project, e, registry));
    const tile = (i: number, j: number) => all.find((e) => isoLookOf(e) === 'iso_floor' && e.transform.position.x === i * 32 + 16 && e.transform.position.y === j * 32 + 16 && !e.components.Sprite?.isoLift)!;
    const half = { ...tile(7, 5), id: 'half', components: { ...tile(7, 5).components, Sprite: { ...tile(7, 5).components.Sprite, isoLift: 8 } } };
    const order = isoOrder([tile(8, 6), tile(8, 5), half, tile(6, 4), tile(7, 4)]).map((e) => e.id);
    const at = (e: { id: string }) => order.indexOf(e.id);
    expect(at(half)).toBeGreaterThan(at(tile(6, 4)));
    expect(at(half)).toBeGreaterThan(at(tile(7, 4)));
    expect(at(half)).toBeLessThan(at(tile(8, 5)));
    expect(at(half)).toBeLessThan(at(tile(8, 6)));
  });

  it('a block is clicked by its own outline (its top and sides), not the box round its picture', () => {
    const project = createIsometricProject(registry);
    const block = resolveEntity(project, project.scenes[0].entities.find((e) => project.definitions.find((d) => d.id === e.definitionId)?.name === 'Cobblestone')!, registry);
    const camera = { x: block.transform.position.x, y: block.transform.position.y, zoom: 1, iso: true };
    const box = isoScreenBox(block, camera, { width: 200, height: 200 })!;
    // The top's middle and a side: it; the picture's top corners (empty, beside the top's diamond): not.
    expect(insideOutline(box.topFace!, box.outline!)).toBe(true);
    expect(insideOutline({ x: box.topFace!.x - 10, y: box.topFace!.y + 12 }, box.outline!)).toBe(true);
    expect(insideOutline({ x: box.left + 1, y: box.top + 1 }, box.outline!)).toBe(false);
    expect(insideOutline({ x: box.right - 1, y: box.bottom - 1 }, box.outline!)).toBe(false);
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

  it('auto-tiling: the dirt road turns where it bends, the grass rounds off at the island corners, the pond has shores', () => {
    const project = createIsometricProject(registry);
    const all = project.scenes[0].entities.map((e) => resolveEntity(project, e, registry));
    const name = (id: string | null) => project.assets.find((a) => a.id === id)?.name;
    const atCell = (i: number, j: number, lift = 0) => all.filter((e) => Math.floor(e.transform.position.x / 32) === i && Math.floor(e.transform.position.y / 32) === j && isoLiftOf(e) === lift);
    const pick = (i: number, j: number) => {
      const e = atCell(i, j)[0];
      return name(isoAutoPicture(e, (dx, dy) => atCell(i + dx, j + dy)));
    };
    // One object each: no separate turn, corner or shore objects.
    expect(project.definitions.some((d) => /Road Turn|Corner|Dark Dirt|Dark Grass/.test(d.name))).toBe(false);
    // The island's corners (north is up on the screen: the square at the level's 0,0).
    expect(pick(0, 0)).toBe('Island Corner North');
    expect(pick(15, 0)).toBe('Island Corner East');
    expect(pick(15, 11)).toBe('Island Corner South');
    expect(pick(0, 11)).toBe('Island Corner West');
    // An edge of the island: its own picture or the dark grass.
    expect([undefined, 'Dark Grass']).toContain(pick(5, 0));
    expect(new Set([...Array(12).keys()].map((i) => pick(i + 2, 8))).size).toBeGreaterThan(1);
    // The road: from (1,6) along +x to (3,6), then -y: there it turns north-west and north-east.
    expect(pick(3, 6)).toBe('Road Turn NW-NE');
    // (3,4): from +y (south-west) turning +x (south-east).
    expect(pick(3, 4)).toBe('Road Turn SE-SW');
    // A straight stretch is the dirt or its variation.
    const straight = [5, 7, 8, 10, 11, 12].map((i) => pick(i, i < 9 ? 7 : 5));
    for (const p of straight) expect([undefined, 'Dark Dirt']).toContain(p);
    // The pond's corner squares.
    expect(pick(9, 9)).toBe('Water Corner North');
    expect(pick(10, 9)).toBe('Water Corner East');
    expect(pick(10, 10)).toBe('Water Corner South');
    expect(pick(9, 10)).toBe('Water Corner West');
  });

  it('auto-tiling: grass next to water that turns (a shore corner) does not round off as well', () => {
    // An L of water: (0,0), (1,0), (0,1); grass all round. Ascii rows are the level's y, columns its x.
    const rows = ['GGGGG', 'GWWGG', 'GWGGG', 'GGGGG'];
    const ent = (kind: 'land' | 'water', i: number, j: number) =>
      ({ definitionId: kind, tags: kind === 'water' ? ['water'] : [], transform: { position: { x: i * 32 + 16, y: j * 32 + 16 } }, components: { Sprite: { isoLook: 'iso_floor', isoAuto: kind, isoPictures: isoShapeNames(kind).map((n) => `${kind}:${n}`) } } }) as unknown as Parameters<typeof isoAutoPicture>[0];
    const grid = rows.map((r, j) => [...r].map((c, i) => ent(c === 'W' ? 'water' : 'land', i, j)));
    const at = (i: number, j: number) => (dx: number, dy: number) => (grid[j + dy]?.[i + dx] ? [grid[j + dy][i + dx]] : []);
    const pick = (i: number, j: number) => isoAutoPicture(grid[j][i], at(i, j));
    // The water at the L's bend has land on its north-west and north-east: a shore corner.
    expect(pick(1, 1)).toBe('water:Shore north');
    // The grass inside the bend has water on its north-west and north-east, but that water turns: no corner.
    expect(String(pick(2, 2))).not.toMatch(/Corner/);
    // A lone water square on an edge of the island (not turning): the grass beside it with water on two sides rounds off.
    const rows2 = ['WWW', 'WGG', 'WGG'];
    const grid2 = rows2.map((r, j) => [...r].map((c, i) => ent(c === 'W' ? 'water' : 'land', i, j)));
    expect(isoAutoPicture(grid2[1][1], (dx, dy) => (grid2[1 + dy]?.[1 + dx] ? [grid2[1 + dy][1 + dx]] : []))).toBe('land:Corner north');
  });

  describe('walkable heights', () => {
    const hold = (rt: Runtime, keys: ('up' | 'down' | 'left' | 'right')[], seconds: number) => {
      const input = new InputState();
      for (const k of keys) input.press(k);
      for (let i = 0; i < Math.round(seconds * 120); i++) rt.update(1 / 120, input);
    };
    const start = (i: number, j: number) => {
      const project = createIsometricProject(registry);
      const rt = new Runtime(project, project.scenes[0].id, registry);
      const p = rt.entities.find((e) => e.controller)!;
      p.x = i * 32 + 16;
      p.y = j * 32 + 16;
      p.z = rt.groundHeight(p.x, p.y);
      return { rt, p };
    };

    it('the player steps up half a block at a time onto the hill, to its top, and picks up the coin there', () => {
      const { rt, p } = start(3, 4);
      expect(rt.groundHeight(3 * 32 + 16, 3 * 32 + 16)).toBe(8);
      expect(rt.groundHeight(3 * 32 + 16, 1 * 32 + 16)).toBe(16);
      expect(rt.groundHeight(3 * 32 + 16, 16)).toBe(24);
      expect(rt.groundHeight(2 * 32 + 16, 16)).toBe(32);
      const coins = () => rt.entities.filter((e) => e.alive && e.name.startsWith('Coin')).length;
      const before = coins();
      // Up the level's y (up and right on the screen): the step, the terrace, the step on it.
      hold(rt, ['up', 'right'], 2.5);
      expect(Math.floor(p.y / 32)).toBe(0);
      expect(Math.floor(p.x / 32)).toBe(3);
      expect(p.z).toBe(24);
      // Along the level's -x (up and left on the screen) onto the top.
      for (let n = 0; n < 40 && Math.floor(p.x / 32) > 2; n++) hold(rt, ['left', 'up'], 0.05);
      hold(rt, [], 0.3);
      expect(Math.floor(p.x / 32)).toBe(2);
      expect(p.z).toBe(32);
      expect(coins()).toBe(before - 1);
      // Drawn up there, after the block it stands on.
      const drawn = rt.renderList().find((r) => r.components.CharacterController)!;
      expect(drawn.components.Sprite!.isoLift).toBe(32);
    });

    it('a whole block up is a cliff: it stops the player; walking off a terrace, it falls', () => {
      const low = start(0, 1);
      // Along the level's x (right and down on the screen), into the terrace one block up.
      hold(low.rt, ['right', 'down'], 1);
      expect(Math.floor(low.p.x / 32)).toBe(0);
      expect(low.p.z).toBe(0);
      const high = start(1, 0);
      expect(high.p.z).toBe(32);
      hold(high.rt, ['left', 'up'], 0.2);
      expect(Math.floor(high.p.x / 32)).toBe(0);
      expect(high.p.z).toBeGreaterThan(0);
      hold(high.rt, ['left', 'up'], 0.6);
      expect(high.p.z).toBe(0);
    });
  });
});
