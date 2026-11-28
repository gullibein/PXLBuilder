/**
 * A game being played by a script, on the real runtime (the same session the play screen runs: levels, progression,
 * restarts). The script drives it only through what a player has (the keys, time) and what the engine itself knows
 * (its menu, its grid cursor, which thing a movement model steers); it reads only what can be observed: where things
 * are, what appeared or went, what is written on the screen, whether the level was won. Never a name, a tag or a
 * variable the model chose: those differ from build to build, and a check that goes by them judges the naming.
 */
import type { ComponentRegistry } from '../core/components/registry';
import type { Id, Project } from '../core/types';
import { InputState, type Action } from '../runtime/input';
import type { Runtime, RuntimeEntity } from '../runtime/runtime';
import { GameSession } from '../runtime/session';

export const FPS = 60;

/** A line of text a player can read now, and where on the screen it is. */
export interface Shown {
  text: string;
  x: number;
  y: number;
  from: 'drawing' | 'message' | 'banner';
}

export interface Box {
  x: number;
  y: number;
  hw: number;
  hh: number;
}

/** What a thing collides with, in the level (null: nothing). */
export const solidBoxOf = (e: RuntimeEntity): Box | null => (e.collider ? { x: e.x + e.collider.ox, y: e.y + e.collider.oy, hw: e.collider.hw, hh: e.collider.hh } : null);

