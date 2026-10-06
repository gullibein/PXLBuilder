/**
 * The one Claude call, shared by the dev server (key from the environment)
 * and the browser (a key the user entered), so both behave identically:
 * same model, system prompt, structured output and error meanings.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { componentRegistry } from '../components/builtin';
import { buildSystemPrompt } from './capabilities';
import { parseJsonReply, systemPromptWithReplyFormat, userMessage } from './prompt';
import { aiResponseSchema, type AIRequestBody, type AIResponse } from './protocol';

export const MODEL = 'claude-opus-5-5';

let systemPrompt: string | null = null;

export type ClaudeResult = { ok: true; response: AIResponse } | { ok: false; status: number; error: string; kind: 'auth' | 'rate' | 'other' };

/**
 * What this account's API key accepts, learned from rejected requests (kept
 * while the app runs): the server-side refusal fallback is a beta feature an
 * organization may not be enabled for, and the reply format may be refused as
 * a structured-output schema. Either is then left out and the same request
 * sent again, so the AI keeps working; answers are validated the same way.
 */
const accepted = { fallbacks: true, schema: true };

/** For tests: assume everything is accepted again. */
export function resetClaudeFeatures(): void {
  accepted.fallbacks = true;
  accepted.schema = true;
}

/** Asks Claude for structured operations. Never throws for API problems: they come back as plain-language errors. */
export async function askClaude(client: Anthropic, body: AIRequestBody, signal?: AbortSignal): Promise<ClaudeResult> {
  if (typeof body?.request !== 'string' || !body.request.trim() || typeof body.context !== 'object') {
    return { ok: false, status: 400, error: 'Missing request or context', kind: 'other' };
  }
  for (;;) {
    try {
      return await callClaude(client, body, signal);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        const why = apiErrorText(e);
        if (accepted.fallbacks && /fallback|beta/i.test(why)) {
          accepted.fallbacks = false;
          continue;
        }
        if (accepted.schema && /output_config|format|schema|grammar/i.test(why)) {
          accepted.schema = false;
          continue;
        }
      }
      return failure(e);
    }
  }
}

async function callClaude(client: Anthropic, body: AIRequestBody, signal?: AbortSignal): Promise<ClaudeResult> {
  // Fast: the same model thinking less (the biggest part of the wait).
  const effort = body.speed === 'fast' ? ('low' as const) : ('medium' as const);
  const common = {
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user' as const, content: userMessage(body) }],
    ...(accepted.fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
  const declined: ClaudeResult = { ok: true, response: { kind: 'unsupported', message: 'The AI declined this request.', changes: [], operations: [] } };
  const incomplete: ClaudeResult = { ok: false, status: 502, error: 'The AI response was incomplete. Try a smaller request.', kind: 'other' };

  if (accepted.schema) {
    systemPrompt ??= buildSystemPrompt(componentRegistry);
    const response = await client.beta.messages.parse(
      {
        ...common,
        output_config: { effort, format: betaZodOutputFormat(aiResponseSchema) },
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') return declined;
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) return incomplete;
    return { ok: true, response: response.parsed_output };
  }

  // The reply format spelled out in the prompt instead (as for claude.ai and Gemini), checked the same way.
  const response = await client.beta.messages.create(
    {
      ...common,
      output_config: { effort },
      system: [{ type: 'text', text: systemPromptWithReplyFormat(), cache_control: { type: 'ephemeral' } }],
    },
    { signal },
  );
  if (response.stop_reason === 'refusal') return declined;
  if (response.stop_reason === 'max_tokens') return incomplete;
  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let raw: unknown;
  try {
    raw = parseJsonReply(text);
  } catch {
    return { ok: false, status: 502, error: "The AI's answer could not be read. Try again, or ask for less at once.", kind: 'other' };
  }
  const parsed = aiResponseSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 502, error: "The AI's answer was not in the expected form. Try again.", kind: 'other' };
  return { ok: true, response: parsed.data };
}

function failure(e: unknown): ClaudeResult {
  if ((e as Error).name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) throw e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { ok: false, status: 401, error: 'The Anthropic API key was not accepted.', kind: 'auth' };
  }
  if (e instanceof Anthropic.RateLimitError) return { ok: false, status: 429, error: 'The AI is rate limited. Try again in a moment.', kind: 'rate' };
  if (e instanceof Anthropic.APIConnectionError) return { ok: false, status: 502, error: 'Could not reach the Anthropic API (network or browser blocked the request).', kind: 'other' };
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(apiErrorText(e))) {
    // The API is billed separately from a Claude subscription (Pro, Max): prepaid credits in the Console.
    return {
      ok: false,
      status: 402,
      error: 'Your Anthropic API account has no credit left. The API is paid separately from a Claude subscription: add credits at console.anthropic.com → Billing, or use PXLBuilder on claude.ai, where the AI runs on your Claude subscription.',
      kind: 'other',
    };
  }
  if (e instanceof Anthropic.APIError) return { ok: false, status: 502, error: `AI request failed (${e.status ?? 'network'}): ${apiErrorText(e)}`, kind: 'other' };
  const message = (e as Error).message ?? '';
  if (/api key|apiKey|credentials|authentication/i.test(message)) return { ok: false, status: 401, error: 'No Anthropic API key found.', kind: 'auth' };
  return { ok: false, status: 500, error: `AI request failed: ${message}`, kind: 'other' };
}

/** Anthropic's own explanation of a failed request (and its id, for support), instead of a bare status code. */
export function apiErrorText(e: InstanceType<typeof Anthropic.APIError>): string {
  const body = e.error as { error?: { message?: unknown } } | undefined;
  const message = typeof body?.error?.message === 'string' ? body.error.message : e.message.replace(/^\d{3}\s+/, '');
  return `${message || 'no details given'}${e.requestID ? ` (request ${e.requestID})` : ''}`;
}
