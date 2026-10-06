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
import { checkScript, type BehaviorScript, type Handler, type Stmt } from '../core/script/language';
import type { Project } from '../core/types';
import type { GameEvent } from './gameplay';
import type { InputState } from './input';
import type { Runtime, RuntimeEntity } from './runtime';

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

const RUN_BUDGET = 2000;
const STEP_BUDGET = 60000;
const MAX_EACH = 200;
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
}

export class ScriptSystem {
  readonly errors: ScriptError[] = [];
  private readonly parsed = new Map<string, Expr>();
  private readonly valid = new WeakMap<BehaviorScript, boolean>();
  private readonly reported = new Set<string>();
  private input: InputState | null = null;
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

  before(dt: number, input: InputState): void {
    this.input = input;
    this.stepBudget = STEP_BUDGET;
    const gen = this.generation;
    for (const e of this.rt.entities.slice()) {
      if (!e.alive || !e.scripts.length) continue;
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
          if (w.on === 'tick') this.run(e, inst, h, null);
          else if (w.on === 'every') {
            inst.timers[i] += dt;
            if (inst.timers[i] >= w.seconds) {
              inst.timers[i] -= w.seconds;
              // Never more than one catch-up per step.
              inst.timers[i] = Math.min(inst.timers[i], w.seconds);
              this.run(e, inst, h, null);
            }
          } else if (w.on === 'key') {
            const hit = w.edge === 'pressed' ? input.wasPressed(w.key) : w.edge === 'held' ? input.isDown(w.key) : input.wasReleased(w.key);
            if (hit) this.run(e, inst, h, null);
          }
        });
        if (gen !== this.generation) return;
      }
    }
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

  private runWhere(e: RuntimeEntity, inst: ScriptInstance, pick: (h: Handler) => boolean, other: RuntimeEntity | null): void {
    const gen = this.generation;
    for (const h of inst.script.handlers) {
      if (gen !== this.generation) return;
      if (pick(h)) this.run(e, inst, h, other);
    }
  }

  private run(e: RuntimeEntity, inst: ScriptInstance, h: Handler, other: RuntimeEntity | null, chain = 0): void {
    if (h.state !== null && h.state !== inst.state) return;
    const ctx: Ctx = { self: e, inst, other, it: null };
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
        const all = this.rt.entities.filter((o) => o.alive && o.tags.includes(s.tag)).slice(0, MAX_EACH);
        const prev = ctx.it;
        for (const o of all) {
          ctx.it = o;
          this.exec(s.then, ctx, chain);
        }
        ctx.it = prev;
        break;
      }
      case 'velocity':
        if (s.x !== null) e.vx = n(s.x);
        if (s.y !== null) e.vy = n(s.y);
        break;
      case 'push':
        e.vx += n(s.x);
        e.vy += n(s.y);
        break;
      case 'move_toward': {
        const t = ent(s.target);
        const speed = n(s.speed);
        if (!t || t === e) break;
        const dx = t.x - e.x;
        const dy = t.y - e.y;
        if (e.gravityScale === 0 || e.body !== 'dynamic') {
          const d = Math.hypot(dx, dy);
          e.vx = d > 1 ? (dx / d) * speed : 0;
          e.vy = d > 1 ? (dy / d) * speed : 0;
        } else e.vx = Math.abs(dx) > 1 ? Math.sign(dx) * speed : 0;
        if (Math.abs(dx) > 1) e.facing = dx < 0 ? -1 : 1;
        this.makeMovable(e);
        break;
      }
      case 'glide_to':
        this.rt.moveTo(e, { x: n(s.x), y: n(s.y) }, Math.max(0, n(s.speed)));
        break;
      case 'position':
        e.x = n(s.x);
        e.y = n(s.y);
        if (e.body !== 'dynamic') this.rt.markSolidsDirty();
        break;
      case 'jump':
        e.vy = -n(s.force);
        e.grounded = false;
        break;
      case 'face': {
        const d = n(s.dir);
        if (d !== 0) e.facing = d < 0 ? -1 : 1;
        break;
      }
      case 'gravity':
        e.gravityScale = n(s.scale);
        break;
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
        if (made) gp.emit('spawned', made, e);
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
        if (t?.health && t.alive && t.invincible <= 0) gp.hurt(t, Math.max(0, n(s.amount)), e);
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
        if (t) gp.setOpen(t, truthy(this.eval(s.open, ctx)), e);
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
      case 'alpha':
        e.alpha = Math.min(1, Math.max(0, n(s.value)));
        break;
      case 'respawn': {
        const t = ent(s.target);
        if (t) this.rt.respawn(t);
        break;
      }
      case 'restart_level':
        this.rt.restart();
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
        return member(asEntity(this.value(e.obj, ctx)), e.name);
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
      case 'player':
        return this.nearest(ctx.self, 'player');
      case 'time':
        return this.rt.time;
      case 'dt':
        return 1 / 60;
      case 'state':
        return ctx.inst.state;
      case 'state_time':
        return ctx.inst.stateTime;
      case 'pi':
        return Math.PI;
    }
    return ctx.inst.vars.get(name) ?? 0;
  }

  private nearest(from: RuntimeEntity, tag: string): RuntimeEntity | null {
    let best: RuntimeEntity | null = null;
    let bestD = Infinity;
    for (const o of this.rt.entities) {
      if (o === from || !o.alive || o.projectile || !o.tags.includes(tag)) continue;
      const d = Math.hypot(o.x - from.x, o.y - from.y);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private solidAt(x: number, y: number): boolean {
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
      case 'rand':
        return n(0) + Math.random() * (n(1) - n(0));
      case 'randint':
        return Math.floor(n(0) + Math.random() * (Math.floor(n(1)) - Math.floor(n(0)) + 1));
      case 'chance':
        return Math.random() < n(0);
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
      case 'pressed':
        return this.input?.wasPressed(show(v[0]) as never) ?? false;
      case 'solid_at':
        return this.solidAt(n(0), n(1));
      case 'can_see': {
        const a = asEntity(v[0]);
        if (!a) return false;
        const d = Math.hypot(a.x - self.x, a.y - self.y);
        const steps = Math.min(200, Math.ceil(d / 8));
        for (let i = 1; i < steps; i++) {
          if (this.solidAt(self.x + ((a.x - self.x) * i) / steps, self.y + ((a.y - self.y) * i) / steps)) return false;
        }
        return true;
      }
      case 'get': {
        const a = asEntity(v[0]);
        const name = show(v[1]);
        return a?.scripts.find((i) => i.vars.has(name))?.vars.get(name) ?? 0;
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
  if (!e) return name === 'name' ? '' : name === 'alive' || name === 'grounded' || name === 'open' || name === 'on' ? false : 0;
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
    case 'facing':
      return e.facing;
    case 'health':
      return e.health?.current ?? 0;
    case 'max_health':
      return e.health?.max ?? 0;
    case 'alive':
      return e.alive;
    case 'open':
      return e.open;
    case 'on':
      return e.switch?.on ?? false;
    case 'spawn_x':
      return e.spawn.x;
    case 'spawn_y':
      return e.spawn.y;
    case 'name':
      return e.name;
  }
  return 0;
}
