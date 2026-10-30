import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import * as logic from '../logic/mutations';
import { createProject, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { setScript } from '../script/mutations';
import { hurtsScript } from '../model/ruleScripts';
import type { Id, Project, Vec2 } from '../types';
import { diagnoseLevel } from './diagnose';

const registry = createBuiltinRegistry();

interface B {
  d: Project;
  sceneId: Id;
  place: (name: string, at?: Vec2) => Id;
  def: (name: string) => Id;
}

function check(build: (b: B) => void) {
  const base = createProject(registry);
  const sceneId = base.scenes[0].id;
  const project = produce(base, (d) => {
    d.scenes[0].entities = [];
    const def = (name: string) => d.definitions.find((x) => x.name === name)!.id;
    // Beside the player, not on it.
    const place = (name: string, at: Vec2 = { x: 64, y: 16 }) => {
      const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, at);
      m.addEntity(d, sceneId, e);
      return e.id;
    };
    // Ground under the player (a player above nothing is a problem of its own).
    for (let x = -96; x <= 96; x += 32) place('Platform', { x, y: 48 });
    place('Player', { x: 0, y: 16 });
    place('Goal', { x: -64, y: 16 }); // a way to win (a level without one gets a note)
    build({ d, sceneId, place, def });
  });
  return diagnoseLevel(project, sceneId, registry);
}
const keys = (ps: { key: string }[]) => ps.map((p) => p.key.split(':')[0]);

