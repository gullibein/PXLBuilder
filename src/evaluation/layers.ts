/**
 * The layers every case shares, each asked of a game as it is (no model involved): Shape (is it the kind of game
 * asked for, as big as asked, and is it what Play starts), Runs (the play probe, with the case's expectations) and
 * Size and load (how big, how much acts, against what the engine was measured to run: §30.13). "Built" comes from
 * how the game was made (replay.ts); "Plays" from the case's own script (plays.ts).
 */
import { checkCoverIndex } from '../core/commands/operations';
import { isTopDownScene } from '../core/model/topDown';
import type { Id, Scene } from '../core/types';
import { probeLevel } from '../runtime/playProbe';
import { Runtime } from '../runtime/runtime';
import { failed, judged, notJudged, passed, type Check } from './verdict';
import { begin, levelSize, run, type PlayCtx } from './watch';

export interface ShapeAsk {
  /** character: something is steered with the keys by a movement model; none: nothing walks (a board, a table, cards); any: either. */
  steered: 'character' | 'none' | 'any';
  view: 'side' | 'top' | 'iso' | 'any';
  /** Levels with something in them, at least. */
  levels?: number;
  /** Something whose script holds the game's rules (games that are not levels to get through). */
  rules?: boolean;
  /** Engine parts the steered character must have (components: Dash, WallJump). */
  abilities?: string[];
  /** The level Play starts is at least this many screens big (one screen: 30 by 17 cells). */
  minScreens?: number;
}

const list = (items: string[], most = 4) => (items.length > most ? `${items.slice(0, most).join(', ')} and ${items.length - most} more` : items.join(', '));

interface LevelFacts {
  scene: Scene;
  steered: string[];
  /** Things with a script of four handlers or more that are not steered (where a game's rules live). */
  rules: string[];
  abilities: Set<string>;
  view: 'side' | 'top' | 'iso';
}

function facts(ctx: PlayCtx, scene: Scene): LevelFacts | { scene: Scene; error: string } {
  try {
    return run({ ...ctx, sceneId: scene.id }, (g) => {
      g.wait(0.2);
      const steered = g.steered();
      const abilities = new Set<string>();
      for (const e of steered) for (const c of Object.keys(e.base.components)) abilities.add(c);
      const rules = g.things().filter((e) => !e.controller && e.scripts.reduce((n, s) => n + s.script.handlers.length, 0) >= 4);
      const view = scene.world.view === 'iso' ? 'iso' : isTopDownScene(ctx.project, scene, ctx.registry) ? 'top' : 'side';
      return { scene, steered: steered.map((e) => e.name), rules: [...new Set(rules.map((e) => e.name))], abilities, view };
    });
  } catch (err) {
    return { scene, error: err instanceof Error ? err.message : String(err) };
  }
}

const fits = (ask: ShapeAsk, f: LevelFacts): boolean =>
  (ask.steered === 'any' || (ask.steered === 'character') === f.steered.length > 0) && (!ask.rules || f.rules.length > 0) && (ask.view === 'any' || ask.view === f.view);

const describe = (f: LevelFacts): string =>
  `seen from ${f.view === 'iso' ? 'above at an angle' : f.view === 'top' ? 'above' : 'the side'}, ${f.steered.length ? `${list(f.steered)} steered with the keys` : 'nothing steered with the keys'}, ${f.rules.length ? `rules in the script of ${list(f.rules)}` : 'no script of rules'}`;

const want = (ask: ShapeAsk): string =>
  [ask.view === 'any' ? '' : `seen from ${ask.view === 'iso' ? 'above at an angle' : ask.view === 'top' ? 'above' : 'the side'}`, ask.steered === 'character' ? 'a character steered with the keys' : ask.steered === 'none' ? 'nothing steered as a character' : '', ask.rules ? 'its rules in a script' : '']
    .filter(Boolean)
    .join(', ');

/**
 * The level to play for the other layers: the one Play starts when it is the game asked for (or when no level is);
 * else the level that is. A game in a level Play does not start has failed Shape; what the game itself does is
 * still worth knowing, and is said to have been found by playing that level.
 */
export function levelToPlay(ctx: PlayCtx, ask: ShapeAsk): { sceneId: Id; name: string; isStart: boolean } {
  const { project } = ctx;
  const start = project.scenes.find((s) => s.id === project.startSceneId) ?? project.scenes[0];
  const levels = project.scenes.filter((s) => s.entities.length || s.generator);
  const all = levels.map((s) => facts(ctx, s)).filter((f): f is LevelFacts => !('error' in f));
  const at = all.find((f) => f.scene.id === start.id);
  if (at && fits(ask, at)) return { sceneId: start.id, name: start.name, isStart: true };
  const other = all.find((f) => f.scene.id !== start.id && fits(ask, f));
  return other ? { sceneId: other.scene.id, name: other.scene.name, isStart: false } : { sceneId: start.id, name: start.name, isStart: true };
}

