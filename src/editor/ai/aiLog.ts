/**
 * The conversation with the AI, in full: every request (as typed), the AI's
 * whole answer and its changes, and how it ended (applied, undone, an answer,
 * an error), also for answers that changed nothing. Shown in the AI History
 * tab. Kept in this browser (the last 200), so it survives a reload.
 */
import { create } from 'zustand';
import type { AIContext } from '../../core/ai/context';
import { useEditor } from '../store';
import type { PromptOutcome } from './runPrompt';

export interface AILogEntry {
  id: number;
  time: number;
  /** What the prompt was about: "Player", "World", "Switch → Door", "Whole game"… */
  where: string;
  request: string;
  status: 'applied' | 'message' | 'error';
  message: string;
  changes: string[];
  /** Warning tone for answers (a refusal, a problem). */
  warn: boolean;
  /** The undo step it made (this session only), to tell whether it was undone since. */
  transactionId: number | null;
  /** Undone from its card. */
  undone: boolean;
  /** A note shown with it (e.g. that a new object was made). */
  note: string | null;
}

const STORAGE_KEY = 'pxlbuilder.aiLog';
const MAX = 200;

function load(): AILogEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    // Undo steps don't survive a reload.
    return Array.isArray(raw) ? raw.slice(-MAX).map((e: AILogEntry) => ({ ...e, transactionId: null })) : [];
  } catch {
    return [];
  }
}

function save(entries: AILogEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Storage full or unavailable: the log lasts for this page.
  }
}

export const useAILog = create<{ entries: AILogEntry[] }>(() => ({ entries: load() }));
let nextId = Math.max(0, ...useAILog.getState().entries.map((e) => e.id)) + 1;

function put(entries: AILogEntry[]): void {
  const kept = entries.slice(-MAX);
  useAILog.setState({ entries: kept });
  save(kept);
}

/** A readable name for what a prompt was about. */
export function contextName(ctx: AIContext): string {
  const { project } = useEditor.getState();
  const scene = project.scenes.find((s) => s.id === ctx.sceneId);
  const name = (id: string) => scene?.entities.find((e) => e.id === id)?.name ?? '?';
  switch (ctx.kind) {
    case 'entity':
      return name(ctx.entityIds[0]);
    case 'pair':
      return `${name(ctx.entityIds[0])} → ${name(ctx.entityIds[1])}`;
    case 'group':
      return `${ctx.entityIds.length} objects`;
    case 'level':
      return scene ? `World (${scene.name})` : 'World';
    case 'background':
      return 'Background';
    case 'project':
      return 'Whole game';
    case 'create':
      return 'Create';
    case 'connection':
      return 'Connection';
    case 'editor':
      return 'Editor';
  }
}

function fields(outcome: PromptOutcome): Pick<AILogEntry, 'status' | 'message' | 'changes' | 'warn' | 'transactionId' | 'undone' | 'note'> {
  if (outcome.status === 'applied') {
    return { status: 'applied', message: outcome.message, changes: outcome.changes, warn: false, transactionId: outcome.transactionId ?? null, undone: outcome.undone === true, note: outcome.note ?? null };
  }
  return { status: outcome.status, message: outcome.message, changes: [], warn: outcome.status === 'error' || outcome.tone === 'warn', transactionId: null, undone: false, note: null };
}

/** A prompt finished; returns its log id (to update it later: undone, made a new object…). */
export function logExchange(ctx: AIContext, request: string, outcome: PromptOutcome): number {
  const id = nextId++;
  put([...useAILog.getState().entries, { id, time: Date.now(), where: contextName(ctx), request, ...fields(outcome) }]);
  return id;
}

/** The exchange's outcome changed (undone from its card, made a new object instead). */
export function updateExchange(id: number, outcome: PromptOutcome): void {
  put(useAILog.getState().entries.map((e) => (e.id === id ? { ...e, ...fields(outcome) } : e)));
}

export function clearAILog(): void {
  put([]);
}
