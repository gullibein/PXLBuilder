/**
 * The play probe (docs/engine-architecture-proposal.md §24.5): plays a level on the real runtime for a bounded time,
 * first with no key pressed, then with each key something in the level listens to, then with keys at random, and
 * reports what it saw (core/debug/probeReport.ts). It knows no kind of game: what ought to answer a key, and whether
 * things ought to act by themselves, come from what is in the level as it runs (its characters' movement models and
 * abilities, its Shooters and switches, its scripts' key handlers, its patrols and moving platforms, its turns).
 *
 * How a key's effect is told: the same level is played twice from the same seed, once with the key and once
 * without, and the two are compared moment by moment. They only differ if the key did something.
 *
 * Bounded and repeatable: a budget in seconds of the game's own time, a seed for everything random in the level.
 */
import type { ComponentRegistry } from '../core/components/registry';
import type { ProbeAction, ProbeError, ProbeListener, ProbeReport, ProbeSuspect } from '../core/debug/probeReport';
import { partLevels } from '../core/generation/playGenerators';
import type { Id, Project } from '../core/types';
import { InputState, type Action } from './input';
import { abilityKeys, locomotionFor } from './movement';
import type { Runtime, RuntimeEntity } from './runtime';
import { ownPart, type LoggedEvent } from './gameplay';
import { GameSession } from './session';

export interface ProbeOptions {
  /** Everything random in the level follows it (default 1). */
  seed?: number;
  /** Seconds of play in all, in the game's own time (default 90): what doesn't fit is said to be unjudged. */
  budget?: number;
  /** A stop for a level too slow to play (ms of real time, default 6000); 0: none. Reported when it stops a probe. */
  maxMs?: number;
}

const FPS = 60;
/** Frames between two looks at the level. */
const LOOK = 6;
const BASELINE = 6;
const AGAIN = 2;
const KEYED = 4;
const MASH = 8;
/** By itself: what the level does after this long (falling to the ground at the start is not acting). */
const SETTLE = 1;
/** A death or a start over this soon in every run, whatever is pressed: the player has no time to act. */
const AT_ONCE = 2;
const WON_AT_ONCE = 1;
/** This many more things than at the start, in a few seconds: they are made and never go. */
const TOO_MANY = 500;
/** A Shooter slower than this may rightly not fire in the time a key is tried. */
const SLOW_SHOOTER = 2;

const ORDER: ProbeAction[] = ['left', 'right', 'up', 'down', 'jump', 'fire', 'interact', 'special', 'menu'];

// ---------------------------------------------------------------------------------------------- what is there

interface Look {
  visible: Map<string, string>;
  hidden: Map<string, string>;
}

const r0 = (n: number) => Math.round(n);

function show(v: unknown): string {
  if (v && typeof v === 'object') return `<${(v as RuntimeEntity).name ?? '?'}>`;
  return typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
}

/** The level as a player could see and hear it now (`visible`), and its variables (`hidden`). Things by name: ids of things made in play differ from run to run. */
function look(session: GameSession): Look {
  const rt = session.runtime;
  const visible = new Map<string, string>();
  const hidden = new Map<string, string>();
  const at = new Map<string, string[]>();
  const how = new Map<string, string[]>();
  const vars = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const had = m.get(k);
    if (had) had.push(v);
    else m.set(k, [v]);
  };
  for (const e of rt.entities) {
    if (!e.alive) continue;
    push(at, e.name, `${r0(e.x)},${r0(e.y)}`);
    push(how, e.name, `${e.facing},${r0(e.angle)},${e.open ? 1 : 0},${e.switch?.on ? 1 : 0},${e.health?.current ?? ''},${e.alpha ?? ''},${e.hiddenBySwitch ? 1 : 0},${e.inventory ? [...e.inventory].map(([k, n]) => `${k}${n}`).join('+') : ''}`);
    if (e.scripts.length) push(vars, e.name, e.scripts.map((s) => `${s.state}:${[...s.vars].map(([k, v]) => `${k}=${show(v)}`).join(',')}`).join('|'));
  }
  for (const [name, list] of at) visible.set(`at:${name}`, list.sort().join(';'));
  for (const [name, list] of how) visible.set(`how:${name}`, list.sort().join(';'));
  for (const [name, list] of vars) hidden.set(`vars:${name}`, list.sort().join(';'));
  visible.set('level', session.scene.name);
  visible.set('screen', [...rt.drawings].map(([k, d]) => `${k}:${d.shape},${r0(d.x)},${r0(d.y)},${r0(d.w)},${r0(d.h)},${d.text},${d.color},${d.alpha}`).join(';'));
  visible.set('messages', rt.messages.join('|'));
  visible.set('sounds', String(rt.soundsPlayed));
  visible.set('won', rt.completed !== null ? '1' : '');
  visible.set('paused', rt.paused ? '1' : '');
  visible.set('menu', rt.kit.menu ? `${rt.kit.menu.title}|${rt.kit.menu.items.join(',')}|${rt.kit.menu.index}` : '');
  visible.set('cursor', JSON.stringify(rt.kit.cursorAt() ?? ''));
  visible.set('finished', session.finished ? '1' : '');
  hidden.set('game', [...rt.game].map(([k, v]) => `${k}=${show(v)}`).sort().join(','));
  // (Nothing drains the sounds here, as the play screen does.)
  rt.soundQueue.length = 0;
  return { visible, hidden };
}

