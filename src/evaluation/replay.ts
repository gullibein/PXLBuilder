/**
 * Recordings, and playing one again. A recording is what "Save with history" writes: every request of a visit as it
 * was sent and every answer as it came, a refused one word for word (editor/ai/diagnostics.ts). There is no second
 * format.
 *
 * A replay puts the recorded answers through the real request flow (runPrompt, the same store, the same checks and
 * second rounds) with no network: the answers come from the file, in order. It tests the engine and the flow as they
 * are now against answers a model once gave; it does not test the model. Where the flow now asks more or fewer
 * times than it did, or ends differently, the replay says so.
 *
 * One thing has to be translated: ids. The game a replay starts from is made afresh, and every id in it is new,
 * while the answers name the ids of the game as it was. Each answer's ids are therefore replaced by those of the
 * things in the same places of what is being sent now (the same object by its name, the same level by its order).
 * Nothing else of an answer is touched.
 */
import type { AIContext } from '../core/ai/context';
import { AIUnavailableError, type AIResponse } from '../core/ai/protocol';
import type { AIProvider } from '../core/ai/provider';
import type { Operation } from '../core/commands/operations';
import { DEFAULT_SPRITE_RESOLUTION, type SpriteResolution } from '../core/model/spriteResolution';
import type { Project } from '../core/types';
import { conversationKey, logExchange } from '../editor/ai/aiLog';
import { clearDiagnostics, diagnosticsFor, type DiagnosticExchange, type DiagnosticRequest } from '../editor/ai/diagnostics';
import { runPrompt, setAIProvider, type PromptOutcome } from '../editor/ai/runPrompt';
import { startNewGame } from '../editor/persistence';
import { useEditor } from '../editor/store';
import type { Spent } from './report';
import { failed, judged, passed, type Check } from './verdict';

export interface Recording {
  /** Where it is from (a file's name, "made by hand"). */
  name: string;
  version: string;
  model: string | null;
  requests: DiagnosticRequest[];
}

/** A "Save with history" file's text as a recording. `requests` is empty when the file holds only earlier visits' cut-short traces. */
export function readRecording(name: string, text: string): Recording {
  const file = JSON.parse(text) as { diagnostics?: { version?: string; ai?: { vendor?: string; claudeModel?: string; geminiModel?: string }; requests?: DiagnosticRequest[] } };
  const d = file.diagnostics;
  if (!d) throw new Error(`${name} was not saved with its history`);
  return { name, version: d.version ?? '', model: (d.ai?.vendor === 'gemini' ? d.ai.geminiModel : d.ai?.claudeModel) ?? null, requests: d.requests ?? [] };
}

const KEY_LIKE = /sk-ant-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}/;
/** Whether a recording's text holds anything that looks like an API key (none may be committed). */
export const holdsAKey = (text: string): boolean => KEY_LIKE.test(text);

/** What the requests of a recording cost, read from each connection's own note (Claude's gives tokens and price; one that gives none: unknown). */
export function spentOn(requests: readonly DiagnosticRequest[], model: string | null): Spent {
  let [tokensIn, tokensOut, usd, known, retries, asked] = [0, 0, 0, 0, 0, 0];
  for (const r of requests) {
    asked += r.exchanges.length;
    retries += r.exchanges.filter((x) => 'error' in x.answer).length;
    for (const s of r.steps) {
      const m = /This request: \$([\d.]+) \([^:]+: ([\d,]+) tokens in(?: \([^)]*\))? · ([\d,]+) out\)/.exec(s.text);
      if (!m) continue;
      known++;
      usd += Number(m[1]);
      tokensIn += Number(m[2].replace(/,/g, ''));
      tokensOut += Number(m[3].replace(/,/g, ''));
    }
  }
  const seconds = requests.reduce((n, r) => n + (r.tookMs ?? 0), 0) / 1000;
  return { requests: asked, retries, tokensIn: known ? tokensIn : null, tokensOut: known ? tokensOut : null, usd: known ? Math.round(usd * 1000) / 1000 : null, seconds, model };
}

// ------------------------------------------------------------------------------------------------ ids

const ID = /^[a-z]{2,6}_[0-9a-f]{8,}$/;
/** Every id in a value, by where it is: through lists by the name of what holds it (and its turn among those of that name), else by its place. */
function idsByPlace(value: unknown, path: string, out: Map<string, string>): void {
  if (typeof value === 'string') {
    if (ID.test(value)) out.set(path, value);
    return;
  }
  if (Array.isArray(value)) {
    const nth = new Map<string, number>();
    value.forEach((v, i) => {
      const name = v && typeof v === 'object' && typeof (v as { name?: unknown }).name === 'string' ? `name:${(v as { name: string }).name}` : `#${i}`;
      const n = nth.get(name) ?? 0;
      nth.set(name, n + 1);
      idsByPlace(v, `${path}/${name}${name.startsWith('#') ? '' : `#${n}`}`, out);
    });
    return;
  }
  if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) idsByPlace(v, `${path}.${k}`, out);
}

