/**
 * Everything about how a game was made, kept for this visit to the page, for "Save with history": each AI request in
 * full (what was sent, the answers uncut, every step under the hood, how it ended). The AI History keeps the same
 * steps cut short and only for a while (browser storage is small); this is what is needed to work out afterwards
 * what the engine and the AI did together. Never an API key: requests don't carry them (and the saved text is
 * searched for anything that looks like one, saveText).
 */
import type { AIRequestBody, AIResponse } from '../../core/ai/protocol';
import type { TraceKind } from '../../core/ai/trace';

/** One question to the AI and what came back. */
export interface DiagnosticExchange {
  /** Milliseconds since the request began, and how long the answer took. */
  atMs: number;
  tookMs: number;
  /** What was sent: the request as the AI got it (with the app's notes), the game's data, the guidance and code that went along. */
  sent: { request: string; speed: string; topics: string[]; context: unknown; code: unknown[]; history: unknown[]; referenceChars: number; pictures: { mediaType: string; chars: number }[] };
  /** The answer as the app read it, or the error (`raw`: a refused answer as the model sent it, word for word). */
  answer: AIResponse | { error: string; raw?: string };
}

/** One request the user made (it may take several exchanges: parts, retries, code asked for). */
export interface DiagnosticRequest {
  time: number;
  project: string;
  request: string;
  about: string;
  steps: { ms: number; kind: TraceKind; text: string }[];
  exchanges: DiagnosticExchange[];
  outcome: { status: string; message: string; changes: string[] } | null;
  tookMs: number | null;
}

export interface DiagnosticRecorder {
  step(kind: TraceKind, text: string): void;
  exchange(body: AIRequestBody, answer: AIResponse | { error: string; raw?: string }, startedAt: number): void;
  end(outcome: { status: string; message?: string; changes?: string[] }): void;
}

/** The most requests kept (a visit of building one game is a handful; each can be hundreds of kilobytes). */
const KEPT = 60;
let kept: DiagnosticRequest[] = [];

export function beginDiagnostics(project: string, request: string, about: string): DiagnosticRecorder {
  const started = Date.now();
  const record: DiagnosticRequest = { time: started, project, request, about, steps: [], exchanges: [], outcome: null, tookMs: null };
  kept = [...kept.slice(-(KEPT - 1)), record];
  return {
    step: (kind, text) => void record.steps.push({ ms: Date.now() - started, kind, text }),
    exchange: (body, answer, startedAt) =>
      void record.exchanges.push({
        atMs: startedAt - started,
        tookMs: Date.now() - startedAt,
        sent: {
          request: body.request,
          speed: body.speed ?? 'best',
          topics: body.topics ?? [],
          context: body.context,
          code: body.code ?? [],
          history: body.history,
          referenceChars: body.reference?.length ?? 0,
          // (Pictures the user attached are theirs and big: their kind and size only.)
          pictures: (body.images ?? []).map((p) => ({ mediaType: p.mediaType, chars: p.data.length })),
        },
        answer,
      }),
    end: (outcome) => {
      record.outcome = { status: outcome.status, message: outcome.message ?? '', changes: outcome.changes ?? [] };
      record.tookMs = Date.now() - started;
    },
  };
}

/** The requests made about a game in this visit, oldest first. */
export function diagnosticsFor(project: string): DiagnosticRequest[] {
  return kept.filter((r) => r.project === project);
}

/** For tests. */
export function clearDiagnostics(): void {
  kept = [];
}

/** Text that looks like an API key (Anthropic's, Google's), wherever it is. */
const KEY_LIKE = /sk-ant-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}/g;

/** The text to save, with anything that looks like an API key taken out (none should be there: a last safeguard). */
export function withoutKeys(text: string): string {
  return text.replace(KEY_LIKE, '[key removed]');
}
