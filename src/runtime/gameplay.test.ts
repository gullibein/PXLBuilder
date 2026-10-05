import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import * as logic from '../core/logic/mutations';
import { createDefinition, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Project, Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

interface Builder {
  d: Project;
  sceneId: string;
  place: (name: string, pos: Vec2, as?: string) => string;
  def: (name: string) => string;
}

/** Ground row at y=48 (top at 32) from x=-144..144, the Player standing at x=0 (center y=16). */
function level(extra: (b: Builder) => void = () => {}) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const def = (name: string) => d.definitions.find((x) => x.name === name)!.id;
    const place = (name: string, pos: Vec2, as?: string) => {
      const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos, as);
      m.addEntity(d, sceneId, e);
      return e.id;
    };
    for (let x = -144; x <= 144; x += 32) place('Platform', { x, y: 48 });
    place('Player', { x: 0, y: 16 });
    extra({ d, sceneId, place, def });
  });
  const rt = new Runtime(project, sceneId, registry);
  return { project, sceneId, rt, input: new InputState(), p: rt.find('Player')! };
}

function run(rt: Runtime, input: InputState, seconds: number, each?: () => void) {
  for (let t = 0; t < seconds; t += 1 / 60) {
    each?.();
    rt.update(1 / 60, input);
  }
}

function walkRight(rt: Runtime, input: InputState, seconds: number) {
  input.press('right');
  run(rt, input, seconds);
  input.release('right');
}

const events = (rt: Runtime, type: string) => rt.eventLog.filter((e) => e.type === type);

