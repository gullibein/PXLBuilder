/**
 * W0 (docs §30): "the same" as a test, for every runtime any test steps. After each step the whole state of play
 * is folded into a fingerprint: every thing in the level's order (where it is, how fast, alive, on the ground, its
 * health, what it carries, each of its scripts' variables, state and timers: every field it has), the camera, the
 * messages, and every event in the order it was raised. A change to the engine that leaves a collision answer, the
 * order of two events or one script variable different in one frame of one test changes that test's fingerprint.
 *
 * Loaded for every test file (vite.config.ts setupFiles). Compared with src/regression/sameAnswers.golden.json:
 * the fingerprints recorded before the change (scripts/same-answers.mjs records them: twice, keeping the tests
 * whose fingerprints came out the same both times; a test that uses unseeded randomness is not compared, and the
 * recorder says how many). SAME_ANSWERS=off turns it off; SAME_ANSWERS_RECORD=<file> records.
 */
import { createHash, type Hash } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect } from 'vitest';
import { Gameplay } from '../runtime/gameplay';
import { Runtime, type RuntimeEntity } from '../runtime/runtime';

const MODE = process.env.SAME_ANSWERS ?? 'on';
const RECORD = process.env.SAME_ANSWERS_RECORD ?? '';
const GOLDEN_FILE = new URL('./sameAnswers.golden.json', import.meta.url);

/** Fields that are not state of play: what a thing is made from (the same every frame), and functions. */
const SKIP = new Set(['base', 'script', 'project', 'registry', 'scene']);
/** Ids are random each time a game is made: named by the order they first appear in. */
const ID = /^(ent|def|scn|ast|rel|rule|scr|trg|tx)_[0-9a-f]{6,}$/;

class Trace {
  readonly hash: Hash = createHash('sha256');
  frames = 0;
  private readonly ids = new Map<string, string>();
  private readonly events: string[] = [];
  private index = new Map<object, number>();

  private idOf(s: string): string {
    let k = this.ids.get(s);
    if (!k) this.ids.set(s, (k = `${s.slice(0, s.indexOf('_'))}#${this.ids.size}`));
    return k;
  }

  /** A value as text: numbers exactly, things by their place in the level, ids by first appearance. */
  private text(v: unknown, depth: number): string {
    if (v === null || v === undefined) return 'n';
    const t = typeof v;
    if (t === 'number') return Object.is(v, -0) ? '-0' : String(v);
    if (t === 'boolean') return v ? 'T' : 'F';
    if (t === 'string') return ID.test(v as string) ? this.idOf(v as string) : `"${v as string}"`;
    if (t !== 'object') return '';
    const at = this.index.get(v as object);
    if (at !== undefined) return `#${at}`;
    if (depth <= 0) return '…';
    let out = '';
    if (Array.isArray(v)) {
      for (const x of v) out += `${this.text(x, depth - 1)},`;
      return `[${out}]`;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) out += `${this.text(k, depth - 1)}>${this.text(x, depth - 1)},`;
      return `M(${out})`;
    }
    if (v instanceof Set) {
      for (const x of v) out += `${this.text(x, depth - 1)},`;
      return `S(${out})`;
    }
    if (ArrayBuffer.isView(v)) return `A(${Array.from(v as unknown as ArrayLike<number>).join(',')})`;
    for (const k in v as object) {
      if (SKIP.has(k)) continue;
      const x = (v as Record<string, unknown>)[k];
      if (typeof x === 'function') continue;
      out += `${k}:${this.text(x, depth - 1)};`;
    }
    return `{${out}}`;
  }

  event(type: string, subject: RuntimeEntity | null, other: RuntimeEntity | null, detail: unknown): void {
    this.events.push(`${type}(${subject ? (this.index.get(subject) ?? subject.name) : ''},${other ? (this.index.get(other) ?? other.name) : ''},${this.text(detail, 3)})`);
  }

  /**
   * Every step: every thing that does something (it moves, has a body that can, is steered, runs scripts) in full,
   * and every event. Every eighth step, and the first: every thing in the level in full (a wall that changed, a
   * door that opened, shows there at the latest, and its event the step it happened).
   */
  frame(rt: Runtime): void {
    if (this.index.size !== rt.entities.length || this.listed !== rt.entities) {
      this.index = new Map(rt.entities.map((e, i) => [e as object, i]));
      this.listed = rt.entities;
    }
    this.frames++;
    const h = this.hash;
    const whole = this.frames % 8 === 1;
    let out = `F${this.frames}|${this.events.join('|')}\n`;
    this.events.length = 0;
    for (let i = 0; i < rt.entities.length; i++) {
      const e = rt.entities[i];
      if (!whole && e.body !== 'dynamic' && e.body !== 'kinematic' && !e.controller && !e.scripts.length && e.vx === 0 && e.vy === 0) continue;
      out += `${i}${this.thing(e)}\n`;
    }
    // (The camera as it is, not its frame(): a shaking camera's frame draws random numbers, and asking would change the game.)
    const cam = rt.cam.camera;
    h.update(`${out}${cam.x},${cam.y},${cam.zoom},${rt.messages.join('~')},${rt.entities.length}`);
  }

  private listed: readonly RuntimeEntity[] | null = null;

  private thing(e: RuntimeEntity): string {
    let out = '';
    for (const k in e) {
      if (k === 'id' || SKIP.has(k)) continue;
      const x = (e as unknown as Record<string, unknown>)[k];
      if (typeof x === 'function') continue;
      out += `${k}:${this.text(x, 4)};`;
    }
    return out;
  }
}

