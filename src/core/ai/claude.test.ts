import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { askClaude, MODEL, resetClaudeFeatures } from './claude';
import type { AIRequestBody } from './protocol';

/** A client whose one call records its parameters and answers. */
function fakeClient(seen: Record<string, unknown>[]): Anthropic {
  const parse = async (params: Record<string, unknown>) => {
    seen.push(params);
    return { stop_reason: 'end_turn', parsed_output: { kind: 'answer', message: 'Hi', changes: [], operations: [] } };
  };
  return { beta: { messages: { parse } } } as unknown as Anthropic;
}
const body = (speed?: 'best' | 'fast'): AIRequestBody => ({ context: { scope: 'level' } as never, request: 'Hello', history: [], ...(speed ? { speed } : {}) });

describe('the Claude call', () => {
  beforeEach(() => resetClaudeFeatures());

  it('best quality: medium effort; fast: the same model at low effort', async () => {
    const seen: Record<string, unknown>[] = [];
    await askClaude(fakeClient(seen), body());
    await askClaude(fakeClient(seen), body('fast'));
    expect(seen.map((p) => p.model)).toEqual([MODEL, MODEL]);
    expect(seen.map((p) => (p.output_config as { effort: string }).effort)).toEqual(['medium', 'low']);
  });

  it("a rejected request says why, in Anthropic's words, with the request id", async () => {
    const failing = {
      beta: {
        messages: {
          parse: async () => {
            throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'max_tokens: must be at most 128000' } }, undefined, new Headers({ 'request-id': 'req_123' }));
          },
        },
      },
    } as unknown as Anthropic;
    const result = await askClaude(failing, body());
    expect(result).toMatchObject({ ok: false, error: 'AI request failed (400): max_tokens: must be at most 128000 (request req_123)' });
  });

  const rejected = (message: string) => new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message } }, undefined, new Headers());
  const answer = { kind: 'answer', message: 'Hi', changes: [], operations: [] };

  it('an account without the fallback beta: asks again without it, and from then on', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          parse: async (params: Record<string, unknown>) => {
            seen.push(params);
            if (params.fallbacks) throw rejected('anthropic-beta: server-side-fallback-2026-07-01 is not available for your organization');
            return { stop_reason: 'end_turn', parsed_output: answer };
          },
        },
      },
    } as unknown as Anthropic;
    expect(await askClaude(client, body())).toEqual({ ok: true, response: answer });
    expect(seen.map((p) => !!p.fallbacks)).toEqual([true, false]);
    expect(seen[1].betas).toBeUndefined();
    await askClaude(client, body());
    expect(seen).toHaveLength(3); // straight to the version that works
  });

  it('a refused reply format: the format goes in the prompt instead, and the answer is checked the same way', async () => {
    const seen: Record<string, unknown>[] = [];
    const client = {
      beta: {
        messages: {
          parse: async () => {
            throw rejected('output_config.format: the schema is too complex');
          },
          create: async (params: Record<string, unknown>) => {
            seen.push(params);
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
          },
        },
      },
    } as unknown as Anthropic;
    expect(await askClaude(client, body('fast'))).toEqual({ ok: true, response: answer });
    const params = seen[0] as { output_config: Record<string, unknown>; system: { text: string }[] };
    expect(params.output_config).toEqual({ effort: 'low' });
    expect(params.system[0].text).toContain('REPLY FORMAT');
  });

  it('other rejections are reported, not retried', async () => {
    let calls = 0;
    const client = { beta: { messages: { parse: async () => { calls++; throw rejected('messages: text content blocks must be non-empty'); } } } } as unknown as Anthropic;
    expect(await askClaude(client, body())).toMatchObject({ ok: false, error: 'AI request failed (400): messages: text content blocks must be non-empty' });
    expect(calls).toBe(1);
  });

  it('no API credit: says so, and that a Claude subscription is billed separately', async () => {
    let calls = 0;
    const client = {
      beta: {
        messages: {
          parse: async () => {
            calls++;
            throw rejected('Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.');
          },
        },
      },
    } as unknown as Anthropic;
    const result = await askClaude(client, body());
    expect(result).toMatchObject({ ok: false, status: 402 });
    expect(!result.ok && result.error).toMatch(/no credit left.*paid separately from a Claude subscription/);
    expect(calls).toBe(1);
  });
});
