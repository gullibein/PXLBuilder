/**
 * What the play probe saw (runtime/playProbe.ts), as plain data: a level played for a bounded time on the real
 * runtime, without and with keys pressed. Four things, kept apart (docs/engine-architecture-proposal.md §24.5):
 *
 *  1. it ran without runtime faults, or the faults (script errors, the engine stopping, a place that is no number):
 *     these are wrong whatever the game is;
 *  2. for each key something in the level listens to: whether pressing it changed anything;
 *  3. whether anything happens by itself, and whether the level is one where that is expected;
 *  4. suspicious things seen: what often means a broken game and may as well be how this one is meant to play (a
 *     character that never moves, a start that kills, a level that ends by itself, things made without end).
 *
 * Only the first is a fault. The probe knows no kind of game, so it can't tell a mistake from a design: what is
 * suspicious is said as seen, and is only held against a game by a caller who says it isn't meant (probeUnmet).
 *
 * It says what was seen in that time, and nothing more: not that a level can be won, is fair, or does what was
 * meant. It is no validator's verdict, and never makes an uncertain level validated.
 */
import type { Id } from '../types';

export type ProbeAction = 'left' | 'right' | 'up' | 'down' | 'jump' | 'interact' | 'fire' | 'special' | 'menu';

/** Something in the level that reads a key. */
export interface ProbeListener {
  who: string;
  /** What it does with the key, after its name: "moves with it", "shoots with it". */
  how: string;
  /** always: wherever it is and whatever went before; sometimes: only in some place or state. */
  when: 'always' | 'sometimes';
  /** The engine's own reading of the key (a movement model, a Shooter): no script decides whether it counts. */
  engine: boolean;
}

export interface ProbeInput {
  action: ProbeAction;
  listeners: ProbeListener[];
  /** seen: pressing it changed something; none: pressed, and nothing changed; not_tried: why is in `unjudged`. */
  response: 'seen' | 'none' | 'not_tried';
  /** What changed, in words (the first that showed). */
  what: string[];
  /** Seconds into the run when it showed. */
  at?: number;
  /** It only changed something once this key had been pressed first. */
  after?: ProbeAction;
}

/**
 * The kinds of suspicious things seen. Each is a measure with a fixed limit, not a judgement:
 * immobile: a steered character's own movement keys never changed its place; silent_shooter: a Shooter's key changed
 * nothing; nothing_acts: everything set to act by itself stood still and nothing else happened; early_setback: in
 * every run a steered character died or was put back, or the level started over, within 2 s; early_win: the level
 * was won within 1 s with no key pressed; many_things: 500 more things than at the start.
 */
export type ProbeSuspicion = 'immobile' | 'silent_shooter' | 'nothing_acts' | 'early_setback' | 'early_win' | 'many_things';
export const PROBE_SUSPICIONS: readonly ProbeSuspicion[] = ['immobile', 'silent_shooter', 'nothing_acts', 'early_setback', 'early_win', 'many_things'];

export interface ProbeSuspect {
  kind: ProbeSuspicion;
  /** What was seen, in words. */
  text: string;
}

export interface ProbeError {
  /** Whose (and which script), or "the engine". */
  where: string;
  message: string;
  /** The keys pressed in the run it showed in (null: none). */
  pressing: string | null;
}

export interface ProbeReport {
  sceneId: Id;
  levelName: string;
  /** The same seed, game and budget give the same report. */
  seed: number;
  /** Seconds of the game's own time played over all runs, of the budget given. */
  seconds: { played: number; budget: number };
  runs: number;
  /** 1. Runtime faults: script errors, the game's own errors, the engine stopping, a place that is no number. Wrong whatever the game is. Empty: it ran without any. */
  errors: ProbeError[];
  /** 2. Each key something listens to. */
  inputs: ProbeInput[];
  /** 3. What happened with no key pressed. */
  byItself: {
    seen: boolean;
    what: string[];
    /** Only variables changed: nothing to see or hear. */
    hiddenOnly: boolean;
    /** yes: something in the level is set to act by itself; waits: it takes turns or shows a menu, so it waits for the player; unknown: nothing says either. */
    expected: 'yes' | 'waits' | 'unknown';
    why: string;
    /** Things set to act by themselves that didn't. */
    still: string[];
  };
  /** 4. Suspicious things seen: often a broken game, maybe how this one is meant to play. Not faults. */
  suspicious: ProbeSuspect[];
  /** Things seen that may or may not be meant. */
  notes: string[];
  /** What wasn't judged, and why. */
  unjudged: string[];
}

/** Whether the probe found a runtime fault: the only thing it calls wrong. None found is not "validated". */
export const probeFound = (r: ProbeReport): boolean => r.errors.length > 0;

const list = (items: string[], most = 3) => (items.length > most ? `${items.slice(0, most).join(', ')} and ${items.length - most} more` : items.join(', '));

