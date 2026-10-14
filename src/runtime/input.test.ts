import { describe, expect, it } from 'vitest';
import { GamepadReader, InputState, type PadLike } from './input';

/** A controller in the standard layout with these buttons down and the left stick at (x, y). */
const pad = (down: number[] = [], x = 0, y = 0): PadLike => ({ connected: true, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i) })), axes: [x, y, 0, 0] });

describe('game controllers', () => {
  it('the d-pad, the left stick and the face buttons are the same actions as the keys', () => {
    const r = new GamepadReader();
    expect([...r.read([pad([0, 14])]).actions].sort()).toEqual(['jump', 'left']);
    expect([...r.read([pad([1, 2])]).actions].sort()).toEqual(['fire', 'interact']);
    expect([...r.read([pad([], 0.9, -0.8)]).actions].sort()).toEqual(['right', 'up']);
    // A slight push of the stick (drift) is nothing.
    expect(r.read([pad([], 0.3, 0.2)]).actions.size).toBe(0);
    // No controller, or a disconnected one: nothing.
    expect(r.read([null, { ...pad([0]), connected: false }])).toEqual({ actions: new Set(), restart: false, connected: 0 });
  });

  it('Select restarts once per press', () => {
    const r = new GamepadReader();
    expect(r.read([pad([8])]).restart).toBe(true);
    expect(r.read([pad([8])]).restart).toBe(false);
    expect(r.read([pad([])]).restart).toBe(false);
    expect(r.read([pad([8])]).restart).toBe(true);
  });

  it('a controller and the keyboard together: held while either holds it; pressed and released once', () => {
    const input = new InputState();
    input.holdOnly(new Set(['jump']), 'pad');
    expect(input.isDown('jump') && input.wasPressed('jump')).toBe(true);
    input.endStep();
    input.press('jump'); // the keyboard too: not a new press
    expect(input.wasPressed('jump')).toBe(false);
    input.holdOnly(new Set(), 'pad');
    expect(input.isDown('jump') && !input.wasReleased('jump')).toBe(true); // the key still holds it
    input.release('jump');
    expect(input.isDown('jump') || !input.wasReleased('jump')).toBe(false);
    input.endStep();
    // Held across frames: pressed only on the first.
    input.holdOnly(new Set(['left']), 'pad');
    input.endStep();
    input.holdOnly(new Set(['left']), 'pad');
    expect(input.isDown('left') && !input.wasPressed('left')).toBe(true);
    input.releaseAll();
    expect(input.isDown('left')).toBe(false);
  });
});
