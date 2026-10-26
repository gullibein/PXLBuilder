/**
 * AI prompts that are running or have finished, one per context (an object,
 * a pair, the level…). They live here, not in the prompt card, so closing a
 * card does not stop its prompt: the user keeps editing while the AI works,
 * on several objects at once (one prompt per object at a time). The level
 * shows dots over objects whose prompt is running, and a badge where a
 * finished one is waiting to be looked at (a proposal, a question, an error).
 */
import { create } from 'zustand';
import { contextKey, type AIContext } from '../../core/ai/context';
import type { Id } from '../../core/types';
import { runPrompt, type PromptOptions, type PromptOutcome } from './runPrompt';
import { contextName, logExchange, markUndoneSteps, newChat, updateExchange } from './aiLog';
import { createTrace } from '../../core/ai/trace';
import { revealCreated } from '../actions';
import { useEditor } from '../store';

export interface PromptJob {
  key: string;
  ctx: AIContext;
  request: string;
  phase: 'working' | 'done';
  outcome: PromptOutcome | null;
  /** False when it finished while its card was closed and still waits to be looked at. */
  seen: boolean;
  /** Its entry in the AI History log (once finished); the card's earlier exchanges come from that log. */
  logId?: number;
}

interface JobState {
  jobs: Record<string, PromptJob>;
}

export const useJobs = create<JobState>(() => ({ jobs: {} }));

const controllers = new Map<string, AbortController>();
/** Cards on screen, by context key. */
const openCards = new Map<string, number>();

function put(key: string, job: PromptJob | null): void {
  useJobs.setState((s) => {
    const jobs = { ...s.jobs };
    if (job) jobs[key] = job;
    else delete jobs[key];
    return { jobs };
  });
}

/** Starts a prompt for a context (the finished ones before it stay in the card's chat, from the log). One at a time per context. */
export function startJob(ctx: AIContext, request: string, options: PromptOptions = {}): void {
  const key = contextKey(ctx);
  if (useJobs.getState().jobs[key]?.phase === 'working') return;
  const controller = new AbortController();
  controllers.set(key, controller);
  put(key, { key, ctx, request, phase: 'working', outcome: null, seen: true });
  // What happens under the hood (AI History → Details).
  const trace = createTrace();
  const done = (outcome: PromptOutcome) => {
    if (controllers.get(key) !== controller) return;
    controllers.delete(key);
    if (outcome.status === 'applied') trace.add('note', `Applied: ${outcome.changes.length} change line(s)${outcome.note ? `; ${outcome.note}` : ''}`);
    // What it built is shown (also when its card was closed meanwhile): a level is framed, something off screen too.
    if (outcome.status === 'applied' && ctx.sceneId === useEditor.getState().activeSceneId) revealCreated(outcome.result.createdEntityIds);
    // About something else (asked on the player's card, it changed the enemy): the exchange goes to that one's
    // card, as if asked there (its conversation, its Undo); this card says where it went. (Not while that card has a
    // prompt of its own running.)
    const to = outcome.status === 'applied' ? outcome.movedTo : undefined;
    const toKey = to ? contextKey(to) : null;
    if (to && toKey && useJobs.getState().jobs[toKey]?.phase !== 'working') {
      trace.add('note', `About ${contextName(to)}, not ${contextName(ctx)}: moved to ${contextName(to)}'s prompt card`);
      const logId = logExchange(to, toKey, request, outcome, trace.steps);
      put(toKey, { key: toKey, ctx: to, request, phase: 'done', outcome, seen: true, logId });
      const message = `This changed the ${contextName(to)}, not the ${contextName(ctx)}, so it was moved to the ${contextName(to)}'s prompt card${to.kind === 'object' ? ' (in Objects)' : ''}.`;
      put(key, { key, ctx, request, phase: 'done', outcome: { status: 'message', tone: 'info', message, movedTo: to }, seen: true });
      return;
    }
    const logId = logExchange(ctx, key, request, outcome, trace.steps);
    // Applied changes glow on the level instead; proposals, answers and errors wait to be looked at.
    put(key, { key, ctx, request, phase: 'done', outcome, seen: openCards.has(key) || outcome.status === 'applied', logId });
  };
  runPrompt(ctx, request, controller.signal, trace.add, options).then(
    (outcome) => !controller.signal.aborted && done(outcome),
    (e) => {
      if ((e as Error).name !== 'AbortError') done({ status: 'error', message: (e as Error).message });
    },
  );
}

