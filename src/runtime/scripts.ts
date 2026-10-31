/**
 * Runs behavior scripts during play (the language is defined in
 * core/script/language.ts).
 *
 * Each entity runs its own copy of every enabled script (its own variables,
 * state and timers). `before` runs start/tick/every/key handlers ahead of
 * physics; game events reach "event" and "signal" handlers through the
 * gameplay event queue (so the runaway-event cap covers scripts too).
 *
 * Scripts can't hang the game: there are no open loops, and every handler run
 * and every step has an operation budget. Problems while running (a budget
 * hit, a script that doesn't check out) are reported once per script in
 * `errors` and in the event log as "script_error"; the game keeps going.
 */
import { parseExpr, type Expr } from '../core/script/expr';
import { checkScript, findSong, findSound, type BehaviorScript, type Handler, type Stmt } from '../core/script/language';
import type { Project } from '../core/types';
import type { GameEvent } from './gameplay';
import type { InputState, InputView } from './input';

import { overlaps, type Box } from './physics';
import { feetOf, groundGrip, STEP, type Runtime, type RuntimeEntity } from './runtime';
import { addComponent, readField, removeComponent, setTag, writeField } from './fields';
import { byTag, LiveGrid, PointGrid } from './spatialIndex';

/** No keys held (a dying character's scripts hear none). */
const NO_KEYS: InputView = { isDown: () => false, wasPressed: () => false, wasReleased: () => false };

/** Statements that never move, add, remove or retag anything, nor change what is solid (the level's index stays valid). */
const KEEPS_INDEX = new Set<string>(['emit', 'bounce', 'set', 'if', 'each', 'repeat', 'velocity', 'push', 'glide_to', 'face', 'state', 'signal', 'message', 'alpha', 'draw', 'erase', 'play_sound', 'play_music', 'stop_music', 'pause', 'resume', 'set_sound', 'set_music', 'builtin_display', 'camera_shake', 'camera_flash', 'camera_zoom', 'camera_focus']);

export interface ScriptInstance {
  script: BehaviorScript;
  vars: Map<string, Value>;
  state: string;
  stateTime: number;
  /** Seconds collected per "every" handler. */
  timers: number[];
  started: boolean;
}

export type Value = number | boolean | string | RuntimeEntity | null;

export interface ScriptError {
  entity: string;
  script: string;
  message: string;
}

/**
 * Statements one handler run, and all scripts in one step, may do: only there to stop a runaway script. A
 * statement takes well under a microsecond, so even the step budget is a few dozen milliseconds, while real games
 * (a falling-block board clearing rows: each row × each block) stay far below it.
 */
const RUN_BUDGET = 50_000;
const STEP_BUDGET = 150_000;
/** Most things one "each" goes through (and times a "repeat" runs). */
const MAX_EACH = 2000;
const MAX_STATE_CHAIN = 10;
const MAX_ERRORS = 30;

/** A script as built for one entity at Play time. */
export function instantiateScripts(scripts: BehaviorScript[]): ScriptInstance[] {
  return scripts
    .filter((s) => s.enabled)
    .map((s) => ({ script: s, vars: new Map(s.vars.map((v) => [v.name, v.value])), state: s.states[0] ?? '', stateTime: 0, timers: s.handlers.map(() => 0), started: false }));
}

class Abort extends Error {}

interface Ctx {
  self: RuntimeEntity;
  inst: ScriptInstance;
  other: RuntimeEntity | null;
  it: RuntimeEntity | null;
  /** The count inside "repeat". */
  i: number;
  /** How much it was hurt (in "hurt" handlers). */
  amount: number;
}

export class ScriptSystem {
  readonly errors: ScriptError[] = [];
  private readonly parsed = new Map<string, Expr>();
  private readonly valid = new WeakMap<BehaviorScript, boolean>();
  private readonly reported = new Set<string>();
  private input: InputView | null = null;
  /** The length of the step being run (what "dt" is; the game's fixed step). */
  private stepDt = STEP;
  private budget = 0;
  private stepBudget = 0;
  private generation = 0;

  constructor(
    private readonly rt: Runtime,
    private readonly project: Project,
  ) {}

  /** The level restarted: scripts already running belong to the old run. */
  reset(): void {
    this.generation++;
  }

  before(dt: number, input: InputState, keysOnly = false): void {
    // While the scripts run, nothing moves but what they move: point and tag questions use an index of the level,
    // brought up to date whenever a statement may have moved, added, removed or retagged something.
    this.indexing = true;
    try {
      this.beforeAll(dt, input, keysOnly);
    } finally {
      this.indexing = false;
      this.index = null;
    }
  }

  private indexing = false;
  /** Null when it may be out of date (it is then brought up to date when next asked). */
  private index: { things: LiveGrid<RuntimeEntity>; solids: PointGrid<Box>; tags: Map<string, RuntimeEntity[]> } | null = null;
  // Kept from step to step: what is where (only what moved is filed again), the solids (filed again only when they
  // change), and the things by tag (made again only when something new appears or a tag changes).
  private readonly things = new LiveGrid<RuntimeEntity>();
  private solidGrid: { from: readonly Box[]; grid: PointGrid<Box> } | null = null;
  private tagMap: { from: readonly RuntimeEntity[]; tags: (readonly string[])[]; map: Map<string, RuntimeEntity[]> } | null = null;

  /** The level's index while the scripts' step runs (null at other times, e.g. in events during physics: then everything is looked at). */
  private levelIndex() {
    if (!this.indexing) return null;
    if (!this.index) {
      const entities = this.rt.entities;
      this.things.sync(entities, (o) => (o.alive ? this.thingBox(o) : null));
      const solids = this.rt.solids;
      if (this.solidGrid?.from !== solids) this.solidGrid = { from: solids, grid: new PointGrid(solids, (b) => b) };
      // (Things that went stay listed under their tags: the one question asking by tag skips them.)
      const t = this.tagMap;
      if (!t || t.from !== entities || t.tags.length !== entities.length || entities.some((o, i) => o.tags !== t.tags[i])) {
        this.tagMap = { from: entities, tags: entities.map((o) => o.tags), map: byTag(entities) };
      }
      this.index = { things: this.things, solids: this.solidGrid.grid, tags: this.tagMap!.map };
    }
    return this.index;
  }

