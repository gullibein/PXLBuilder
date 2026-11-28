/**
 * A case judged, and the report: one row a case, the five layers apart, what was not judged said as that, and the
 * engine parts the game needed and did not have. Running without errors is never a success by itself.
 */
import type { ComponentRegistry } from '../core/components/registry';
import type { Project } from '../core/types';
import type { CaseCtx, EvalCase } from './cases';
import { engineParts, type EnginePart } from './engineParts';
import { levelToPlay, loadChecks, runsChecks, shapeChecks } from './layers';
import { LAYERS, layerResult, notJudged, outcomeOf, type Check, type Layer, type LayerResult, type Outcome } from './verdict';

/** What making the game took, in one form for every connection (`usd` null: the connection gave no price). */
export interface Spent {
  requests: number;
  /** Answers asked for again: refused, cut off, or lost. */
  retries: number;
  tokensIn: number | null;
  tokensOut: number | null;
  usd: number | null;
  seconds: number | null;
  model: string | null;
}

export interface CaseReport {
  id: string;
  number: number;
  title: string;
  /** Where the game came from: a live run, a recording replayed, a saved game, a stand-in. */
  source: string;
  checks: Check[];
  layers: Record<Layer, LayerResult>;
  /** The level that was played, when it is not the one Play starts (the game asked for is in another level). */
  playedInstead: string | null;
  /** Engine parts this kind of game needs that the engine does not have (each with what the experiment saw). */
  missing: EnginePart[];
  outcome: Outcome;
  spent: Spent | null;
}

export interface Given {
  /** How the game was made: the Built layer's checks (none: only the game is known, and Built is not judged). */
  built?: Check[];
  before?: Project;
  operations?: CaseCtx['operations'];
  spent?: Spent | null;
  source: string;
  seed?: number;
  /** How many of the case's follow-up requests were made (their checks are run on the game as it is after them). */
  followUps?: number;
}

let partsNow: { registry: ComponentRegistry; parts: EnginePart[] } | null = null;
/** The engine's parts as they are now (found out once per registry). */
export function partsOf(registry: ComponentRegistry): EnginePart[] {
  if (partsNow?.registry !== registry) partsNow = { registry, parts: engineParts(registry) };
  return partsNow.parts;
}

/** Judges a game as the answer to a case. */
export function evaluate(c: EvalCase, project: Project, registry: ComponentRegistry, given: Given): CaseReport {
  const ctx: CaseCtx = { project, registry, seed: given.seed ?? 1, before: given.before, operations: given.operations };
  const checks: Check[] = [...(given.built ?? [notJudged('built', 'The request ended with the game applied, whole', 'Only the game was given, not how it was made.')])];
  const guard = (layer: Layer, what: string, fn: () => Check[]) => {
    try {
      checks.push(...fn());
    } catch (err) {
      checks.push({ layer, what, verdict: 'fail', why: `The check itself could not run on this game: ${err instanceof Error ? err.message : String(err)}` });
    }
  };
  guard('shape', 'Shape', () => shapeChecks(ctx, c.shape));
  // (Play starts another level than the one the game is in: Shape has failed; the game itself is played all the same.)
  let playedInstead: string | null = null;
  try {
    const level = levelToPlay(ctx, c.shape);
    if (!level.isStart) {
      playedInstead = level.name;
      ctx.sceneId = level.sceneId;
    }
  } catch {
    // (Shape has said why.)
  }
  guard('runs', 'Runs', () => runsChecks(ctx, c.runs));
  guard('plays', 'Plays', () => c.plays(ctx));
  for (const f of c.followUps.slice(0, given.followUps ?? 0)) guard('plays', `After "${f.prompt}"`, () => f.plays(ctx));
  guard('load', 'Size and load', () => loadChecks(ctx));
  const missing = partsOf(registry).filter((p) => c.needs.includes(p.id) && !p.has);
  const layers = Object.fromEntries(LAYERS.map((l) => [l.id, layerResult(checks, l.id)])) as Record<Layer, LayerResult>;
  return { id: c.id, number: c.number, title: c.title, source: given.source, playedInstead, checks, layers, missing, outcome: outcomeOf(checks, missing.map((m) => m.id)), spent: given.spent ?? null };
}

const MARK: Record<LayerResult, string> = { pass: 'pass', fail: 'FAIL', uncertain: 'uncertain', 'not judged': 'not judged' };
const money = (s: Spent | null) => (s?.usd == null ? (s ? 'unknown' : '') : `$${s.usd.toFixed(2)}`);
const count = (n: number | null | undefined) => (n == null ? '' : n.toLocaleString('en'));

/** The report as text (Markdown): the table, then each case's checks. */
export function reportText(reports: readonly CaseReport[], title = 'Evaluation'): string {
  const lines: string[] = [`# ${title}`, ''];
  lines.push('| # | Case | From | Built | Shape | Runs | Plays | Size and load | Engine parts missing | Result | Requests | Retries | Tokens in | Tokens out | Cost | Time |', '|---|---|---|---|---|---|---|---|---|---|---:|---:|---:|---:|---:|---:|');
  for (const r of reports) {
    const s = r.spent;
    lines.push(
      `| ${r.number} | ${r.title} | ${r.source} | ${LAYERS.map((l) => MARK[r.layers[l.id]]).join(' | ')} | ${r.missing.map((m) => m.id.replace(/_/g, ' ')).join(', ') || 'none'} | **${r.outcome}** | ${count(s?.requests)} | ${count(s?.retries)} | ${count(s?.tokensIn)} | ${count(s?.tokensOut)} | ${money(s)} | ${s?.seconds == null ? '' : `${Math.round(s.seconds)} s`} |`,
    );
  }
  const total = reports.reduce((n, r) => n + (r.spent?.usd ?? 0), 0);
  const of = (o: Outcome) => reports.filter((r) => r.outcome === o).length;
  lines.push('', `${reports.length} cases: ${of('success')} success, ${of('approximation')} approximation (plays by a script standing in for an engine part that is missing), ${of('uncertain')} uncertain (nothing failed, something was not judged), ${of('failed')} failed.${total ? ` Spent: $${total.toFixed(2)}.` : ''}`, '');
  for (const r of reports) {
    lines.push(`## ${r.number}. ${r.title}: ${r.outcome}`, '', `From: ${r.source}.`, '');
    if (r.playedInstead) lines.push(`Runs, Plays and Size and load are of the level "${r.playedInstead}", where the game asked for is. Play does not start it (see Shape).`, '');
    for (const l of LAYERS) {
      const mine = r.checks.filter((c) => c.layer === l.id);
      lines.push(`**${l.name}: ${MARK[r.layers[l.id]]}**`, '');
      for (const c of mine) lines.push(`- ${c.verdict === 'pass' ? 'pass' : c.verdict === 'fail' ? 'FAIL' : 'not judged'}: ${c.what}.${c.why ? ` ${c.why}` : ''}`);
      if (!mine.length) lines.push('- (no check)');
      lines.push('');
    }
    if (r.missing.length) {
      lines.push('**Engine parts this kind of game needs and the engine does not have:**', '');
      for (const m of r.missing) lines.push(`- ${m.name}. ${m.seen}`);
      lines.push('');
    }
  }
  return lines.join('\n');
}
