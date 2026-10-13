/**
 * What the AI has cost with your own Anthropic key: each request's price from the token counts the API reports
 * (not an estimate), added up for this browser tab and, for good, in this browser. Shown in the console after each
 * request and in AI connection.
 */
import { useEffect, useState } from 'react';
import type { ClaudeUsage } from '../../core/ai/claude';

const STORAGE_KEY = 'pxlbuilder.aiSpend';

export interface Spend {
  /** This browser tab (since the page was opened). */
  session: { requests: number; cost: number };
  /** Everything since it was last reset, in this browser. */
  total: { requests: number; cost: number; since: string };
}

function load(): Spend['total'] {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Spend['total'] | null;
    if (raw && Number.isFinite(raw.cost) && Number.isFinite(raw.requests) && typeof raw.since === 'string') return raw;
  } catch {
    // Unreadable: start again.
  }
  return { requests: 0, cost: 0, since: new Date().toISOString() };
}

let spend: Spend = { session: { requests: 0, cost: 0 }, total: load() };
const listeners = new Set<() => void>();

function save(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(spend.total));
  } catch {
    // Storage unavailable: the total lasts for this page only.
  }
  for (const l of listeners) l();
}

/** Adds one request's cost. */
export function recordSpend(usage: ClaudeUsage): Spend {
  const cost = usage.cost ?? 0;
  spend = {
    session: { requests: spend.session.requests + 1, cost: spend.session.cost + cost },
    total: { ...spend.total, requests: spend.total.requests + 1, cost: spend.total.cost + cost },
  };
  save();
  return spend;
}

export function resetSpendTotal(): void {
  spend = { ...spend, total: { requests: 0, cost: 0, since: new Date().toISOString() } };
  save();
}

export function getSpend(): Spend {
  return spend;
}

export function useSpend(): Spend {
  const [value, setValue] = useState(spend);
  useEffect(() => {
    const l = () => setValue(spend);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);
  return value;
}

/** "$0.142" (three decimals below a dollar: single requests are cents). */
export function dollars(n: number): string {
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

/** "31,200 in (24,800 from cache) · 4,100 out". */
export function tokensLine(u: ClaudeUsage): string {
  const k = (n: number) => n.toLocaleString('en-US');
  const inTotal = u.inputTokens + u.cacheWriteTokens + u.cacheReadTokens;
  return `${k(inTotal)} tokens in${u.cacheReadTokens ? ` (${k(u.cacheReadTokens)} from cache)` : ''} · ${k(u.outputTokens)} out`;
}
