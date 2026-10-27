/**
 * The conversation with the AI, in full: every request (as typed), the AI's
 * whole answer and its changes, and how it ended (applied, undone, an answer,
 * an error), also for answers that changed nothing. Shown in the AI History
 * tab. Kept in this browser (the last 1000), so it survives a reload, and
 * saved in the game file with the game (this game's exchanges, without the
 * under-the-hood traces), so opening the file brings it back. What is saved
 * is for the user to read: it is never sent to the AI.
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
  /** The game it was about (its project id). Missing in entries from before conversations were kept per game. */
  project?: string;
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
  /** Came from a saved game file: shown, never sent to the AI. */
  saved?: true;
}

const STORAGE_KEY = 'pxlbuilder.aiLog';
const STARTS_KEY = 'pxlbuilder.chatStarts';
/** How many earlier exchanges the AI is reminded of. */
export const MEMORY_TURNS = 6;
/** How many earlier exchanges a card shows. */
const CARD_TURNS = 30;
const MAX = 1000;
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
      if (ctx.camera) return scene ? `Camera (${scene.name})` : 'Camera';
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
    case 'object':
      return project.definitions.find((d) => d.id === ctx.definitionId)?.name ?? 'Object';
    case 'sound':
      return project.assets.find((a) => a.id === ctx.assetId)?.name ?? 'Sound';
    case 'autotile':
      return `${project.definitions.find((d) => d.id === ctx.definitionId)?.name ?? 'Object'} autotile`;
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
  put([...useAILog.getState().entries, { id, time: Date.now(), key, project: useEditor.getState().project.id, where: contextName(ctx), request, ...fields(outcome), ...(trace?.length ? { trace } : {}) }]);
  return id;
}

/** Conversations belong to one game (another game's "Whole game" chat isn't this one's); the editor's own chat to none. */
const scoped = (key: string, project: string) => (key === 'editor' ? key : `${project}/${key}`);

/** The exchanges of one conversation in this game since its last "New chat", oldest first (at most the last `max`). */
export function chatEntries(state: { entries: AILogEntry[]; starts: Record<string, number> }, key: string, max = CARD_TURNS, project = useEditor.getState().project.id): AILogEntry[] {
  const start = state.starts[scoped(key, project)] ?? 0;
  return state.entries.filter((e) => e.key === key && (key === 'editor' || e.project === project) && e.time > start).slice(-max);
}

/**
 * What the AI is reminded of: the conversation's last few exchanges, its
 * answers with the app's own notes ("⚠ Left out…"), and requests that failed.
 */
export function chatHistory(key: string): { request: string; reply: string }[] {
  return chatEntries(useAILog.getState(), key, MEMORY_TURNS)
    .filter((e) => !e.saved)
    .map((e) => ({
    request: e.request,
    reply:
      e.status === 'error'
        ? `[The app: this request failed and nothing was changed: ${e.message}]`
        : [e.message, ...e.changes.map((c) => `- ${c}`), ...(e.undone ? ['[The app: the user undid this change.]'] : [])].join('\n'),
  }));
}

/** "New chat": the conversation about this starts again (the AI History log keeps the old one). */
export function newChat(key: string): void {
  const starts = { ...useAILog.getState().starts, [scoped(key, useEditor.getState().project.id)]: Date.now() };
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

/** Undo/redo moved steps: AI changes whose step is now undone are marked undone; redone ones are applied again. */
export function markUndoneSteps(undone: Set<number>, done: Set<number>): void {
  const entries = useAILog.getState().entries;
  let changed = false;
  const next = entries.map((e) => {
    if (e.transactionId === null || e.status !== 'applied') return e;
    const now = undone.has(e.transactionId) ? true : done.has(e.transactionId) ? false : e.undone;
    if (now === e.undone) return e;
    changed = true;
    return { ...e, undone: now };
  });
  if (changed) put(next);
}

/** What goes into the game file: this game's exchanges and where its conversations start, without the traces. */
export interface SavedAIHistory {
  entries: Omit<AILogEntry, 'id' | 'transactionId' | 'trace' | 'saved' | 'project'>[];
  starts: Record<string, number>;
}

export function aiHistoryFor(project: string): SavedAIHistory {
  const { entries, starts } = useAILog.getState();
  const mine = entries.filter((e) => e.project === project);
  return {
    entries: mine.map(({ id: _id, transactionId: _t, trace: _trace, saved: _saved, project: _p, ...e }) => e),
    starts: Object.fromEntries(Object.entries(starts).filter(([k]) => k.startsWith(`${project}/`)).map(([k, v]) => [k.slice(project.length + 1), v])),
  };
}

/** A game file was opened: its saved AI history joins the log (what is already there is not added twice). */
export function restoreAIHistory(project: string, saved: unknown): number {
  if (!saved || typeof saved !== 'object' || !Array.isArray((saved as SavedAIHistory).entries)) return 0;
  const { entries, starts } = useAILog.getState();
  const have = new Set(entries.filter((e) => e.project === project).map((e) => `${e.time}|${e.request}`));
  const added: AILogEntry[] = [];
  for (const raw of (saved as SavedAIHistory).entries) {
    if (!raw || typeof raw !== 'object' || typeof raw.request !== 'string' || typeof raw.time !== 'number') continue;
    if (have.has(`${raw.time}|${raw.request}`)) continue;
    const status = raw.status === 'applied' || raw.status === 'error' ? raw.status : 'message';
    added.push({
      id: nextId++,
      time: raw.time,
      key: typeof raw.key === 'string' ? raw.key : undefined,
      project,
      where: String(raw.where ?? ''),
      request: raw.request,
      status,
      message: String(raw.message ?? ''),
      changes: Array.isArray(raw.changes) ? raw.changes.map(String) : [],
      warn: raw.warn === true,
      transactionId: null,
      undone: raw.undone === true,
      note: typeof raw.note === 'string' ? raw.note : null,
      saved: true,
    });
  }
  const savedStarts = (saved as SavedAIHistory).starts;
  const nextStarts = { ...starts };
  if (savedStarts && typeof savedStarts === 'object') {
    for (const [k, v] of Object.entries(savedStarts)) if (typeof v === 'number' && !(`${project}/${k}` in nextStarts)) nextStarts[`${project}/${k}`] = v;
    useAILog.setState({ starts: nextStarts });
    try {
      localStorage.setItem(STARTS_KEY, JSON.stringify(nextStarts));
    } catch {
      // Storage unavailable: lasts for this page.
    }
  }
  if (added.length) put([...entries, ...added].sort((a, b) => a.time - b.time));
  return added.length;
}

export function clearAILog(): void {
  put([]);
}
