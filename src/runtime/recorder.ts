/**
 * Records a play session for debugging (by the user and the AI): every event,
 * a short movement trace of the things that matter (the player, anything with
 * health, scripts or a behavior), and how everything was at the end. It only
 * reads the runtime; the game plays the same with or without it.
 */
import type { PlayEntityState, PlayEvent, PlayReport, PlaySample } from '../core/debug/playReport';
import type { Id } from '../core/types';
import type { Runtime, RuntimeEntity } from './runtime';

const SAMPLE_EVERY = 0.25;
/** Samples kept per entity (the last 30 seconds). */
const MAX_SAMPLES = 120;
const MAX_WATCHED = 16;
const MAX_EVENTS = 3000;

const r1 = (n: number) => Math.round(n * 10) / 10;

export class PlayRecorder {
  private readonly events: PlayEvent[] = [];
  private dropped = 0;
  private restarts = 0;
  private readonly traces = new Map<Id, { name: string; samples: PlaySample[] }>();
  private readonly messages: string[] = [];
  private nextSample = 0;

  constructor(private readonly rt: Runtime) {
    // What the runtime logged before we started listening (the level start).
    for (const e of rt.eventLog) this.events.push({ ...e });
    rt.onLog = (e) => {
      if (e.type === 'level_started' && this.events.length) this.restarts++;
      this.events.push({ ...e });
      if (this.events.length > MAX_EVENTS) {
        this.events.shift();
        this.dropped++;
      }
    };
    this.sample();
  }

  /** Call after each runtime update. */
  sample(): void {
    for (const m of this.rt.messages) if (this.messages.at(-1) !== m && !this.messages.slice(-5).includes(m)) this.messages.push(m);
    if (this.rt.time < this.nextSample) return;
    this.nextSample = this.rt.time + SAMPLE_EVERY;
    for (const e of this.watched()) {
      let trace = this.traces.get(e.id);
      if (!trace) this.traces.set(e.id, (trace = { name: e.name, samples: [] }));
      trace.samples.push({
        t: Math.round(this.rt.time * 100) / 100,
        x: r1(e.x),
        y: r1(e.y),
        vx: r1(e.vx),
        vy: r1(e.vy),
        grounded: e.grounded,
        alive: e.alive,
        ...(e.health ? { health: e.health.current } : {}),
        ...(e.scripts.find((s) => s.script.states.length) ? { state: e.scripts.find((s) => s.script.states.length)!.state } : {}),
      });
      if (trace.samples.length > MAX_SAMPLES) trace.samples.shift();
    }
  }

  /** The entities worth tracing: players first, then things that move or can be hurt. */
  private watched(): RuntimeEntity[] {
    const score = (e: RuntimeEntity) => (e.controller ? 0 : e.health || e.scripts.length ? 1 : e.body === 'dynamic' || e.beh.patrol || e.moveTarget ? 2 : 9);
    return this.rt.entities
      .filter((e) => !e.projectile && score(e) < 9)
      .sort((a, b) => score(a) - score(b))
      .slice(0, MAX_WATCHED);
  }

  report(): PlayReport {
    this.sample();
    return {
      sceneId: this.rt.scene.id,
      levelName: this.rt.scene.name,
      duration: r1(this.rt.time),
      restarts: this.restarts,
      events: this.events.slice(),
      eventsDropped: this.dropped,
      traces: [...this.traces].map(([id, t]) => ({ id, name: t.name, samples: t.samples.slice() })),
      final: this.rt.entities.filter((e) => !e.projectile).map((e) => stateOf(this.rt, e)),
      scriptErrors: this.rt.scripts.errors.map((e) => ({ ...e })),
      messages: this.messages.slice(),
    };
  }

  /** Stops listening to the runtime. */
  stop(): void {
    this.rt.onLog = null;
  }
}

function plain(v: unknown): string | number | boolean | null {
  if (v === null || typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return typeof v === 'number' ? r1(v) : v;
  if (typeof v === 'object' && v && 'name' in v) return `→${(v as RuntimeEntity).name}`;
  return null;
}

function stateOf(rt: Runtime, e: RuntimeEntity): PlayEntityState {
  return {
    id: e.id,
    name: e.name,
    alive: e.alive,
    x: r1(e.x),
    y: r1(e.y),
    vx: r1(e.vx),
    vy: r1(e.vy),
    grounded: e.grounded,
    ...(e.climbing ? { climbing: true } : {}),
    ...(e.health ? { health: `${e.health.current}/${e.health.max}` } : {}),
    ...(e.base.components.Openable ? { open: e.open } : {}),
    ...(e.switch ? { switchOn: e.switch.on } : {}),
    ...(e.inventory && e.inventory.size ? { items: Object.fromEntries(e.inventory) } : {}),
    ...(e.scripts.length
      ? { scripts: e.scripts.map((s) => ({ name: s.script.name, state: s.state, vars: Object.fromEntries([...s.vars].map(([k, v]) => [k, plain(v)])) })) }
      : {}),
    ...(e.speedFactor !== 1 ? { speedFactor: e.speedFactor } : {}),
    ...(e.gravityScale !== e.baseGravity ? { gravity: e.gravityScale } : {}),
    ...(e.touching.size ? { touching: [...e.touching].map((id) => rt.byId(id)?.name ?? id) } : {}),
    ...(e.respawns ? { respawns: e.respawns } : {}),
    ...(e.hiddenBySwitch ? { hidden: true } : {}),
  };
}
