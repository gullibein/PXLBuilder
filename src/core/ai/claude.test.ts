import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { askClaude, MODEL } from './claude';
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
            throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'output_config.format: schema is too complex' } }, undefined, new Headers({ 'request-id': 'req_123' }));
          },
        },
      },
    } as unknown as Anthropic;
    const result = await askClaude(failing, body());
    expect(result).toMatchObject({ ok: false, error: 'AI request failed (400): output_config.format: schema is too complex (request req_123)' });
  });
});