const WORDS: Record<string, string> = {
  level: 'the game went to another level',
  screen: 'what is drawn on the screen changed',
  messages: 'a message showed',
  sounds: 'a sound played',
  won: 'the level was won',
  paused: 'the game paused',
  menu: 'the menu changed',
  cursor: 'the cursor moved',
  finished: 'the game was finished',
};

const count = (s: string | undefined) => (s ? s.split(';').length : 0);

/** How `b` differs from `a`: what a player could notice (what it is about, and in words; things first), and whether variables differ. */
function differ(a: Look, b: Look): { visible: { about: string; text: string }[]; hidden: boolean } {
  const out: { about: string; text: string }[] = [];
  const things: { about: string; text: string }[] = [];
  const names = new Set<string>();
  for (const k of new Set([...a.visible.keys(), ...b.visible.keys()])) {
    const va = a.visible.get(k);
    const vb = b.visible.get(k);
    if (va === vb) continue;
    if (k.startsWith('at:') || k.startsWith('how:')) names.add(k.slice(k.indexOf(':') + 1));
    else out.push({ about: k, text: WORDS[k] ?? `${k} changed` });
  }
  for (const name of names) {
    const na = count(a.visible.get(`at:${name}`));
    const nb = count(b.visible.get(`at:${name}`));
    const text =
      nb > na ? (nb - na === 1 ? `a ${name} appeared` : `${nb - na} more ${name} appeared`) : nb < na ? (na - nb === 1 ? `a ${name} was gone` : `${na - nb} ${name} were gone`) : a.visible.get(`at:${name}`) !== b.visible.get(`at:${name}`) ? `${name} moved` : `${name} changed (turned, opened, hurt or the like)`;
    things.push({ about: name, text });
  }
  let hidden = false;
  for (const k of new Set([...a.hidden.keys(), ...b.hidden.keys()])) if (a.hidden.get(k) !== b.hidden.get(k)) hidden = true;
  return { visible: [...things, ...out], hidden };
}

// ---------------------------------------------------------------------------------------------- who listens

