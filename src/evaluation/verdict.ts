/**
 * How the evaluation judges (docs/engine-architecture-proposal.md §25, §33). Every check ends in one of three ways,
 * and the third is not a kind of pass: what could not be seen is said to be not judged, with the reason.
 *
 * The checks are kept in layers that are reported apart, because each can hold without the next: a game can be built
 * and not be the game asked for; be that game and not run; run and not play as asked; play and ask more of the
 * engine than it can run. A game that loads is not a game that works.
 */
export type Verdict = 'pass' | 'fail' | 'not judged';

export type Layer = 'built' | 'shape' | 'runs' | 'plays' | 'load';

export const LAYERS: readonly { id: Layer; name: string; asks: string }[] = [
  { id: 'built', name: 'Built', asks: 'Did the request end with a game applied, whole? (What was refused, cut off or left out.)' },
  { id: 'shape', name: 'Shape', asks: 'Is it the kind of game asked for, of the size asked for, and is it what Play starts?' },
  { id: 'runs', name: 'Runs', asks: 'Does it run without faults, do its keys do something, does what should act by itself act?' },
  { id: 'plays', name: 'Plays', asks: 'Played by a script written for the case: does it do what was asked?' },
  { id: 'load', name: 'Size and load', asks: 'How big is it and how much acts in it, against what the engine was measured to run?' },
];

export interface Check {
  layer: Layer;
  /** What was asked of the game, in words that stand on their own. */
  what: string;
  verdict: Verdict;
  /** What was seen (a pass, a fail), or why it could not be judged. */
  why: string;
}

export const passed = (layer: Layer, what: string, why = ''): Check => ({ layer, what, verdict: 'pass', why });
export const failed = (layer: Layer, what: string, why: string): Check => ({ layer, what, verdict: 'fail', why });
export const notJudged = (layer: Layer, what: string, why: string): Check => ({ layer, what, verdict: 'not judged', why });
/** A check from a yes or no seen. */
export const judged = (layer: Layer, what: string, ok: boolean, seen: string): Check => ({ layer, what, verdict: ok ? 'pass' : 'fail', why: seen });

/** A layer's result: failed when any check failed; else uncertain when any was not judged; no checks: not judged. */
export type LayerResult = 'pass' | 'fail' | 'uncertain' | 'not judged';

export function layerResult(checks: readonly Check[], layer: Layer): LayerResult {
  const mine = checks.filter((c) => c.layer === layer);
  if (!mine.length) return 'not judged';
  if (mine.some((c) => c.verdict === 'fail')) return 'fail';
  if (mine.every((c) => c.verdict === 'not judged')) return 'not judged';
  return mine.some((c) => c.verdict === 'not judged') ? 'uncertain' : 'pass';
}

/**
 * A case as a whole. `success` only when every layer passed and no part of the engine it needs is missing.
 * `approximation`: it plays as asked, but by a script standing in for a part the engine does not have (named with
 * the result): not counted as the engine being able to. `uncertain`: nothing failed, something was not judged.
 */
export type Outcome = 'success' | 'approximation' | 'uncertain' | 'failed';

export function outcomeOf(checks: readonly Check[], missingParts: readonly string[]): Outcome {
  const results = LAYERS.map((l) => layerResult(checks, l.id));
  if (results.includes('fail')) return 'failed';
  if (results.some((r) => r !== 'pass')) return 'uncertain';
  return missingParts.length ? 'approximation' : 'success';
}
