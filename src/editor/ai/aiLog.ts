/**
 * The conversation with the AI, in full: every request (as typed), the AI's
 * whole answer and its changes, and how it ended (applied, undone, an answer,
 * an error), also for answers that changed nothing. Shown in the AI History
 * tab. Kept in this browser (the last 200), so it survives a reload.
 *
 * It is also each prompt card's conversation: the exchanges about one thing
 * (an object, a pair, the level…, by context key) since that card's last
 * "New chat" are what the card shows and what the AI is reminded of. So
 * closing a card, selecting something else or reloading the page forgets
 * nothing; "New chat" starts fresh.
 */
import { create } from 'zustand';
import type { AIContext } from '../../core/ai/context';
import { useEditor } from '../store';
import type { PromptOutcome } from './runPrompt';
import type { TraceStep } from '../../core/ai/trace';

export interface AILogEntry {
  id: number;
  time: number;
  /** Which conversation it belongs to (the prompt's context key). Missing in entries from before conversations were kept. */
  key?: string;
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
  /** What happened under the hood (kept for the most recent exchanges only). */
  trace?: TraceStep[];
}

const STORAGE_KEY = 'pxlbuilder.aiLog';
const STARTS_KEY = 'pxlbuilder.chatStarts';
/** How many earlier exchanges the AI is reminded of. */
export const MEMORY_TURNS = 6;
/** How many earlier exchanges a card shows. */
const CARD_TURNS = 30;
const MAX = 200;
/** Exchanges that keep their trace (the raw answers are big; browser storage is small). */
const TRACED = 20;

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
    // Storage full: keep the conversations without the traces (the traces then last for this page).
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.map(({ trace: _trace, ...e }) => e)));
    } catch {
      // Unavailable: the log lasts for this page.
    }
  }
}

function loadStarts(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(STARTS_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** entries: the log; starts: when each conversation's last "New chat" was (by context key). */
export const useAILog = create<{ entries: AILogEntry[]; starts: Record<string, number> }>(() => ({ entries: load(), starts: loadStarts() }));
let nextId = Math.max(0, ...useAILog.getState().entries.map((e) => e.id)) + 1;

function put(entries: AILogEntry[]): void {
  const kept = entries.slice(-MAX).map((e, i, all) => (e.trace && i < all.length - TRACED ? { ...e, trace: undefined } : e));
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
export function logExchange(ctx: AIContext, key: string, request: string, outcome: PromptOutcome, trace?: TraceStep[]): number {
  const id = nextId++;
  put([...useAILog.getState().entries, { id, time: Date.now(), key, where: contextName(ctx), request, ...fields(outcome), ...(trace?.length ? { trace } : {}) }]);
  return id;
}

/** The exchanges of one conversation since its last "New chat", oldest first (at most the last `max`). */
export function chatEntries(state: { entries: AILogEntry[]; starts: Record<string, number> }, key: string, max = CARD_TURNS): AILogEntry[] {
  const start = state.starts[key] ?? 0;
  return state.entries.filter((e) => e.key === key && e.time > start).slice(-max);
}

/**
 * What the AI is reminded of: the conversation's last few exchanges, its
 * answers with the app's own notes ("⚠ Left out…"), and requests that failed.
 */
export function chatHistory(key: string): { request: string; reply: string }[] {
  return chatEntries(useAILog.getState(), key, MEMORY_TURNS).map((e) => ({
    request: e.request,
    reply:
      e.status === 'error'
        ? `[The app: this request failed and nothing was changed: ${e.message}]`
        : [e.message, ...e.changes.map((c) => `- ${c}`), ...(e.undone ? ['[The app: the user undid this change.]'] : [])].join('\n'),
  }));
}

/** "New chat": the conversation about this starts again (the AI History log keeps the old one). */
export function newChat(key: string): void {
  const starts = { ...useAILog.getState().starts, [key]: Date.now() };
  useAILog.setState({ starts });
  try {
    localStorage.setItem(STARTS_KEY, JSON.stringify(starts));
  } catch {
    // Storage unavailable: lasts for this page.
  }
}

/** The exchange's outcome changed (undone from its card, made a new object instead). */
export function updateExchange(id: number, outcome: PromptOutcome): void {
  put(useAILog.getState().entries.map((e) => (e.id === id ? { ...e, ...fields(outcome) } : e)));
}

export function clearAILog(): void {
  put([]);
}
