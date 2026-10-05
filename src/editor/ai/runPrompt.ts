/**
 * Prompt -> context -> AI -> structured operations -> validation -> transaction.
 *
 * The AI only ever proposes operations. They are applied all-or-nothing as
 * one undoable transaction through the same mutation layer the inspector uses.
 */
import { buildAIPayload, contextKey, type AIContext } from '../../core/ai/context';
import { AIUnavailableError, type AIExchange, type AIResponse } from '../../core/ai/protocol';
import { HttpAIProvider, type AIProvider } from '../../core/ai/provider';
import { applyOperations, isEditorOperation, type ApplyResult, type Operation } from '../../core/commands/operations';
import { checkEditorSetting, editorSettingsPayload, type EditorLayout } from '../layout/settings';
import { componentRegistry } from '../../core/components/builtin';
import { useEditor } from '../store';

export type PromptOutcome =
  /** `editor`: the change was to the editor's own settings (undone with the editor's undo, not the project's). */
  | { status: 'applied'; message: string; changes: string[]; result: ApplyResult; editor?: boolean }
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
    context: buildAIPayload(state.project, ctx, componentRegistry, ctx.kind === 'editor' ? editorSettingsPayload(state.layout) : undefined),
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

const EMPTY_RESULT: ApplyResult = { createdDefinitionIds: [], createdEntityIds: [], createdRelationshipIds: [], createdRuleIds: [] };

/**
 * Applies editor-setting operations as one step of the editor's own undo.
 * Every value is checked against the setting's schema first; one bad value rejects all.
 */
function applyEditorOperations(message: string, changes: string[], operations: Operation[]): PromptOutcome {
  const { setLayout, logMessage } = useEditor.getState();
  const patch: Record<string, unknown> = {};
  for (const op of operations) {
    if (!isEditorOperation(op)) return { status: 'error', message: "The AI mixed editor and game changes, so nothing was changed." };
    let value: unknown;
    try {
      value = JSON.parse(op.valueJson);
    } catch {
      return { status: 'error', message: `The AI's value for "${op.key}" isn't valid, so nothing was changed.` };
    }
    const err = checkEditorSetting(op.key, value);
    if (err) {
      logMessage('error', `Editor change rejected: ${err}`);
      return { status: 'error', message: `The AI's editor change couldn't be applied. ${err}.` };
    }
    patch[op.key] = value;
  }
  setLayout(patch as Partial<EditorLayout>);
  logMessage('info', `Editor: ${message}`);
  return { status: 'applied', message, changes, result: EMPTY_RESULT, editor: true };
}

/** Applies AI operations as one transaction. Invalid operations reject the whole set. */
export function applyAIOperations(request: string, message: string, changes: string[], operations: Operation[]): PromptOutcome {
  if (operations.some(isEditorOperation)) return applyEditorOperations(message, changes, operations);
  const { edit, logMessage } = useEditor.getState();
  let result: ApplyResult = EMPTY_RESULT;
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
