import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { checkScript, scriptSchema } from '../core/script/language';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** A corridor: a floor row (y 160) and a ceiling row (y -160), a coin near the ceiling, the player on the floor. */
function corridor(withScript = false): Runtime {
  let project = createProject(registry, 'Flip');
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const def = (n: string) => d.definitions.find((x) => x.name === n)!;
    for (let x = -160; x <= 160; x += 32) {
      m.addEntity(d, sceneId, instantiateDefinition(def('Platform'), { x, y: 160 }));
      m.addEntity(d, sceneId, instantiateDefinition(def('Platform'), { x, y: -160 }));
    }
    m.addEntity(d, sceneId, instantiateDefinition(def('Coin'), { x: 64, y: -112 }));
    const player = def('Player');
    if (withScript)
      player.scripts = [
        scriptSchema.parse({ id: 'scr_flip', name: 'Flip', vars: [], states: [], handlers: [{ when: { on: 'key', key: 'interact' }, if: 'not flipping', do: [{ do: 'flip_level', way: 'upside_down', at: null, seconds: '0.6', wave: '0.5' }] }] }) as never,
      ];
    m.addEntity(d, sceneId, instantiateDefinition(player, { x: -96, y: 128 }));
  });
  return new Runtime(project, sceneId, registry);
}

const step = (rt: Runtime, seconds: number, input = new InputState()) => {
  for (let i = 0; i < Math.round(seconds * 120); i++) rt.update(1 / 120, input);
};

describe('flip_level', () => {
  it('mirrors the whole level upside down: the outer rows first and fastest, things turned over; the player is carried upright and falls onto the new floor', () => {
    const rt = corridor();
    step(rt, 0.5);
    const player = rt.entities.find((e) => e.controller)!;
    expect(player.grounded).toBe(true);
    const floor = rt.entities.find((e) => e.y === 160)!;
    const coin = rt.entities.find((e) => e.base.name === 'Coin')!;
    expect(rt.flipLevel('upside_down', null, 0.6, 0.5)).toBe(true);
    // Only one at a time.
    expect(rt.flipLevel('upside_down', null, 0.6, 0.5)).toBe(false);
    step(rt, 0.32);
    // The floor (farthest from the middle) is already across; the coin (nearer) is still on its way.
    expect(floor.y).toBe(-160);
    expect(coin.y).toBeGreaterThan(-112);
    expect(coin.y).toBeLessThan(112);
    // Turning over on the way: drawn squashed, and upside down once across.
    const drawn = (name: string, y: number) => rt.renderList().find((r) => r.name === name && Math.abs(r.transform.position.y - y) < 1)!;
    expect(drawn('Platform', -160).transform.scale.y).toBe(-1);
    expect(Math.abs(rt.renderList().find((r) => r.name === 'Coin')!.transform.scale.y)).toBeLessThan(1);
    step(rt, 0.29);
    expect(rt.flip).toBeNull();
    expect(coin.y).toBe(112);
    // The player rode along to its mirrored place (up near the new ceiling), upright, then falls down onto the new
    // floor (the old ceiling, turned over).
    expect(player.y).toBeLessThan(-100);
    expect(rt.renderList().find((r) => r.name === 'Player')!.transform.scale.y).toBe(1);
    step(rt, 1.5);
    expect(player.grounded).toBe(true);
    expect(player.y).toBeGreaterThan(100);
    // A second flip turns it all back.
    rt.flipLevel('upside_down', null, 0, 0);
    expect(floor.y).toBe(160);
    expect(rt.renderList().find((r) => r.name === 'Coin')!.transform.scale.y).toBe(1);
  });

  it('is a script statement (with "flipping" and "flipped"); left to right mirrors around a column', () => {
    const script = { id: 's', name: 'F', vars: [], states: [], handlers: [{ when: { on: 'tick' }, if: 'not flipping and not flipped', do: [{ do: 'flip_level', way: 'left_right', at: '0', seconds: 0.4, wave: '0' }] }] };
    expect('script' in checkScript(script, createProject(registry, 'T'))).toBe(true);
    const rt = corridor(true);
    step(rt, 0.3);
    const player = rt.entities.find((e) => e.controller)!;
    const input = new InputState();
    input.press('interact');
    step(rt, 1 / 60, input);
    expect(rt.flip).not.toBeNull();
    input.release('interact');
    step(rt, 0.6);
    expect(rt.flip).toBeNull();
    expect(rt.flips.upside_down).toBe(1);
    expect(player.y).toBeLessThan(-100);
    const rt2 = corridor();
    const coin = rt2.entities.find((e) => e.base.name === 'Coin')!;
    rt2.flipLevel('left_right', 0, 0, 0);
    expect(coin.x).toBe(-64);
  });
});