function mulberry(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Played {
  readonly session: GameSession;
  readonly input = new InputState();
  /** Runtime faults heard while playing (script errors, the engine stopping). */
  readonly errors: string[] = [];
  /** How long each frame took here, in milliseconds (for "Size and load"). */
  readonly frameMs: number[] = [];
  frames = 0;
  stopped = false;
  private held = new Set<Action>();

  constructor(
    readonly project: Project,
    readonly registry: ComponentRegistry,
    sceneId: Id = project.startSceneId,
  ) {
    const hear = (rt: Runtime) => {
      for (const ev of rt.eventLog) this.note(ev);
      rt.onLog = (ev) => this.note(ev);
    };
    this.session = new GameSession(project, sceneId, registry, { enter: (_scene, rt) => hear(rt) });
    hear(this.session.runtime);
  }

  private note(ev: { type: string; subject?: string | null; detail?: Record<string, unknown> }): void {
    if (ev.type !== 'script_error') return;
    const text = `${ev.subject ?? 'the game'}${ev.detail?.script ? ` (${String(ev.detail.script)})` : ''}: ${String(ev.detail?.message ?? 'a problem')}`;
    if (!this.errors.includes(text)) this.errors.push(text);
  }

  get rt(): Runtime {
    return this.session.runtime;
  }
  get seconds(): number {
    return this.frames / FPS;
  }
  get level(): string {
    return this.session.scene.name;
  }
  get won(): boolean {
    return this.rt.completed !== null || this.session.finished;
  }

  /** One frame. */
  step(): void {
    if (this.stopped) return;
    this.input.holdOnly(this.held, 'keys');
    const t0 = performance.now();
    try {
      this.session.step(1 / FPS, this.input);
    } catch (err) {
      this.errors.push(`the engine stopped after ${this.seconds.toFixed(1)} s: ${err instanceof Error ? err.message : String(err)}`);
      this.stopped = true;
    }
    this.frameMs.push(performance.now() - t0);
    this.frames++;
  }

  wait(seconds: number): void {
    for (let n = Math.max(1, Math.round(seconds * FPS)); n > 0 && !this.stopped; n--) this.step();
  }

  /** Holds exactly these keys from now on. */
  hold(...actions: Action[]): void {
    this.held = new Set(actions);
  }

  /** A key pressed and let go (held for `seconds`), then a moment for the game to answer. */
  tap(action: Action, seconds = 0.05, after = 0.1): void {
    const before = this.held;
    this.held = new Set([...before, action]);
    this.wait(seconds);
    this.held = before;
    this.wait(after);
  }

  /** Plays on until `seen` holds (true), for at most `seconds` (false). */
  until(seen: () => boolean, seconds: number): boolean {
    for (let n = Math.round(seconds * FPS); n > 0 && !this.stopped; n--) {
      if (seen()) return true;
      this.step();
    }
    return seen();
  }

  /** Every thing in the level now. */
  things(): RuntimeEntity[] {
    return this.rt.entities.filter((e) => e.alive);
  }

  /** The things a movement model steers with the keys (the engine's own knowledge of who the player is). */
  steered(): RuntimeEntity[] {
    return this.things().filter((e) => e.controller);
  }

  /** Everything written on the screen now: what scripts and the engine's menu draw, messages, the level banner. */
  shown(): Shown[] {
    const out: Shown[] = [];
    for (const d of this.rt.drawings.values()) if (d.shape === 'text' && d.text.trim() && d.alpha > 0) out.push({ text: d.text, x: d.x, y: d.y, from: 'drawing' });
    for (const m of this.rt.messages) if (m.trim()) out.push({ text: m, x: 0, y: 0, from: 'message' });
    if (this.session.banner) out.push({ text: this.session.banner, x: 0, y: 0, from: 'banner' });
    return out;
  }

  texts(): string[] {
    return this.shown().map((s) => s.text);
  }

  /** All of it as one text (to look for a word in). */
  screen(): string {
    return this.texts().join('\n');
  }

  /** The numbers written on the screen, in the order drawn (a score, a count of cards, lives). */
  numbers(): number[] {
    return [...this.screen().matchAll(/-?\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  }

  /** The engine's menu, when one is open. */
  menu(): { title: string; items: string[]; index: number } | null {
    const m = this.rt.kit.menu;
    return m ? { title: m.title, items: [...m.items], index: m.index } : null;
  }

  /** Chooses the menu item whose text matches (moving to it with the keys). False: no menu, or no such item. */
  pick(item: RegExp): boolean {
    const m = this.menu();
    const want = m ? m.items.findIndex((t) => item.test(t) && !t.startsWith('-')) : -1;
    if (!m || want < 0) return false;
    for (let n = 0; n < m.items.length * 2 && this.rt.kit.menu && this.rt.kit.menu.index !== want; n++) this.tap('down', 0.03, 0.03);
    if (this.rt.kit.menu?.index !== want) return false;
    this.tap('jump', 0.03, 0.2);
    return true;
  }

  /** The engine's grid cursor: the cell it is on (null: no cursor shown). */
  cursor(): { i: number; j: number } | null {
    const c = this.rt.kit.cursor;
    return c ? { i: c.i, j: c.j } : null;
  }

  /** Moves the grid cursor to a cell with the arrow keys, a press a square. False: no cursor, or it did not get there. */
  cursorTo(i: number, j: number): boolean {
    for (let n = 0; n < 200; n++) {
      const c = this.cursor();
      if (!c) return false;
      if (c.i === i && c.j === j) return true;
      this.tap(c.i < i ? 'right' : c.i > i ? 'left' : c.j < j ? 'down' : 'up', 0.03, 0.03);
    }
    return false;
  }

  /** The middle frame time and the worst, in milliseconds (the first frames, when the level is set up, left out). */
  frameTimes(): { middle: number; worst: number } | null {
    const ms = this.frameMs.slice(Math.min(30, this.frameMs.length >> 1)).sort((a, b) => a - b);
    return ms.length ? { middle: ms[ms.length >> 1], worst: ms[ms.length - 1] } : null;
  }
}

/** Plays a game with a script; chance is seeded for the whole of it, so the same seed plays the same game. */
export function play<T>(project: Project, registry: ComponentRegistry, seed: number, script: (g: Played) => T, sceneId?: Id): T {
  const real = Math.random;
  Math.random = mulberry(seed);
  try {
    return script(new Played(project, registry, sceneId));
  } finally {
    Math.random = real;
  }
}
