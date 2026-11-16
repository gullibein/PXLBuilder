/**
 * The cross-genre regression suite's tools (docs/engine-architecture-proposal.md §15): seeded randomness, playing a
 * game with inputs on the real runtime, and a trace of what moved (and the game's key numbers) whose fingerprint is
 * golden: a refactor must leave it identical.
 */
import { createHash } from 'node:crypto';
import { InputState, type Action } from '../runtime/input';
import { Runtime, type RuntimeEntity } from '../runtime/runtime';

/** Math.random seeded for the duration of `run` (the runtime's random parts, scripts' rand()). */
export function withSeed<T>(seed: number, run: () => T): T {
  const real = Math.random;
  let s = seed >>> 0 || 1;
  Math.random = () => {
    // (mulberry32)
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  try {
    return run();
  } finally {
    Math.random = real;
  }
}

/** A step of input: from `at` seconds, these actions held (until the next step). */
export interface InputStep {
  at: number;
  hold: Action[];
}

export const DT = 1 / 60;

/** Plays `seconds` of the runtime with the input steps, calling `onFrame` each frame; returns the trace. */
export class Player {
  readonly input = new InputState();
  private held = new Set<Action>();
  private frames = 0;
  private readonly samples: string[] = [];

  constructor(readonly rt: Runtime) {}

  get time(): number {
    return this.frames * DT;
  }

  /** Holds exactly these actions (presses the new ones, lets go of the others). */
  hold(actions: Action[]): void {
    for (const a of [...this.held]) if (!actions.includes(a)) {
      this.input.release(a);
      this.held.delete(a);
    }
    for (const a of actions) if (!this.held.has(a)) {
      this.input.press(a);
      this.held.add(a);
    }
  }

  /** Runs for `seconds` with the steps (times relative to now); samples the trace every `every` frames. */
  play(seconds: number, steps: InputStep[] = [], sample?: (rt: Runtime) => unknown, every = 6): void {
    const start = this.frames;
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) {
      const t = (this.frames - start) * DT;
      const step = [...steps].reverse().find((s) => s.at <= t + 1e-9);
      if (step) this.hold(step.hold);
      this.rt.update(DT, this.input);
      this.frames++;
      if (sample && this.frames % every === 0) this.samples.push(JSON.stringify(sample(this.rt)));
    }
  }

  /** Taps an action (pressed for one frame, then let go for one). */
  tap(action: Action, sample?: (rt: Runtime) => unknown): void {
    this.hold([...this.held, action]);
    this.play(DT, [], sample, 1);
    this.hold([...this.held].filter((a) => a !== action));
    this.play(DT, [], sample, 1);
  }

  /** The trace so far, as a fingerprint. */
  fingerprint(): string {
    return createHash('sha256').update(this.samples.join('\n')).digest('hex').slice(0, 16);
  }

  get sampleCount(): number {
    return this.samples.length;
  }
}

/** Rounded position and speed of an entity (for traces). */
export const body = (e: RuntimeEntity | undefined) => (e ? [Math.round(e.x * 10) / 10, Math.round(e.y * 10) / 10, Math.round(e.vx), Math.round(e.vy), e.grounded ? 1 : 0] : null);

/** Living entities with a tag, as sorted cells (col,row) of 32-px squares. */
export const cellsOf = (rt: Runtime, tag: string) =>
  rt.entities
    .filter((e) => e.alive && e.tags.includes(tag))
    .map((e) => `${Math.round((e.x - 16) / 32)},${Math.round((e.y - 16) / 32)}`)
    .sort();

/** A script variable of an entity. */
export const varOf = (e: RuntimeEntity | undefined, name: string): unknown => e?.scripts.find((s) => s.vars.has(name))?.vars.get(name);