describe('gameplay', () => {
  it('announces the level start, and logs touches', () => {
    const { rt, input } = level();
    run(rt, input, 0.2);
    expect(events(rt, 'level_started')).toHaveLength(1);
    expect(events(rt, 'touch_started').some((e) => e.subject === 'Player' && e.other === 'Platform')).toBe(true);
  });

  it('picking up a coin puts it in the inventory and takes it out of the level', () => {
    const { rt, input, p } = level(({ place }) => place('Coin', { x: 60, y: 20 }));
    walkRight(rt, input, 0.8);
    expect(p.inventory?.get('coin')).toBe(1);
    expect(rt.find('Coin')!.alive).toBe(false);
    expect(rt.renderList().some((e) => e.name === 'Coin')).toBe(false);
    expect(events(rt, 'collected')).toEqual([expect.objectContaining({ subject: 'Player', other: 'Coin', detail: { item: 'coin' } })]);
  });

  it('a hazard hurts the player, with a short invincibility; at zero health the player dies and respawns', () => {
    // A wall right after the hazard keeps the player in it.
    const { rt, input, p } = level(({ place }) => {
      place('Hazard', { x: 60, y: 24 });
      place('Stone', { x: 112, y: 16 });
    });
    walkRight(rt, input, 0.6);
    expect(p.health!.current).toBe(2);
    expect(events(rt, 'damaged')).toHaveLength(1);
    expect(p.invincible).toBeGreaterThan(0);
    // Keep walking into it: two more hits (each after the invincibility runs out), then death.
    input.press('right');
    run(rt, input, 4, () => {
      if (events(rt, 'died').length) input.release('right');
    });
    input.release('right');
    expect(events(rt, 'died')).toHaveLength(1);
    expect(events(rt, 'respawned')).toHaveLength(1);
    expect(p.health!.current).toBe(3);
    expect(p.respawns).toBe(1);
  });

  it('an enemy hurts the player on contact (the player accepts damage from "enemy")', () => {
    const { rt, input, p } = level(({ place }) => place('Enemy', { x: 70, y: 17 }));
    walkRight(rt, input, 0.6);
    expect(p.health!.current).toBe(2);
    expect(events(rt, 'damaged')[0]).toMatchObject({ subject: 'Player', other: 'Enemy' });
  });

  /** A door at x=96 standing on the ground (32x64), closing the way right. */
  const door = ({ place }: Builder) => place('Door', { x: 96, y: 0 });

  it('a closed door blocks the way', () => {
    const { rt, input, p } = level(door);
    walkRight(rt, input, 1.5);
    expect(p.x).toBeCloseTo(96 - 16 - 14, 0);
  });

  it('"Door requires Key": the door opens for the player carrying the key', () => {
    const { rt, input, p } = level((b) => {
      const doorId = door(b);
      b.place('Key', { x: 40, y: 20 });
      logic.addRelationship(b.d, b.sceneId, { type: 'requires', source: { kind: 'entity', id: doorId }, target: { kind: 'object', id: b.def('Key') }, params: {}, conditions: [] });
    });
    walkRight(rt, input, 1.5);
    expect(p.inventory?.get('key')).toBe(1);
    expect(rt.find('Door')!.open).toBe(true);
    expect(p.x).toBeGreaterThan(120);
    expect(events(rt, 'opened')[0]).toMatchObject({ subject: 'Door', other: 'Player' });
    expect(rt.renderList().find((e) => e.name === 'Door')!.alpha).toBe(0.3);
  });

  it('without the key the door stays shut', () => {
    const { rt, input, p } = level((b) => {
      const doorId = door(b);
      logic.addRelationship(b.d, b.sceneId, { type: 'requires', source: { kind: 'entity', id: doorId }, target: { kind: 'object', id: b.def('Key') }, params: {}, conditions: [] });
    });
    walkRight(rt, input, 1.5);
    expect(rt.find('Door')!.open).toBe(false);
    expect(p.x).toBeLessThan(80);
  });

  it('"consume" uses the key up', () => {
    const { rt, input, p } = level((b) => {
      const doorId = door(b);
      b.place('Key', { x: 40, y: 20 });
      logic.addRelationship(b.d, b.sceneId, { type: 'requires', source: { kind: 'entity', id: doorId }, target: { kind: 'object', id: b.def('Key') }, params: { consume: true }, conditions: [] });
    });
    walkRight(rt, input, 1.5);
    expect(rt.find('Door')!.open).toBe(true);
    expect(p.inventory?.get('key') ?? 0).toBe(0);
  });

  /** Switch at x=40 (the player passes it), door at x=96, the switch controls the door. */
  function switchLevel(conditions: Parameters<typeof logic.addRelationship>[2]['conditions'] = [], playerItems: string[] = [], params: Record<string, unknown> = {}) {
    return level((b) => {
      const doorId = door(b);
      const switchId = b.place('Switch', { x: 40, y: 16 });
      logic.addRelationship(b.d, b.sceneId, { type: 'controls', source: { kind: 'entity', id: switchId }, target: { kind: 'entity', id: doorId }, params, conditions });
      if (playerItems.length) {
        const player = b.d.scenes[0].entities.find((e) => e.name === 'Player')!;
        m.setEntityComponentField(b.d, b.sceneId, player.id, 'Inventory', 'items', playerItems, registry);
      }
    });
  }

  it('"Switch controls Door": pressing E at the switch opens the door, pressing again closes it', () => {
    const { rt, input, p } = switchLevel();
    walkRight(rt, input, 0.25);
    expect(p.touching.has(rt.find('Switch')!.id)).toBe(true);
    input.press('interact');
    run(rt, input, 0.1);
    input.release('interact');
    expect(rt.find('Switch')!.switch!.on).toBe(true);
    expect(rt.find('Door')!.open).toBe(true);
    expect(events(rt, 'switch_activated')[0]).toMatchObject({ subject: 'Switch', other: 'Player', detail: { on: true } });
    input.press('interact');
    run(rt, input, 0.1);
    input.release('interact');
    expect(rt.find('Door')!.open).toBe(false);
  });

  it('walking past a switch does nothing without pressing E', () => {
    const { rt, input } = switchLevel();
    walkRight(rt, input, 1.5);
    expect(rt.find('Door')!.open).toBe(false);
  });

  const needsKey = [{ type: 'has_item' as const, entity: { kind: 'other' as const }, item: 'key', count: 1, not: false }];

  it('a condition on the relationship: the switch only works if the player has the key', () => {
    const { rt, input } = switchLevel(needsKey);
    walkRight(rt, input, 0.25);
    input.press('interact');
    run(rt, input, 0.1);
    expect(rt.find('Switch')!.switch!.on).toBe(true); // the switch flips…
    expect(rt.find('Door')!.open).toBe(false); // …but the door ignores it

    const withKey = switchLevel(needsKey, ['key']);
    walkRight(withKey.rt, withKey.input, 0.25);
    withKey.input.press('interact');
    run(withKey.rt, withKey.input, 0.1);
    expect(withKey.rt.find('Door')!.open).toBe(true);
  });

  it('rules: WHEN the player picks up a coin DO show a message and spawn an enemy', () => {
    const { rt, input } = level((b) => {
      b.place('Coin', { x: 60, y: 20 });
      logic.addRule(b.d, b.sceneId, {
        name: 'Coin surprise',
        enabled: true,
        when: { event: 'collected', subject: { kind: 'object', id: b.def('Player') }, other: { kind: 'object', id: b.def('Coin') } },
        conditions: [],
        actions: [
          { type: 'show_message', text: 'Got a coin!', seconds: 2 },
          { type: 'spawn', object: b.def('Enemy'), at: null, x: -100, y: 0 },
        ],
      });
    });
    const before = rt.entities.length;
    walkRight(rt, input, 0.8);
    expect(rt.messages).toEqual(['Got a coin!']);
    expect(rt.entities.length).toBe(before + 1);
    expect(events(rt, 'spawned')).toHaveLength(1);
    run(rt, input, 2.5);
    expect(rt.messages).toEqual([]);
  });

  it('rules with conditions: only when the player has two coins', () => {
    const { rt, input } = level((b) => {
      b.place('Coin', { x: 40, y: 20 });
      b.place('Coin', { x: 80, y: 20 });
      logic.addRule(b.d, b.sceneId, {
        name: '',
        enabled: true,
        when: { event: 'collected', subject: { kind: 'any' }, other: { kind: 'any' } },
        conditions: [{ type: 'has_item', entity: { kind: 'subject' }, item: 'coin', count: 2, not: false }],
        actions: [{ type: 'show_message', text: 'Two!', seconds: 5 }],
      });
    });
    walkRight(rt, input, 0.35);
    expect(events(rt, 'collected')).toHaveLength(1);
    expect(rt.messages).toEqual([]);
    walkRight(rt, input, 0.6);
    expect(events(rt, 'collected')).toHaveLength(2);
    expect(rt.messages).toEqual(['Two!']);
  });

  it('a disabled rule does nothing', () => {
    const { rt, input } = level((b) => {
      logic.addRule(b.d, b.sceneId, { name: '', enabled: false, when: { event: 'level_started', subject: { kind: 'any' }, other: { kind: 'any' } }, conditions: [], actions: [{ type: 'show_message', text: 'Hi', seconds: 5 }] });
    });
    run(rt, input, 0.1);
    expect(rt.messages).toEqual([]);
  });

  it('restart_level puts everything back as it was', () => {
    const { rt, input } = level((b) => {
      b.place('Coin', { x: 60, y: 20 });
      b.place('Hazard', { x: -60, y: 24 });
      logic.addRule(b.d, b.sceneId, {
        name: '',
        enabled: true,
        when: { event: 'damaged', subject: { kind: 'object', id: b.def('Player') }, other: { kind: 'any' } },
        conditions: [],
        actions: [{ type: 'restart_level' }],
      });
    });
    walkRight(rt, input, 0.8);
    expect(rt.find('Coin')!.alive).toBe(false);
    input.press('left');
    run(rt, input, 1.5, () => {
      if (events(rt, 'level_started').length > 1) input.release('left');
    });
    input.release('left');
    expect(events(rt, 'level_started')).toHaveLength(2);
    expect(rt.find('Coin')!.alive).toBe(true);
    const p = rt.find('Player')!;
    expect(p.inventory?.get('coin') ?? 0).toBe(0);
    expect(p.health!.current).toBe(3);
  });

  it('rules that keep triggering themselves are stopped instead of freezing the game', () => {
    const { rt, input } = level((b) => {
      logic.addRule(b.d, b.sceneId, {
        name: 'Runaway',
        enabled: true,
        when: { event: 'spawned', subject: { kind: 'any' }, other: { kind: 'any' } },
        conditions: [],
        actions: [{ type: 'spawn', object: b.def('Coin'), at: null, x: 0, y: -400 }],
      });
      logic.addRule(b.d, b.sceneId, { name: '', enabled: true, when: { event: 'level_started', subject: { kind: 'any' }, other: { kind: 'any' } }, conditions: [], actions: [{ type: 'spawn', object: b.def('Coin'), at: null, x: 0, y: -400 }] });
    });
    run(rt, input, 0.05);
    expect(events(rt, 'stopped_runaway_rules').length).toBeGreaterThan(0);
  });

  it('open/close/toggle, damage, heal and items as rule actions', () => {
    const { rt, input, p } = level((b) => {
      door(b);
      const player = { kind: 'object' as const, id: b.def('Player') };
      logic.addRule(b.d, b.sceneId, {
        name: '',
        enabled: true,
        when: { event: 'level_started', subject: { kind: 'any' }, other: { kind: 'any' } },
        conditions: [],
        actions: [
          { type: 'open', target: { kind: 'tag', tag: 'door' } },
          { type: 'damage', target: player, amount: 2 },
          { type: 'heal', target: player, amount: 1 },
          { type: 'give_item', target: player, item: 'gem', count: 3 },
          { type: 'take_item', target: player, item: 'gem', count: 1 },
        ],
      });
    });
    run(rt, input, 0.05);
    expect(rt.find('Door')!.open).toBe(true);
    expect(p.health!.current).toBe(2);
    expect(p.inventory!.get('gem')).toBe(2);
    walkRight(rt, input, 1.5);
    expect(p.x).toBeGreaterThan(120); // the open door no longer blocks
  });

  it('a "damages" relationship hurts even without a matching Damage Receiver tag', () => {
    const { rt, input, p } = level((b) => {
      const stone = b.place('Stone', { x: 80, y: 16 });
      logic.addRelationship(b.d, b.sceneId, { type: 'damages', source: { kind: 'entity', id: stone }, target: { kind: 'object', id: b.def('Player') }, params: { amount: 2 }, conditions: [] });
    });
    walkRight(rt, input, 0.8);
    expect(p.health!.current).toBe(1);
  });

  /** Two teleporters (trigger pads) on the ground: A at x=60, B at x=-120 (a wall at x=-80 keeps the player from walking there). */
  function teleporters(extra: (b: Builder, a: string, bId: string) => void) {
    return level((b) => {
      const def = createDefinition('Teleporter', { Sprite: registry.createDefault('Sprite', { width: 24, height: 8 }), Collider: registry.createDefault('Collider', { size: { x: 24, y: 8 }, isTrigger: true }) });
      m.addDefinition(b.d, def, registry);
      const a = b.place('Teleporter', { x: 60, y: 28 }, 'A');
      const bId = b.place('Teleporter', { x: -120, y: 28 }, 'B');
      b.place('Stone', { x: -80, y: 16 });
      extra(b, a, bId);
    });
  }

  it('"teleports_to": stepping on teleporter A puts the player on B, and it does not bounce back', () => {
    const { rt, input, p } = teleporters((b, a, bId) => {
      logic.addRelationship(b.d, b.sceneId, { type: 'teleports_to', source: { kind: 'entity', id: a }, target: { kind: 'entity', id: bId }, params: {}, conditions: [] });
      logic.addRelationship(b.d, b.sceneId, { type: 'teleports_to', source: { kind: 'entity', id: bId }, target: { kind: 'entity', id: a }, params: {}, conditions: [] });
    });
    input.press('right');
    run(rt, input, 1, () => {
      if (events(rt, 'teleported').length) input.release('right');
    });
    input.release('right');
    expect(events(rt, 'teleported')).toEqual([expect.objectContaining({ subject: 'Player', other: 'B' })]);
    run(rt, input, 0.5);
    expect(p.x).toBeCloseTo(-120, 0);
    expect(p.y).toBeCloseTo(16, 0); // standing on the ground where B is
    expect(events(rt, 'teleported')).toHaveLength(1);
  });

  it('a teleport action in a rule works the same', () => {
    const { rt, input, p } = teleporters((b, a, bId) => {
      logic.addRule(b.d, b.sceneId, {
        name: '',
        enabled: true,
        when: { event: 'touch_started', subject: { kind: 'any' }, other: { kind: 'entity', id: a } },
        conditions: [],
        actions: [{ type: 'teleport', target: { kind: 'subject' }, to: { kind: 'entity', id: bId } }],
      });
    });
    input.press('right');
    run(rt, input, 1, () => {
      if (events(rt, 'teleported').length) input.release('right');
    });
    input.release('right');
    expect(p.x).toBeCloseTo(-120, 0);
  });

  /** An enemy standing on the ground at x=60; `stompable` adds Stompable to this enemy. */
  function enemyLevel(stompable: boolean, player: Vec2) {
    return level((b) => {
      const e = b.place('Enemy', { x: 60, y: 17 }, stompable ? 'Mushroom' : 'Enemy');
      if (stompable) m.addEntityComponent(b.d, b.sceneId, e, 'Stompable', registry);
      b.d.scenes[0].entities.find((x) => x.name === 'Player')!.transform.position = player;
    });
  }

  it('landing on a Stompable enemy defeats it; the player bounces off unhurt', () => {
    const { rt, input, p } = enemyLevel(true, { x: 60, y: -80 });
    let bounced = false;
    run(rt, input, 1, () => {
      if (events(rt, 'stomped').length && p.vy < 0) bounced = true;
    });
    expect(events(rt, 'stomped')).toEqual([expect.objectContaining({ subject: 'Mushroom', other: 'Player' })]);
    expect(rt.find('Mushroom')!.alive).toBe(false);
    expect(events(rt, 'died')[0]).toMatchObject({ subject: 'Mushroom', other: 'Player' });
    expect(bounced).toBe(true);
    expect(p.health!.current).toBe(3);
  });

  it('other enemies cannot be stomped: landing on one hurts', () => {
    const { rt, input, p } = enemyLevel(false, { x: 60, y: -80 });
    run(rt, input, 1);
    expect(events(rt, 'stomped')).toHaveLength(0);
    expect(rt.find('Enemy')!.alive).toBe(true);
    expect(p.health!.current).toBe(2);
  });

  it('walking into a Stompable enemy from the side still hurts', () => {
    const { rt, input, p } = enemyLevel(true, { x: 0, y: 16 });
    walkRight(rt, input, 0.6);
    expect(events(rt, 'stomped')).toHaveLength(0);
    expect(p.health!.current).toBe(2);
  });

  const useSwitch = (rt: Runtime, input: InputState) => {
    input.press('interact');
    run(rt, input, 0.05);
    input.release('interact');
  };

  it('a switch can make its target disappear, and switching off brings it back', () => {
    const { rt, input } = switchLevel([], [], { action: 'disappear' });
    walkRight(rt, input, 0.25);
    useSwitch(rt, input);
    expect(rt.find('Door')!.alive).toBe(false);
    expect(rt.renderList().some((e) => e.name === 'Door')).toBe(false);
    useSwitch(rt, input);
    expect(rt.find('Door')!.alive).toBe(true);
  });

  it('a switch can move its target (3 tiles up at a speed) and back', () => {
    const { rt, input } = switchLevel([], [], { action: 'move', offset: { x: 0, y: -96 }, speed: 96 });
    walkRight(rt, input, 0.25);
    useSwitch(rt, input);
    run(rt, input, 0.5);
    const d = rt.find('Door')!;
    expect(d.y).toBeGreaterThan(-96);
    expect(d.y).toBeLessThan(-30); // on its way, about half way after half a second
    run(rt, input, 1);
    expect(d.y).toBeCloseTo(-96, 5);
    // The way under it is free now: the player walks through where the door was.
    walkRight(rt, input, 1.2);
    expect(rt.find('Player')!.x).toBeGreaterThan(120);
    useSwitch(rt, input); // too far from the switch now: nothing happens
    expect(d.y).toBeCloseTo(-96, 5);
  });

  it('speed 0 moves it at once', () => {
    const { rt, input } = switchLevel([], [], { action: 'move', offset: { x: 64, y: 0 }, speed: 0 });
    walkRight(rt, input, 0.25);
    useSwitch(rt, input);
    expect(rt.find('Door')!.x).toBe(96 + 64);
  });

  function followLevel(params: Record<string, unknown>, enemy: Vec2, flying = false) {
    return level((b) => {
      const e = b.place('Enemy', enemy);
      if (flying) m.setEntityComponentField(b.d, b.sceneId, e, 'PhysicsBody', 'gravityScale', 0, registry);
      logic.addRelationship(b.d, b.sceneId, { type: 'follows', source: { kind: 'entity', id: e }, target: { kind: 'object', id: b.def('Player') }, params, conditions: [] });
    });
  }

  it('"Enemy follows Player": a walking enemy heads for the player at its speed', () => {
    const { rt, input, p } = followLevel({ speed: 80 }, { x: 140, y: 17 });
    run(rt, input, 0.5);
    const e = rt.find('Enemy')!;
    expect(e.x).toBeLessThan(140 - 30);
    expect(e.x).toBeGreaterThan(140 - 50); // about 80 px/s for half a second
    expect(e.y).toBeCloseTo(17, 0); // stays on the ground
    run(rt, input, 1.5);
    expect(events(rt, 'damaged')[0]).toMatchObject({ subject: 'Player', other: 'Enemy' });
    expect(p.health!.current).toBeLessThan(3);
  });

  it('it only follows within range', () => {
    const { rt, input } = followLevel({ speed: 80, range: 64 }, { x: 140, y: 17 });
    run(rt, input, 1);
    expect(rt.find('Enemy')!.x).toBeCloseTo(140, 0);
  });

  it('a flying follower (no gravity) goes straight at the player', () => {
    const { rt, input } = followLevel({ speed: 100 }, { x: 100, y: -100 }, true);
    run(rt, input, 0.5);
    const e = rt.find('Enemy')!;
    expect(e.x).toBeLessThan(100);
    expect(e.y).toBeGreaterThan(-100);
  });
});