  /** The box thing_at finds a thing by: its collider, or (without one) its picture. */
  private thingBox(o: RuntimeEntity): Box | null {
    const b = this.rt.boxOf(o);
    if (b) return b;
    const sp = o.base.components.Sprite;
    return { x: o.x, y: o.y, hw: (Number(sp?.width) || 0) / 2, hh: (Number(sp?.height) || 0) / 2 };
  }

  private beforeAll(dt: number, input: InputState, keysOnly = false): void {
    if (dt > 0) this.stepDt = dt;
    this.input = input;
    this.stepBudget = STEP_BUDGET;
    const gen = this.generation;
    for (const e of this.rt.entities.slice()) {
      if (!e.alive || !e.scripts.length) continue;
      // Keys held through a respawn don't count for it until let go; nor do any while it is dying.
      const keys: InputView = e.dying > 0 ? NO_KEYS : this.rt.inputFor(e, input);
      this.input = keys;
      for (const inst of e.scripts) {
        if (!this.usable(e, inst)) continue;
        if (!inst.started) {
          inst.started = true;
          this.runWhere(e, inst, (h) => h.when.on === 'start', null);
          if (inst.script.states.length) this.enterState(e, inst, inst.state, 0);
        }
        inst.stateTime += dt;
        inst.script.handlers.forEach((h, i) => {
          if (gen !== this.generation || !e.alive) return;
          const w = h.when;
          if (keysOnly ? w.on !== 'key' && w.on !== 'paused' : w.on === 'paused') return;
          if (w.on === 'tick' || w.on === 'paused') this.run(e, inst, h, null);
          else if (w.on === 'every') {
            inst.timers[i] += dt;
            if (inst.timers[i] >= w.seconds) {
              inst.timers[i] -= w.seconds;
              // Never more than one catch-up per step.
              inst.timers[i] = Math.min(inst.timers[i], w.seconds);
              this.run(e, inst, h, null);
            }
          } else if (w.on === 'key') {
            const hit = w.edge === 'pressed' ? keys.wasPressed(w.key) : w.edge === 'held' ? keys.isDown(w.key) : keys.wasReleased(w.key);
            if (hit) this.run(e, inst, h, null);
          }
        });
        if (gen !== this.generation) return;
      }
    }
    // (Events handled later this step hear the keys as they are.)
    this.input = input;
  }

  /** While the game is paused: only "key" handlers run (a pause menu reads its keys there; they may resume). */
  whilePaused(input: InputState): void {
    this.before(0, input, true);
  }

  /**
   * It respawned: its scripts' states start over (a "dying" state must not carry on, or start again, at the start
   * point) and their "every" timers too; variables (scores, lives) stay.
   */
  resetForRespawn(e: RuntimeEntity): void {
    for (const inst of e.scripts) {
      if (inst.script.states.length) inst.state = inst.script.states[0];
      inst.stateTime = 0;
      inst.timers = inst.timers.map(() => 0);
    }
  }

  /** `e` and `other` touch ("contact"), or `other` came down onto `e` ("landed_on"): `e`'s handlers for it. */
  onTouch(e: RuntimeEntity, other: RuntimeEntity, kind: 'landed_on' | 'contact'): void {
    if (!e.alive) return;
    const gen = this.generation;
    for (const inst of e.scripts) {
      if (gen !== this.generation || !e.alive) return;
      if (this.usable(e, inst)) this.runWhere(e, inst, (h) => h.when.on === kind, other);
    }
  }

  /** Whether any of its scripts reacts to `kind` (so the engine only looks for it where it matters). */
  listens(e: RuntimeEntity, kind: 'landed_on' | 'contact'): boolean {
    return e.scripts.some((inst) => inst.script.handlers.some((h) => h.when.on === kind));
  }

  /** A game event: the event handlers of both entities involved, and signal handlers everywhere. */
  onEvent(ev: GameEvent): void {
    const gen = this.generation;
    if (ev.type === 'signal') {
      const name = ev.detail?.name;
      for (const e of this.rt.entities.slice()) {
        if (!e.alive) continue;
        for (const inst of e.scripts) {
          if (gen !== this.generation) return;
          if (this.usable(e, inst)) this.runWhere(e, inst, (h) => h.when.on === 'signal' && h.when.name === name, ev.subject);
        }
      }
      return;
    }
    const sides: [RuntimeEntity | null, RuntimeEntity | null][] = [
      [ev.subject, ev.other],
      [ev.other, ev.subject],
    ];
    const seen = new Set<RuntimeEntity>();
    for (const [me, them] of sides) {
      if (!me || seen.has(me) || !me.scripts.length) continue;
      seen.add(me);
      // "died" and "collected" happen to things that are already gone: they still get to react.
      for (const inst of me.scripts) {
        if (gen !== this.generation) return;
        if (!this.usable(me, inst)) continue;
        this.runWhere(
          me,
          inst,
          (h) => h.when.on === 'event' && h.when.event === ev.type && (h.when.with === null || (them !== null && them.tags.includes(h.when.with))),
          them,
        );
      }
    }
  }

  // ---------------------------------------------------------------- running

  private usable(e: RuntimeEntity, inst: ScriptInstance): boolean {
    let ok = this.valid.get(inst.script);
    if (ok === undefined) {
      const checked = checkScript(inst.script, this.project);
      ok = !('error' in checked);
      if ('error' in checked) this.report(e, inst, `doesn't check out, so it is not run: ${checked.error}`);
      this.valid.set(inst.script, ok);
    }
    return ok;
  }