/** Shape: the kind of game, which level Play starts, how many levels, how big. */
export function shapeChecks(ctx: PlayCtx, ask: ShapeAsk): Check[] {
  const out: Check[] = [];
  const { project } = ctx;
  const levels = project.scenes.filter((s) => s.entities.length || s.generator);
  const all = levels.map((s) => facts(ctx, s));
  const start = project.scenes.find((s) => s.id === project.startSceneId) ?? project.scenes[0];
  const at = all.find((f) => f.scene.id === start.id);
  const startsWhat = 'Play starts the game that was asked for';
  if (!at) out.push(failed('shape', startsWhat, `Play starts "${start.name}", which has nothing in it.`));
  else if ('error' in at) out.push(failed('shape', startsWhat, `Play starts "${start.name}", which could not be started: ${at.error}`));
  else if (fits(ask, at)) out.push(passed('shape', startsWhat, `Play starts "${start.name}": ${describe(at)}.`));
  else {
    const other = all.find((f): f is LevelFacts => !('error' in f) && f.scene.id !== start.id && fits(ask, f));
    out.push(
      failed(
        'shape',
        startsWhat,
        other
          ? `Play starts "${start.name}" (${describe(at)}); the game asked for (${want(ask)}) is the level "${other.scene.name}", which Play does not start.`
          : `Play starts "${start.name}": ${describe(at)}. Asked for: ${want(ask)}. No level is that.`,
      ),
    );
  }
  const judgedLevel = at && !('error' in at) ? at : null;
  if (ask.abilities?.length) {
    const what = `The character has the abilities asked for (${ask.abilities.join(', ')}) as the engine's own`;
    if (!judgedLevel?.steered.length) out.push(failed('shape', what, 'No character is steered in the level Play starts.'));
    else {
      const missing = ask.abilities.filter((a) => !judgedLevel.abilities.has(a));
      out.push(judged('shape', what, !missing.length, missing.length ? `${list(judgedLevel.steered)} has no ${missing.join(', no ')}.` : `${list(judgedLevel.steered)} has ${ask.abilities.join(' and ')}.`));
    }
  }
  if (ask.levels) out.push(judged('shape', `It has at least ${ask.levels} level${ask.levels === 1 ? '' : 's'}`, levels.length >= ask.levels, `${levels.length} level${levels.length === 1 ? '' : 's'} with something in ${levels.length === 1 ? 'it' : 'them'}: ${list(levels.map((s) => s.name))}.`));
  if (ask.minScreens) {
    const size = levelSize(project, start.id);
    const what = `The world is as big as asked (at least ${ask.minScreens} screens)`;
    if (start.generator && !start.entities.length) out.push(notJudged('shape', what, 'The level is built anew at each play: its size is not that of what is placed in the editor.'));
    else out.push(judged('shape', what, size.screens >= ask.minScreens, `"${start.name}" is ${size.cols} by ${size.rows} cells: ${size.screens} screens.`));
  }
  return out;
}

export interface RunsAsk {
  /** acts: things are expected to move or happen with no key pressed; waits: it waits for the player (turns, a board); any. */
  byItself: 'acts' | 'waits' | 'any';
  /** Being put back at the start within two seconds is how this game is meant to be (none so far). */
  earlySetbackMeant?: boolean;
}

/** Runs: the play probe on the level Play starts, with what the case expects of it. */
export function runsChecks(ctx: PlayCtx, ask: RunsAsk): Check[] {
  const out: Check[] = [];
  const r = probeLevel(ctx.project, ctx.sceneId ?? ctx.project.startSceneId, ctx.registry, { seed: ctx.seed, budget: 60, maxMs: 15000 });
  const played = `${Math.round(r.seconds.played)} s of play in ${r.runs} runs`;
  out.push(judged('runs', 'It runs without a fault', !r.errors.length, r.errors.length ? list(r.errors.map((e) => `${e.where}: ${e.message}${e.pressing ? ` (pressing ${e.pressing})` : ''}`), 3) : `No fault in ${played}.`));
  const heard = r.inputs.filter((i) => i.listeners.length);
  const seen = heard.filter((i) => i.response === 'seen').map((i) => i.action);
  const dead = heard.filter((i) => i.response === 'none').map((i) => i.action);
  const untried = heard.filter((i) => i.response === 'not_tried').map((i) => i.action);
  if (!heard.length) out.push(failed('runs', 'Its keys do something', 'Nothing in the level listens to any key.'));
  else if (!seen.length && untried.length && !dead.length) out.push(notJudged('runs', 'Its keys do something', `The keys it listens to (${untried.join(', ')}) were not tried: ${list(r.unjudged, 2) || 'the time ran out'}.`));
  else out.push(judged('runs', 'Its keys do something', seen.length > 0, `${seen.length ? `Changed something: ${seen.join(', ')}.` : 'No key changed anything.'}${dead.length ? ` Listened to, and nothing seen to change: ${dead.join(', ')}.` : ''}`));
  if (ask.byItself === 'acts') out.push(judged('runs', 'Things act by themselves, with no key pressed', r.byItself.seen && !r.byItself.hiddenOnly, r.byItself.seen ? list(r.byItself.what, 3) || 'something changed' : `Nothing happened by itself${r.byItself.still.length ? ` (${list(r.byItself.still, 3)} stood still)` : ''}.`));
  const held = r.suspicious.filter((s) => s.kind === 'early_win' || s.kind === 'many_things' || s.kind === 'immobile' || (s.kind === 'early_setback' && !ask.earlySetbackMeant) || (s.kind === 'nothing_acts' && ask.byItself === 'acts'));
  if (held.length) out.push(failed('runs', 'Nothing seen that means a broken game', list(held.map((s) => s.text), 3)));
  else out.push(passed('runs', 'Nothing seen that means a broken game', r.suspicious.length ? `Seen and not held against it: ${list(r.suspicious.map((s) => s.text), 2)}` : ''));
  return out;
}

