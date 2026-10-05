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
import { z } from 'zod';
import { buildSystemPrompt } from '../../core/ai/capabilities';
import { userMessage } from '../../core/ai/prompt';
import { AIUnavailableError, aiResponseSchema, type AIRequestBody, type AIResponse } from '../../core/ai/protocol';
import type { AIProvider } from '../../core/ai/provider';
import { componentRegistry } from '../../core/components/builtin';

interface SampleError {
  code: string;
  message: string;
}
type SampleFn = { json(input: string, options?: { signal?: AbortSignal; modelTier?: 'default' | 'quick' | 'complex'; cache?: boolean }): Promise<unknown> };

let samplePromise: Promise<SampleFn | null> | null = null;

/** The viewer's `sample` function, or null outside a claude.ai artifact viewer (local dev, a saved copy). */
export function claudeSample(): Promise<SampleFn | null> {
  if (!samplePromise) {
    const claude = (globalThis as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
    samplePromise = claude?.use ? claude.use('sample').then((s) => (s as SampleFn | null) ?? null, () => null) : Promise.resolve(null);
  }
  return samplePromise;
}

let instructions: string | null = null;

function prompt(body: AIRequestBody): string {
  instructions ??= `${buildSystemPrompt(componentRegistry)}

REPLY FORMAT
Reply with only one JSON object matching this JSON Schema (no other text). Every operation must have all of its fields; use null where a field allows it.
${JSON.stringify(z.toJSONSchema(aiResponseSchema))}`;
  return `${instructions}\n\n${userMessage(body)}`;
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
    let raw: unknown;
    try {
      // Every request is new work: no replay of an earlier answer.
      raw = await this.sample.json(prompt(body), { signal, cache: false });
    } catch (e) {
      const err = e as SampleError;
      if (err?.code === 'cancelled') throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      throw new AIUnavailableError(MESSAGES[err?.code] ?? `The AI request failed (${err?.code ?? 'unknown'}). Try again.`);
    }
    const parsed = aiResponseSchema.safeParse(raw);
    if (!parsed.success) throw new AIUnavailableError("The AI's answer was not in the expected form. Try again.");
    return parsed.data;
  }
}
