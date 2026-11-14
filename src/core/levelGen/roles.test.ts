import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject, instantiateDefinition } from '../model/factory';
import * as m from '../model/mutations';
import { findRoles, missingRoles } from './roles';

const registry = createBuiltinRegistry();

describe('which object plays each part of a level', () => {
  it("the starter platformer's objects each find their part, with their size in cells", () => {
    const r = findRoles(createProject(registry), registry);
    const names = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v!.name]));
    expect(names).toEqual({
      player: 'Player', goal: 'Goal', door: 'Door', switch: 'Switch', ladder: 'Ladder', crate: 'Crate', deepWater: 'Deep water', water: 'Water', spring: 'Spring',
      block: 'Question block', brick: 'Brick', enemy: 'Enemy', hazard: 'Hazard', key: 'Key', heart: 'Heart', coin: 'Coin', teleporter: 'Teleporter',
      rampRight: 'Ramp', rampLeft: 'Ramp left', oneway: 'Bridge', pipeTop: 'Pipe top', pipe: 'Pipe', ground: 'Platform', ledge: 'Stone',
    });
    expect(r.door!.cells).toEqual({ w: 1, h: 2 });
    expect(r.pipeTop!.cells).toEqual({ w: 2, h: 1 });
    expect(r.ground!.cells).toEqual({ w: 1, h: 1 });
    // No moving platform or lava object in the starter: those parts are missing (never made up).
    expect(missingRoles(r, ['mover', 'lava', 'ground'])).toEqual(['mover', 'lava']);
  });

  it('found by what an object is, not its name: a renamed ground still is the ground; the one placed most wins', () => {
    const p = produce(createProject(registry), (d) => {
      const stone = d.definitions.find((x) => x.name === 'Stone')!;
      stone.tags.push('ground');
      d.definitions.find((x) => x.name === 'Platform')!.name = 'Mossy earth';
      for (let i = 0; i < 5; i++) m.addEntity(d, d.scenes[0].id, instantiateDefinition(stone, { x: 16 + i * 32, y: 48 }));
    });
    const r = findRoles(p, registry);
    expect(r.ground!.name).toBe('Stone');
    expect(r.ledge!.name).toBe('Mossy earth');
  });

  it('a top-down game has no platformer parts to speak of, but nothing breaks', () => {
    const r = findRoles(createProject(registry, 'T', 'topdown'), registry);
    expect(r.player).toBeTruthy();
    expect(r.rampRight).toBeUndefined();
  });
});
