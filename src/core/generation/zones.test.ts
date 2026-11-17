/**
 * F6b: camera zones for generated rooms (docs/engine-architecture-proposal.md §22.2). A play-time generator that
 * knows its rooms gets a Camera Zone object for each when the game's camera has the "rooms" behaviour; the camera
 * does the rest (runtime/cameraBehaviors.ts: nothing new there). Without "rooms": exactly what the generator built.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { roguelike } from '../../regression/generators.test';
import { Runtime } from '../../runtime/runtime';
import { createBuiltinRegistry } from '../components/builtin';
import { checkGame, setGameProfile } from '../engine/profile';
import { createDefinition, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import type { Project } from '../types';

const registry = createBuiltinRegistry();

/** The roguelike with the camera's rooms behaviour (and its recipe's seed fixed). */
const withRooms = (recipe: Record<string, unknown> = {}, more?: (d: Project) => void) =>
  produce(roguelike({ seed: 11, ...recipe }), (d) => {
    setGameProfile(d, { camera: ['follow', 'rooms'] }, registry);
    more?.(d);
  });

function play(p: Project) {
  const rt = new Runtime(p, p.scenes[0].id, registry);
  const zones = rt.entities.filter((e) => e.base.components.CameraZone);
  const hero = rt.entities.find((e) => e.base.components.CameraTarget)!;
  const step = (seconds: number) => {
    for (let t = 0; t < seconds; t += 1 / 60) rt.cam.update(1 / 60);
  };
  /** The hero put somewhere (as walking there would), the camera then given time. */
  const go = (x: number, y: number, seconds = 1) => {
    hero.x = x;
    hero.y = y;
    step(seconds);
  };
  return { rt, zones, hero, go, cam: rt.cam.camera };
}

