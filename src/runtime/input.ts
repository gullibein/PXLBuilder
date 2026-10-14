/**
 * Player input as game actions. The runtime reads actions, never raw keys,
 * so the keyboard, touch buttons and game controllers all drive the same
 * actions (bindings change in one place).
 */
export type Action = 'left' | 'right' | 'up' | 'down' | 'jump' | 'interact' | 'fire';

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
  KeyX: 'fire',
};

/** Where an action comes from: the keyboard and touch buttons, or a game controller. Held if any source holds it. */
export type InputSource = 'keys' | 'pad';

export class InputState {
  private readonly bySource = new Map<InputSource, Set<Action>>();
  private readonly pressedSinceStep = new Set<Action>();
  private readonly releasedSinceStep = new Set<Action>();

  private from(source: InputSource): Set<Action> {
    let set = this.bySource.get(source);
    if (!set) this.bySource.set(source, (set = new Set()));
    return set;
  }

  press(action: Action, source: InputSource = 'keys'): void {
    if (!this.isDown(action)) this.pressedSinceStep.add(action);
    this.from(source).add(action);
  }

  release(action: Action, source: InputSource = 'keys'): void {
    const set = this.from(source);
    if (!set.delete(action)) return;
    if (!this.isDown(action)) this.releasedSinceStep.add(action);
  }

  /** What one source holds now (a controller, read every frame): pressed and released to match. */
  holdOnly(actions: ReadonlySet<Action>, source: InputSource): void {
    for (const a of [...this.from(source)]) if (!actions.has(a)) this.release(a, source);
    for (const a of actions) if (!this.from(source).has(a)) this.press(a, source);
  }

  releaseAll(): void {
    for (const [source, set] of this.bySource) for (const a of [...set]) this.release(a, source);
  }

  isDown(action: Action): boolean {
    for (const set of this.bySource.values()) if (set.has(action)) return true;
    return false;
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

/**
 * Game controllers (Xbox, PlayStation, Switch Pro, Steam Deck…), in the browser's standard layout: d-pad or left
 * stick to move, the bottom face button (A / Cross) to jump, the right one (B / Circle) and the top one (Y /
 * Triangle) to interact, the left one (X / Square) and the right trigger to fire. Select/Back (or the Share/minus
 * button) restarts the level. Read once a frame; every connected controller counts.
 */
export const PAD_BUTTONS: Record<number, Action | 'restart'> = {
  0: 'jump',
  1: 'interact',
  3: 'interact',
  2: 'fire',
  7: 'fire',
  8: 'restart',
  12: 'up',
  13: 'down',
  14: 'left',
  15: 'right',
};
/** How far a stick must be pushed to count (half way). */
const STICK = 0.5;

export interface PadLike {
  connected: boolean;
  buttons: readonly { pressed: boolean; value?: number }[];
  axes: readonly number[];
}

/** What the controllers hold now, and whether restart was just pressed. */
export class GamepadReader {
  private restartHeld = false;

  read(pads: readonly (PadLike | null)[]): { actions: Set<Action>; restart: boolean; connected: number } {
    const actions = new Set<Action>();
    let restartNow = false;
    let connected = 0;
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      connected++;
      pad.buttons.forEach((b, i) => {
        const what = PAD_BUTTONS[i];
        if (!what || !(b.pressed || (b.value ?? 0) > 0.5)) return;
        if (what === 'restart') restartNow = true;
        else actions.add(what);
      });
      const [x = 0, y = 0] = pad.axes;
      if (x <= -STICK) actions.add('left');
      if (x >= STICK) actions.add('right');
      if (y <= -STICK) actions.add('up');
      if (y >= STICK) actions.add('down');
    }
    const restart = restartNow && !this.restartHeld;
    this.restartHeld = restartNow;
    return { actions, restart, connected };
  }
}

/** The browser's controllers (none where there is no Gamepad API). */
export function browserPads(): readonly (PadLike | null)[] {
  try {
    return typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
  } catch {
    return [];
  }
}