/** What the engine was measured to run at a frame's time, by what a thing does (§30.13). */
export const MEASURED_LIMITS: readonly { kind: string; limit: number }[] = [
  { kind: 'wanderers', limit: 1600 },
  { kind: 'patrollers', limit: 520 },
  { kind: 'hunters (patrollers that chase)', limit: 240 },
  { kind: 'shooters', limit: 250 },
  { kind: 'moving solids', limit: 560 },
  { kind: 'things with a script', limit: 3400 },
  { kind: 'loose bodies', limit: 250 },
];
/** The most things in one level the engine was measured with (the 160 by 950 mine). */
export const MOST_THINGS_MEASURED = 150_106;
const FRAME_MS = 1000 / 60;

/** Size and load: how big the level is, how much acts in it, and a frame of it as measured here. */
export function loadChecks(ctx: PlayCtx): Check[] {
  const out: Check[] = [];
  const sceneId = ctx.sceneId ?? ctx.project.startSceneId;
  const size = levelSize(ctx.project, sceneId);
  // (Timed as the game is played, not as the test harness checks it: its "compare against afresh" modes off.)
  const modes = { solids: Runtime.checkSolids, cover: checkCoverIndex(false) };
  Runtime.checkSolids = false;
  try {
    const seen = run(ctx, (g) => {
      begin(g);
      const count = (of: (e: (typeof g.rt.entities)[number]) => boolean) => g.things().filter(of).length;
      const kinds = [
        count((e) => !!e.beh.wander),
        count((e) => !!e.beh.patrol && !(e.beh.patrol.chaseRange > 0)),
        count((e) => !!e.beh.patrol && e.beh.patrol.chaseRange > 0),
        count((e) => e.beh.shooter?.trigger === 'auto'),
        count((e) => !!e.beh.mover),
        count((e) => e.scripts.length > 0),
        count((e) => e.body === 'dynamic' && !e.controller && !e.beh.patrol && !e.beh.wander),
      ];
      const atStart = g.things().length;
      g.wait(5);
      return { kinds, atStart, atEnd: g.things().length, times: g.frameTimes(), errors: g.errors.length };
    });
    out.push(
      judged(
        'load',
        'The level is no bigger than the engine was measured to hold',
        seen.atStart <= MOST_THINGS_MEASURED,
        `${size.cols} by ${size.rows} cells (${size.screens} screens), ${seen.atStart.toLocaleString('en')} things at the start of play${seen.atEnd !== seen.atStart ? `, ${seen.atEnd.toLocaleString('en')} after five seconds` : ''}; measured up to ${MOST_THINGS_MEASURED.toLocaleString('en')}.`,
      ),
    );
    const acting = MEASURED_LIMITS.map((l, i) => ({ ...l, n: seen.kinds[i] })).filter((k) => k.n > 0);
    const over = acting.filter((k) => k.n > k.limit);
    const half = acting.filter((k) => k.n > k.limit / 2 && k.n <= k.limit);
    const say = (k: (typeof acting)[number]) => `${k.n} ${k.kind} (measured limit ${k.limit.toLocaleString('en')})`;
    out.push(
      judged(
        'load',
        'What acts in it is within what the engine was measured to run',
        !over.length,
        acting.length ? `${over.length ? `Over: ${over.map(say).join(', ')}. ` : ''}${half.length ? `Over half: ${half.map(say).join(', ')}. ` : ''}${acting.filter((k) => !over.includes(k) && !half.includes(k)).map(say).join(', ')}`.trim() : 'Nothing in it acts by an engine part or a script.',
      ),
    );
    const what = 'A frame of it is played within a frame\'s time, here';
    if (!seen.times) out.push(notJudged('load', what, 'It could not be played.'));
    else out.push(judged('load', what, seen.times.middle <= FRAME_MS, `The middle frame took ${seen.times.middle.toFixed(2)} ms and the worst ${seen.times.worst.toFixed(1)} ms over five seconds with no key pressed (a frame is ${FRAME_MS.toFixed(1)} ms; on this machine, without drawing).`));
  } catch (err) {
    out.push(notJudged('load', 'Size and load', `The level could not be started: ${err instanceof Error ? err.message : String(err)}`));
  } finally {
    Runtime.checkSolids = modes.solids;
    checkCoverIndex(modes.cover);
  }
  return out;
}

export type { Id };
