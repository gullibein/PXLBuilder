import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { buildSystemPrompt } from '../src/core/ai/capabilities';
import { aiResponseSchema, type AIRequestBody } from '../src/core/ai/protocol';
import { componentRegistry } from '../src/core/components/builtin';

const MODEL = 'claude-opus-5-5';
const SYSTEM_PROMPT = buildSystemPrompt(componentRegistry);

let client: Anthropic | null = null;

function getClient(apiKey: string | undefined): Anthropic {
  // Without an explicit key the SDK falls back to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
  client ??= apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  return client;
}

function userMessage(body: AIRequestBody): string {
  const history = body.history.length
    ? `Recent requests in this same context (oldest first; the project data above reflects their results):\n${body.history
        .map((h) => `- User: ${h.request}\n  You: ${h.reply}`)
        .join('\n')}\n\n`
    : '';
  return `CONTEXT\n${JSON.stringify(body.context)}\n\n${history}REQUEST\n${body.request}`;
}

export async function handleAIRequest(body: AIRequestBody, apiKey: string | undefined): Promise<{ status: number; body: unknown }> {
  if (typeof body?.request !== 'string' || !body.request.trim() || typeof body.context !== 'object') {
    return { status: 400, body: { error: 'Missing request or context' } };
  }
  try {
    const response = await getClient(apiKey).beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium', format: betaZodOutputFormat(aiResponseSchema) },
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userMessage(body) }],
    });
    if (response.stop_reason === 'refusal') {
      return { status: 200, body: { kind: 'unsupported', message: 'The AI declined this request.', changes: [], operations: [] } };
    }
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      return { status: 502, body: { error: 'The AI response was incomplete. Try a smaller request.' } };
    }
    return { status: 200, body: response.parsed_output };
  } catch (e) {
    client = null;
    if (e instanceof Anthropic.AuthenticationError) {
      return { status: 401, body: { error: 'AI is not connected: the Anthropic API key is missing or invalid. Set ANTHROPIC_API_KEY in .env.local and restart `npm run dev`.' } };
    }
    if (e instanceof Anthropic.RateLimitError) return { status: 429, body: { error: 'The AI is rate limited. Try again in a moment.' } };
    if (e instanceof Anthropic.APIError) return { status: 502, body: { error: `AI request failed (${e.status ?? 'network'}).` } };
    const message = (e as Error).message ?? '';
    if (/api key|apiKey|credentials|authentication/i.test(message)) {
      return { status: 401, body: { error: 'AI is not connected: no Anthropic API key found. Set ANTHROPIC_API_KEY in .env.local and restart `npm run dev`.' } };
    }
    return { status: 500, body: { error: `AI request failed: ${message}` } };
  }
}
