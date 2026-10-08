import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { addRelationship } from '../core/logic/mutations';
import type { Project, Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/**
 * A top-down room: no gravity, the player walks in every direction. Stone
 * walls on the left (x = -96) and above (y = -96); the player at 0,0.
 */
function room(extra: (p: Project, sceneId: string, place: (name: string, pos: Vec2) => string) => void = () => {}, gravity = 0) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const place = (name: string, pos: Vec2) => {
      const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos);
      m.addEntity(d, sceneId, e);
      return e.id;
    };
    m.setWorldSettings(d, sceneId, { gravity: { x: 0, y: gravity } });
    m.setDefinitionComponentField(d, d.definitions.find((x) => x.name === 'Player')!.id, 'CharacterController', 'movement', 'topdown', registry);
    for (let i = -3; i <= 3; i++) {
      place('Stone', { x: -96, y: i * 32 });
      place('Stone', { x: i * 32, y: -96 });
    }
    place('Player', { x: 0, y: 0 });
    extra(d, sceneId, place);
  });
  return new Runtime(project, sceneId, registry);
}

function run(rt: Runtime, input: InputState, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) rt.update(1 / 60, input);
}

describe('top-down movement', () => {
  it('stands still without input: nothing pulls it down', () => {
    const rt = room();
    const p = rt.find('Player')!;
    run(rt, new InputState(), 1);
    expect(p.x).toBeCloseTo(0, 5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('stays put even in a level with gravity (the character itself has none)', () => {
    const rt = room(() => {}, 980);
    const p = rt.find('Player')!;
    run(rt, new InputState(), 1);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('walks down and up with the arrow keys, at the controller speed', () => {
    const rt = room();
    const p = rt.find('Player')!;
    const input = new InputState();
    input.press('down');
    run(rt, input, 0.5);
    expect(p.vy).toBeCloseTo(200, 0);
    expect(p.y).toBeGreaterThan(60);
    input.release('down');
    run(rt, input, 0.3);
    expect(Math.abs(p.vy)).toBeLessThan(1);
    const y = p.y;
    input.press('up');
    run(rt, input, 0.3);
    expect(p.y).toBeLessThan(y - 30);
  });

  it('diagonals are no faster than straight lines', () => {
    const rt = room();
    const p = rt.find('Player')!;
    const input = new InputState();
    input.press('down');
    input.press('right');
    run(rt, input, 0.5);
    expect(Math.hypot(p.vx, p.vy)).toBeCloseTo(200, 0);
    expect(p.vx).toBeCloseTo(p.vy, 3);
  });

  it('walls stop it on every side', () => {
    const rt = room();
    const p = rt.find('Player')!;
    const input = new InputState();
    input.press('up');
    input.press('left');
    run(rt, input, 2);
    // Stone walls: right edge at x = -80, bottom edge at y = -80; the player is 28×32.
    expect(p.x).toBeCloseTo(-80 + 14, 1);
    expect(p.y).toBeCloseTo(-80 + 16, 1);
  });

  it('Space does not jump', () => {
    const rt = room();
    const p = rt.find('Player')!;
    const input = new InputState();
    input.press('jump');
    run(rt, input, 0.5);
    expect(p.y).toBeCloseTo(0, 5);
  });

  it('walking far below the level does not count as falling out of it', () => {
    const rt = room();
    const p = rt.find('Player')!;
    const input = new InputState();
    input.press('down');
    run(rt, input, 6);
    expect(p.respawns).toBe(0);
    expect(p.y).toBeGreaterThan(1000);
  });

  it('shows the up and down images while walking up or down (else the running image)', () => {
    const rt = room((d) => {
      const player = d.definitions.find((x) => x.name === 'Player')!.id;
      m.addDefinitionComponent(d, player, 'SpriteStates', registry);
    });
    const p = rt.find('Player')!;
    const input = new InputState();
    input.press('up');
    run(rt, input, 0.3);
    expect(rt.lookOf(p).situation).toBe('up');
    input.release('up');
    input.press('down');
    run(rt, input, 0.3);
    expect(rt.lookOf(p).situation).toBe('down');
    input.release('down');
    input.press('right');
    run(rt, input, 0.3);
    expect(rt.lookOf(p).situation).toBe('run');
  });

  it('a top-down character shoots the way it last walked (up too)', () => {
    const rt = room((d) => {
      const player = d.definitions.find((x) => x.name === 'Player')!.id;
      const def = d.definitions.find((x) => x.id === player)!;
      def.components.Shooter = { ...registry.createDefault('Shooter'), trigger: 'key', interval: 0.1 };
    });
    const input = new InputState();
    input.press('up');
    run(rt, input, 0.2);
    input.release('up');
    input.press('fire');
    rt.update(1 / 60, input);
    const shot = rt.entities.find((e) => e.projectile);
    expect(shot).toBeTruthy();
    expect(shot!.vx).toBeCloseTo(0, 5);
    expect(shot!.vy).toBeLessThan(0);
  });
});

describe('things in a level without gravity', () => {
  it('an enemy that follows the player chases it up and down too', () => {
    const rt = room((d, sceneId, place) => {
      const enemy = place('Enemy', { x: 0, y: 160 });
      const player = d.scenes[0].entities.find((e) => e.name === 'Player')!.id;
      addRelationship(d, sceneId, { type: 'follows', source: { kind: 'entity', id: enemy }, target: { kind: 'entity', id: player }, params: { speed: 80, range: 0 }, conditions: [] });
    });
    const enemy = rt.find('Enemy')!;
    run(rt, new InputState(), 0.5);
    expect(enemy.y).toBeLessThan(150);
  });

  it('a patrol with start direction "up" goes up and down, turning at walls', () => {
    const rt = room((d, _s, place) => {
      const def = d.definitions.find((x) => x.name === 'Enemy')!;
      def.components.Patrol = { ...registry.createDefault('Patrol'), startDirection: 'up', speed: 100 };
      place('Enemy', { x: 64, y: 0 });
    });
    const enemy = rt.find('Enemy')!;
    let top = enemy.y;
    for (let i = 0; i < 120; i++) {
      rt.update(1 / 60, new InputState());
      top = Math.min(top, enemy.y);
      expect(enemy.x).toBeCloseTo(64, 5);
    }
    // The wall's bottom is at y = -80; the enemy is 30 tall: it turns there.
    expect(top).toBeGreaterThan(-80 + 15 - 2);
    expect(top).toBeLessThan(-80 + 15 + 2);
    expect(enemy.vy).toBeGreaterThan(0);
  });

  it('touching an enemy from above hurts instead of stomping it, and knocks straight back', () => {
    const rt = room((d, _s, place) => {
      const def = d.definitions.find((x) => x.name === 'Enemy')!;
      def.components.Stompable = registry.createDefault('Stompable');
      def.components.Health = { ...registry.createDefault('Health'), maxHealth: 1, currentHealth: 1 };
      place('Enemy', { x: 0, y: 64 });
    });
    const p = rt.find('Player')!;
    const enemy = rt.find('Enemy')!;
    const input = new InputState();
    input.press('down');
    run(rt, input, 0.4);
    expect(enemy.alive).toBe(true);
    expect(p.health!.current).toBeLessThan(p.health!.max);
  });

  it('knock back is straight away from what hurt it (no hop upward)', () => {
    const rt = room((_d, _s, place) => place('Enemy', { x: 0, y: 64 }));
    const p = rt.find('Player')!;
    rt.gameplay.hurt(p, 1, rt.find('Enemy')!);
    expect(p.vx).toBeCloseTo(0, 5);
    expect(p.vy).toBeLessThan(0);
    const rt2 = room((_d, _s, place) => place('Enemy', { x: -64, y: 0 }));
    const p2 = rt2.find('Player')!;
    rt2.gameplay.hurt(p2, 1, rt2.find('Enemy')!);
    expect(p2.vx).toBeGreaterThan(0);
    expect(p2.vy).toBeCloseTo(0, 5);
  });
});