describe('behaviors', () => {
  const add = (b: Builder, id: string, type: string, props: Record<string, unknown> = {}) => m.addEntityComponent(b.d, b.sceneId, id, type, registry, props);

  it('Patrol: walks back and forth and turns at the ledge instead of falling off', () => {
    const { rt, input } = level((b) => add(b, b.place('Enemy', { x: 60, y: 17 }), 'Patrol', { speed: 120 }));
    const e = rt.find('Enemy')!;
    let maxX = -Infinity;
    let turned = false;
    run(rt, input, 4, () => {
      maxX = Math.max(maxX, e.x);
      if (e.vx < 0) turned = true;
    });
    expect(turned).toBe(true);
    expect(maxX).toBeLessThanOrEqual(160);
    expect(e.y).toBeCloseTo(17, 0);
    expect(e.alive).toBe(true);
    expect(rt.renderList().find((r) => r.name === 'Enemy')!.transform.scale.x).toBe(e.facing === -1 ? -1 : 1);
  });

  it('Patrol with a distance stays within that distance of where it started', () => {
    const { rt, input } = level((b) => add(b, b.place('Enemy', { x: 60, y: 17 }), 'Patrol', { speed: 120, distance: 32 }));
    const e = rt.find('Enemy')!;
    let lo = Infinity;
    let hi = -Infinity;
    run(rt, input, 3, () => {
      lo = Math.min(lo, e.x);
      hi = Math.max(hi, e.x);
    });
    expect(hi).toBeLessThanOrEqual(60 + 32 + 3);
    expect(lo).toBeGreaterThanOrEqual(60 - 32 - 3);
    expect(hi - lo).toBeGreaterThan(50);
  });

  it('Patrol turns at walls', () => {
    const { rt, input } = level((b) => {
      add(b, b.place('Enemy', { x: 60, y: 17 }), 'Patrol', { speed: 120 });
      b.place('Stone', { x: 112, y: 16 });
    });
    const e = rt.find('Enemy')!;
    let maxX = -Infinity;
    run(rt, input, 1.5, () => (maxX = Math.max(maxX, e.x)));
    expect(maxX).toBeLessThanOrEqual(112 - 16 - 15 + 0.01);
    expect(e.vx).toBeLessThan(0);
  });

  it('Jumper: jumps every interval', () => {
    const { rt, input } = level((b) => add(b, b.place('Enemy', { x: 100, y: 17 }), 'Jumper', { interval: 0.5, jumpForce: 300 }));
    const e = rt.find('Enemy')!;
    let minY = Infinity;
    let jumps = 0;
    let wasUp = false;
    run(rt, input, 2.2, () => {
      minY = Math.min(minY, e.y);
      const up = e.vy < 0;
      if (up && !wasUp) jumps++;
      wasUp = up;
    });
    expect(minY).toBeLessThan(17 - 30);
    expect(jumps).toBeGreaterThanOrEqual(2);
  });

  it('Shooter (auto): fires at the player when in range, and the shot hurts', () => {
    const { rt, input, p } = level((b) => add(b, b.place('Enemy', { x: 120, y: 17 }), 'Shooter', { interval: 1, speed: 300 }));
    run(rt, input, 1.6);
    expect(events(rt, 'shot')[0]).toMatchObject({ subject: 'Enemy', other: 'Shot' });
    expect(events(rt, 'damaged')[0]).toMatchObject({ subject: 'Player', other: 'Shot' });
    expect(p.health!.current).toBe(2);
    // Spent shots are gone.
    expect(rt.entities.filter((e) => e.projectile && !e.alive)).toHaveLength(0);
  });

  it('Shooter (auto) does nothing while the target is out of range', () => {
    const { rt, input } = level((b) => add(b, b.place('Enemy', { x: 120, y: 17 }), 'Shooter', { interval: 0.5, range: 64 }));
    run(rt, input, 2);
    expect(events(rt, 'shot')).toHaveLength(0);
  });

  it('Shooter (key): the player shoots with X; the shot hurts an enemy that takes damage from the player, never the player', () => {
    const { rt, input, p } = level((b) => {
      add(b, rt0(b, 'Player'), 'Shooter', { trigger: 'key', interval: 0.3, speed: 300 });
      const e = b.place('Enemy', { x: 110, y: 17 });
      add(b, e, 'Health', { maxHealth: 2, currentHealth: 2 });
      add(b, e, 'DamageReceiver', { damageSources: ['player'] });
    });
    run(rt, input, 0.1);
    expect(events(rt, 'shot')).toHaveLength(0); // not without pressing
    input.press('fire');
    run(rt, input, 0.05);
    input.release('fire');
    expect(events(rt, 'shot')).toHaveLength(1);
    run(rt, input, 0.6);
    expect(events(rt, 'damaged')[0]).toMatchObject({ subject: 'Enemy', other: 'Shot' });
    expect(rt.find('Enemy')!.health!.current).toBe(1);
    expect(p.health!.current).toBe(3);
  });

  it('shots stop at walls', () => {
    const { rt, input } = level((b) => {
      add(b, rt0(b, 'Player'), 'Shooter', { trigger: 'key', speed: 300 });
      b.place('Stone', { x: 64, y: 16 });
    });
    input.press('fire');
    run(rt, input, 0.05);
    input.release('fire');
    expect(rt.entities.some((e) => e.projectile)).toBe(true);
    run(rt, input, 0.4);
    expect(rt.entities.some((e) => e.projectile)).toBe(false);
  });

  it('MovingPlatform: glides to its offset and back, carrying the player standing on it', () => {
    const { rt, input, p } = level((b) => add(b, b.place('Stone', { x: 208, y: 48 }), 'MovingPlatform', { offset: { x: 64, y: 0 }, speed: 64, pause: 0.5 }));
    const stone = rt.entities.find((e) => e.name === 'Stone' && e.beh.mover)!;
    p.x = 208;
    run(rt, input, 0.5);
    expect(stone.x).toBeGreaterThan(230);
    expect(p.x - stone.x).toBeCloseTo(0, 0);
    expect(p.y).toBeCloseTo(16, 0);
    run(rt, input, 1.5); // at the end, wait, and start back
    run(rt, input, 1.2);
    expect(stone.x).toBeLessThan(250);
    expect(p.x - stone.x).toBeCloseTo(0, 0);
    expect(p.y).toBeCloseTo(16, 0);
  });

  it('Timer: goes off every interval (or once) as a "timer" event rules can use', () => {
    const { rt, input } = level((b) => {
      add(b, b.place('Coin', { x: -100, y: 0 }), 'Timer', { interval: 0.5 });
      const once = b.place('Key', { x: -60, y: 0 });
      add(b, once, 'Timer', { interval: 0.5, repeat: false });
      logic.addRule(b.d, b.sceneId, { name: '', enabled: true, when: { event: 'timer', subject: { kind: 'entity', id: once }, other: { kind: 'any' } }, conditions: [], actions: [{ type: 'show_message', text: 'Ding', seconds: 1 }] });
    });
    run(rt, input, 0.6);
    expect(rt.messages).toContain('Ding');
    run(rt, input, 1);
    expect(events(rt, 'timer').filter((e) => e.subject === 'Coin')).toHaveLength(3);
    expect(events(rt, 'timer').filter((e) => e.subject === 'Key')).toHaveLength(1);
  });

  function apex(withDouble: boolean) {
    const { rt, input, p } = level((b) => withDouble && add(b, rt0(b, 'Player'), 'DoubleJump'));
    run(rt, input, 0.1);
    let minY = Infinity;
    const track = () => (minY = Math.min(minY, p.y));
    // Hold jump to the top of the jump, then press it again in the air.
    input.press('jump');
    run(rt, input, 0.32, track);
    input.release('jump');
    run(rt, input, 0.02, track);
    input.press('jump');
    run(rt, input, 0.35, track);
    input.release('jump');
    run(rt, input, 0.5, track);
    return minY;
  }

  it('DoubleJump: a second jump in the air goes higher; without it, pressing jump in the air does nothing', () => {
    const single = apex(false);
    const double = apex(true);
    expect(16 - single).toBeGreaterThan(35);
    expect(16 - single).toBeLessThan(55);
    expect(16 - double).toBeGreaterThan(70);
  });

  function ledge(grab: boolean) {
    const { rt, input, p } = level((b) => {
      if (grab) add(b, rt0(b, 'Player'), 'LedgeGrab');
      b.place('Stone', { x: 64, y: 16 });
      b.place('Stone', { x: 64, y: -16 });
    });
    input.press('right');
    run(rt, input, 0.3);
    input.press('jump');
    run(rt, input, 0.6);
    input.release('jump');
    return { rt, input, p };
  }

  it('LedgeGrab: jumping at a wall a bit too high to reach, the player hangs from its top and climbs up with Up', () => {
    const { rt, input, p } = ledge(true);
    expect(p.hanging).not.toBeNull();
    expect(events(rt, 'ledge_grabbed')).toHaveLength(1);
    const y = p.y;
    run(rt, input, 0.5);
    expect(p.y).toBe(y); // hangs still
    input.press('up');
    run(rt, input, 0.1);
    input.release('up');
    input.release('right');
    run(rt, input, 0.3);
    expect(p.hanging).toBeNull();
    expect(p.y).toBeCloseTo(-48, 0);
    expect(p.grounded).toBe(true);
  });

  it('without LedgeGrab the same jump falls back down; Down lets go of a ledge', () => {
    expect(ledge(false).p.y).toBeCloseTo(16, 0);
    const { rt, input, p } = ledge(true);
    input.release('right');
    input.press('down');
    run(rt, input, 0.6);
    expect(p.hanging).toBeNull();
    expect(p.y).toBeCloseTo(16, 0);
  });
});

/** The id of the (first) placed instance called `name`. */
function rt0(b: Builder, name: string): string {
  return b.d.scenes.find((s) => s.id === b.sceneId)!.entities.find((e) => e.name === name)!.id;
}