/** The ids of the game as recorded, each with the id the same thing has in the game as it is being built now. */
export function idsNow(recorded: unknown, now: unknown): Map<string, string> {
  const [was, is] = [new Map<string, string>(), new Map<string, string>()];
  idsByPlace(recorded, '', was);
  idsByPlace(now, '', is);
  const map = new Map<string, string>();
  for (const [path, id] of was) {
    const to = is.get(path);
    if (to && !map.has(id)) map.set(id, to);
  }
  return map;
}

/** A recorded answer with its ids replaced by today's. */
export function withIdsNow<T>(answer: T, map: ReadonlyMap<string, string>): T {
  if (!map.size) return answer;
  return JSON.parse(JSON.stringify(answer).replace(/[a-z]{2,6}_[0-9a-f]{8,}/g, (id) => map.get(id) ?? id)) as T;
}

// ------------------------------------------------------------------------------------------------ replay

export interface Replayed {
  /** The game as it stands after the last request. */
  project: Project;
  /** The game before the first request. */
  before: Project;
  /** Each request as replayed: how it ended now, and how it ended when recorded. */
  requests: { request: string; now: string; message: string; then: string | null; answersUsed: number; answersRecorded: number }[];
  /** Every operation of every answer that was used. */
  operations: { op: string; [k: string]: unknown }[];
  /** Where the replay did not go as the recording did. */
  differs: string[];
  /** The Built layer's checks. */
  built: Check[];
  /** The requests as the flow recorded them this time (for looking into a failure). */
  diagnostics: DiagnosticRequest[];
  spent: Spent;
}

const NO_MORE = 'The recording has no further answer: the request flow asked once more than it did when this was recorded.';

/** The context a recorded request was made in, as far as a replay can make it again (the whole game, a level). */
function contextOf(about: string, project: Project): AIContext | null {
  const sceneId = useEditor.getState().activeSceneId ?? project.startSceneId;
  if (about === 'project') return { kind: 'project', sceneId };
  if (about.startsWith('level:')) return { kind: 'level', sceneId, point: null };
  return null;
}

/**
 * Plays a recording again through the real request flow. `given`: the game the requests were made to (an edit);
 * none: a new game, as the New game window starts one.
 */
export async function replay(recording: Recording, given?: Project): Promise<Replayed> {
  const first = recording.requests[0]?.exchanges[0]?.sent;
  const newGame = !given && !!first?.topics.includes('new_game');
  clearDiagnostics();
  if (given) useEditor.getState().loadProject(given);
  else {
    const size = (first?.context as { level?: { spriteResolution?: number } } | undefined)?.level?.spriteResolution;
    startNewGame('platformer', true, ([16, 32, 64].includes(size ?? 0) ? size : DEFAULT_SPRITE_RESOLUTION) as SpriteResolution);
  }
  const before = useEditor.getState().project;
  const out: Replayed = { project: before, before, requests: [], operations: [], differs: [], built: [], diagnostics: [], spent: spentOn(recording.requests, recording.model) };
  let queue: DiagnosticExchange[] = [];
  let used = 0;
  const provider: AIProvider = {
    respond: async (body, _signal, trace) => {
      const next = queue.shift();
      trace?.('sent', `A recording (${recording.name})`);
      if (!next) throw new AIUnavailableError(NO_MORE);
      used++;
      if ('error' in next.answer) {
        trace?.('reply', `Failed: ${next.answer.error}`);
        throw new AIUnavailableError(next.answer.error, next.answer.raw);
      }
      const answer = withIdsNow(next.answer as AIResponse, idsNow(next.sent.context, body.context));
      trace?.('reply', JSON.stringify(answer));
      out.operations.push(...((answer.operations ?? []) as Operation[] as unknown as Replayed['operations']));
      return answer;
    },
  };
  setAIProvider(provider);
  try {
    let n = 0;
    for (const r of recording.requests) {
      const ctx = contextOf(r.about, useEditor.getState().project);
      if (!ctx) {
        out.differs.push(`"${r.request.slice(0, 60)}" was asked on a card of its own (${r.about.split(':')[0]}), which a replay cannot open again: it and what follows were not replayed.`);
        break;
      }
      queue = [...r.exchanges];
      used = 0;
      const steps: { ms: number; kind: 'sent' | 'reply' | 'check' | 'retry' | 'note' | 'error'; text: string }[] = [];
      const started = Date.now();
      let outcome: PromptOutcome;
      try {
        // A new game's request (the first, or the same again after one that failed: Retry asks as the New game
        // window did), with the sprites choice the recorded request shows.
        const sent = r.exchanges[0]?.sent;
        const asNew = newGame && !!sent?.topics.includes('new_game') && out.requests.every((q) => q.now === 'error');
        const drawn = /built in two answers|draw_sprite for every object/.test(sent?.request ?? '');
        outcome = await runPrompt(ctx, r.request, undefined, (kind, text) => void steps.push({ ms: Date.now() - started, kind, text }), asNew ? { newGame: true, sprites: drawn ? 'ai' : 'engine' } : {});
      } catch (e) {
        outcome = { status: 'error', message: (e as Error).message };
      }
      // (As the prompt card does: the exchange joins the conversation, so the next request carries it.)
      logExchange(ctx, conversationKey(ctx), r.request, outcome, steps);
      const then = r.outcome?.status ?? null;
      out.requests.push({ request: r.request, now: outcome.status, message: 'message' in outcome ? outcome.message : '', then, answersUsed: used, answersRecorded: r.exchanges.length });
      if (then && then !== outcome.status) out.differs.push(`"${r.request.slice(0, 60)}" ended "${outcome.status}" now and "${then}" when recorded${outcome.status === 'error' && 'message' in outcome ? ` (${outcome.message.slice(0, 160)})` : ''}.`);
      if (used !== r.exchanges.length || ('message' in outcome && outcome.message.includes(NO_MORE))) out.differs.push(`"${r.request.slice(0, 60)}": the flow used ${used} of the ${r.exchanges.length} recorded answer${r.exchanges.length === 1 ? '' : 's'}${'message' in outcome && outcome.message.includes(NO_MORE) ? ' and asked for one more' : ''}.`);
      n++;
    }
  } finally {
    setAIProvider(null);
  }
  out.project = useEditor.getState().project;
  out.diagnostics = diagnosticsFor(out.project.id);
  out.built = builtChecks(out.requests, out.diagnostics, out.differs, true);
  return out;
}

