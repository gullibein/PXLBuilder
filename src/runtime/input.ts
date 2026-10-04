/**
 * Player input as game actions. The runtime reads actions, never raw keys,
 * so key bindings (and later gamepads/touch) can change in one place.
 */
export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'interact';

export const KEY_BINDINGS: Record<string, Action> = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  Space: 'jump',
  KeyZ: 'jump',
  KeyE: 'interact',
};

export class InputState {
  private readonly held = new Set<Action>();
  private readonly pressedSinceStep = new Set<Action>();
  private readonly releasedSinceStep = new Set<Action>();

  press(action: Action): void {
    if (!this.held.has(action)) this.pressedSinceStep.add(action);
    this.held.add(action);
  }

  release(action: Action): void {
    if (this.held.has(action)) this.releasedSinceStep.add(action);
    this.held.delete(action);
  }

  releaseAll(): void {
    for (const a of this.held) this.releasedSinceStep.add(a);
    this.held.clear();
  }

  isDown(action: Action): boolean {
    return this.held.has(action);
  }

  /** Pressed since the last simulation step (consumed by `endStep`). */
  wasPressed(action: Action): boolean {
    return this.pressedSinceStep.has(action);
  }

  wasReleased(action: Action): boolean {
    return this.releasedSinceStep.has(action);
  }

  endStep(): void {
    this.pressedSinceStep.clear();
    this.releasedSinceStep.clear();
  }
}
