/**
 * Claude through claude.ai, for the published app: the page asks Claude with
 * the `sample` capability of the artifact viewer, on the viewer's own Claude
 * account (they allow it once per visit). No API key, no server, and the page
 * makes no network requests of its own (the viewer does not allow those).
 *
 * The answer is plain JSON, so the reply format is spelled out in the prompt
 * (from the same schema the server uses) and checked against it before any
 * operation is applied.
 */
import { parseJsonReply, systemPromptWithReplyFormat, userMessage } from '../../core/ai/prompt';
import { AIUnavailableError, aiResponseSchema, type AIRequestBody, type AIResponse } from '../../core/ai/protocol';
import type { AIProvider } from '../../core/ai/provider';
import { claudeCapability } from '../claudeViewer';

interface SampleError {
  code: string;
  message: string;
}
type SampleOptions = { signal?: AbortSignal; modelTier?: 'default' | 'quick' | 'complex'; cache?: boolean };
/** The viewer's sample: called, it gives the answer's text (read here, forgivingly); `json` parses it strictly. */
type SampleFn = ((input: string, options?: SampleOptions) => Promise<{ text: string; truncated: boolean }>) & { json?(input: string, options?: SampleOptions): Promise<unknown> };

/** The viewer's `sample` function, or null outside a claude.ai artifact viewer (local dev, a saved copy). */
export function claudeSample(): Promise<SampleFn | null> {
  return claudeCapability<SampleFn>('sample');
}

function prompt(body: AIRequestBody): string {
  return `${systemPromptWithReplyFormat()}\n\n${userMessage(body)}`;
}

const MESSAGES: Record<string, string> = {
  not_granted: 'The AI needs your permission to use your Claude account on this page. Reload the page and choose Allow when asked.',
  sampling_disabled: 'Claude is not available for your account here.',
  rate_limited: 'Too many AI requests right now (or your Claude usage limit was reached). Try again in a little while.',
  session_expired: 'Your claude.ai session expired. Sign in again and reload.',
  refused: 'Claude declined this request.',
  invalid_json: "The AI's answer could not be read. Try again, or ask for less at once.",
  prompt_too_large: 'This level is too big to send in one request. Try asking about a selected part.',
};

export class SampleAIProvider implements AIProvider {
  constructor(private readonly sample: SampleFn) {}

  async respond(body: AIRequestBody, signal?: AbortSignal): Promise<AIResponse> {
    let answer: { text: string; truncated: boolean };
    try {
      // Every request is new work: no replay of an earlier answer.
      // Fast: claude.ai's quicker model tier.
      answer = await this.sample(prompt(body), { signal, cache: false, ...(body.speed === 'fast' ? { modelTier: 'quick' as const } : {}) });
    } catch (e) {
      const err = e as SampleError;
      if (err?.code === 'cancelled') throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      throw new AIUnavailableError(MESSAGES[err?.code] ?? `The AI request failed (${err?.code ?? 'unknown'}). Try again.`);
    }
    // The answer is read here rather than by the viewer, so a sentence around the JSON or a code fence doesn't lose it,
    // and an answer that was cut off is told apart from one that is malformed.
    if (answer.truncated) throw new AIUnavailableError("The AI's answer was too long and got cut off before it was complete. Ask for less at once (for example one drawing, or one part of the level, per request).");
    let raw: unknown;
    try {
      raw = parseJsonReply(answer.text);
    } catch {
      throw new AIUnavailableError("The AI's answer wasn't in the form the app reads (JSON), so nothing was changed. Try again; asking in a different way or for less at once usually helps.");
    }
    const parsed = aiResponseSchema.safeParse(raw);
    if (!parsed.success) throw new AIUnavailableError("The AI's answer was not in the expected form. Try again.");
    return parsed.data;
  }
}
