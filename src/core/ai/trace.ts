/**
 * What happened under the hood for one AI request (shown under Details in
 * AI History, and downloadable): what was sent (sizes, not the whole
 * prompt), the raw text that came back, the app's checks, retries and
 * problems. Never contains API keys (requests don't carry them).
 */
export type TraceKind = 'sent' | 'reply' | 'check' | 'retry' | 'note' | 'error';

export interface TraceStep {
  /** Milliseconds since the request started. */
  ms: number;
  kind: TraceKind;
  text: string;
}

export type TraceFn = (kind: TraceKind, text: string) => void;

/** Longest text kept per step (a whole drawing or level answer fits; huge ones are cut). */
export const TRACE_TEXT_MAX = 16000;

export function createTrace(): { steps: TraceStep[]; add: TraceFn } {
  const start = Date.now();
  const steps: TraceStep[] = [];
  return {
    steps,
    add(kind, text) {
      steps.push({ ms: Date.now() - start, kind, text: text.length > TRACE_TEXT_MAX ? `${text.slice(0, TRACE_TEXT_MAX)}… [cut: ${text.length} characters in all]` : text });
    },
  };
}