/** The report in lines of plain words, its four parts apart (for the editor and the AI). */
export function probeLines(r: ProbeReport, keyName: (a: ProbeAction) => string = (a) => a): { part: 'runs' | 'inputs' | 'by_itself' | 'suspicious' | 'notes' | 'unjudged'; ok: boolean | null; text: string }[] {
  const out: ReturnType<typeof probeLines> = [];
  const played = `${Math.round(r.seconds.played)} s of play in ${r.runs} runs`;
  if (r.errors.length) for (const e of r.errors) out.push({ part: 'runs', ok: false, text: `Runtime fault in ${e.where}: ${e.message}${e.pressing ? ` (while pressing ${e.pressing})` : ''}` });
  else out.push({ part: 'runs', ok: true, text: `It ran without runtime faults (${played}).` });
  for (const i of r.inputs) {
    const who = list([...new Set(i.listeners.map((l) => `${l.who} ${l.how}`))], 2);
    if (i.response === 'seen') out.push({ part: 'inputs', ok: true, text: `${keyName(i.action)}: ${list(i.what)}${i.after ? ` (only after ${keyName(i.after)})` : ''}.` });
    else if (i.response === 'none' && i.listeners.some((l) => l.when === 'always')) out.push({ part: 'inputs', ok: false, text: `${keyName(i.action)}: pressing it changed nothing, though ${who}.` });
    else if (i.response === 'none') out.push({ part: 'inputs', ok: null, text: `${keyName(i.action)}: pressing it changed nothing where it was tried (${who}).` });
    else out.push({ part: 'inputs', ok: null, text: `${keyName(i.action)}: not tried.` });
  }
  if (!r.inputs.length) out.push({ part: 'inputs', ok: null, text: 'Nothing in the level listens to a key.' });
  const b = r.byItself;
  const expects = b.expected === 'yes' ? ` (${b.why})` : b.expected === 'waits' ? ` (${b.why}: waiting for the player is right)` : b.why ? ` (${b.why})` : '';
  out.push({
    part: 'by_itself',
    ok: b.seen && !b.hiddenOnly ? true : b.expected === 'yes' ? false : null,
    text: b.seen ? (b.hiddenOnly ? `With no key pressed, only variables changed: nothing to see${expects}.` : `With no key pressed: ${list(b.what, 4)}${b.expected === 'yes' ? '' : expects}.`) : `With no key pressed, nothing happened${expects}.`,
  });
  // (No judgement: the probe can't tell a mistake from a design.)
  for (const s of r.suspicious) out.push({ part: 'suspicious', ok: null, text: s.text });
  for (const n of r.notes) out.push({ part: 'notes', ok: null, text: n });
  for (const u of r.unjudged) out.push({ part: 'unjudged', ok: null, text: u });
  return out;
}

/**
 * What a caller that knows what the game is meant to be expects of the report, and what of it wasn't seen, in words
 * (none: all of it was). The probe itself has no idea of genres: a shooter's caller asks for its fire key and for
 * things acting by themselves; a tactics game's caller asks for neither. The same for what is suspicious: a caller
 * says which of it isn't meant in its game (a platformer's: a hero that can't be moved, dying at the start), and
 * only then is it held against the game.
 */
export interface ProbeExpectations {
  /** Keys that must change something. */
  keys?: ProbeAction[];
  /** Something to see must happen with no key pressed. */
  byItself?: boolean;
  /** Runtime faults count (the default: they are wrong in every game). */
  noErrors?: boolean;
  /** The suspicious things that are not meant in this game ("any": none of them is). Unsaid, none is held against it. */
  notMeant?: readonly ProbeSuspicion[] | 'any';
}

export function probeUnmet(r: ProbeReport, want: ProbeExpectations): string[] {
  const out: string[] = [];
  if (want.noErrors !== false) for (const e of r.errors) out.push(`runtime fault in ${e.where}: ${e.message}`);
  const notMeant = want.notMeant === 'any' ? PROBE_SUSPICIONS : (want.notMeant ?? []);
  for (const s of r.suspicious) if (notMeant.includes(s.kind)) out.push(`not meant (${s.kind}): ${s.text}`);
  for (const k of want.keys ?? []) {
    const i = r.inputs.find((x) => x.action === k);
    if (!i) out.push(`nothing in the level listens to ${k}`);
    else if (i.response === 'none') out.push(`pressing ${k} changed nothing`);
    else if (i.response === 'not_tried') out.push(`${k} was not tried`);
  }
  if (want.byItself && !(r.byItself.seen && !r.byItself.hiddenOnly)) out.push('nothing to see happened by itself');
  return out;
}

/** What the probe doesn't say: shown with every report. */
export const PROBE_LIMITS = 'This is what was seen in a short time of play. It does not say the level can be won, is fair, or plays as meant.';
