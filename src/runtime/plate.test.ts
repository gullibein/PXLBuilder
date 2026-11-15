import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Vec2 } from '../core/types';
import { generateId } from '../core/ids';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** Ground from x -6..14 cells; a pressure plate at cell 2, a door at cell 10 it controls; maybe a crate at cell 1. */
function world(crate: boolean) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    d.scenes[0].entities = [];
    const place = (name: string, pos: Vec2) => {
      const e = instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos);
      m.addEntity(d, sceneId, e);
      return e.id;
    };
    for (let c = -6; c <= 14; c++) place('Platform', { x: c * 32 + 16, y: 48 });
    const plate = place('Pressure plate', { x: 2 * 32 + 16, y: 16 });
    const door = place('Door', { x: 10 * 32 + 16, y: 0 });
    if (crate) place('Crate', { x: 0 * 32 + 16, y: 16 });
    place('Player', { x: -3 * 32 + 16, y: 16 });
    d.scenes[0].relationships.push({ id: generateId('rel'), type: 'controls', source: { kind: 'entity', id: plate }, target: { kind: 'entity', id: door }, params: {}, conditions: [] });
  });
  return { rt: new Runtime(project, sceneId, registry), input: new InputState() };
}

const run = (rt: Runtime, input: InputState, seconds: number) => {
  for (let t = 0; t < seconds; t += 1 / 120) rt.update(1 / 120, input);
};

describe('the Pressure plate: on while something heavy is on it', () => {
  it('opens its door while the player stands on it, and closes it when the player steps off', () => {
    const { rt, input } = world(false);
    const door = rt.find('Door')!;
    const plate = rt.find('Pressure plate')!;
    run(rt, input, 0.3);
    expect(door.open).toBe(false);
    input.press('right');
    for (let i = 0; i < 600 && rt.find('Player')!.x < plate.x; i++) rt.update(1 / 120, input);
    input.release('right');
    run(rt, input, 0.3);
    expect(plate.switch!.on).toBe(true);
    expect(door.open).toBe(true);
    // (Its pressed look, and back up after.)
    const look = () => (plate.base.components.Sprite as { assetId: string }).assetId;
    const used = (plate.base.components.SpriteStates as { used: string }).used;
    expect(look()).toBe(used);
    input.press('right');
    run(rt, input, 0.6);
    input.release('right');
    run(rt, input, 0.2);
    expect(plate.switch!.on).toBe(false);
    expect(door.open).toBe(false);
    expect(look()).not.toBe(used);
  });

  it('stays on with a crate pushed onto it: the door stays open after the player walks on', () => {
    const { rt, input } = world(true);
    const door = rt.find('Door')!;
    const plate = rt.find('Pressure plate')!;
    const crate = rt.find('Crate')!;
    run(rt, input, 0.3);
    input.press('right');
    for (let i = 0; i < 2400 && crate.x < plate.x; i++) rt.update(1 / 120, input);
    input.release('right');
    run(rt, input, 0.3);
    expect(Math.abs(crate.x - plate.x)).toBeLessThan(20);
    expect(plate.switch!.on).toBe(true);
    expect(door.open).toBe(true);
    // The player jumps over the crate and goes on to the door: still open.
    input.press('jump');
    input.press('right');
    run(rt, input, 1.5);
    input.release('jump');
    run(rt, input, 1.5);
    input.release('right');
    expect(rt.find('Player')!.x).toBeGreaterThan(plate.x + 64);
    expect(plate.switch!.on).toBe(true);
    expect(door.open).toBe(true);
  });
});