let tracing = true;
let realRandom: (() => number) | null = null;
const traces = new Map<Runtime, Trace>();
let order: Trace[] = [];
const byGameplay = new WeakMap<object, Runtime>();
const traceOf = (rt: Runtime): Trace => {
  let t = traces.get(rt);
  if (!t) {
    traces.set(rt, (t = new Trace()));
    order.push(t);
    byGameplay.set(rt.gameplay as object, rt);
  }
  return t;
};

if (MODE !== 'off') {
  const proto = Runtime.prototype as unknown as { step: (dt: number, input: unknown) => void; __same?: boolean };
  if (!proto.__same) {
    proto.__same = true;
    const step = proto.step;
    proto.step = function (this: Runtime, dt: number, input: unknown): void {
      if (!tracing) return step.call(this, dt, input);
      const t = traceOf(this);
      step.call(this, dt, input);
      t.frame(this);
    };
    const gp = Gameplay.prototype as unknown as { emit: (type: string, subject: RuntimeEntity | null, other?: RuntimeEntity | null, detail?: Record<string, unknown>) => void };
    const emit = gp.emit;
    gp.emit = function (this: Gameplay, type, subject, other = null, detail) {
      const rt = byGameplay.get(this as object);
      if (rt) traces.get(rt)?.event(type, subject, other, detail);
      return emit.call(this, type, subject, other, detail);
    };
  }

  const golden: Record<string, string> | null = !RECORD && existsSync(GOLDEN_FILE) ? (JSON.parse(readFileSync(GOLDEN_FILE, 'utf8')) as Record<string, string>) : null;
  const nameOf = (task: { name: string; suite?: { name: string; suite?: unknown } | null; file?: { name: string } }): string => {
    const parts = [task.name];
    for (let s = task.suite as { name: string; suite?: unknown } | null | undefined; s && s.name; s = s.suite as typeof s) parts.unshift(s.name);
    return `${task.file?.name ?? ''} > ${parts.join(' > ')}`;
  };

  beforeEach((ctx) => {
    traces.clear();
    order = [];
    // Chance is the same every time a test runs (its own, from its name), so a game with something random in it
    // (a wandering enemy, a dungeon, a critical hit) plays the same and can be compared. (A test that seeds its own
    // puts its own in place while it runs.)
    realRandom = Math.random;
    let seed = 2166136261;
    for (const ch of nameOf(ctx.task as never)) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
    Math.random = () => {
      seed = (seed + 0x6d2b79f5) >>> 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // (The play probe stops itself after so many seconds of real time: its tests measure that, and fingerprinting
    // every step would spend the time they count. Its games are played by other tests too.)
    tracing = !/playProbe\.test/.test(ctx.task.file?.name ?? '');
  });

  afterEach((ctx) => {
    if (realRandom) Math.random = realRandom;
    realRandom = null;
    const stepped = order.filter((t) => t.frames > 0);
    if (!stepped.length) return;
    const all = createHash('sha256');
    for (const t of stepped) all.update(`${t.frames}:${t.hash.digest('hex')}\n`);
    const print = `${stepped.length} games, ${stepped.reduce((n, t) => n + t.frames, 0)} steps: ${all.digest('hex').slice(0, 20)}`;
    const key = nameOf(ctx.task as never);
    traces.clear();
    order = [];
    if (RECORD) appendFileSync(RECORD, `${JSON.stringify([key, print])}\n`);
    else if (golden && key in golden && ctx.task.result?.state !== 'fail') expect(print, `${key}: play is not what it was (every thing's state and every event, each step)`).toBe(golden[key]);
  });
}
