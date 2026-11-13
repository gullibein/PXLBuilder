import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';
const registry = createBuiltinRegistry();

/** A floor, a block with two empty cells under it (over the player, or `beside` it), the player under it. */
function world(block: string, beside = 0) {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    d.scenes[0].entities = [];
    const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
    for (let c = -6; c <= 6; c++) place('Platform', { x: c * 32 + 16, y: 48 });
    place(block, { x: 16 + beside, y: 16 - 64 });
    place('Player', { x: 16, y: 16 });
  });
  return { rt: new Runtime(project, sceneId, registry), input: new InputState(), project };
}
const run = (rt: Runtime, input: InputState, s: number) => {
  for (let t = 0; t < s; t += 1 / 120) rt.update(1 / 120, input);
};
const jump = (rt: Runtime, input: InputState) => {
  run(rt, input, 0.3);
  input.press('jump');
  run(rt, input, 0.6);
  input.release('jump');
  run(rt, input, 1);
};

describe('blocks hit from below', () => {
  it('a ? block gives a Coin on top once, then shows its used look', () => {
    const { rt, input, project } = world('Question block');
    const def = project.definitions.find((d) => d.name === 'Question block')!;
    const used = def.components.SpriteStates!.used as string;
    const coins = () => rt.entities.filter((e) => e.alive && e.name === 'Coin').length;
    const before = coins();
    jump(rt, input);
    expect(rt.scripts.errors).toEqual([]);
    expect(coins()).toBe(before + 1);
    const block = rt.find('Question block')!;
    expect(block.base.components.Sprite!.assetId).toBe(used);
    const coin = rt.entities.filter((e) => e.name === 'Coin').at(-1)!;
    expect(coin.y).toBeCloseTo(block.y - 32, 0);
    // (Bumped again: nothing more.)
    jump(rt, input);
    expect(coins()).toBe(before + 1);
  });
  it('a brick breaks when bumped from below, and not when the jump goes past it', () => {
    const { rt, input } = world('Brick');
    jump(rt, input);
    expect(rt.find('Brick')?.alive ?? false).toBe(false);
    const away = world('Brick', 96);
    jump(away.rt, away.input);
    expect(away.rt.find('Brick')!.alive).toBe(true);
  });
});