  private runWhere(e: RuntimeEntity, inst: ScriptInstance, pick: (h: Handler) => boolean, other: RuntimeEntity | null, amount = 0): void {
    const gen = this.generation;
    for (const h of inst.script.handlers) {
      if (gen !== this.generation) return;
      if (pick(h)) this.run(e, inst, h, other, 0, amount);
    }
  }

  /** It is hurt and a script of its own took being hurt over: its "hurt" handlers do what a hit does. */
  onHurt(e: RuntimeEntity, source: RuntimeEntity | null, amount: number): void {
    const gen = this.generation;
    for (const inst of e.scripts) {
      if (gen !== this.generation || !e.alive) return;
      if (this.usable(e, inst)) this.runWhere(e, inst, (h) => h.when.on === 'hurt', source, amount);
    }
  }

  private run(e: RuntimeEntity, inst: ScriptInstance, h: Handler, other: RuntimeEntity | null, chain = 0, amount = 0): void {
    if (h.state !== null && h.state !== inst.state) return;
    const ctx: Ctx = { self: e, inst, other, it: null, i: 0, amount };
    this.budget = RUN_BUDGET;
    try {
      if (h.if !== null && !truthy(this.eval(h.if, ctx))) return;
      this.exec(h.do, ctx, chain);
    } catch (err) {
      if (err instanceof Abort) return;
      throw err;
    }
  }

  private enterState(e: RuntimeEntity, inst: ScriptInstance, name: string, chain: number): void {
    if (chain > MAX_STATE_CHAIN) {
      this.report(e, inst, `keeps switching state (${MAX_STATE_CHAIN} times in one step); stopped`);
      return;
    }
    inst.state = name;
    inst.stateTime = 0;
    const gen = this.generation;
    for (const h of inst.script.handlers) {
      if (gen !== this.generation || inst.state !== name) return;
      if (h.when.on === 'enter_state' && h.state === name) this.run(e, inst, h, null, chain + 1);
    }
  }

  private tick(ctx: Ctx): void {
    if (--this.budget < 0 || --this.stepBudget < 0) {
      this.report(ctx.self, ctx.inst, 'did too much work in one step and was stopped there');
      throw new Abort();
    }
  }

  private exec(list: Stmt[], ctx: Ctx, chain: number): void {
    const gen = this.generation;
    for (const s of list) {
      this.tick(ctx);
      this.stmt(s, ctx, chain);
      if (gen !== this.generation) throw new Abort();
    }
  }

  private stmt(s: Stmt, ctx: Ctx, chain: number): void {
    const keeps = KEEPS_INDEX.has(s.do);
    if (!keeps) this.index = null;
    try {
      this.statement(s, ctx, chain);
    } finally {
      // (Also after: what it evaluated may have rebuilt the index before it moved something.)
      if (!keeps) this.index = null;
    }
  }

