/**
 * Calls Claude straight from the browser with the user's own key (no server
 * needed). Uses the same request as the dev server (core/ai/claude.ts).
 */
import Anthropic from '@anthropic-ai/sdk';
import { askClaude, MODEL } from '../../core/ai/claude';
import { AIUnavailableError, type AIRequestBody, type AIResponse } from '../../core/ai/protocol';
import type { AIProvider } from '../../core/ai/provider';

function client(apiKey: string): Anthropic {
  // The key is the user's own, entered by them, and only ever sent to the Anthropic API.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export class BrowserClaudeProvider implements AIProvider {
  constructor(private readonly apiKey: string) {}

  async respond(body: AIRequestBody, signal?: AbortSignal): Promise<AIResponse> {
    const result = await askClaude(client(this.apiKey), body, signal);
    if (result.ok) return result.response;
    throw new AIUnavailableError(result.kind === 'auth' ? 'Your Anthropic API key was not accepted. Check it in ⋯ → AI connection.' : result.error);
  }
}

/** Checks a key without spending tokens (looks up the model). */
export async function testApiKey(apiKey: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await client(apiKey).models.retrieve(MODEL);
    return { ok: true };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return { ok: false, message: 'The key was not accepted.' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, message: 'Could not reach the Anthropic API from this page (network, or the page does not allow it).' };
    return { ok: false, message: (e as Error).message };
  }
}
