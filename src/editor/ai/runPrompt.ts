/**
 * Prompt -> context -> AI -> structured operations -> validation -> transaction.
 *
 * The AI only ever proposes operations. They are applied all-or-nothing as
 * one undoable transaction through the same mutation layer the inspector uses.
 */
import { buildAIPayload, contextKey, type AIContext } from '../../core/ai/context';
import { AIUnavailableError, type AIExchange, type AIResponse } from '../../core/ai/protocol';
import { HttpAIProvider, type AIProvider } from '../../core/ai/provider';
import { applyOperations, type ApplyResult, type Operation } from '../../core/commands/operations';
import { componentRegistry } from '../../core/components/builtin';
import { useEditor } from '../store';

export type PromptOutcome =
  | { status: 'applied'; message: string; changes: string[]; result: ApplyResult }
  | { status: 'proposal'; message: string; changes: string[]; operations: Operation[] }
  | { status: 'message'; message: string; tone: 'info' | 'warn' }
  | { status: 'error'; message: string };

let provider: AIProvider = new HttpAIProvider();

/** Swaps the AI provider (other vendors, a hosted backend, tests). */
export function setAIProvider(next: AIProvider): void {
  provider = next;
}

/** Short per-context memory so follow-ups like "make them regenerate" resolve. Never the source of truth. */
const conversations = new Map<string, AIExchange[]>();
const MAX_TURNS = 6;

function remember(ctx: AIContext, request: string, response: AIResponse): void {
  const key = contextKey(ctx);
  const reply = [response.message, ...response.changes.map((c) => `- ${c}`)].join('\n');
  conversations.set(key, [...(conversations.get(key) ?? []), { request, reply }].slice(-MAX_TURNS));
}

export function labelFor(request: string): string {
  const text = request.trim().replace(/\s+/g, ' ');
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

export async function runPrompt(ctx: AIContext, request: string, signal?: AbortSignal): Promise<PromptOutcome> {
  const state = useEditor.getState();
  const body = {
    context: buildAIPayload(state.project, ctx, componentRegistry),
    request,
    history: conversations.get(contextKey(ctx)) ?? [],
  };
  let response: AIResponse;
  try {
    response = await provider.respond(body, signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    const message = e instanceof AIUnavailableError ? e.message : `AI request failed: ${(e as Error).message}`;
    state.logMessage('error', message);
    return { status: 'error', message };
  }
  remember(ctx, request, response);

  if (response.operations.length === 0) {
    return { status: 'message', message: response.message, tone: response.kind === 'unsupported' ? 'warn' : 'info' };
  }
  if (response.kind === 'apply') return applyAIOperations(request, response.message, response.changes, response.operations);
  return { status: 'proposal', message: response.message, changes: response.changes, operations: response.operations };
}

/** Applies AI operations as one transaction. Invalid operations reject the whole set. */
export function applyAIOperations(request: string, message: string, changes: string[], operations: Operation[]): PromptOutcome {
  const { edit, logMessage } = useEditor.getState();
  let result: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [] };
  const ok = edit(
    `✨ ${labelFor(request)}`,
    (p) => {
      result = applyOperations(p, operations, componentRegistry);
    },
    { source: 'ai', changes, operations },
  );
  if (!ok) {
    const last = useEditor.getState().log.at(-1);
    return { status: 'error', message: `The AI's change couldn't be applied. ${last?.message.split(': ').slice(1).join(': ') ?? ''}`.trim() };
  }
  logMessage('info', `AI: ${message}`);
  return { status: 'applied', message, changes, result };
}