  private statement(s: Stmt, ctx: Ctx, chain: number): void {
    const e = ctx.self;
    const n = (text: string) => num(this.eval(text, ctx));
    const ent = (text: string | null) => (text === null ? e : asEntity(this.eval(text, ctx)));
    const gp = this.rt.gameplay;
    switch (s.do) {
      case 'set': {
        const value = this.eval(s.value, ctx);
        if (s.on === null) ctx.inst.vars.set(s.var, value);
        else {
          const t = ent(s.on);
          const holder = t?.scripts.find((i) => i.vars.has(s.var));
          if (holder) holder.vars.set(s.var, value);
        }
        break;
      }
      case 'if':
        this.exec(truthy(this.eval(s.cond, ctx)) ? s.then : s.else, ctx, chain);
        break;
      case 'each': {
        let all = this.rt.entities.filter((o) => o.alive && o.tags.includes(s.tag));
        if (all.length > MAX_EACH) {
          this.report(e, ctx.inst, `"each ${s.tag}" went through only the first ${MAX_EACH} of ${all.length}`);
          all = all.slice(0, MAX_EACH);
        }
        const prev = ctx.it;
        for (const o of all) {
          ctx.it = o;
          this.exec(s.then, ctx, chain);
        }
        ctx.it = prev;
        break;
      }
      case 'velocity': {
        const t = ent(s.on);
        if (!t) break;
        if (s.x !== null) t.vx = n(s.x);
        if (s.y !== null) t.vy = n(s.y);
        break;
      }
      case 'push': {
        const t = ent(s.on);
        if (!t) break;
        // A push moves heavier things less.
        t.vx += n(s.x) / t.mass;
        t.vy += n(s.y) / t.mass;
        if (t.vy < 0) t.grounded = false;
        break;
      }
      case 'chase': {
        const t = ent(s.target);
        if (t && t !== e) this.rt.chase(e, t, n(s.speed));
        break;
      }
      case 'carry':
        this.rt.behaviors.carryRiders(e, n(s.x), n(s.y));
        break;
      case 'climbing':
        e.climbing = truthy(this.eval(s.value, ctx));
        e.climbDir = 0;
        break;
      case 'stand_on_ladder':
        this.rt.standOnLadder(e);
        break;
      case 'grab_ledge': {
        const d = n(s.dir);
        if (d !== 0 && !e.hanging) this.rt.grabLedge(e, d < 0 ? -1 : 1);
        break;
      }
      case 'climb_ledge':
        this.rt.climbLedge(e);
        break;
      case 'let_go':
        e.hanging = null;
        break;
      case 'heading': {
        const x = Math.sign(n(s.x));
        const y = Math.sign(n(s.y));
        e.heading = { x, y };
        break;
      }
      case 'move_toward': {
        const t = ent(s.target);
        const speed = n(s.speed);
        if (!t || t === e) break;
        const dx = t.x - e.x;
        const dy = t.y - e.y;
        if (this.rt.floats(e) || e.body !== 'dynamic') {
          const d = Math.hypot(dx, dy);
          e.vx = d > 1 ? (dx / d) * speed : 0;
          e.vy = d > 1 ? (dy / d) * speed : 0;
        } else e.vx = Math.abs(dx) > 1 ? Math.sign(dx) * speed : 0;
        if (Math.abs(dx) > 1) e.facing = dx < 0 ? -1 : 1;
        this.makeMovable(e);
        break;
      }
      case 'glide_to': {
        const t = ent(s.on);
        if (t) this.rt.moveTo(t, { x: n(s.x), y: n(s.y) }, Math.max(0, n(s.speed)));
        break;
      }
      case 'position': {
        const t = ent(s.on);
        if (!t) break;
        t.x = n(s.x);
        t.y = n(s.y);
        if (t.body !== 'dynamic') this.rt.markSolidsDirty();
        break;
      }
      case 'jump': {
        const t = ent(s.on);
        if (!t) break;
        t.vy = -n(s.force);
        t.grounded = false;
        break;
      }
      case 'face': {
        const t = ent(s.on);
        const d = n(s.dir);
        if (t && d !== 0) t.facing = d < 0 ? -1 : 1;
        break;
      }
      case 'climb': {
        const t = ent(s.on);
        if (!t || t.controller) break;
        const d = n(s.dir);
        t.climbDir = d < 0 ? -1 : d > 0 ? 1 : 0;
        if (s.speed) t.climbSpeed = Math.max(0, n(s.speed));
        break;
      }
      case 'gravity': {
        const t = ent(s.on);
        if (t) t.gravityScale = n(s.scale);
        break;
      }
      case 'speed_factor': {
        const t = ent(s.on);
        if (t) t.speedFactor = Math.max(0, Math.min(10, n(s.value)));
        break;
      }
      case 'shoot': {
        let dx = n(s.dx);
        let dy = n(s.dy);
        const len = Math.hypot(dx, dy);
        if (len === 0) break;
        dx /= len;
        dy /= len;
        const shot = this.rt.shoot(e, dx, dy, { projectile: s.object ?? '', speed: n(s.speed), damage: n(s.damage), range: n(s.range) });
        if (shot) gp.emit('shot', e, shot);
        break;
      }
      case 'spawn': {
        const made = this.rt.spawn(s.object, { x: n(s.x), y: n(s.y) });
        if (made && s.tag) setTag(made, s.tag, true);
        if (made) gp.emit('spawned', made, e);
        break;
      }
      case 'move_group': {
        const dx = n(s.dx);
        const dy = n(s.dy);
        for (const o of this.group(s.tag)) {
          o.x += dx;
          o.y += dy;
        }
        this.rt.markSolidsDirty();
        break;
      }
      case 'turn_group': {
        const cx = n(s.x);
        const cy = n(s.y);
        const dir = n(s.dir) < 0 ? -1 : 1;
        for (const o of this.group(s.tag)) {
          const p = turned(o.x, o.y, cx, cy, dir);
          o.x = p.x;
          o.y = p.y;
        }
        this.rt.markSolidsDirty();
        break;
      }
      case 'remove': {
        const t = ent(s.target);
        if (t?.alive) {
          t.alive = false;
          this.rt.markSolidsDirty();
        }
        break;
      }
      case 'damage': {
        const t = ent(s.target);
        // Not while blinking after a hit, nor just after bouncing off a stomp (a stomp is never also a hit).
        // Hurting itself: no knock back from itself.
        if (t?.health && t.alive && t.invincible <= 0 && t.stompGrace <= 0) gp.hurt(t, Math.max(0, n(s.amount)), t === e ? null : e);
        break;
      }
      case 'bounce': {
        const t = ent(s.on);
        if (t?.alive) {
          t.vy = -Math.max(0, n(s.speed));
          t.grounded = false;
          t.stompGrace = 0.2;
        }
        break;
      }
      case 'emit': {
        const subject = s.subject ? ent(s.subject) : e;
        // (A switch's "switch_activated" says which way it went, as the engine's does.)
        const detail: Record<string, unknown> = s.event === 'switch_activated' && subject?.switch ? { on: subject.switch.on } : {};
        for (const [k, v] of Object.entries(s.detail ?? {})) detail[k] = this.eval(v, ctx);
        gp.emit(s.event, subject, s.other === null ? null : ent(s.other), Object.keys(detail).length ? detail : undefined);
        break;
      }
      case 'kill': {
        const t = ent(s.target);
        // Killing itself (stomped, say): the one it was dealing with did it.
        if (t?.alive) gp.die(t, t === e ? ctx.other : e);
        break;
      }
      case 'heal': {
        const t = ent(s.target);
        if (t?.health) t.health.current = Math.min(t.health.max, t.health.current + Math.max(0, n(s.amount)));
        break;
      }
      case 'give_item':
      case 'take_item': {
        const t = ent(s.target);
        const count = Math.max(0, Math.round(n(s.count)));
        if (t && count > 0) (s.do === 'give_item' ? gp.addItem(t, s.item, count) : gp.takeItem(t, s.item, count));
        break;
      }
      case 'set_open': {
        const t = ent(s.target);
        if (t) gp.setOpen(t, truthy(this.eval(s.open, ctx)), s.by ? ent(s.by) : e);
        break;
      }
      case 'set_health': {
        const t = ent(s.target);
        if (t?.health) t.health.current = Math.min(t.health.max, Math.max(0, n(s.value)));
        break;
      }
      case 'invincible': {
        const t = ent(s.on);
        if (t) {
          t.invincible = Math.max(0, n(s.seconds));
          if (t.invincible > 0) t.hurtAt = this.rt.time;
        }
        break;
      }
      case 'knock_back': {
        const from = ent(s.from);
        if (from) gp.knockBack(e, from, n(s.strength));
        break;
      }
      case 'respawn_after':
        if (e.controller && e.alive) gp.waitToRespawn(e, n(s.seconds));
        break;
      case 'defeated': {
        const t = ent(s.target);
        if (t?.alive) gp.defeated(t);
        break;
      }
      case 'set_switch': {
        const t = ent(s.target);
        if (t?.switch) t.switch.on = truthy(this.eval(s.value, ctx));
        break;
      }
      case 'state':
        if (s.name !== ctx.inst.state) this.enterState(e, ctx.inst, s.name, chain + 1);
        break;
      case 'signal':
        gp.emit('signal', e, null, { name: s.name });
        break;
      case 'message': {
        const text = s.text.replace(/\{([^{}]+)\}/g, (_, x: string) => show(this.eval(x, ctx)));
        gp.messages.push({ text, until: this.rt.time + s.seconds });
        break;
      }
      case 'alpha': {
        const t = ent(s.on);
        if (t) t.alpha = Math.min(1, Math.max(0, n(s.value)));
        break;
      }
      case 'set_field': {
        const t = ent(s.on);
        if (!t) break;
        const err = writeField(this.rt, t, s.component, s.field, this.eval(s.value, ctx));
        if (err) this.report(e, ctx.inst, `set_field on ${t.name}: ${err}`);
        break;
      }
      case 'add_component':
      case 'remove_component': {
        const t = ent(s.on);
        if (!t) break;
        const err = s.do === 'add_component' ? addComponent(this.rt, t, s.component) : removeComponent(this.rt, t, s.component);
        if (err) this.report(e, ctx.inst, `${s.do} on ${t.name}: ${err}`);
        break;
      }
      case 'tag': {
        const t = ent(s.on);
        if (t) setTag(t, s.tag, s.add);
        break;
      }
      case 'repeat': {
        const times = Math.min(MAX_EACH, Math.max(0, Math.floor(n(s.times))));
        const prev = ctx.i;
        for (let k = 0; k < times; k++) {
          ctx.i = k;
          this.exec(s.then, ctx, chain);
        }
        ctx.i = prev;
        break;
      }
      case 'draw': {
        const fill = (text: string) => text.replace(/\{([^{}]+)\}/g, (_, x: string) => show(this.eval(x, ctx)));
        const id = fill(s.id);
        const old = this.rt.drawings.get(id);
        const opt = (text: string | null, d: number) => (text === null ? d : n(text));
        this.rt.drawings.set(id, {
          owner: e.id,
          shape: s.shape,
          anchor: s.anchor,
          x: n(s.x),
          y: n(s.y),
          w: Math.max(0, opt(s.w, 32)),
          h: Math.max(0, opt(s.h, 32)),
          text: s.text === null ? '' : fill(s.text),
          size: Math.min(200, Math.max(4, opt(s.size, 18))),
          color: s.color,
          object: s.object,
          alpha: Math.min(1, Math.max(0, opt(s.alpha, 1))),
          order: old?.order ?? this.rt.drawings.size,
        });
        break;
      }
      case 'erase': {
        if (s.id === null) {
          for (const [k, d] of this.rt.drawings) if (d.owner === e.id) this.rt.drawings.delete(k);
        } else this.rt.drawings.delete(s.id.replace(/\{([^{}]+)\}/g, (_, x: string) => show(this.eval(x, ctx))));
        break;
      }
      case 'play_sound': {
        const sound = findSound(this.project, s.sound);
        if (!sound) {
          this.report(e, ctx.inst, `play_sound: there is no sound "${s.sound}"`);
          break;
        }
        // At most a few at once (a sound on every tick would otherwise pile up).
        if (this.rt.soundQueue.length < 16) {
          this.rt.soundQueue.push({ assetId: sound.id, volume: Math.min(1, Math.max(0, n(s.volume))), pitch: Math.min(4, Math.max(0.25, n(s.pitch) || 1)) });
          this.rt.soundsPlayed++;
        }
        break;
      }
      case 'play_music': {
        const song = findSong(this.project, s.music);
        if (!song) this.report(e, ctx.inst, `play_music: there is no song "${s.music}"`);
        else this.rt.musicRequest = { assetId: song.id };
        break;
      }
      case 'stop_music':
        this.rt.musicRequest = { assetId: null };
        break;
      case 'builtin_display': {
        const parts: ('hearts' | 'items')[] = s.what === 'all' ? ['hearts', 'items'] : [s.what];
        for (const part of parts) {
          if (s.show) this.rt.builtinHidden.delete(part);
          else this.rt.builtinHidden.add(part);
        }
        break;
      }
      case 'rotate': {
        const t = ent(s.on);
        if (!t) break;
        const to = s.to !== null ? n(s.to) : t.angle + (s.by !== null ? n(s.by) : 0);
        const seconds = Math.max(0, n(s.seconds));
        t.spin = 0;
        if (!Number.isFinite(to)) break;
        if (seconds === 0 || to === t.angle) {
          t.angle = to;
          t.turn = null;
        } else t.turn = { to, speed: Math.abs(to - t.angle) / seconds };
        break;
      }
      case 'spin': {
        const t = ent(s.on);
        if (!t) break;
        const speed = n(s.speed);
        t.spin = Number.isFinite(speed) ? speed : 0;
        t.turn = null;
        break;
      }
      case 'respawn': {
        const t = ent(s.target);
        if (t) this.rt.respawn(t, 'script');
        break;
      }
      case 'restart_level':
        this.rt.restart();
        break;
      case 'restart_game':
        this.rt.restartGameRequested = true;
        break;
      case 'pause':
        this.rt.paused = true;
        break;
      case 'resume':
        this.rt.paused = false;
        break;
      case 'set_sound':
        this.rt.soundOn = truthy(this.eval(s.enabled, ctx));
        break;
      case 'set_music':
        this.rt.musicOn = truthy(this.eval(s.enabled, ctx));
        break;
      case 'complete_level':
        this.rt.completeLevel(s.by ? ent(s.by) : e);
        break;
      case 'camera_shake':
        this.rt.cam.startShake(n(s.strength), n(s.seconds));
        break;
      case 'camera_flash':
        this.rt.cam.startFlash(s.color, n(s.seconds));
        break;
      case 'camera_zoom':
        this.rt.cam.zoomTo(n(s.zoom), Math.max(0, n(s.seconds)));
        break;
      case 'camera_focus': {
        const t = ent(s.target);
        if (t) this.rt.cam.focusOn(t, n(s.seconds));
        break;
      }
      case 'camera_follow':
        this.rt.cam.follow(s.target === null ? null : ent(s.target));
        break;
    }
  }