/** Stops a running prompt (nothing is changed); the chat before it stays. */
export function stopJob(key: string): void {
  controllers.get(key)?.abort();
  controllers.delete(key);
  put(key, null);
}

/** Replaces a finished job's outcome (a proposal that was applied). */
export function setJobOutcome(key: string, outcome: PromptOutcome): void {
  const job = useJobs.getState().jobs[key];
  if (!job) return;
  put(key, { ...job, phase: 'done', outcome, seen: true });
  if (job.logId !== undefined) updateExchange(job.logId, outcome);
}

/** Forgets a finished job (the card was cleared, or a proposal cancelled). */
export function clearJob(key: string): void {
  if (useJobs.getState().jobs[key]?.phase === 'done') put(key, null);
}

/** A card for this context is on screen (returns the "closed" callback). What finishes now counts as seen. */
export function cardOpened(key: string): () => void {
  openCards.set(key, (openCards.get(key) ?? 0) + 1);
  const job = useJobs.getState().jobs[key];
  if (job && !job.seen) put(key, { ...job, seen: true });
  return () => {
    const n = (openCards.get(key) ?? 1) - 1;
    if (n > 0) openCards.set(key, n);
    else openCards.delete(key);
  };
}

/** "New chat": the conversation about this context starts again (a prompt still running carries on). */
export function startNewChat(key: string): void {
  newChat(key);
  if (useJobs.getState().jobs[key]?.phase === 'done') put(key, null);
}

/** For the level view: objects with a running prompt, and objects with a finished one waiting to be seen. */
export function jobMarks(jobs: Record<string, PromptJob>, openKey: string | null = null): { working: Set<Id>; waiting: Set<Id> } {
  const working = new Set<Id>();
  const waiting = new Set<Id>();
  for (const job of Object.values(jobs)) {
    // The open card shows its own state.
    if (!('entityIds' in job.ctx) || job.key === openKey) continue;
    const target = job.phase === 'working' ? working : !job.seen ? waiting : null;
    if (target) for (const id of job.ctx.entityIds) target.add(id);
  }
  return { working, waiting };
}

/** For tests: forget everything. */
export function resetJobs(): void {
  for (const c of controllers.values()) c.abort();
  controllers.clear();
  openCards.clear();
  useJobs.setState({ jobs: {} });
}

// Another game opened (New project, a file): its cards start clean, and a prompt still running for the old game
// is stopped (its change would land in the wrong game).
useEditor.subscribe((s, prev) => {
  if (s.project.id !== prev.project.id) resetJobs();
});

// Undo and redo (the toolbar, Ctrl+Z, a card's Undo): an AI change whose step is undone is marked so in its card and
// in the AI History, and stays marked after other edits clear the redo list; redone, it is applied again.
useEditor.subscribe((s, prev) => {
  if (s.history === prev.history || s.project.id !== prev.project.id) return;
  const undone = new Set(s.history.future.map((t) => t.id));
  const done = new Set(s.history.past.map((t) => t.id));
  markUndoneSteps(undone, done);
  for (const job of Object.values(useJobs.getState().jobs)) {
    const o = job.outcome;
    if (job.phase !== 'done' || o?.status !== 'applied' || o.editor || o.transactionId === undefined) continue;
    const now = undone.has(o.transactionId) ? true : done.has(o.transactionId) ? false : o.undone === true;
    if (now !== (o.undone === true)) put(job.key, { ...job, outcome: { ...o, undone: now } });
  }
});
