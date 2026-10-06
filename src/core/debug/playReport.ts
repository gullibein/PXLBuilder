/**
 * What happened in a play session, as plain data: the runtime records it
 * (runtime/recorder.ts), the editor keeps the last one, and the AI reads a
 * compact summary of it to answer "why did the player die?" or "why doesn't
 * this door open?". Never saved with the project.
 */
import type { Id } from '../types';

export interface PlayEvent {
  time: number;
  type: string;
  subject: string | null;
  other: string | null;
  subjectId?: Id;
  otherId?: Id;
  detail?: Record<string, unknown>;
}

/** Where something was at one moment. */
export interface PlaySample {
  t: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  alive: boolean;
  health?: number;
  /** The state of its first script with states. */
  state?: string;
}

/** Everything worth knowing about one entity at the end of the session. */
export interface PlayEntityState {
  id: Id;
  name: string;
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  climbing?: boolean;
  health?: string;
  open?: boolean;
  switchOn?: boolean;
  items?: Record<string, number>;
  scripts?: { name: string; state: string; vars: Record<string, string | number | boolean | null> }[];
  speedFactor?: number;
  gravity?: number;
  touching?: string[];
  respawns?: number;
  hidden?: boolean;
}

export interface PlayReport {
  sceneId: Id;
  levelName: string;
  /** Play time in seconds (restarts included). */
  duration: number;
  restarts: number;
  events: PlayEvent[];
  /** Earlier events dropped to keep the report small. */
  eventsDropped: number;
  traces: { id: Id; name: string; samples: PlaySample[] }[];
  final: PlayEntityState[];
  scriptErrors: { entity: string; script: string; message: string }[];
  /** On-screen messages shown during play, in order (each once). */
  messages: string[];
}

/** The summary the AI gets: small enough to send with every request. */
export interface PlaySummary {
  level: string;
  seconds: number;
  restarts: number;
  /** Plain counts first, so the obvious answers are cheap. */
  counts: Record<string, number>;
  /** The most recent events (touches between the same two things are merged: "×N"). */
  events: string[];
  eventsLeftOut: number;
  /** Movement of the player and the asked-about entities, every quarter second (last part of the session). */
  traces: { id: Id; name: string; samples: string[] }[];
  /** How things were when play stopped (the player, the asked-about entities, then anything notable). */
  final: PlayEntityState[];
  scriptErrors: PlayReport['scriptErrors'];
  messages: string[];
}

const MAX_SUMMARY_EVENTS = 160;
const MAX_TRACE_SAMPLES = 48;
const MAX_FINAL = 40;

const r1 = (n: number) => Math.round(n * 10) / 10;

function eventText(e: PlayEvent): string {
  const who = (name: string | null, id?: Id) => (name === null ? '' : id ? `${name}#${id.slice(-4)}` : name);
  const detail = e.detail && Object.keys(e.detail).length ? ` ${JSON.stringify(e.detail)}` : '';
  const other = e.other !== null ? ` > ${who(e.other, e.otherId)}` : '';
  return `${e.time.toFixed(2)}s ${e.type} ${who(e.subject, e.subjectId)}${other}${detail}`;
}

/**
 * The summary for the AI. `focus` are the entities the user asked about (the
 * selection): their traces and states come first, along with the player's.
 */
export function summarizePlay(report: PlayReport, focus: readonly Id[], playerIds: readonly Id[]): PlaySummary {
  const counts: Record<string, number> = {};
  for (const e of report.events) counts[e.type] = (counts[e.type] ?? 0) + 1;

  // touch_ended is implied by the next touch; repeated touches of the same pair are merged.
  const merged: { e: PlayEvent; n: number }[] = [];
  for (const e of report.events) {
    if (e.type === 'touch_ended') continue;
    const last = merged.at(-1);
    if (last && e.type === 'touch_started' && last.e.type === 'touch_started' && last.e.subjectId === e.subjectId && last.e.otherId === e.otherId) last.n++;
    else merged.push({ e, n: 1 });
  }
  const kept = merged.slice(-MAX_SUMMARY_EVENTS);
  const events = kept.map(({ e, n }) => eventText(e) + (n > 1 ? ` ×${n}` : ''));

  const important = new Set<Id>([...playerIds, ...focus]);
  const traces = report.traces
    .filter((t) => important.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      samples: t.samples.slice(-MAX_TRACE_SAMPLES).map((s) => `${s.t.toFixed(2)}s ${r1(s.x)},${r1(s.y)} v ${r1(s.vx)},${r1(s.vy)}${s.grounded ? ' ground' : ''}${s.alive ? '' : ' gone'}${s.health !== undefined ? ` hp ${s.health}` : ''}${s.state ? ` [${s.state}]` : ''}`),
    }));

  const notable = (s: PlayEntityState) => !!(s.health || s.scripts || s.open !== undefined || s.switchOn !== undefined || s.items || !s.alive || s.respawns || s.hidden);
  const rank = (s: PlayEntityState) => (playerIds.includes(s.id) ? 0 : focus.includes(s.id) ? 1 : notable(s) ? 2 : 3);
  const final = report.final
    .filter((s) => rank(s) < 3)
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_FINAL);

  return {
    level: report.levelName,
    seconds: r1(report.duration),
    restarts: report.restarts,
    counts,
    events,
    eventsLeftOut: report.eventsDropped + merged.length - kept.length,
    traces,
    final,
    scriptErrors: report.scriptErrors,
    messages: report.messages.slice(-20),
  };
}
