import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { addRelationship } from '../core/logic/mutations';
import { setScript } from '../core/script/mutations';
import type { Project, Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';
import { writeField } from './fields';

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

describe('Wander', () => {
  const wanderer = (gravity = 0, random: () => number = Math.random) => {
    const rt = room((d, _s, place) => {
      const def = d.definitions.find((x) => x.name === 'Enemy')!;
      def.components.Wander = { ...registry.createDefault('Wander'), speed: 60, interval: 0.5 };
      place('Enemy', { x: 0, y: 64 });
    }, gravity);
    rt.random = random;
    return { rt, enemy: rt.find('Enemy')! };
  };

  it('wanders in all four directions without gravity, never through the walls', () => {
    let seed = 7;
    const { rt, enemy } = wanderer(0, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    const ways = new Set<string>();
    for (let i = 0; i < 60 * 30; i++) {
      rt.update(1 / 60, new InputState());
      ways.add(`${Math.sign(Math.round(enemy.vx))},${Math.sign(Math.round(enemy.vy))}`);
      // The room's walls: left at x -80, top at y -80 (the enemy is 30 wide).
      expect(enemy.x).toBeGreaterThanOrEqual(-80 + 15 - 0.01);
      expect(enemy.y).toBeGreaterThanOrEqual(-80 + 15 - 0.01);
    }
    for (const w of ['1,0', '-1,0', '0,1', '0,-1']) expect(ways).toContain(w);
  });

  it('with gravity it only wanders left and right', () => {
    let seed = 3;
    const { rt, enemy } = wanderer(980, () => ((seed = (seed * 16807) % 2147483647) / 2147483647));
    let moved = false;
    for (let i = 0; i < 60 * 10; i++) {
      rt.update(1 / 60, new InputState());
      if (Math.abs(enemy.vx) > 1) moved = true;
      // It never picks up or down: falling is gravity's business.
      expect(enemy.beh.wander!.dy).toBe(0);
    }
    expect(moved).toBe(true);
  });

  it('turns away when it meets a wall instead of pushing into it', () => {
    // Always "go left first": the left wall is 2 cells away.
    const { rt, enemy } = wanderer(0, () => 0.3);
    let stuck = 0;
    for (let i = 0; i < 60 * 6; i++) {
      rt.update(1 / 60, new InputState());
      if (enemy.bumped !== 0) stuck++;
    }
    expect(stuck).toBeLessThan(5);
  });
});

describe('sprite layers', () => {
  it('draws lower layers first, keeping the placed order within a layer', async () => {
    const { byLayer } = await import('../render/renderer');
    const mk = (name: string, layer?: number) => ({ name, components: { Sprite: layer === undefined ? {} : { layer } } }) as never;
    const list = [mk('player'), mk('floor', -1), mk('roof', 1), mk('coin'), mk('floor2', -1)];
    expect(byLayer(list).map((e: { name: string }) => e.name)).toEqual(['floor', 'floor2', 'player', 'coin', 'roof']);
  });
});

describe('knock back', () => {
  it('seen from above, a hit shoves an enemy a little, then it stops (no sliding into a wall)', () => {
    const rt = room((d, _s, place) => {
      const def = d.definitions.find((x) => x.name === 'Enemy')!;
      def.components.Health = { ...registry.createDefault('Health'), maxHealth: 5, currentHealth: 5 };
      def.components.DamageReceiver = { ...registry.createDefault('DamageReceiver'), damageSources: ['player'] };
      place('Enemy', { x: 0, y: 64 });
    });
    const enemy = rt.find('Enemy')!;
    rt.gameplay.hurt(enemy, 1, rt.find('Player')!);
    run(rt, new InputState(), 1);
    expect(enemy.vy).toBe(0);
    expect(enemy.y - 64).toBeGreaterThan(5);
    expect(enemy.y - 64).toBeLessThan(40);
  });

  it('knockback 0 keeps it exactly on its square (grid and turn-based games)', () => {
    const rt = room((d, _s, place) => {
      const def = d.definitions.find((x) => x.name === 'Enemy')!;
      def.components.Health = { ...registry.createDefault('Health'), maxHealth: 5, currentHealth: 5 };
      def.components.DamageReceiver = { ...registry.createDefault('DamageReceiver'), knockback: 0 };
      place('Enemy', { x: 0, y: 64 });
    });
    const enemy = rt.find('Enemy')!;
    rt.gameplay.hurt(enemy, 1, rt.find('Player')!);
    run(rt, new InputState(), 1);
    expect(enemy.health!.current).toBe(4);
    expect(enemy.x).toBe(0);
    expect(enemy.y).toBe(64);
  });

  it('with gravity, a knocked enemy goes back to how it moved once it lands (it no longer slides on forever)', () => {
    const rt = room((d, _s, place) => {
      const def = d.definitions.find((x) => x.name === 'Enemy')!;
      def.components.Health = { ...registry.createDefault('Health'), maxHealth: 5, currentHealth: 5 };
      def.components.DamageReceiver = registry.createDefault('DamageReceiver');
      // A floor under the enemy.
      for (let x = -64; x <= 64; x += 32) place('Stone', { x, y: 112 });
      place('Enemy', { x: 0, y: 80 });
    }, 980);
    const enemy = rt.find('Enemy')!;
    run(rt, new InputState(), 0.3);
    rt.gameplay.hurt(enemy, 1, rt.find('Player')!);
    run(rt, new InputState(), 1.5);
    expect(enemy.grounded).toBe(true);
    expect(enemy.vx).toBe(0);
  });
});

describe('Pushable', () => {
  const withBarrel = (pushable: Record<string, unknown>, at: Vec2, gravity = 0) =>
    room((d, _s, place) => {
      const barrel = { ...d.definitions.find((x) => x.name === 'Stone')!, id: 'def_barrel', name: 'Barrel', tags: ['barrel'] };
      barrel.components = { ...barrel.components, Pushable: { ...registry.createDefault('Pushable'), ...pushable } };
      d.definitions.push(JSON.parse(JSON.stringify(barrel)));
      place('Barrel', at);
    }, gravity);

  it('seen from above, walking into a barrel pushes it along (down here)', () => {
    const rt = withBarrel({}, { x: 0, y: 64 });
    const p = rt.find('Player')!;
    const barrel = rt.find('Barrel')!;
    const input = new InputState();
    input.press('down');
    run(rt, input, 0.6);
    expect(barrel.y).toBeGreaterThan(100);
    // The player stays right behind it (touching, not inside).
    expect(barrel.y - 16 - (p.y + 16)).toBeGreaterThanOrEqual(-0.01);
    expect(barrel.y - 16 - (p.y + 16)).toBeLessThan(2);
    expect(rt.eventLog.filter((e) => e.type === 'pushed')).toHaveLength(1);
  });

  it('a wall stops the barrel, and the barrel stops the player', () => {
    const rt = withBarrel({}, { x: -48, y: 0 });
    const p = rt.find('Player')!;
    const barrel = rt.find('Barrel')!;
    const input = new InputState();
    input.press('left');
    run(rt, input, 2);
    // The wall's right edge is x = -80: the barrel rests against it, the player against the barrel.
    expect(barrel.x).toBeCloseTo(-80 + 16, 3);
    expect(p.x).toBeCloseTo(-80 + 32 + 14, 1);
  });

  it('step 32: each push moves it exactly one tile, so it stays on the grid', () => {
    const rt = withBarrel({ step: 32, speed: 320 }, { x: 0, y: 48 });
    const barrel = rt.find('Barrel')!;
    const input = new InputState();
    input.press('down');
    run(rt, input, 0.2);
    input.release('down');
    run(rt, input, 0.5);
    expect(barrel.y - 48).toBeCloseTo(32 * Math.round((barrel.y - 48) / 32), 5);
    expect(barrel.y).toBeGreaterThan(48);
    expect(barrel.x).toBe(0);
  });

  it('only pushers can push it; an enemy just bumps into it', () => {
    const rt = withBarrel({}, { x: 64, y: 0 });
    const barrel = rt.find('Barrel')!;
    const input = new InputState();
    input.press('right');
    run(rt, input, 0.5);
    expect(barrel.x).toBeGreaterThan(64);
    const rt2 = withBarrel({ pushers: ['someone else'] }, { x: 64, y: 0 });
    const input2 = new InputState();
    input2.press('right');
    run(rt2, input2, 0.5);
    expect(rt2.find('Barrel')!.x).toBe(64);
  });

  it('in a platformer it is pushed sideways only, and a crate with gravity falls off a ledge', () => {
    const rt = room((d, _s, place) => {
      const crate = { ...d.definitions.find((x) => x.name === 'Stone')!, id: 'def_crate', name: 'Test crate', tags: ['crate'] };
      crate.components = { ...crate.components, PhysicsBody: { ...registry.createDefault('PhysicsBody'), bodyType: 'dynamic' }, Pushable: registry.createDefault('Pushable') };
      d.definitions.push(JSON.parse(JSON.stringify(crate)));
      m.setDefinitionComponentField(d, d.definitions.find((x) => x.name === 'Player')!.id, 'CharacterController', 'movement', 'platformer', registry);
      // A short floor: x -48..48 at y 48 (top 32).
      for (const x of [-32, 0, 32]) place('Stone', { x, y: 48 });
      place('Test crate', { x: 0, y: 16 });
      d.scenes[0].entities.find((e) => e.name === 'Player')!.transform.position = { x: -48, y: 16 };
    }, 980);
    const crate = rt.find('Test crate')!;
    const input = new InputState();
    input.press('right');
    run(rt, input, 1.5);
    // Pushed off the right end of the floor, it fell.
    expect(crate.y).toBeGreaterThan(60);
  });
});

describe('thing_at', () => {
  it('a script can see what is on a grid square', () => {
    const rt = room((d, _s, place) => {
      const coin = place('Coin', { x: 64, y: 0 });
      void coin;
      const player = d.scenes[0].entities.find((e) => e.name === 'Player')!.id;
      setScript(d, { target: 'instance', id: player }, {
        name: 'Look',
        handlers: [
          { when: { on: 'start' }, do: [{ do: 'if', cond: 'thing_at(self.x + 64, self.y, "collectible") != null and thing_at(self.x - 64, self.y) == null', then: [{ do: 'message', text: 'coin to the right' }], else: [] }] },
        ],
      });
    });
    run(rt, new InputState(), 0.1);
    expect(rt.messages).toContain('coin to the right');
  });
});

describe('friction', () => {
  /** A block sliding at 200 px/s: on a long floor (with gravity), or on a top-down floor. */
  const slider = (friction: number, gravity: number, extra: Record<string, unknown> = {}) =>
    room((d, _s, place) => {
      const block = { ...d.definitions.find((x) => x.name === 'Stone')!, id: 'def_block', name: 'Block', tags: ['block'] };
      block.components = {
        ...block.components,
        Collider: { ...registry.createDefault('Collider'), size: { x: 30, y: 30 }, matchSprite: false },
        PhysicsBody: { ...registry.createDefault('PhysicsBody'), bodyType: 'dynamic', friction, velocity: { x: 200, y: 0 }, ...extra },
      };
      d.definitions.push(JSON.parse(JSON.stringify(block)));
      if (gravity) for (let x = -64; x <= 640; x += 32) place('Stone', { x, y: 112 });
      place('Block', { x: 0, y: gravity ? 81 : 64 });
    }, gravity);

  it('on the ground, a sliding block slows down and stops (about v² / 2·friction·1000 px later)', () => {
    const rt = slider(0.2, 980);
    const block = rt.find('Block')!;
    run(rt, new InputState(), 2);
    expect(block.vx).toBe(0);
    // 200² / (2 × 200) = 100 px.
    expect(block.x).toBeGreaterThan(90);
    expect(block.x).toBeLessThan(110);
  });

  it('friction 0 is ice: it keeps sliding', () => {
    const rt = slider(0, 980);
    const block = rt.find('Block')!;
    run(rt, new InputState(), 2);
    expect(block.vx).toBeCloseTo(200, 5);
    expect(block.x).toBeGreaterThan(350);
  });

  it('higher friction stops it sooner', () => {
    const far = (f: number) => {
      const rt = slider(f, 980);
      run(rt, new InputState(), 2);
      return rt.find('Block')!.x;
    };
    expect(far(1)).toBeLessThan(far(0.5));
    expect(far(0.5)).toBeLessThan(far(0.1));
  });

  it('in the air there is no friction: it keeps its sideways speed until it lands', () => {
    const rt = room((d, _s, place) => {
      const block = { ...d.definitions.find((x) => x.name === 'Stone')!, id: 'def_block', name: 'Block' };
      block.components = { ...block.components, PhysicsBody: { ...registry.createDefault('PhysicsBody'), bodyType: 'dynamic', friction: 1, velocity: { x: 200, y: 0 } } };
      d.definitions.push(JSON.parse(JSON.stringify(block)));
      place('Block', { x: 0, y: 64 });
    }, 980);
    const block = rt.find('Block')!;
    run(rt, new InputState(), 0.5);
    expect(block.grounded).toBe(false);
    expect(block.vx).toBeCloseTo(200, 5);
  });

  it('seen from above, it slows down on the floor in every direction', () => {
    const rt = slider(0.2, 0, { velocity: { x: 120, y: 160 } });
    const block = rt.find('Block')!;
    run(rt, new InputState(), 2);
    expect(block.vx).toBe(0);
    expect(block.vy).toBe(0);
    // Straight along its path: 200² / 400 = 100 px.
    expect(Math.hypot(block.x, block.y - 64)).toBeCloseTo(100, -1);
  });

  it('a patrol walks at exactly its speed, even with friction 1', () => {
    const rt = room((d, sceneId, place) => {
      const def = d.definitions.find((x) => x.name === 'Enemy')!;
      def.components.PhysicsBody = { ...def.components.PhysicsBody, friction: 1 };
      def.components.Patrol = { ...registry.createDefault('Patrol'), speed: 60, startDirection: 'down' };
      place('Enemy', { x: 64, y: 0 });
      void sceneId;
    });
    const enemy = rt.find('Enemy')!;
    for (let i = 0; i < 30; i++) rt.update(1 / 60, new InputState());
    expect(enemy.vy).toBe(60);
    // 30 steps of 1/60 s at 60 px/s: exactly 30 px, as if there were no friction.
    expect(enemy.y).toBeCloseTo(30, 5);
  });

  it('a speed a script sets once runs down; set on every tick it stays', () => {
    const scripted = (on: string) =>
      room((d, _s, place) => {
        const id = place('Enemy', { x: 0, y: 64 });
        setScript(d, { target: 'instance', id }, { name: 'Go', handlers: [{ when: { on }, do: [{ do: 'velocity', x: '100', y: null }] }] });
      });
    const once = scripted('start');
    run(once, new InputState(), 1);
    expect(once.find('Enemy')!.vx).toBe(0);
    const always = scripted('tick');
    run(always, new InputState(), 1);
    expect(always.find('Enemy')!.vx).toBe(100);
  });

  it('a script can change friction during play (ice appears)', () => {
    const rt = slider(1, 980);
    const block = rt.find('Block')!;
    run(rt, new InputState(), 0.05);
    expect(writeField(rt, block, 'PhysicsBody', 'friction', 0)).toBeNull();
    block.vx = 200;
    run(rt, new InputState(), 1);
    expect(block.vx).toBeCloseTo(200, 5);
  });
});

describe('mass', () => {
  /** A top-down barrel (Pushable, sliding) of the given mass to the right of the player; the player has `playerMass`. */
  const push = (barrelMass: number, playerMass = 1) => {
    const rt = room((d, _s, place) => {
      const barrel = { ...d.definitions.find((x) => x.name === 'Stone')!, id: 'def_barrel', name: 'Barrel', tags: ['barrel'] };
      barrel.components = { ...barrel.components, PhysicsBody: { ...registry.createDefault('PhysicsBody'), bodyType: 'static', mass: barrelMass }, Pushable: registry.createDefault('Pushable') };
      d.definitions.push(JSON.parse(JSON.stringify(barrel)));
      const player = d.definitions.find((x) => x.name === 'Player')!;
      player.components.PhysicsBody = { ...player.components.PhysicsBody, mass: playerMass };
      place('Barrel', { x: 64, y: 0 });
    });
    const input = new InputState();
    input.press('right');
    // Walk up to it, then push for a second.
    run(rt, input, 0.3);
    const from = rt.find('Barrel')!.x;
    run(rt, input, 1);
    return rt.find('Barrel')!.x - from;
  };

  it('pushing something twice your weight goes at half speed, and as heavy as you at full speed', () => {
    const light = push(1);
    const heavy = push(2);
    expect(light).toBeGreaterThan(140);
    expect(heavy / light).toBeCloseTo(0.5, 1);
  });

  it('something 10 times heavier does not move, until the pusher gets stronger (heavier)', () => {
    expect(push(10)).toBe(0);
    expect(push(10, 2)).toBeGreaterThan(20);
  });

  it('a hit knocks heavier things back less', () => {
    const knocked = (mass: number) => {
      const rt = room((d, _s, place) => {
        const def = d.definitions.find((x) => x.name === 'Enemy')!;
        def.components.PhysicsBody = { ...def.components.PhysicsBody, mass, friction: 0 };
        def.components.Health = { ...registry.createDefault('Health'), maxHealth: 5, currentHealth: 5 };
        def.components.DamageReceiver = registry.createDefault('DamageReceiver');
        place('Enemy', { x: 0, y: 64 });
      });
      const enemy = rt.find('Enemy')!;
      rt.gameplay.hurt(enemy, 1, rt.find('Player')!);
      return enemy.vy;
    };
    expect(knocked(1)).toBeCloseTo(160, 5);
    expect(knocked(4)).toBeCloseTo(40, 5);
  });

  it("a script's push moves heavier things less", () => {
    const pushed = (mass: number) => {
      const rt = room((d, _s, place) => {
        const def = d.definitions.find((x) => x.name === 'Enemy')!;
        def.components.PhysicsBody = { ...def.components.PhysicsBody, mass };
        const id = place('Enemy', { x: 0, y: 64 });
        setScript(d, { target: 'instance', id }, { name: 'Shove', handlers: [{ when: { on: 'start' }, do: [{ do: 'push', x: '200', y: '0' }] }] });
      });
      rt.update(1 / 60, new InputState());
      return rt.find('Enemy')!.vx;
    };
    expect(pushed(2) / pushed(1)).toBeCloseTo(0.5, 2);
  });

  it('heavy and light things fall equally fast', () => {
    const fall = (mass: number) => {
      const rt = room((d, _s, place) => {
        const def = d.definitions.find((x) => x.name === 'Enemy')!;
        def.components.PhysicsBody = { ...def.components.PhysicsBody, mass };
        place('Enemy', { x: 0, y: 0 });
      }, 980);
      run(rt, new InputState(), 0.3);
      return rt.find('Enemy')!.y;
    };
    expect(fall(5)).toBeCloseTo(fall(0.5), 5);
  });
});
