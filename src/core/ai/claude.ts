/**
 * The one Claude call, shared by the dev server (key from the environment)
 * and the browser (a key the user entered), so both behave identically:
 * same model, system prompt, structured output and error meanings.
 */
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { componentRegistry } from '../components/builtin';
import { buildSystemPrompt } from './capabilities';
import { userMessage } from './prompt';
import { aiResponseSchema, type AIRequestBody, type AIResponse } from './protocol';

export const MODEL = 'claude-opus-5-5';

let systemPrompt: string | null = null;

export type ClaudeResult = { ok: true; response: AIResponse } | { ok: false; status: number; error: string; kind: 'auth' | 'rate' | 'other' };

/** Asks Claude for structured operations. Never throws for API problems: they come back as plain-language errors. */
export async function askClaude(client: Anthropic, body: AIRequestBody, signal?: AbortSignal): Promise<ClaudeResult> {
  if (typeof body?.request !== 'string' || !body.request.trim() || typeof body.context !== 'object') {
    return { ok: false, status: 400, error: 'Missing request or context', kind: 'other' };
  }
  systemPrompt ??= buildSystemPrompt(componentRegistry);
  try {
    const response = await client.beta.messages.parse(
      {
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'medium', format: betaZodOutputFormat(aiResponseSchema) },
        system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: userMessage(body) }],
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') {
      return { ok: true, response: { kind: 'unsupported', message: 'The AI declined this request.', changes: [], operations: [] } };
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      return { ok: false, status: 502, error: 'The AI response was incomplete. Try a smaller request.', kind: 'other' };
    }
    return { ok: true, response: response.parsed_output };
  } catch (e) {
    if ((e as Error).name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, status: 401, error: 'The Anthropic API key was not accepted.', kind: 'auth' };
    }
    if (e instanceof Anthropic.RateLimitError) return { ok: false, status: 429, error: 'The AI is rate limited. Try again in a moment.', kind: 'rate' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, status: 502, error: 'Could not reach the Anthropic API (network or browser blocked the request).', kind: 'other' };
    if (e instanceof Anthropic.APIError) return { ok: false, status: 502, error: `AI request failed (${e.status ?? 'network'}).`, kind: 'other' };
    const message = (e as Error).message ?? '';
    if (/api key|apiKey|credentials|authentication/i.test(message)) return { ok: false, status: 401, error: 'No Anthropic API key found.', kind: 'auth' };
    return { ok: false, status: 500, error: `AI request failed: ${message}`, kind: 'other' };
  }
}
