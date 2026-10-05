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
  function switchLevel(conditions: Parameters<typeof logic.addRelationship>[2]['conditions'] = [], playerItems: string[] = []) {
    return level((b) => {
      const doorId = door(b);
      const switchId = b.place('Switch', { x: 40, y: 16 });
      logic.addRelationship(b.d, b.sceneId, { type: 'controls', source: { kind: 'entity', id: switchId }, target: { kind: 'entity', id: doorId }, params: {}, conditions });
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
});
