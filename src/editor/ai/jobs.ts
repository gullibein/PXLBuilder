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
import { runPrompt, type PromptOutcome } from './runPrompt';

export interface PromptJob {
  key: string;
  ctx: AIContext;
  request: string;
  phase: 'working' | 'done';
  outcome: PromptOutcome | null;
  /** False when it finished while its card was closed and still waits to be looked at. */
  seen: boolean;
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

/** Starts a prompt for a context (replacing a finished one there). One at a time per context. */
export function startJob(ctx: AIContext, request: string): void {
  const key = contextKey(ctx);
  if (useJobs.getState().jobs[key]?.phase === 'working') return;
  const controller = new AbortController();
  controllers.set(key, controller);
  put(key, { key, ctx, request, phase: 'working', outcome: null, seen: true });
  const done = (outcome: PromptOutcome) => {
    if (controllers.get(key) !== controller) return;
    controllers.delete(key);
    // Applied changes glow on the level instead; proposals, answers and errors wait to be looked at.
    put(key, { key, ctx, request, phase: 'done', outcome, seen: openCards.has(key) || outcome.status === 'applied' });
  };
  runPrompt(ctx, request, controller.signal).then(
    (outcome) => !controller.signal.aborted && done(outcome),
    (e) => {
      if ((e as Error).name !== 'AbortError') done({ status: 'error', message: (e as Error).message });
    },
  );
}

/** Stops a running prompt (nothing is changed). */
export function stopJob(key: string): void {
  controllers.get(key)?.abort();
  controllers.delete(key);
  put(key, null);
}

/** Replaces a finished job's outcome (a proposal that was applied). */
export function setJobOutcome(key: string, outcome: PromptOutcome): void {
  const job = useJobs.getState().jobs[key];
  if (job) put(key, { ...job, phase: 'done', outcome, seen: true });
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