describe('the problem checker', () => {
  it('a plain level with a player, a door and its key has no problems', () => {
    const problems = check((b) => {
      const door = b.place('Door', { x: 96, y: 0 });
      b.place('Key');
      logic.addRelationship(b.d, b.sceneId, { type: 'requires', source: { kind: 'entity', id: door }, target: { kind: 'object', id: b.def('Key') }, params: {}, conditions: [] });
      b.place('Enemy', { x: -64, y: 17 }); // the player's Damage Receiver accepts "enemy"
    });
    expect(problems).toEqual([]);
  });

  it('a door that needs a key nothing gives', () => {
    let door = '';
    const problems = check((b) => {
      door = b.place('Door', { x: 96, y: 0 });
      logic.addRelationship(b.d, b.sceneId, { type: 'requires', source: { kind: 'entity', id: door }, target: { kind: 'object', id: b.def('Key') }, params: {}, conditions: [] });
    });
    expect(keys(problems)).toEqual(['requires-nothing-gives']);
    expect(problems[0]).toMatchObject({ severity: 'error', entityIds: [door] });
    expect(problems[0].text).toMatch(/Door only opens for someone carrying "key", but nothing in this level gives "key"/);
  });

  it('…unless a rule gives the key', () => {
    const problems = check((b) => {
      const door = b.place('Door', { x: 96, y: 0 });
      logic.addRelationship(b.d, b.sceneId, { type: 'requires', source: { kind: 'entity', id: door }, target: { kind: 'object', id: b.def('Key') }, params: {}, conditions: [] });
      logic.addRule(b.d, b.sceneId, { name: 'gift', enabled: true, when: { event: 'level_started', subject: { kind: 'any' }, other: { kind: 'any' } }, conditions: [], actions: [{ type: 'give_item', target: { kind: 'tag', tag: 'player' }, item: 'key', count: 1 }] });
    });
    expect(problems).toEqual([]);
  });

  it('a "switch" without a Switch component, controlling something that is not Openable', () => {
    const problems = check((b) => {
      const stone = b.place('Stone');
      const other = b.place('Stone', { x: 64, y: -32 });
      logic.addRelationship(b.d, b.sceneId, { type: 'controls', source: { kind: 'entity', id: stone }, target: { kind: 'entity', id: other }, params: { action: 'open' }, conditions: [] });
    });
    expect(keys(problems)).toEqual(['controls-no-switch', 'controls-not-openable']);
  });

  it('damage nothing accepts, and hurting something without Health', () => {
    const problems = check((b) => {
      b.place('Enemy');
      // It hurts only ghosts, and no ghost with health is here.
      b.d.definitions.find((d) => d.name === 'Enemy')!.scripts = [hurtsScript({ amount: 1, who: ['ghost'] })];
      const stone = b.place('Stone', { x: 64, y: -32 });
      logic.addRelationship(b.d, b.sceneId, { type: 'damages', source: { kind: 'tag', tag: 'player' }, target: { kind: 'entity', id: stone }, params: {}, conditions: [] });
    });
    expect(keys(problems)).toEqual(['damages-no-health', 'damage-unaccepted']);
    expect(problems[1].text).toMatch(/Enemy hurts what touches it, but nothing in this level that it hurts \(things tagged "ghost"\) has Health/);
  });

  it('copies of one object are one problem', () => {
    const problems = check((b) => {
      b.d.definitions.find((d) => d.name === 'Enemy')!.scripts = [hurtsScript({ amount: 1, who: ['ghost'] })];
      b.place('Enemy');
      b.place('Enemy', { x: 64, y: 0 });
    });
    expect(problems).toHaveLength(1);
    expect(problems[0].text).toMatch(/^Enemy \(2 copies\)/);
    expect(problems[0].entityIds).toHaveLength(2);
  });

  it('no player; items nobody can pick up', () => {
    const base = createProject(registry);
    const sceneId = base.scenes[0].id;
    const project = produce(base, (d) => {
      d.scenes[0].entities = [];
      m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === 'Coin')!, { x: 0, y: 0 }));
    });
    expect(keys(diagnoseLevel(project, sceneId, registry))).toEqual(['no-player', 'uncollectable']);
  });

  it('no player needed when a script reads the keys (a falling-block puzzle)', () => {
    const base = createProject(registry);
    const sceneId = base.scenes[0].id;
    const project = produce(base, (d) => {
      d.scenes[0].entities = [];
      const board = instantiateDefinition(d.definitions.find((x) => x.name === 'Coin')!, { x: 0, y: 0 });
      m.addEntity(d, sceneId, board);
      setScript(d, { target: 'instance', id: board.id }, { name: 'Board', description: 'Moves the piece.', vars: [{ name: 'x', value: 0 }], handlers: [{ when: { on: 'key', key: 'left', edge: 'pressed' }, if: null, do: [{ do: 'set', var: 'x', value: '1' }] }] });
    });
    expect(keys(diagnoseLevel(project, sceneId, registry))).not.toContain('no-player');
  });

  it('a water script that slows itself instead of what touches it', () => {
    const problems = check((b) => {
      const w = b.place('Stone');
      setScript(b.d, { target: 'instance', id: w }, {
        name: 'Water',
        handlers: [{ when: { on: 'event', event: 'touch_started', with: 'player' }, do: [{ do: 'speed_factor', value: '0.4' }, { do: 'gravity', scale: '0.3' }] }],
      });
    });
    expect(keys(problems)).toEqual(['script-speed-self', 'script-gravity-self']);
    expect(problems[0].text).toMatch(/needs "on": "other"/);
  });

  it('…and the fixed one is fine', () => {
    const problems = check((b) => {
      const w = b.place('Stone');
      setScript(b.d, { target: 'instance', id: w }, {
        name: 'Water',
        handlers: [{ when: { on: 'event', event: 'touch_started', with: 'player' }, do: [{ do: 'speed_factor', value: '0.4', on: 'other' }, { do: 'gravity', scale: '0.3', on: 'other' }] }],
      });
    });
    expect(problems).toEqual([]);
  });

  it('connections that only exist in the design are noted', () => {
    const problems = check((b) => {
      const e = b.place('Enemy');
      logic.addRelationship(b.d, b.sceneId, { type: 'protects', source: { kind: 'entity', id: e }, target: { kind: 'tag', tag: 'player' }, params: {}, conditions: [] });
    });
    expect(problems).toMatchObject([{ severity: 'note' }]);
  });

  it('something with no look at all is invisible in play', () => {
    const problems = check((b) => {
      const id = b.place('Hazard', { x: 64, y: 24 });
      m.removeDefinitionComponent(b.d, b.def('Hazard'), 'Sprite');
      void id;
    });
    expect(problems.map((p) => p.key.split(':')[0])).toContain('no-look');
    expect(problems.find((p) => p.key.startsWith('no-look'))!.text).toMatch(/^Hazard has no look \(no Sprite\), so it can't be seen while playing, though it still hurts/);
  });

  it("a level with no way to win gets a note", () => {
    const base = createProject(registry);
    const sceneId = base.scenes[0].id;
    const project = produce(base, (d) => {
      d.scenes[0].entities = [];
      for (let x = -96; x <= 96; x += 32) m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((q) => q.name === 'Platform')!, { x, y: 48 }));
      m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((q) => q.name === 'Player')!, { x: 0, y: 16 }));
    });
    expect(diagnoseLevel(project, sceneId, registry)).toMatchObject([{ key: 'no-goal', severity: 'note' }]);
  });
});

describe('solid things on the same square', () => {
  it('a block hidden under a wall is named, once, with how many places', () => {
    const ps = check(({ place }) => {
      place('Stone', { x: 160, y: 16 });
      place('Crate', { x: 160, y: 16 });
      place('Stone', { x: 192, y: 16 });
      place('Crate', { x: 192, y: 16 });
    });
    const stacked = ps.filter((p) => p.key.startsWith('stacked:'));
    expect(stacked).toHaveLength(1);
    expect(stacked[0].text).toMatch(/^Crate and Stone are on the same square \(2 places\)/);
    expect(stacked[0].entityIds).toHaveLength(4);
  });

  it('side by side, or a pickup (no solid box) on a block, is fine', () => {
    const ps = check(({ place }) => {
      place('Stone', { x: 160, y: 16 });
      place('Crate', { x: 192, y: 16 });
      place('Coin', { x: 160, y: 16 });
    });
    expect(keys(ps)).not.toContain('stacked');
  });
});
