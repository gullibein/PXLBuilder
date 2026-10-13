/**
 * Calls Claude straight from the browser with the user's own key (no server
 * needed). Uses the same request as the dev server (core/ai/claude.ts).
 */
import Anthropic from '@anthropic-ai/sdk';
import { askClaude, CLAUDE_MODELS, MODEL } from '../../core/ai/claude';
import { AIUnavailableError, type AIRequestBody, type AIResponse } from '../../core/ai/protocol';
import type { AIProvider } from '../../core/ai/provider';
import type { TraceFn } from '../../core/ai/trace';
import { getAISettings } from './aiSettings';
import { dollars, recordSpend, tokensLine } from './spend';

function client(apiKey: string): Anthropic {
  // The key is the user's own, entered by them, and only ever sent to the Anthropic API.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

export class BrowserClaudeProvider implements AIProvider {
  /** `onSpend`: told what each request cost (the editor shows it in the console). */
  constructor(
    private readonly apiKey: string,
    private readonly onSpend?: (message: string) => void,
  ) {}

  async respond(body: AIRequestBody, signal?: AbortSignal, trace?: TraceFn): Promise<AIResponse> {
    const model = getAISettings().claudeModel;
    trace?.('sent', `Claude with your Anthropic key (${CLAUDE_MODELS[model].name}${body.speed === 'fast' ? ', fast' : ''})`);
    const result = await askClaude(client(this.apiKey), body, signal, model);
    if (result.usage) {
      // What it cost, from the API's own token counts: in the trace, and in the console (with the running totals).
      const spent = recordSpend(result.usage);
      const line = `${result.usage.cost === null ? 'cost unknown' : dollars(result.usage.cost)} (${result.usage.model}: ${tokensLine(result.usage)})`;
      trace?.('note', `This request: ${line}`);
      this.onSpend?.(`AI request: ${line}. This session ${dollars(spent.session.cost)} for ${spent.session.requests} request${spent.session.requests === 1 ? '' : 's'}.`);
    }
    trace?.('reply', result.ok ? JSON.stringify(result.response) : `Failed (${result.kind}): ${result.error}`);
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