const KEY_CALL = /\b(?:key|pressed|released)\(\s*\\?["'](\w+)\\?["']\s*\)/g;

/** What in the level reads which key, as it runs (things placed, generated or made in play alike). */
class Listeners {
  readonly by = new Map<ProbeAction, ProbeListener[]>();
  /** Each character steered by a movement model, with the keys that move it. */
  readonly movers = new Map<string, ProbeAction[]>();
  readonly undeclared = new Set<string>();
  /** Scripts that act by time (every so often, or every step), as "X's script "Y"". */
  readonly timed = new Set<string>();
  private readonly scanned = new WeakSet<object>();

  private add(action: string, l: ProbeListener): void {
    if (!ORDER.includes(action as ProbeAction)) return;
    const list = this.by.get(action as ProbeAction) ?? [];
    if (!this.by.has(action as ProbeAction)) this.by.set(action as ProbeAction, list);
    const had = list.find((x) => x.who === l.who && x.how === l.how);
    if (!had) list.push(l);
    else if (l.when === 'always') had.when = 'always';
  }

  scan(rt: Runtime): void {
    for (const e of rt.entities) {
      if (!e.alive || this.scanned.has(e)) continue;
      this.scanned.add(e);
      if (e.controller) {
        const model = locomotionFor(e.controller.movement);
        if (model?.keys) {
          for (const a of model.keys.move) this.add(a, { who: e.name, how: 'moves with it', when: 'always', engine: true });
          for (const a of model.keys.sometimes) this.add(a, { who: e.name, how: 'uses it only in some places, as on a ladder or in water', when: 'sometimes', engine: true });
          this.movers.set(e.name, model.keys.move as ProbeAction[]);
        } else if (model) this.undeclared.add(`${e.name}'s movement ("${model.id}") doesn't say which keys it reads`);
        for (const k of abilityKeys(e)) this.add(k.action, { who: e.name, how: `${k.does} with it`, when: 'sometimes', engine: true });
      }
      const shooter = e.beh.shooter;
      if (shooter?.trigger === 'key' && !ownPart(e, 'shooting')) {
        this.add('fire', { who: e.name, how: 'shoots with it', when: shooter.interval > SLOW_SHOOTER ? 'sometimes' : 'always', engine: true });
        if (rt.fireHeld(e, { isDown: (a) => a === 'jump', wasPressed: () => false, wasReleased: () => false })) this.add('jump', { who: e.name, how: 'shoots with it too', when: 'sometimes', engine: true });
      }
      if (e.switch?.activation === 'interact') this.add('interact', { who: e.name, how: 'is used with it (from beside it)', when: 'sometimes', engine: true });
      for (const inst of e.scripts) {
        const script = inst.script;
        for (const h of script.handlers) if (h.when.on === 'key') this.add(h.when.key, { who: e.name, how: `listens to it in its script "${script.name}"`, when: h.if || h.state ? 'sometimes' : 'always', engine: false });
        if (script.enabled && script.handlers.some((h) => h.when.on === 'every' || h.when.on === 'tick')) this.timed.add(`${e.name}'s script "${script.name}"`);
        const text = JSON.stringify(script.handlers);
        for (const m of text.matchAll(KEY_CALL)) this.add(m[1], { who: e.name, how: `reads it in its script "${script.name}"`, when: 'sometimes', engine: false });
        // (A menu or a grid cursor of its own: the arrows pick, Space, X or E choose, Esc goes back.)
        if (/"do":"(menu|cursor)"/.test(text)) {
          for (const a of ['up', 'down', 'left', 'right', 'jump', 'interact', 'fire', 'menu'] as const) this.add(a, { who: e.name, how: `uses it in the menu or grid cursor of its script "${script.name}"`, when: 'sometimes', engine: false });
        }
      }
    }
  }
}

/** Things set to act by themselves whatever the player does: a patrol, a path, wandering, hopping. */
function actsAlone(e: RuntimeEntity): string | null {
  const b = e.beh;
  if (b.mover && b.mover.path.length > 1 && b.mover.speed > 0) return 'moves along its path';
  if (b.patrol && b.patrol.speed > 0) return 'patrols';
  if (b.wander && b.wander.speed > 0) return 'wanders';
  if (b.jumper) return 'hops';
  return null;
}

// ---------------------------------------------------------------------------------------------- one run

interface Press {
  action: ProbeAction;
  from: number;
  to: number;
}

interface Plan {
  seconds: number;
  presses: Press[];
  /** Keys at random (their own seed, apart from the level's). */
  mash?: ProbeAction[];
  /** In words, for errors: the keys pressed. */
  pressing: string | null;
  /** The run with no key pressed: who listens and who acts alone are read from it. */
  baseline?: { listeners: Listeners };
}

interface Ran {
  looks: Look[];
  errors: ProbeError[];
  suspicious: ProbeSuspect[];
  /** The first death or respawn of a character the player steers, or the level starting over: when, and what. */
  setback: { t: number; what: string } | null;
  won: number | null;
  left: { t: number; to: string } | null;
  played: number;
  /** Stopped before its time: why. */
  stopped: string | null;
  turns: boolean;
  /** The game was paused at every look (a title to start from, a menu of its own). */
  paused: boolean;
  /** (Baseline.) Things set to act alone: name, what they do, whether they moved. */
  actors: { name: string; does: string; moved: boolean }[];
}

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

/** The key's presses in a run: a tap, a hold, a tap (from `start` seconds in). */
const pattern = (action: ProbeAction, start = 0.5): Press[] => [
  { action, from: start, to: start + 0.05 },
  { action, from: start + 0.7, to: start + 1.7 },
  { action, from: start + 2.5, to: start + 2.55 },
];

function run(project: Project, sceneId: Id, registry: ComponentRegistry, seed: number, plan: Plan, deadline: number): Ran {
  const out: Ran = { looks: [], errors: [], suspicious: [], setback: null, won: null, left: null, played: 0, stopped: null, turns: false, paused: true, actors: [] };
  const real = Math.random;
  Math.random = mulberry(seed);
  const keys = mulberry(seed ^ 0x51f15e);
  try {
    let frame = 0;
    const now = () => frame / FPS;
    const fail = (where: string, message: string) => {
      if (!out.errors.some((e) => e.where === where && e.message === message)) out.errors.push({ where, message, pressing: plan.pressing });
    };
    let session!: GameSession;
    const note = (ev: LoggedEvent, startedOver: boolean) => {
      if (ev.type === 'script_error') fail(`${ev.subject ?? 'the game'}${ev.detail?.script ? ` (${String(ev.detail.script)})` : ''}`, String(ev.detail?.message ?? 'a problem'));
      else if (out.setback) return;
      else if ((ev.type === 'died' || ev.type === 'respawned') && ev.subjectId && session?.runtime.byId(ev.subjectId)?.controller) out.setback = { t: now(), what: ev.type === 'died' ? `${ev.subject} died` : `${ev.subject} was put back at its start` };
      else if (startedOver) out.setback = { t: now(), what: 'the level started over' };
    };
    // (A level says "level_started" once when it begins, in its first step: only a second one is a start over.)
    const watch = (rt: Runtime) => {
      let begun = false;
      const hear = (ev: LoggedEvent) => {
        const again = ev.type === 'level_started' && begun;
        if (ev.type === 'level_started') begun = true;
        note(ev, again);
      };
      for (const ev of rt.eventLog) hear(ev);
      rt.onLog = hear;
    };
    try {
      session = new GameSession(project, sceneId, registry, { enter: (_scene, rt) => watch(rt) });
    } catch (err) {
      fail('the engine', `the level couldn't be started: ${err instanceof Error ? err.message : String(err)}`);
      return out;
    }
    watch(session.runtime);
    const first = session.scene.name;
    const startCount = session.runtime.entities.length;
    const input = new InputState();
    const held = new Set<Action>();
    const alone = new Map<RuntimeEntity, { x: number; y: number; does: string; moved: boolean }>();
    if (plan.baseline) {
      plan.baseline.listeners.scan(session.runtime);
      for (const e of session.runtime.entities) {
        const does = e.alive ? actsAlone(e) : null;
        if (does) alone.set(e, { x: e.x, y: e.y, does, moved: false });
      }
    }
    const frames = Math.round(plan.seconds * FPS);
    for (; frame < frames; frame++) {
      const t = now();
      if (plan.mash) {
        if (frame % 12 === 0) {
          held.clear();
          const n = keys() < 0.25 ? 0 : keys() < 0.6 ? 1 : 2;
          for (let i = 0; i < n && plan.mash.length; i++) held.add(plan.mash[Math.floor(keys() * plan.mash.length)]);
        }
      } else {
        held.clear();
        for (const p of plan.presses) if (t >= p.from - 1e-9 && t < p.to - 1e-9) held.add(p.action);
      }
      input.holdOnly(held, 'keys');
      try {
        session.step(1 / FPS, input);
      } catch (err) {
        fail('the engine', `it stopped after ${t.toFixed(1)} s: ${err instanceof Error ? err.message : String(err)}`);
        out.stopped = 'the engine stopped';
        frame++;
        break;
      }
      if (frame % LOOK !== LOOK - 1) continue;
      const rt = session.runtime;
      out.looks.push(look(session));
      if (rt.kit.turns || rt.kit.capturing()) out.turns = true;
      if (!rt.paused) out.paused = false;
      if (out.won === null && rt.completed !== null) out.won = t;
      if (!out.left && session.scene.name !== first) out.left = { t, to: session.scene.name };
      if (plan.baseline) plan.baseline.listeners.scan(rt);
      for (const [e, a] of alone) if (!a.moved && (Math.abs(e.x - a.x) > 1 || Math.abs(e.y - a.y) > 1)) a.moved = true;
      const lost = rt.entities.find((e) => e.alive && !(Number.isFinite(e.x) && Number.isFinite(e.y) && Number.isFinite(e.vx) && Number.isFinite(e.vy)));
      if (lost) {
        // (A fault whatever the game is: nothing can be meant to be at no place.)
        fail(lost.name, `its place or speed stopped being a number after ${t.toFixed(1)} s`);
        out.stopped = 'a place stopped being a number';
        frame++;
        break;
      }
      if (rt.entities.length - startCount > TOO_MANY) {
        out.suspicious.push({ kind: 'many_things', text: `Many things are made and stay: ${rt.entities.length} after ${t.toFixed(1)} s (${startCount} at the start)${plan.pressing ? `, pressing ${plan.pressing}` : ''}. The probe stopped that run there.` });
        out.stopped = 'too many things';
        frame++;
        break;
      }
      if (deadline && performance.now() > deadline) {
        out.stopped = 'it took too long';
        frame++;
        break;
      }
    }
    out.played = frame / FPS;
    if (!out.looks.length) out.paused = false;
    for (const [e, a] of alone) out.actors.push({ name: e.name, does: a.does, moved: a.moved });
  } finally {
    Math.random = real;
  }
  return out;
}

/** Whether a thing of that name is somewhere else in `b` than in `a` at some moment. */
function movedIn(a: Ran, b: Ran, name: string): boolean {
  const n = Math.min(a.looks.length, b.looks.length);
  for (let i = 0; i < n; i++) if (a.looks[i].visible.get(`at:${name}`) !== b.looks[i].visible.get(`at:${name}`)) return true;
  return false;
}

/** When and how `b` first differs from `a` in what a player could notice (looks at the same moments). */
function firstDifference(a: Ran, b: Ran): { at: number; what: string[] } | null {
  const n = Math.min(a.looks.length, b.looks.length);
  for (let i = 0; i < n; i++) {
    const d = differ(a.looks[i], b.looks[i]);
    if (d.visible.length) return { at: ((i + 1) * LOOK) / FPS, what: d.visible.slice(0, 3).map((v) => v.text) };
  }
  return null;
}

const same = (a: Look, b: Look) => !differ(a, b).visible.length && !differ(a, b).hidden;

// ---------------------------------------------------------------------------------------------- the probe

/** Plays the level and says what it saw: see the file's comment, and ProbeReport. */
export function probeLevel(project: Project, sceneId: Id, registry: ComponentRegistry, options: ProbeOptions = {}): ProbeReport {
  const seed = options.seed ?? 1;
  const budget = options.budget ?? 90;
  const maxMs = options.maxMs ?? 6000;
  const deadline = maxMs > 0 ? performance.now() + maxMs : 0;
  const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
  const report: ProbeReport = {
    sceneId: scene.id,
    levelName: scene.name,
    seed,
    seconds: { played: 0, budget },
    runs: 0,
    errors: [],
    inputs: [],
    byItself: { seen: false, what: [], hiddenOnly: false, expected: 'unknown', why: '', still: [] },
    suspicious: [],
    notes: [],
    unjudged: [],
  };
  /** Something suspicious seen (each kind's words once): said as seen, never as a fault. */
  const suspect = (kind: ProbeSuspect['kind'], text: string) => {
    if (!report.suspicious.some((s) => s.kind === kind && s.text === text)) report.suspicious.push({ kind, text });
  };
  const all: Ran[] = [];
  let tooLong = false;
  /** A run, if the budget has room for it. */
  const play = (plan: Plan): Ran | null => {
    if (tooLong || report.seconds.played + plan.seconds > budget + 1e-9) return null;
    const ran = run(project, scene.id, registry, seed, plan, deadline);
    report.runs++;
    report.seconds.played += ran.played;
    for (const e of ran.errors) if (!report.errors.some((x) => x.where === e.where && x.message === e.message)) report.errors.push(e);
    for (const s of ran.suspicious) suspect(s.kind, s.text);
    if (ran.stopped === 'it took too long') tooLong = true;
    all.push(ran);
    return ran;
  };
  const finish = () => {
    report.seconds.played = Math.round(report.seconds.played * 10) / 10;
    if (tooLong) report.unjudged.push(`The level is slow to play here: the probe stopped after ${Math.round(maxMs / 1000)} s of real time, with ${report.seconds.played} s of the game played.`);
    return report;
  };

  if (partLevels(project).has(scene.id)) {
    report.unjudged.push('This level is a room template: random levels stamp it into their rooms, so it is not played on its own.');
    return finish();
  }

  // 1. With no key pressed.
  const listeners = new Listeners();
  const base = budget >= 1 ? play({ seconds: Math.min(BASELINE, budget), presses: [], pressing: null, baseline: { listeners } }) : null;
  if (!base) {
    report.unjudged.push('Nothing was played: the budget is too small for one run.');
    return finish();
  }
  const stoppedEarly = base.stopped !== null;

  // By itself: what changed once things had settled.
  const settled = base.looks[Math.round((SETTLE * FPS) / LOOK) - 1];
  const by = report.byItself;
  if (settled) {
    // (Each thing once: what it first did.)
    const what = new Map<string, string>();
    let hidden = false;
    for (const l of base.looks.slice(base.looks.indexOf(settled) + 1)) {
      const d = differ(settled, l);
      for (const w of d.visible) if (!what.has(w.about)) what.set(w.about, w.text);
      hidden ||= d.hidden;
    }
    by.what = [...what.values()].slice(0, 6);
    by.seen = what.size > 0 || hidden;
    by.hiddenOnly = what.size === 0 && hidden;
  }
  const acting = base.actors.filter((a) => a.moved);
  by.still = [...new Set(base.actors.filter((a) => !a.moved).map((a) => `${a.name} (${a.does})`))];
  if (base.turns) {
    by.expected = 'waits';
    by.why = 'it takes turns or has a menu up';
  } else if (base.paused) {
    by.expected = 'waits';
    by.why = 'it is paused from its start, as at a title';
  } else if (base.actors.length) {
    by.expected = 'yes';
    by.why = [...new Set(base.actors.map((a) => `${a.name} ${a.does}`))].slice(0, 3).join(', ');
  } else if (listeners.timed.size) by.why = `${[...listeners.timed].slice(0, 2).join(', ')} ${listeners.timed.size > 1 ? 'act' : 'acts'} by time`;
  if (by.expected === 'yes' && !acting.length && !by.what.length && !stoppedEarly) suspect('nothing_acts', `Nothing set to act by itself did (${by.why}): in ${base.played.toFixed(0)} s with no key pressed, none of them moved and nothing else happened.`);
  else if (by.expected !== 'waits') for (const s of by.still) report.notes.push(`${s} didn't move in ${base.played.toFixed(0)} s with no key pressed.`);

  if (base.won !== null && base.won < WON_AT_ONCE) suspect('early_win', `The level was won ${base.won.toFixed(1)} s after it started, with no key pressed.`);
  else if (base.won !== null) report.notes.push(`With no key pressed, the level is won after ${base.won.toFixed(1)} s.`);
  if (base.left) report.notes.push(`With no key pressed, the game goes on to "${base.left.to}" after ${base.left.t.toFixed(1)} s.`);
  for (const u of listeners.undeclared) report.unjudged.push(`${u}: whether its keys move it isn't judged.`);

  // 2. Each key something listens to. First: does the level play the same twice? (Else a key's effect can't be told from chance.)
  const actions = ORDER.filter((a) => listeners.by.has(a));
  report.inputs = actions.map((action) => ({ action, listeners: listeners.by.get(action)!, response: 'not_tried', what: [] }));
  const again = actions.length && !stoppedEarly ? play({ seconds: Math.min(AGAIN, base.played), presses: [], pressing: null }) : null;
  const repeats = !!again && again.looks.every((l, i) => same(l, base.looks[i]));
  if (actions.length && stoppedEarly) report.unjudged.push('The keys were not tried: the level stopped by itself with no key pressed (above).');
  else if (actions.length && !again) report.unjudged.push(`The keys were not tried: the budget (${budget} s of play) was used up.`);
  else if (actions.length && !repeats) report.unjudged.push("The keys were not tried: the level doesn't play the same twice from the same seed, so what a key changes can't be told from chance.");
  if (repeats) {
    const keyed = new Map<ProbeAction, Ran>();
    /** The characters each key moved (their place, not only which way they face). */
    const moved = new Map<ProbeAction, Set<string>>();
    const moves = (action: ProbeAction, ref: Ran, ran: Ran) => {
      for (const who of listeners.movers.keys()) if (movedIn(ref, ran, who)) moved.set(action, (moved.get(action) ?? new Set()).add(who));
    };
    const skipped: ProbeAction[] = [];
    for (const i of report.inputs) {
      const ran = play({ seconds: KEYED, presses: pattern(i.action), pressing: i.action });
      if (!ran) {
        skipped.push(i.action);
        continue;
      }
      keyed.set(i.action, ran);
      moves(i.action, base, ran);
      const d = firstDifference(base, ran);
      i.response = d ? 'seen' : 'none';
      if (d) {
        i.what = d.what;
        i.at = d.at;
      }
    }
    // Keys at random, all together: for what only shows when keys are combined.
    const mashed = play({ seconds: MASH, presses: [], mash: actions, pressing: 'keys at random' });
    // A key that did nothing: again after each key that did (a title to start from, a menu to open first).
    const opens = report.inputs.filter((i) => i.response === 'seen').map((i) => i.action);
    const first = (['jump', 'interact', 'fire', 'menu'] as ProbeAction[]).filter((a) => opens.includes(a)).concat(opens.filter((a) => !['jump', 'interact', 'fire', 'menu'].includes(a))).slice(0, 3);
    // (Only a key something listens to wherever it is: one for some places only may rightly do nothing here.)
    const quiet = report.inputs.filter((i) => i.response === 'none' && i.listeners.some((l) => l.when === 'always'));
    let untried = 0;
    if (quiet.length) {
      for (const opener of first) {
        const waiting = quiet.filter((i) => i.response === 'none');
        if (!waiting.length) break;
        const before: Press[] = [{ action: opener, from: 0.5, to: 0.55 }];
        const ref = play({ seconds: KEYED + 0.5, presses: before, pressing: opener });
        if (!ref) {
          untried = waiting.length;
          break;
        }
        for (const i of waiting) {
          const ran = play({ seconds: KEYED + 0.5, presses: [...before, ...pattern(i.action, 1)], pressing: `${opener}, then ${i.action}` });
          if (!ran) {
            untried++;
            continue;
          }
          moves(i.action, ref, ran);
          const d = firstDifference(ref, ran);
          if (d) {
            i.response = 'seen';
            i.what = d.what;
            i.at = d.at;
            i.after = opener;
          }
        }
      }
    }
    if (skipped.length) report.unjudged.push(`Not tried: ${skipped.join(', ')}. The budget (${budget} s of play) was used up.`);
    if (!mashed) report.unjudged.push(`Keys pressed together were not tried: the budget (${budget} s of play) was used up.`);
    if (untried) report.unjudged.push(`Some keys that did nothing were not tried again after another key: the budget (${budget} s of play) was used up.`);

    // What mostly answers: a character's own movement keys (one of them at least), a Shooter's key. When they
    // don't, it is said as suspicious: a character may be meant to stay where it is.
    // (With a menu up or turns taken, the keys are the menu's: not judged.)
    for (const [who, own] of listeners.movers) {
      if (base.turns) {
        report.unjudged.push(`Whether ${who} can be moved isn't judged: a menu or turns had the keys.`);
        continue;
      }
      const tried = report.inputs.filter((i) => own.includes(i.action) && i.response !== 'not_tried');
      if (tried.length < own.length) continue;
      if (!own.some((a) => moved.get(a)?.has(who))) suspect('immobile', `${who} never left its place: pressing ${own.join(', ')} didn't move it${tried.some((i) => i.response === 'seen') ? ' (it only turned, or something else changed)' : ''}.`);
    }
    for (const i of report.inputs) {
      if (i.response !== 'none') continue;
      const shooters = i.listeners.filter((l) => l.engine && l.when === 'always' && l.how.startsWith('shoots'));
      if (shooters.length) suspect('silent_shooter', `Pressing ${i.action} changed nothing, though ${shooters.map((l) => l.who).join(', ')} shoots with it.`);
    }

    // A setback before the player can act: in every run, whatever was pressed.
    const runs = [base, ...keyed.values(), ...(mashed ? [mashed] : [])];
    if (runs.length >= 3 && runs.every((r) => r.setback && r.setback.t < AT_ONCE)) {
      const whats = [...new Set(runs.map((r) => r.setback!.what))];
      suspect('early_setback', `Whatever was pressed, ${whats.join(' or ')} within ${AT_ONCE} s of the start (${runs.length} runs).`);
    } else if (base.setback) report.notes.push(`With no key pressed, ${base.setback.what} after ${base.setback.t.toFixed(1)} s.`);
  } else if (base.setback) report.notes.push(`With no key pressed, ${base.setback.what} after ${base.setback.t.toFixed(1)} s.`);

  if (!actions.length) report.notes.push('Nothing in the level listens to a key: no character with a way of moving, no Shooter fired by a key, no script with a key handler.');
  return finish();
}