  /** A static thing told to move becomes kinematic (it moves by its speed, without gravity). */
  private makeMovable(e: RuntimeEntity): void {
    if (e.body === 'static' || e.body === 'none') {
      e.body = 'kinematic';
      this.rt.markSolidsDirty();
    }
  }

  // ---------------------------------------------------------------- expressions

  private eval(text: string, ctx: Ctx): Value {
    let e = this.parsed.get(text);
    if (!e) {
      e = parseExpr(text);
      this.parsed.set(text, e);
    }
    return this.value(e, ctx);
  }

  private value(e: Expr, ctx: Ctx): Value {
    this.tick(ctx);
    switch (e.k) {
      case 'num':
      case 'str':
      case 'bool':
        return e.v;
      case 'null':
        return null;
      case 'id':
        return this.name(e.name, ctx);
      case 'mem':
        {
          const who = asEntity(this.value(e.obj, ctx));
          // (Whether it floats needs the level's gravity.)
          if (e.name === 'floats') return !!who && (this.rt.floats(who) || who.body !== 'dynamic');
          return member(who, e.name);
        }
      case 'un': {
        const a = this.value(e.a, ctx);
        return e.op === '-' ? -num(a) : !truthy(a);
      }
      case 'cond':
        return truthy(this.value(e.c, ctx)) ? this.value(e.a, ctx) : this.value(e.b, ctx);
      case 'bin': {
        if (e.op === '&&') return truthy(this.value(e.a, ctx)) && truthy(this.value(e.b, ctx));
        if (e.op === '||') return truthy(this.value(e.a, ctx)) || truthy(this.value(e.b, ctx));
        const a = this.value(e.a, ctx);
        const b = this.value(e.b, ctx);
        switch (e.op) {
          case '+':
            return typeof a === 'string' || typeof b === 'string' ? show(a) + show(b) : num(a) + num(b);
          case '-':
            return num(a) - num(b);
          case '*':
            return num(a) * num(b);
          case '/':
            return num(b) === 0 ? 0 : num(a) / num(b);
          case '%':
            return num(b) === 0 ? 0 : num(a) % num(b);
          case '<':
            return num(a) < num(b);
          case '<=':
            return num(a) <= num(b);
          case '>':
            return num(a) > num(b);
          case '>=':
            return num(a) >= num(b);
          case '==':
            return same(a, b);
          case '!=':
            return !same(a, b);
        }
        return null;
      }
      case 'call':
        return this.call(e.fn, e.args, ctx);
    }
  }

