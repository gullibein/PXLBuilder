/**
 * The one Claude call, shared by the dev server (key from the environment)
 * and the browser (a key the user entered), so both behave identically:
 * same model, system prompt, structured output and error meanings.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { componentRegistry } from '../components/builtin';
import { buildSystemPrompt } from './capabilities';
import { parseJsonReply, systemPromptWithReplyFormat, userMessageParts } from './prompt';
import { aiResponseSchema, type AIRequestBody, type AIResponse, fillMissingNulls } from './protocol';

export const MODEL = 'claude-opus-5-5';

/**
 * The Claude models an Anthropic key can be used with here, and what they cost (US$ per million tokens, Anthropic's
 * price list). Opus is the default; the others cost less and may get hard requests wrong more often.
 */
export const CLAUDE_MODELS = {
  'claude-opus-5-5': { name: 'Claude Opus 5.5', input: 4, output: 20 },
  'claude-sonnet-5-5': { name: 'Claude Sonnet 5.5', input: 2, output: 10 },
  'claude-haiku-5-5': { name: 'Claude Haiku 5.5', input: 0.1, output: 0.5 },
} as const;
export type ClaudeModel = keyof typeof CLAUDE_MODELS;
export const isClaudeModel = (m: unknown): m is ClaudeModel => typeof m === 'string' && m in CLAUDE_MODELS;

/** What one request used and cost (from the token counts the API reports). */
export interface ClaudeUsage {
  model: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** US$; null for a model not in CLAUDE_MODELS (a fallback model, say). */
  cost: number | null;
}

/**
 * The price of a request: normal input, cache writes (1.25× input for 5 minutes, 2× for an hour), cache reads
 * (0.1× input) and output (thinking included).
 */
export function usageCost(model: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null }): ClaudeUsage {
  const price = isClaudeModel(model) ? CLAUDE_MODELS[model] : null;
  const write = u.cache_creation_input_tokens ?? 0;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write - write1h;
  const read = u.cache_read_input_tokens ?? 0;
  const cost = price ? (u.input_tokens * price.input + write5m * price.input * 1.25 + write1h * price.input * 2 + read * price.input * 0.1 + u.output_tokens * price.output) / 1e6 : null;
  return { model, inputTokens: u.input_tokens, cacheWriteTokens: write, cacheReadTokens: read, outputTokens: u.output_tokens, cost };
}

let systemPrompt: string | null = null;

export type ClaudeResult = ({ ok: true; response: AIResponse } | { ok: false; status: number; error: string; kind: 'auth' | 'rate' | 'other' }) & { usage?: ClaudeUsage };

/**
 * What this account's API key accepts, learned from rejected requests (kept
 * while the app runs): the server-side refusal fallback is a beta feature an
 * organization may not be enabled for, and the reply format may be refused as
 * a structured-output schema. Either is then left out and the same request
 * sent again, so the AI keeps working; answers are validated the same way.
 */
const accepted = { fallbacks: new Set<string>(), schema: true };

/** For tests: assume everything is accepted again. */
export function resetClaudeFeatures(): void {
  accepted.fallbacks.clear();
  accepted.schema = true;
}

/** Asks Claude for structured operations. Never throws for API problems: they come back as plain-language errors. */
export async function askClaude(client: Anthropic, body: AIRequestBody, signal?: AbortSignal, model: ClaudeModel = MODEL): Promise<ClaudeResult> {
  if (typeof body?.request !== 'string' || !body.request.trim() || typeof body.context !== 'object') {
    return { ok: false, status: 400, error: 'Missing request or context', kind: 'other' };
  }
  for (;;) {
    try {
      return await callClaude(client, body, model, signal);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        const why = apiErrorText(e);
        // (Per model: a model with no fallback, such as Haiku, refuses the parameter; the others keep it.)
        if (!accepted.fallbacks.has(model) && /fallback|beta/i.test(why)) {
          accepted.fallbacks.add(model);
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

async function callClaude(client: Anthropic, body: AIRequestBody, model: ClaudeModel, signal?: AbortSignal): Promise<ClaudeResult> {
  // Fast: the same model thinking less (the biggest part of the wait).
  const effort = body.speed === 'fast' ? ('low' as const) : ('medium' as const);
  // The game's data is its own block, cached: a second request with the same game (the answer sent back to be fixed,
  // or another question before anything changed) reads it at a tenth of the price instead of paying for it again.
  const { context, rest } = userMessageParts(body);
  const common = {
    model,
    max_tokens: 16000,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: context, cache_control: { type: 'ephemeral' as const } },
          { type: 'text' as const, text: rest },
        ],
      },
    ],
    ...(!accepted.fallbacks.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
  // The system prompt (the same for every request, about 25,000 tokens) is cached for an hour, not 5 minutes, so a
  // pause between prompts doesn't mean paying to write it again.
  const cachedSystem = (text: string) => [{ type: 'text' as const, text, cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } }];
  const used = (r: { model?: string; usage?: Parameters<typeof usageCost>[1] }) => (r.usage ? usageCost(r.model ?? model, r.usage) : undefined);
  const declined: ClaudeResult = { ok: true, response: { kind: 'unsupported', message: 'The AI declined this request.', changes: [], operations: [] } };
  const incomplete: ClaudeResult = { ok: false, status: 502, error: 'The AI response was incomplete. Try a smaller request.', kind: 'other' };

  if (accepted.schema) {
    systemPrompt ??= buildSystemPrompt(componentRegistry);
    const response = await client.beta.messages.parse(
      {
        ...common,
        output_config: { effort, format: betaZodOutputFormat(aiResponseSchema) },
        system: cachedSystem(systemPrompt),
      },
      { signal },
    );
    const usage = used(response);
    const withUsage = <T extends ClaudeResult>(r: T): T => (usage ? { ...r, usage } : r);
    if (response.stop_reason === 'refusal') return withUsage(declined);
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) return withUsage(incomplete);
    return withUsage({ ok: true, response: response.parsed_output });
  }

  // The reply format spelled out in the prompt instead (as for claude.ai and Gemini), checked the same way.
  const response = await client.beta.messages.create(
    {
      ...common,
      output_config: { effort },
      system: cachedSystem(systemPromptWithReplyFormat()),
    },
    { signal },
  );
  const usage = used(response);
  const withUsage = <T extends ClaudeResult>(r: T): T => (usage ? { ...r, usage } : r);
  if (response.stop_reason === 'refusal') return withUsage(declined);
  if (response.stop_reason === 'max_tokens') return withUsage(incomplete);
  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  let raw: unknown;
  try {
    raw = parseJsonReply(text);
  } catch {
    return withUsage({ ok: false, status: 502, error: "The AI's answer could not be read. Try again, or ask for less at once.", kind: 'other' });
  }
  const parsed = aiResponseSchema.safeParse(fillMissingNulls(raw));
  if (!parsed.success) return withUsage({ ok: false, status: 502, error: "The AI's answer was not in the expected form. Try again.", kind: 'other' });
  return withUsage({ ok: true, response: parsed.data });
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