/**
 * The Built layer, from how the requests went: did the last asking end with the game applied; was it built at the
 * first asking; was anything refused, cut off, lost or left out on the way. A request that ended in an error is
 * never a built game, whatever was applied before it failed.
 */
export function builtChecks(requests: readonly { request: string; now: string; message: string }[], diagnostics: readonly DiagnosticRequest[], differs: readonly string[] = [], replayed = false): Check[] {
  const out: Check[] = [];
  const whole = 'The request ended with the game applied, whole';
  if (!requests.length) return [failed('built', whole, 'No request was made.')];
  const last = requests[requests.length - 1];
  const failedOnes = requests.filter((r) => r.now === 'error');
  out.push(judged('built', whole, last.now === 'applied' || last.now === 'message', last.now === 'error' ? `It ended in an error: ${last.message.slice(0, 220)}` : `${requests.length} request${requests.length === 1 ? '' : 's'}; the last ended "${last.now}".`));
  // Asked again by the person: the same words more than once, an earlier asking having failed.
  const again = failedOnes.filter((f) => requests.some((r) => r !== f && r.request === f.request));
  const firstTime = 'It was built at the first asking';
  if (failedOnes.length) out.push(failed('built', firstTime, `${failedOnes.length} of ${requests.length} requests ended in an error${again.length ? ' and had to be made again by hand' : ''}: ${failedOnes[0].message.slice(0, 200)}`));
  else out.push(passed('built', firstTime, ''));
  const refused = diagnostics.flatMap((d) => d.exchanges.filter((x) => 'error' in x.answer).map((x) => x.answer as { error: string; raw?: string }));
  const lost = 'No answer was refused, cut off or lost on the way';
  if (refused.length) {
    const kept = refused.filter((r) => typeof r.raw === 'string').length;
    out.push(failed('built', lost, `${refused.length} answer${refused.length === 1 ? '' : 's'} could not be used: ${[...new Set(refused.map((r) => r.error))].join(' | ').slice(0, 260)} (${kept ? `${kept} kept as the model sent ${kept === 1 ? 'it' : 'them'}` : 'nothing of them was kept: recorded before answers were, or nothing arrived'}).`));
  } else out.push(passed('built', lost, ''));
  const NOTES = /left out|was not applied|wasn't applied|could not be applied|couldn't be applied|not built|skipped|cut off|given up|gave up/i;
  const notes = [...new Set(diagnostics.flatMap((d) => d.steps.filter((s) => (s.kind === 'note' || s.kind === 'check' || s.kind === 'error') && NOTES.test(s.text)).map((s) => s.text.split('\n')[0].slice(0, 200))))];
  out.push(judged('built', 'Nothing the answers held was left out', !notes.length, notes.length ? notes.slice(0, 3).join(' | ') : ''));
  if (replayed) out.push(judged('built', 'The replay went as the recording did', !differs.length, differs.length ? differs.slice(0, 3).join(' ') : 'The same number of answers used, each request ending as it did.'));
  return out;
}
