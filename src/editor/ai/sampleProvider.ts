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
import type { TraceFn } from '../../core/ai/trace';

interface SampleError {
  code: string;
  message: string;
}
type SampleOptions = { signal?: AbortSignal; modelTier?: 'default' | 'quick' | 'complex'; cache?: boolean };
/** The viewer's sample: called, it gives the answer's text (read here, forgivingly); `json` parses it strictly. */
type SampleInput = string | { role: 'user' | 'assistant'; content: string }[];
type SampleFn = ((input: SampleInput, options?: SampleOptions) => Promise<{ text: string; truncated: boolean }>) & { json?(input: string, options?: SampleOptions): Promise<unknown> };

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
  /** `log`: hears about answers that couldn't be read (with the start of what came back), for the console. */
  constructor(
    private readonly sample: SampleFn,
    private readonly log?: (note: string) => void,
  ) {}

  private async ask(input: SampleInput, body: AIRequestBody, signal?: AbortSignal, trace?: TraceFn): Promise<{ text: string; truncated: boolean }> {
    const size = typeof input === 'string' ? input.length : input.reduce((n, t) => n + t.content.length, 0);
    trace?.('sent', `Claude through claude.ai (${body.speed === 'fast' ? 'quick' : 'default'} tier): ${size} characters${typeof input === 'string' ? '' : `, ${input.length} turns`}`);
    try {
      // Every request is new work: no replay of an earlier answer.
      // Fast: claude.ai's quicker model tier.
      const answer = await this.sample(input, { signal, cache: false, ...(body.speed === 'fast' ? { modelTier: 'quick' as const } : {}) });
      trace?.('reply', `${answer.truncated ? '[cut off by the length limit] ' : ''}${answer.text}`);
      return answer;
    } catch (e) {
      const err = e as SampleError;
      trace?.('error', `${err?.code ?? 'unknown'}: ${err?.message ?? ''}${(e as { text?: string }).text ? `\nPartial answer: ${(e as { text?: string }).text}` : ''}`);
      if (err?.code === 'cancelled') throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      throw new AIUnavailableError(MESSAGES[err?.code] ?? `The AI request failed (${err?.code ?? 'unknown'}). Try again.`);
    }
  }

  async respond(body: AIRequestBody, signal?: AbortSignal, trace?: TraceFn): Promise<AIResponse> {
    const question = prompt(body);
    let answer = await this.ask(question, body, signal, trace);
    // The answer is read here rather than by the viewer, so a sentence around the JSON or a code fence doesn't lose it,
    // and an answer that was cut off is told apart from one that is malformed.
    const cutOff = () => new AIUnavailableError("The AI's answer was too long and got cut off before it was complete. Ask for less at once (for example one drawing, or one part of the level, per request).");
    if (answer.truncated) throw cutOff();
    let raw: unknown;
    try {
      raw = parseJsonReply(answer.text);
    } catch (e) {
      // Not readable: say what came back (for the console), and ask once for the same answer as valid JSON.
      const problem = (e as Error).message;
      trace?.('retry', `Not readable as JSON (${problem}): asking once more`);
      this.log?.(`The AI's answer couldn't be read (${problem}); asking it to send it again. It began: ${answer.text.slice(0, 600)}`);
      answer = await this.ask(
        [
          { role: 'user', content: question },
          { role: 'assistant', content: answer.text },
          { role: 'user', content: `That answer is not valid JSON (${problem}), so the app couldn't read it and nothing was changed. Send the same answer again as ONE valid JSON object in the reply format, with nothing before or after it. In strings, escape quotes (\\") and backslashes (\\\\); in drawings use only letters and digits as palette keys.` },
        ],
        body,
        signal,
        trace,
      );
      if (answer.truncated) throw cutOff();
      try {
        raw = parseJsonReply(answer.text);
      } catch (e2) {
        this.log?.(`Still not readable (${(e2 as Error).message}). It began: ${answer.text.slice(0, 600)}`);
        throw new AIUnavailableError("The AI's answer wasn't in the form the app reads (JSON), twice, so nothing was changed. Try again; asking in a different way or for less at once usually helps. (The Console shows what came back.)");
      }
    }
    const parsed = aiResponseSchema.safeParse(raw);
    if (!parsed.success) {
      trace?.('error', `Read, but not in the reply format: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      throw new AIUnavailableError("The AI's answer was not in the expected form. Try again.");
    }
    return parsed.data;
  }
}
