/**
 * Transactions and undo/redo.
 *
 * Every accepted change to the project is one Transaction. Because projects
 * are immutable values (each edit produces a new object, sharing unchanged
 * parts), a transaction stores the project before and after the change:
 * undo/redo swap whole versions, which is exact, cheap, and covers every kind
 * of change (inspector edits, drags, AI operation lists) uniformly. The
 * operation list is kept alongside for display and for the AI history.
 */
import type { Project } from '../types';
import type { Operation } from './operations';

export type TransactionSource = 'user' | 'ai';

export interface Transaction {
  id: number;
  label: string;
  source: TransactionSource;
  time: number;
  before: Project;
  after: Project;
  /** Human-readable list of what changed (AI transactions). */
  changes: string[];
  /** Structured operations, when the change came from an operation list. */
  operations: Operation[];
  /** Edits with the same key in quick succession merge into one transaction. */
  coalesceKey?: string;
}

export interface History {
  past: Transaction[];
  future: Transaction[];
}

export const EMPTY_HISTORY: History = { past: [], future: [] };

const MAX_HISTORY = 200;
const COALESCE_MS = 1000;
let nextId = 1;

export function record(history: History, t: Omit<Transaction, 'id'>): History {
  const last = history.past[history.past.length - 1];
  if (t.coalesceKey && last && last.coalesceKey === t.coalesceKey && t.time - last.time < COALESCE_MS) {
    const merged: Transaction = { ...last, after: t.after, time: t.time };
    return { past: [...history.past.slice(0, -1), merged], future: [] };
  }
  return { past: [...history.past, { ...t, id: nextId++ }].slice(-MAX_HISTORY), future: [] };
}

export function undo(history: History): { history: History; project: Project; transaction: Transaction } | null {
  const t = history.past[history.past.length - 1];
  if (!t) return null;
  return { history: { past: history.past.slice(0, -1), future: [t, ...history.future] }, project: t.before, transaction: t };
}

export function redo(history: History): { history: History; project: Project; transaction: Transaction } | null {
  const t = history.future[0];
  if (!t) return null;
  return { history: { past: [...history.past, t], future: history.future.slice(1) }, project: t.after, transaction: t };
}
