import { describe, expect, it } from 'vitest';
import { AIUnavailableError, type AIRequestBody } from '../../core/ai/protocol';
import { SampleAIProvider } from './sampleProvider';

const body: AIRequestBody = { context: { scope: 'level' } as never, request: 'Make gravity weaker', history: [] };

describe('Claude through claude.ai (sample)', () => {
  it('sends the instructions, the reply format and the request; checks the answer', async () => {
    let seen: { input: string; options: unknown } | null = null;
    const answer = { kind: 'answer', message: 'Hi', changes: [], operations: [] };
    const provider = new SampleAIProvider({
      json: async (input, options) => {
        seen = { input, options };
        return answer;
      },
    });
    expect(await provider.respond(body)).toEqual(answer);
    expect(seen!.input).toContain('REPLY FORMAT');
    expect(seen!.input).toContain('"set_component_field"');
    expect(seen!.input.endsWith('REQUEST\nMake gravity weaker')).toBe(true);
    expect(seen!.options).toMatchObject({ cache: false });
  });

  it('rejects answers in the wrong form, and explains refusals and missing consent', async () => {
    await expect(new SampleAIProvider({ json: async () => ({ kind: 'apply' }) }).respond(body)).rejects.toThrow(/expected form/);
    const failing = (code: string) => new SampleAIProvider({ json: () => Promise.reject({ code, message: '' }) });
    await expect(failing('not_granted').respond(body)).rejects.toThrow(/permission/);
    await expect(failing('rate_limited').respond(body)).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(failing('cancelled').respond(body)).rejects.toMatchObject({ name: 'AbortError' });
  });
});
