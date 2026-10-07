import { AIUnavailableError, aiResponseSchema, type AIRequestBody, type AIResponse } from './protocol';
import type { TraceFn } from './trace';

/**
 * The editor talks to AI through this interface, so the model vendor (and
 * whether calls go through a proxy) can change without touching the UI.
 */
export interface AIProvider {
  /** `trace` hears what was sent and the raw answers (for AI History's Details). */
  respond(body: AIRequestBody, signal?: AbortSignal, trace?: TraceFn): Promise<AIResponse>;
}

/** Calls the PXLBuilder AI endpoint (served by the dev/preview server, which holds the API key). */
export class HttpAIProvider implements AIProvider {
  constructor(private readonly endpoint = '/api/ai') {}

  async respond(body: AIRequestBody, signal?: AbortSignal, trace?: TraceFn): Promise<AIResponse> {
    trace?.('sent', `This computer's PXLBuilder server (${this.endpoint})`);
    let res: Response;
    try {
      res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new AIUnavailableError('AI is not connected. Add your Anthropic API key in ⋯ → AI connection.');
    }
    if (res.status === 404 || res.status === 405) {
      throw new AIUnavailableError('AI is not connected here. Add your Anthropic API key in ⋯ → AI connection.');
    }
    const json: unknown = await res.json().catch(() => null);
    trace?.('reply', `HTTP ${res.status}: ${JSON.stringify(json)}`);
    if (!res.ok) {
      const message = (json as { error?: string } | null)?.error ?? `AI request failed (${res.status})`;
      // No usable key on the server: point to the user's own key.
      const hint = res.status === 401 && !message.includes('AI connection') ? ' You can add your own Anthropic API key in ⋯ → AI connection.' : '';
      throw new AIUnavailableError(message + hint);
    }
    const parsed = aiResponseSchema.safeParse(json);
    if (!parsed.success) throw new AIUnavailableError('The AI returned a response PXLBuilder could not read. Try again.');
    return parsed.data;
  }
}
