/**
 * The level's problems, looked for without holding up the editor (docs §30, W1.1).
 *
 * Looking for them reads the whole level, in one piece, on the same thread the editor draws and listens on: about a
 * hundredth of a millisecond for each thing, so nothing in a level of hundreds of things and a second or more in one
 * of a hundred thousand. So:
 *  - a small level is looked at at once, at every change, as always;
 *  - a bigger one is looked at when the editor has been left alone for a moment (nothing pressed, typed or scrolled),
 *    if the look is expected to be short enough not to be felt;
 *  - a level too big for that is looked at when the user asks.
 * What is shown in between is what was found last, and it is said to be so: `state` is never "current" for a level
 * that has changed since it was looked at.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { componentRegistry } from '../core/components/builtin';
import { diagnoseLevel, type Problem } from '../core/debug/diagnose';
import type { Project } from '../core/types';
import { useEditor } from './store';

/** Below this many things a level is looked at at once (it takes a few milliseconds). */
export const AT_ONCE_BELOW = 4000;
/** How long the editor is left alone before a look that was put off is made. */
export const QUIET_MS = 700;
/** A look expected to take longer than this is not made unasked. */
export const UNASKED_MS = 150;
/** Milliseconds a look takes for each thing, until one has been timed here (measured: 0.011 at 31,000 things). */
const FIRST_RATE = 0.012;

export type CheckWhen = 'at once' | 'when quiet' | 'when asked';
/** current: of the level as it is. soon: of an earlier state, a look follows by itself. ask: of an earlier state (or none), until asked. checking: being looked at now. */
export type CheckState = 'current' | 'soon' | 'ask' | 'checking';

export interface LevelCheck {
  problems: Problem[];
  state: CheckState;
  /** Whether this level has been looked at at all (false: `problems` is empty because nothing is known). */
  looked: boolean;
  things: number;
  /** How long a look is expected to take, in milliseconds. */
  expectedMs: number;
}

/** When a level of this many things is looked at, given how long a look takes for each thing. */
export function checkWhen(things: number, msPerThing: number): CheckWhen {
  if (things < AT_ONCE_BELOW) return 'at once';
  return things * msPerThing <= UNASKED_MS ? 'when quiet' : 'when asked';
}

let last: { project: Project; sceneId: string; problems: Problem[] } | null = null;
let rate = FIRST_RATE;
/** (Tests: the time for each thing is this, whatever a look really takes on the machine they run on.) */
let fixedRate: number | null = null;
let busy = false;
let wanted: { project: Project; sceneId: string } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastInput = 0;
let tick = 0;
const watchers = new Set<() => void>();
const changed = () => {
  tick++;
  for (const w of watchers) w();
};
const now = () => performance.now();
const thingsIn = (project: Project, sceneId: string) => project.scenes.find((s) => s.id === sceneId)?.entities.length ?? 0;

if (typeof window !== 'undefined') {
  const used = () => void (lastInput = now());
  for (const type of ['pointerdown', 'pointerup', 'keydown', 'wheel'] as const) window.addEventListener(type, used, { capture: true, passive: true });
  window.addEventListener('pointermove', (e) => void (e.buttons && used()), { capture: true, passive: true });
}

/** Looks at the level now (in one piece), keeps what is found and how long it took. */
function look(project: Project, sceneId: string): Problem[] {
  if (last && last.project === project && last.sceneId === sceneId) return last.problems;
  const t0 = now();
  const problems = diagnoseLevel(project, sceneId, componentRegistry);
  const things = thingsIn(project, sceneId);
  // (Timed on big levels only: a small one says little about the time for each thing.)
  if (things >= AT_ONCE_BELOW && fixedRate === null) rate = Math.max(0.001, (now() - t0) / things);
  last = { project, sceneId, problems };
  return problems;
}

/** A level that is looked at "when quiet" has changed: a look follows once the editor has been left alone. */
function lookWhenQuiet(project: Project, sceneId: string): void {
  wanted = { project, sceneId };
  if (timer !== null) return;
  const fire = () => {
    timer = null;
    if (!wanted) return;
    const quiet = now() - lastInput;
    if (quiet < QUIET_MS) {
      timer = setTimeout(fire, QUIET_MS - quiet + 10);
      return;
    }
    const { project: p, sceneId: s } = wanted;
    wanted = null;
    look(p, s);
    changed();
  };
  timer = setTimeout(fire, QUIET_MS);
}

/** The user asks: "Checking…" is shown first, then the level is looked at. */
export function checkLevelNow(): void {
  if (busy) return;
  busy = true;
  changed();
  setTimeout(() => {
    const s = useEditor.getState();
    try {
      look(s.project, s.activeSceneId);
    } finally {
      busy = false;
      changed();
    }
  }, 40);
}

/** What is known of the level's problems, and how current it is. */
export function levelCheck(project: Project, sceneId: string): LevelCheck {
  const things = thingsIn(project, sceneId);
  const expectedMs = things * rate;
  const when = checkWhen(things, rate);
  if (when === 'at once') return { problems: look(project, sceneId), state: 'current', looked: true, things, expectedMs };
  const mine = last && last.sceneId === sceneId ? last : null;
  const state: CheckState = mine && mine.project === project ? 'current' : busy ? 'checking' : when === 'when quiet' ? 'soon' : 'ask';
  return { problems: mine?.problems ?? [], state, looked: !!mine, things, expectedMs };
}

/** The level's problems for the editor's panels, kept as current as its size allows (see the top of this file). */
export function useLevelCheck(): LevelCheck {
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.activeSceneId);
  useSyncExternalStore(
    (w) => {
      watchers.add(w);
      return () => void watchers.delete(w);
    },
    () => tick,
  );
  const check = levelCheck(project, sceneId);
  useEffect(() => {
    if (check.state === 'soon') lookWhenQuiet(project, sceneId);
  }, [project, sceneId, check.state]);
  return check;
}

/** For tests: as if nothing had been looked at or timed yet (`msPerThing`: a look takes this, and stays so). */
export function resetLevelCheck(msPerThing?: number): void {
  last = null;
  fixedRate = msPerThing ?? null;
  rate = msPerThing ?? FIRST_RATE;
  busy = false;
  wanted = null;
  if (timer !== null) clearTimeout(timer);
  timer = null;
  lastInput = 0;
}

/** For tests: the editor was just used (a key, a click). */
export function noteInput(): void {
  lastInput = now();
}
export const lookSoon = lookWhenQuiet;
