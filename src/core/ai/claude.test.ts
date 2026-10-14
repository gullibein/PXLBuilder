import Anthropic from '@anthropic-ai/sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import { askClaude, MODEL, resetClaudeFeatures, usageCost } from './claude';
import type { AIRequestBody } from './protocol';

/** A client whose one call records its parameters and answers. */
function fakeClient(seen: Record<string, unknown>[]): Anthropic {
  const parse = async (params: Record<string, unknown>) => {
    seen.push(params);
    return { stop_reason: 'end_turn', parsed_output: { kind: 'answer', message: 'Hi', changes: [], operations: [], needCode: null, starter: null } };
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
  const answer = { kind: 'answer', message: 'Hi', changes: [], operations: [], needCode: null, starter: null };

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

  it('a model refusing the strict format says so in the console, and only that model asks without it', async () => {
    const notes: string[] = [];
    const used: string[] = [];
    const client = {
      beta: {
        messages: {
          parse: async (params: { model: string }) => {
            used.push(`parse:${params.model}`);
            if (params.model === 'claude-haiku-5-5') throw rejected('output_config.format: the schema is too complex');
            return { stop_reason: 'end_turn', parsed_output: answer };
          },
          create: async (params: { model: string }) => {
            used.push(`create:${params.model}`);
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(answer) }] };
          },
        },
      },
    } as unknown as Anthropic;
    await askClaude(client, body(), undefined, 'claude-haiku-5-5', (n) => notes.push(n));
    await askClaude(client, body(), undefined, 'claude-sonnet-5-5', (n) => notes.push(n));
    expect(used).toEqual(['parse:claude-haiku-5-5', 'create:claude-haiku-5-5', 'parse:claude-sonnet-5-5']);
    expect(notes[0]).toMatch(/Claude Haiku 5\.5 did not take the strict reply format \(output_config\.format: the schema is too complex/);
  });

  it('an unreadable answer (format in the prompt) is asked for again with the problem; what came back goes to the console', async () => {
    const notes: string[] = [];
    const sent: { messages: { role: string; content: unknown }[] }[] = [];
    let replies = ['Sure! Here it is: {"kind": "answer", "message": "Hi" "changes": []}', JSON.stringify(answer)];
    const client = {
      beta: {
        messages: {
          parse: async () => {
            throw rejected('output_config.format: the schema is too complex');
          },
          create: async (params: { messages: { role: string; content: unknown }[] }) => {
            sent.push(params);
            return { stop_reason: 'end_turn', content: [{ type: 'text', text: replies.shift() }], usage: { input_tokens: 100, output_tokens: 10 } };
          },
        },
      },
    } as unknown as Anthropic;
    const result = await askClaude(client, body(), undefined, 'claude-sonnet-5-5', (n) => notes.push(n));
    expect(result).toMatchObject({ ok: true, response: answer, usage: { inputTokens: 200, outputTokens: 20 } });
    expect(sent).toHaveLength(2);
    expect(sent[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(String(sent[1].messages[2].content)).toMatch(/not valid JSON/);
    expect(notes.some((n) => /couldn't be read .*It began: Sure! Here it is/.test(n))).toBe(true);
    // Unreadable twice: a plain error, and the console has both beginnings.
    replies = ['oops', 'still oops'];
    const again = await askClaude(client, body(), undefined, 'claude-sonnet-5-5', (n) => notes.push(n));
    expect(again).toMatchObject({ ok: false, error: expect.stringMatching(/could not be read \(twice/) });
    expect(notes.at(-1)).toMatch(/Still not readable.*It began: still oops/);
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

  it('the chosen model is asked; the system prompt is cached for an hour and the game data for the request', async () => {
    const seen: Record<string, unknown>[] = [];
    await askClaude(fakeClient(seen), body(), undefined, 'claude-haiku-5-5');
    const p = seen[0] as { model: string; system: { cache_control: unknown }[]; messages: { content: { text: string; cache_control?: unknown }[] }[] };
    expect(p.model).toBe('claude-haiku-5-5');
    expect(p.system[0].cache_control).toEqual({ type: 'ephemeral', ttl: '1h' });
    const [data, rest] = p.messages[0].content;
    expect(data.text.startsWith('CONTEXT')).toBe(true);
    expect(data.cache_control).toEqual({ type: 'ephemeral' });
    expect(rest.text).toContain('REQUEST\nHello');
    expect(rest).not.toHaveProperty('cache_control');
  });

  it("a request's cost comes from the API's token counts (cache writes and reads priced as Anthropic prices them)", async () => {
    // Opus 5.5: $4 in, $20 out per million; an hour's cache write 2×, a 5-minute one 1.25×, a read 0.1×.
    const u = usageCost('claude-opus-5-5', {
      input_tokens: 1000,
      output_tokens: 2000,
      cache_read_input_tokens: 20000,
      cache_creation_input_tokens: 30000,
      cache_creation: { ephemeral_1h_input_tokens: 25000, ephemeral_5m_input_tokens: 5000 },
    });
    expect(u.cost).toBeCloseTo((1000 * 4 + 25000 * 8 + 5000 * 5 + 20000 * 0.4 + 2000 * 20) / 1e6, 10);
    expect(usageCost('claude-haiku-5-5', { input_tokens: 1e6, output_tokens: 1e6 }).cost).toBeCloseTo(0.6, 10);
    expect(usageCost('some-other-model', { input_tokens: 1, output_tokens: 1 }).cost).toBeNull();
    // The answer carries it.
    const client = { beta: { messages: { parse: async () => ({ model: 'claude-opus-5-5', stop_reason: 'end_turn', parsed_output: answer, usage: { input_tokens: 10, output_tokens: 10 } }) } } } as unknown as Anthropic;
    expect((await askClaude(client, body())).usage?.cost).toBeCloseTo(240 / 1e6, 12);
  });

  it("the app's fixed reference goes after the instructions and is cached with them", async () => {
    const seen: Record<string, unknown>[] = [];
    await askClaude(fakeClient(seen), { ...body(), reference: 'EDITOR SETTINGS\n- inspector' });
    const system = (seen[0] as { system: { text: string; cache_control?: unknown }[] }).system;
    expect(system).toHaveLength(2);
    expect(system[0].cache_control).toBeUndefined();
    expect(system[1]).toEqual({ type: 'text', text: 'EDITOR SETTINGS\n- inspector', cache_control: { type: 'ephemeral', ttl: '1h' } });
  });
});
