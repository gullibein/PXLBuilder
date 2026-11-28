/**
 * What a play script can see of a game, and the one tool that tells cause from coincidence: the same game played
 * twice from the same seed, once with a key pressed and once without. What differs between the two was caused by
 * the key. Nothing here goes by a name the model chose.
 */
import type { ComponentRegistry } from '../core/components/registry';
import type { Id, Project } from '../core/types';
import type { RuntimeEntity } from '../runtime/runtime';
import { play, solidBoxOf, type Box, type Played } from './played';

export interface PlayCtx {
  project: Project;
  registry: ComponentRegistry;
  seed: number;
  /** The level Play starts (the project's own start level, unless a check plays another). */
  sceneId?: Id;
}

/** A thing as seen at one moment. `key`: the same thing in a twin run (its object and its place in line). */
export interface SeenThing {
  key: string;
  e: RuntimeEntity;
  def: Id | null;
  name: string;
  x: number;
  y: number;
  angle: number;
  box: Box | null;
  steered: boolean;
  /** It never moves by itself: a wall, a floor, a tile. */
  fixed: boolean;
}

export interface Sight {
  things: Map<string, SeenThing>;
  texts: string[];
  numbers: number[];
  won: boolean;
  level: string;
  menu: string[] | null;
}

export function sight(g: Played): Sight {
  const things = new Map<string, SeenThing>();
  const nth = new Map<string, number>();
  for (const e of g.things()) {
    const kind = e.definitionId ?? e.name;
    const n = nth.get(kind) ?? 0;
    nth.set(kind, n + 1);
    const key = `${kind}#${n}`;
    things.set(key, { key, e, def: e.definitionId, name: e.name, x: e.x, y: e.y, angle: e.angle ?? 0, box: solidBoxOf(e), steered: !!e.controller, fixed: e.body === 'static' && !e.scripts.length && !e.beh.mover });
  }
  return { things, texts: g.texts(), numbers: g.numbers(), won: g.won, level: g.level, menu: g.menu()?.items ?? null };
}

export interface Difference {
  /** The same thing in another place (by more than a pixel), or turned. */
  moved: { a: SeenThing; b: SeenThing; dx: number; dy: number; turned: number }[];
  /** In `b` and not in `a`. */
  more: SeenThing[];
  /** In `a` and not in `b`. */
  fewer: SeenThing[];
  texts: boolean;
}

/** How sight `b` differs from sight `a`. */
export function difference(a: Sight, b: Sight): Difference {
  const out: Difference = { moved: [], more: [], fewer: [], texts: a.texts.join('\n') !== b.texts.join('\n') };
  for (const [key, tb] of b.things) {
    const ta = a.things.get(key);
    if (!ta) out.more.push(tb);
    else if (Math.abs(ta.x - tb.x) > 1 || Math.abs(ta.y - tb.y) > 1 || Math.abs(ta.angle - tb.angle) > 1) out.moved.push({ a: ta, b: tb, dx: tb.x - ta.x, dy: tb.y - ta.y, turned: tb.angle - ta.angle });
  }
  for (const [key, ta] of a.things) if (!b.things.has(key)) out.fewer.push(ta);
  return out;
}

/** Plays the game with a script (chance seeded: the same every time). */
export const run = <T>(ctx: PlayCtx, script: (g: Played) => T): T => play(ctx.project, ctx.registry, ctx.seed, script, ctx.sceneId);

/**
 * The same game twice: `lead` both times, then `act` in one and nothing in the other for as long as the act took,
 * then `after` seconds in both. `caused`: how the run with the act differs from the run without at the end.
 */
export function twin(ctx: PlayCtx, lead: (g: Played) => void, act: (g: Played) => void, after = 0.5): { acted: Sight; idle: Sight; before: Sight; caused: Difference; errors: string[] } {
  let frames = 0;
  let before!: Sight;
  const errors: string[] = [];
  const acted = run(ctx, (g) => {
    lead(g);
    before = sight(g);
    const from = g.frames;
    act(g);
    frames = g.frames - from;
    g.wait(after);
    errors.push(...g.errors);
    return sight(g);
  });
  const idle = run(ctx, (g) => {
    lead(g);
    for (let n = frames; n > 0; n--) g.step();
    g.wait(after);
    return sight(g);
  });
  return { acted, idle, before, caused: difference(idle, acted), errors };
}

/**
 * Gets past what a game shows before it begins: the engine's menu (its first item is chosen), a pause of its own
 * (the start keys are tried). A game that begins at once is left alone.
 */
export function begin(g: Played): void {
  g.wait(0.4);
  for (let n = 0; n < 3; n++) {
    if (g.menu()) g.tap('jump', 0.05, 0.3);
    else if (g.rt.paused) {
      g.tap('jump', 0.05, 0.2);
      if (g.rt.paused) g.tap('interact', 0.05, 0.2);
    } else break;
  }
}

/** The cells a level covers, by the things placed in it (32 px a cell), and how many screens that is (30 by 17 cells). */
export function levelSize(project: Project, sceneId: Id): { cols: number; rows: number; screens: number; things: number } {
  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
  let [l, r, t, b] = [Infinity, -Infinity, Infinity, -Infinity];
  for (const e of scene.entities) {
    const { x, y } = e.transform.position;
    if (x < l) l = x;
    if (x > r) r = x;
    if (y < t) t = y;
    if (y > b) b = y;
  }
  if (!scene.entities.length) return { cols: 0, rows: 0, screens: 0, things: 0 };
  const cols = Math.round((r - l) / 32) + 1;
  const rows = Math.round((b - t) / 32) + 1;
  return { cols, rows, screens: Math.round(((cols * rows) / (30 * 17)) * 10) / 10, things: scene.entities.length };
}
