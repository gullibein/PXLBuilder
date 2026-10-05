import Anthropic from '@anthropic-ai/sdk';
import { askClaude } from '../src/core/ai/claude';
import type { AIRequestBody } from '../src/core/ai/protocol';

let client: Anthropic | null = null;

function getClient(apiKey: string | undefined): Anthropic {
  // Without an explicit key the SDK falls back to ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
  client ??= apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  return client;
}

export async function handleAIRequest(body: AIRequestBody, apiKey: string | undefined): Promise<{ status: number; body: unknown }> {
  let result;
  try {
    result = await askClaude(getClient(apiKey), body);
  } catch (e) {
    client = null;
    // Constructing the client without any credentials throws here.
    result = { ok: false as const, status: 401, error: (e as Error).message, kind: 'auth' as const };
  }
  if (result.ok) return { status: 200, body: result.response };
  if (result.kind === 'auth') {
    client = null;
    return { status: 401, body: { error: 'AI is not connected: no valid Anthropic API key. Set ANTHROPIC_API_KEY in .env.local and restart `npm run dev`, or enter your own key in ⋯ → AI connection.', noKey: true } };
  }
  return { status: result.status, body: { error: result.error } };
}