  private name(name: string, ctx: Ctx): Value {
    switch (name) {
      case 'self':
        return ctx.self;
      case 'other':
        return ctx.other;
      case 'it':
        return ctx.it;
      case 'i':
        return ctx.i;
      case 'damage_taken':
        return ctx.amount;
      case 'screen_w':
        return this.rt.screen.w;
      case 'screen_h':
        return this.rt.screen.h;
      case 'view_x':
      case 'view_y':
      case 'view_w':
      case 'view_h': {
        const v = this.rt.cam.visible();
        return name === 'view_x' ? (v.minX + v.maxX) / 2 : name === 'view_y' ? (v.minY + v.maxY) / 2 : name === 'view_w' ? v.maxX - v.minX : v.maxY - v.minY;
      }
      case 'player':
        return this.nearest(ctx.self, 'player');
      case 'time':
        return this.rt.time;
      case 'dt':
        return this.stepDt;
      case 'state':
        return ctx.inst.state;
      case 'state_time':
        return ctx.inst.stateTime;
      case 'pi':
        return Math.PI;
      case 'paused':
        return this.rt.paused;
      case 'sound_on':
        return this.rt.soundOn;
      case 'music_on':
        return this.rt.musicOn;
    }
    return ctx.inst.vars.get(name) ?? 0;
  }