describe('F6b: generated camera zones', () => {
  it('one zone for each generated room, matching the room: its inside and the walls round it; invisible, not solid', () => {
    const { rt, zones } = play(withRooms());
    const rooms = rt.dungeon!.roomList;
    expect(rooms.length).toBeGreaterThan(3);
    expect(zones.length).toBe(rooms.length);
    zones.forEach((z, i) => {
      const s = z.base.components.Sprite!;
      expect([z.x, z.y, s.width, s.height], `room ${i + 1}`).toEqual([rooms[i].x, rooms[i].y, rooms[i].w + 64, rooms[i].h + 64]);
      expect(s.visible).toBe(false);
      expect(z.collider).toBeNull();
    });
    expect(rt.renderList().some((r) => r.components.CameraZone && r.components.Sprite?.visible !== false)).toBe(false);
    expect(checkGame(withRooms(), registry).state).toBe('ok');
  });

  it('without "rooms" in the profile: no zones; the level is exactly what the generator built', () => {
    const plain = roguelike({ seed: 11 });
    const rt = new Runtime(plain, plain.scenes[0].id, registry);
    expect(rt.entities.some((e) => e.base.components.CameraZone)).toBe(false);
    const { rt: zoned } = play(withRooms());
    const others = zoned.entities.filter((e) => !e.base.components.CameraZone).map((e) => [e.name, e.x, e.y]);
    expect(others).toEqual(rt.entities.map((e) => [e.name, e.x, e.y]));
  });

  it('seen from above: the view is held on the room the hero is in; in a corridor (no zone) it follows the hero', () => {
    const { rt, go, cam } = play(withRooms());
    const [first, second] = rt.dungeon!.roomList;
    // (Rooms are smaller than the screen: the view is centred on the room.)
    go(first.x, first.y);
    expect([cam.x, cam.y]).toEqual([first.x, first.y]);
    go(first.x + first.w / 2 - 20, first.y + 10);
    expect([cam.x, cam.y]).toEqual([first.x, first.y]);
    go(second.x, second.y, 2);
    expect(cam.x).toBeCloseTo(second.x, 3);
    expect(cam.y).toBeCloseTo(second.y, 3);
    // A spot in no zone (between rooms, away from the level's edges, where its limits would hold the view): the
    // camera goes to the hero.
    const inZone = (x: number, y: number) => rt.dungeon!.roomList.some((r) => Math.abs(x - r.x) <= r.w / 2 + 32 && Math.abs(y - r.y) <= r.h / 2 + 32);
    let free: { x: number; y: number } | null = null;
    for (let x = 496; x <= 784 && !free; x += 32) for (let y = 304; y <= 592 && !free; y += 32) if (!inZone(x, y)) free = { x, y };
    expect(free).not.toBeNull();
    go(free!.x, free!.y, 4);
    expect(Math.abs(cam.x - free!.x) + Math.abs(cam.y - free!.y)).toBeLessThan(2);
  });

  it('going to the room next door slides the view there; rooms one above the other too', () => {
    const { rt, go, cam } = play(withRooms());
    const rooms = rt.dungeon!.roomList;
    /** The pair of rooms most side by side (dx) or most one above the other (dy). */
    const pair = (axis: 'x' | 'y') => {
      let best: [number, number] = [0, 1];
      let score = -Infinity;
      for (let a = 0; a < rooms.length; a++)
        for (let b = 0; b < rooms.length; b++) {
          if (a === b) continue;
          const dx = Math.abs(rooms[a].x - rooms[b].x);
          const dy = Math.abs(rooms[a].y - rooms[b].y);
          const sc = axis === 'x' ? dx - 3 * dy : dy - 3 * dx;
          if (sc > score) [score, best] = [sc, [a, b]];
        }
      return best.map((i) => rooms[i]);
    };
    for (const axis of ['x', 'y'] as const) {
      const [from, to] = pair(axis);
      // (Truly beside, or above, each other.)
      expect(Math.abs(from[axis] - to[axis])).toBeGreaterThan(Math.abs(from[axis === 'x' ? 'y' : 'x'] - to[axis === 'x' ? 'y' : 'x']));
      go(from.x, from.y, 2);
      expect(cam[axis]).toBeCloseTo(from[axis], 3);
      // Into the other room: sliding at once, part of the way after a moment, there after the slide.
      go(to.x, to.y, 0.1);
      expect(rt.cam.sliding).toBe(true);
      const part = cam[axis];
      expect(Math.abs(part - from[axis])).toBeGreaterThan(0);
      expect(Math.abs(part - to[axis])).toBeGreaterThan(1);
      go(to.x, to.y, 1);
      expect(rt.cam.sliding).toBe(false);
      expect(cam.x).toBeCloseTo(to.x, 3);
      expect(cam.y).toBeCloseTo(to.y, 3);
    }
  });

  it('a zone placed by hand in the level stays as it is, beside the generated ones', () => {
    const p = withRooms({}, (d) => {
      const def = createDefinition('Vault view', { Sprite: registry.createDefault('Sprite', { width: 320, height: 192, visible: false }), CameraZone: registry.createDefault('CameraZone', { transition: 'cut' }) }, []);
      m.addDefinition(d, def, registry);
      m.addEntity(d, d.scenes[0].id, { ...instantiateDefinition(def, { x: -600, y: -600 }), id: 'ent_by_hand' });
    });
    const { rt, zones, go, cam } = play(p);
    const mine = zones.find((z) => z.id === 'ent_by_hand')!;
    expect([mine.x, mine.y, mine.base.components.CameraZone!.transition]).toEqual([-600, -600, 'cut']);
    expect(zones.length).toBe(rt.dungeon!.roomList.length + 1);
    // (And it works as any zone: the view cuts to it.)
    go(-600, -600, 0.05);
    expect([cam.x, cam.y]).toEqual([-600, -600]);
  });

  it('caves and mazes have no rooms: no zones (the camera follows); keeping an example keeps its zones as objects to edit', () => {
    expect(play(withRooms({ style: 'caves' })).zones.length).toBe(0);
    expect(play(withRooms({ style: 'maze' })).zones.length).toBe(0);
    const kept = produce(withRooms(), (d) => m.keepDungeon(d, d.scenes[0].id, registry));
    const zones = kept.scenes[0].entities.filter((e) => e.components.CameraZone);
    expect(kept.scenes[0].generator).toBeUndefined();
    expect(zones.length).toBeGreaterThan(3);
    expect(zones.every((z) => z.id.startsWith('ent'))).toBe(true);
  });
});
