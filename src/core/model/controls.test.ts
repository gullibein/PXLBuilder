import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations, checkOperations, type Operation } from '../commands/operations';
import { createProject } from './factory';
import { keyCode, keyLabel, keyMap, readControls } from './controls';
import { produce } from 'immer';

describe("a game's controls", () => {
  it('keys by plain name or browser code; shown as people say them', () => {
    expect(['W', 'space', 'Up', 'Esc', '5', 'KeyJ', 'keyj', 'Shift', ','].map(keyCode)).toEqual(['KeyW', 'Space', 'ArrowUp', 'Escape', 'Digit5', 'KeyJ', 'KeyJ', 'ShiftLeft', 'Comma']);
    expect(keyCode('F5')).toBeNull();
    expect(['KeyW', 'ArrowLeft', 'Escape', 'ShiftLeft'].map(keyLabel)).toEqual(['W', '←', 'Esc', 'Left Shift']);
  });

  it("the game's own keys replace the engine's for those actions; a key it gives one action is no longer another's", () => {
    const map = keyMap({ jump: ['KeyW', 'KeyK'], fire: ['KeyJ'] });
    expect(map.KeyW).toBe('jump');
    expect(map.KeyJ).toBe('fire');
    expect(map.Space).toBeUndefined();
    expect(map.KeyX).toBeUndefined();
    expect(map.ArrowUp).toBe('up');
    expect(map.KeyE).toBe('interact');
  });

  it('wrong ones are said plainly', () => {
    expect(readControls({ jmp: ['W'] })).toEqual({ error: expect.stringMatching(/no action "jmp"/) });
    expect(readControls({ jump: ['W'], fire: ['W'] })).toEqual({ error: expect.stringMatching(/W is set for both jump and fire/) });
    expect(readControls({ jump: ['F13'] })).toEqual({ error: expect.stringMatching(/not a key/) });
    expect(readControls({ action: 'Enter' })).toEqual({ controls: { interact: ['Enter'] } });
  });

  it('the AI sets them with set_controls; "{}" puts back the engine\'s', () => {
    const registry = createBuiltinRegistry();
    const project = createProject(registry, 'T');
    const set = (json: string) => ({ op: 'set_controls', controlsJson: json }) as unknown as Operation;
    const after = produce(project, (d) => {
      applyOperations(d, [set('{"left":["A"],"right":["D"],"jump":["W","Space"]}')], registry);
    });
    expect(after.settings.controls).toEqual({ left: ['KeyA'], right: ['KeyD'], jump: ['KeyW', 'Space'] });
    expect(checkOperations(after, [set('{"jump":["Q"],"fire":["Q"]}')], registry)).toMatch(/both/);
    const back = produce(after, (d) => {
      applyOperations(d, [set('{}')], registry);
    });
    expect(back.settings.controls).toBeUndefined();
  });
});