  private nearest(from: RuntimeEntity, tag: string): RuntimeEntity | null {
    let best: RuntimeEntity | null = null;
    let bestD = Infinity;
    for (const o of this.levelIndex()?.tags.get(tag) ?? this.rt.entities) {
      if (o === from || !o.alive || o.projectile || !o.tags.includes(tag)) continue;
      const d = Math.hypot(o.x - from.x, o.y - from.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** The living entities with the tag (a group moved or turned together). */
  private group(tag: string): RuntimeEntity[] {
    return this.rt.entities.filter((o) => o.alive && o.tags.includes(tag)).slice(0, MAX_EACH);
  }

  /**
   * Whether the group with this tag could be where `to` puts each member: no solid thing (outside the group) and,
   * with `block`, no other living entity with that tag at any member's new middle.
   */
  private groupFits(tag: string, to: (o: RuntimeEntity) => { x: number; y: number }, block: string | null): boolean {
    const members = this.group(tag);
    if (!members.length) return false;
    const inGroup = new Set(members);
    const others = this.rt.entities.filter((o) => o.alive && !inGroup.has(o));
    for (const m of members) {
      const p = to(m);
      for (const o of others) {
        if (!this.rt.solidFor(o) && !(block !== null && o.tags.includes(block))) continue;
        const b = this.rt.boxOf(o);
        const hw = b ? b.hw : (Number(o.base.components.Sprite?.width) || 0) / 2;
        const hh = b ? b.hh : (Number(o.base.components.Sprite?.height) || 0) / 2;
        const bx = b ? b.x : o.x;
        const by = b ? b.y : o.y;
        if (Math.abs(p.x - bx) < hw && Math.abs(p.y - by) < hh) return false;
      }
    }
    return true;
  }

  private solidAt(x: number, y: number): boolean {
    const index = this.levelIndex();
    if (index) return index.solids.first(x, y) !== null;
    return this.rt.solids.some((s) => Math.abs(x - s.x) < s.hw && Math.abs(y - s.y) < s.hh);
  }

  private call(fn: string, args: Expr[], ctx: Ctx): Value {
    const v = args.map((a) => this.value(a, ctx));
    const n = (i: number) => num(v[i]);
    const self = ctx.self;
    switch (fn) {
      case 'abs':
        return Math.abs(n(0));
      case 'min':
        return Math.min(...v.map(num));
      case 'max':
        return Math.max(...v.map(num));
      case 'clamp':
        return Math.min(n(2), Math.max(n(1), n(0)));
      case 'pick':
        return truthy(v[0]) ? v[1] : v[2];
      case 'sign':
        return Math.sign(n(0));
      case 'sqrt':
        return Math.sqrt(Math.max(0, n(0)));
      case 'floor':
        return Math.floor(n(0));
      case 'ceil':
        return Math.ceil(n(0));
      case 'round':
        return Math.round(n(0));
      case 'sin':
        return Math.sin(n(0));
      case 'cos':
        return Math.cos(n(0));
      case 'atan2':
        return Math.atan2(n(0), n(1));
      case 'lerp':
        return n(0) + (n(1) - n(0)) * n(2);
      // (The game's own random numbers, as the engine draws them.)
      case 'rand':
        return n(0) + this.rt.random() * (n(1) - n(0));
      case 'randint':
        return Math.floor(n(0) + this.rt.random() * (Math.floor(n(1)) - Math.floor(n(0)) + 1));
      case 'chance':
        return this.rt.random() < n(0);
      case 'dist': {
        const a = asEntity(v[0]);
        const b = v.length > 1 ? asEntity(v[1]) : self;
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 1e9;
      }
      case 'dx': {
        const a = asEntity(v[0]);
        return a ? a.x - self.x : 0;
      }
      case 'dy': {
        const a = asEntity(v[0]);
        return a ? a.y - self.y : 0;
      }
      case 'angle_to': {
        const a = asEntity(v[0]);
        return a ? Math.atan2(a.y - self.y, a.x - self.x) : 0;
      }
      case 'nearest':
        return this.nearest(self, show(v[0]));
      case 'count':
        return this.rt.entities.filter((o) => o.alive && o.tags.includes(show(v[0]))).length;
      case 'fits': {
        const dx = n(1);
        const dy = n(2);
        return this.groupFits(show(v[0]), (o) => ({ x: o.x + dx, y: o.y + dy }), v.length > 3 && v[3] !== null ? show(v[3]) : null);
      }
      case 'fits_turned': {
        const cx = n(1);
        const cy = n(2);
        const dir = n(3) < 0 ? -1 : 1;
        return this.groupFits(show(v[0]), (o) => turned(o.x, o.y, cx, cy, dir), v.length > 4 && v[4] !== null ? show(v[4]) : null);
      }
      case 'count_in': {
        const [x1, x2] = [Math.min(n(1), n(3)), Math.max(n(1), n(3))];
        const [y1, y2] = [Math.min(n(2), n(4)), Math.max(n(2), n(4))];
        return this.rt.entities.filter((o) => o.alive && o.tags.includes(show(v[0])) && o.x >= x1 && o.x <= x2 && o.y >= y1 && o.y <= y2).length;
      }
      case 'exists': {
        const a = asEntity(v[0]);
        return !!a && a.alive;
      }
      case 'has_tag': {
        const a = asEntity(v[0]);
        return !!a && a.tags.includes(show(v[1]));
      }
      case 'items': {
        const a = asEntity(v[0]);
        return a?.inventory?.get(show(v[1])) ?? 0;
      }
      case 'key':
        return this.input?.isDown(show(v[0]) as never) ?? false;
      case 'fire_held':
        return !!this.input && this.rt.fireHeld(self, this.input);
      case 'shot_wait':
        return this.rt.shotWait(self, n(0), n(1));
      case 'pressed':
        return this.input?.wasPressed(show(v[0]) as never) ?? false;
      case 'released':
        return this.input?.wasReleased(show(v[0]) as never) ?? false;
      case 'solid_at':
        return this.solidAt(n(0), n(1));
      case 'thing_at': {
        const x = n(0);
        const y = n(1);
        const tag = v.length > 2 && v[2] !== null ? show(v[2]) : null;
        const index = this.levelIndex();
        if (index) return index.things.first(x, y, (o) => o !== self && o.alive && (tag === null || o.tags.includes(tag)));
        return (
          this.rt.entities.find((o) => {
            if (o === self || !o.alive || (tag !== null && !o.tags.includes(tag))) return false;
            const b = this.rt.boxOf(o);
            if (b) return Math.abs(x - b.x) < b.hw && Math.abs(y - b.y) < b.hh;
            // No collider: its picture's box.
            const s = o.base.components.Sprite;
            const hw = (Number(s?.width) || 0) / 2;
            const hh = (Number(s?.height) || 0) / 2;
            return Math.abs(x - o.x) < hw && Math.abs(y - o.y) < hh;
          }) ?? null
        );
      }
      case 'can_see': {
        const a = asEntity(v[0]);
        return !!a && this.rt.canSee(self, a);
      }
      case 'touching': {
        const tag = show(v[0]);
        const who = v.length > 1 ? asEntity(v[1]) : self;
        const box = who && this.rt.boxOf(who);
        if (!who || !box) return false;
        return this.rt.entities.some((o) => o !== who && o.alive && !o.projectile && o.tags.includes(tag) && boxesOverlap(box, this.rt.boxOf(o)));
      }
      case 'on_ladder': {
        const who = v.length ? asEntity(v[0]) : self;
        return !!who && this.rt.onLadder(who);
      }
      case 'overlaps': {
        const a = asEntity(v[0]);
        const box = this.rt.boxOf(self);
        return !!a && a !== self && a.alive && !!box && boxesOverlap(box, this.rt.boxOf(a));
      }
      case 'get': {
        const a = asEntity(v[0]);
        const name = show(v[1]);
        return a?.scripts.find((i) => i.vars.has(name))?.vars.get(name) ?? 0;
      }
      case 'field': {
        const a = asEntity(v[0]);
        if (!a) return null;
        const text = show(v[1]);
        const dot = text.indexOf('.');
        const r = dot > 0 ? readField(this.rt, a, text.slice(0, dot), text.slice(dot + 1)) : { error: `field(): "${text}" should be "Component.field"` };
        if (r !== null && typeof r === 'object' && 'error' in r) {
          this.report(ctx.self, ctx.inst, `field(${a.name}, "${text}"): ${r.error}`);
          return null;
        }
        return r as Value;
      }
      case 'wall_ahead':
        return this.rt.wallAhead(self, Math.sign(n(0)), Math.sign(n(1)));
      case 'inside': {
        const who = asEntity(v[0]);
        const box = this.rt.boxOf(self);
        return !!who && !!box && Math.abs(who.x - box.x) <= box.hw && Math.abs(who.y - box.y) <= box.hh;
      }
      case 'ladder_here':
        return this.rt.ladderHere(self) !== null;
      case 'ladder_x':
        return this.rt.ladderHere(self)?.x ?? 0;
      case 'ladder_top':
        return this.rt.ladderHere(self)?.top ?? 0;
      case 'floor_below_ladder':
        return this.rt.floorBelowLadder(self);
      case 'ledge_ahead':
        return this.rt.ledgeAhead(self, Math.sign(n(0)));
      case 'ladder_choice':
        return this.rt.ladderChoice(self, Math.sign(n(0)), n(1));
      case 'shots_in_air':
        return this.rt.entities.filter((o) => o.alive && o.projectile).length;
      case 'nearest_player':
        return this.rt.nearestPlayer(self);
      case 'collects': {
        const a = asEntity(v[0]);
        return !!a && this.rt.gameplay.canCollect(a, ctx.self);
      }
      case 'has_component': {
        const a = asEntity(v[0]);
        return !!a && !!a.base.components[show(v[1])];
      }
    }
    return null;
  }

  private report(e: RuntimeEntity, inst: ScriptInstance, message: string): void {
    const key = `${inst.script.id}|${message}`;
    if (this.reported.has(key) || this.errors.length >= MAX_ERRORS) return;
    this.reported.add(key);
    this.errors.push({ entity: e.name, script: inst.script.name, message });
    this.rt.gameplay.emit('script_error', e, null, { script: inst.script.name, message });
  }
}

// ---------------------------------------------------------------- values

function boxesOverlap(a: Box, b: Box | null): boolean {
  return !!b && overlaps(a, b);
}

function isEntity(v: Value): v is RuntimeEntity {
  return typeof v === 'object' && v !== null;
}

function asEntity(v: Value): RuntimeEntity | null {
  return isEntity(v) ? v : null;
}

export function truthy(v: Value): boolean {
  if (isEntity(v)) return true;
  return !!v;
}

function num(v: Value): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const x = Number(v);
    return Number.isFinite(x) ? x : 0;
  }
  return 0;
}

function same(a: Value, b: Value): boolean {
  if (typeof a === 'number' || typeof b === 'number') return typeof a !== 'object' && typeof b !== 'object' ? num(a) === num(b) : a === b;
  return a === b;
}

function show(v: Value): string {
  if (typeof v === 'number') return String(Math.round(v * 100) / 100);
  if (isEntity(v)) return v.name;
  if (v === null) return '';
  return String(v);
}

function member(e: RuntimeEntity | null, name: string): Value {
  if (!e) return name === 'name' ? '' : name === 'alive' || name === 'grounded' || name === 'climbing' || name === 'open' || name === 'on' ? false : 0;
  switch (name) {
    case 'x':
      return e.x;
    case 'y':
      return e.y;
    case 'vx':
      return e.vx;
    case 'vy':
      return e.vy;
    case 'width':
      return e.collider ? e.collider.hw * 2 : 0;
    case 'height':
      return e.collider ? e.collider.hh * 2 : 0;
    case 'grounded':
      return e.grounded;
    case 'climbing':
      return e.climbing;
    case 'hanging':
      return e.hanging !== null;
    case 'facing':
      return e.facing;
    case 'angle':
      return e.angle;
    case 'health':
      return e.health?.current ?? 0;
    case 'max_health':
      return e.health?.max ?? 0;
    case 'alive':
      return e.alive;
    case 'dead':
      return e.dying > 0 || !e.alive;
    case 'open':
      return e.open;
    case 'on':
      return e.switch?.on ?? false;
    case 'spawn_x':
      return e.spawn.x;
    case 'bumped':
      return e.bumped;
    case 'following':
      return e.chasing;
    case 'blinking':
      return e.invincible > 0;
    case 'climb_dir':
      return e.climbDir;
    case 'heading_x':
      return e.heading.x;
    case 'heading_y':
      return e.heading.y;
    case 'spawn_y':
      return e.spawn.y;
    case 'gravity':
      return e.gravityScale;
    case 'speed_factor':
      return e.speedFactor;
    case 'grip':
      return groundGrip(e.friction, e.groundFriction);
    case 'feet':
      return feetOf(e);
    case 'hang_side':
      return e.hanging?.side ?? 0;
    case 'name':
      return e.name;
  }
  return 0;
}

/** A point turned a quarter around (cx, cy): dir 1 clockwise on screen (right goes down), -1 the other way. */
function turned(x: number, y: number, cx: number, cy: number, dir: 1 | -1): { x: number; y: number } {
  const dx = x - cx;
  const dy = y - cy;
  return dir === 1 ? { x: cx - dy, y: cy + dx } : { x: cx + dy, y: cy - dx };
}
