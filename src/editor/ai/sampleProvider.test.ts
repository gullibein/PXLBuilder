import { describe, expect, it } from 'vitest';
import { AIUnavailableError, type AIRequestBody } from '../../core/ai/protocol';
import { SampleAIProvider } from './sampleProvider';

/** A stand-in for the viewer's sample: answers with this value as JSON text. */
const fake = (answer: (input: string, options: unknown) => Promise<unknown> | unknown, wrap = (s: string) => s, truncated = false) =>
  Object.assign(async (input: string, options?: unknown) => ({ text: wrap(JSON.stringify(await answer(input, options))), truncated }), {});

const body: AIRequestBody = { context: { scope: 'level' } as never, request: 'Make gravity weaker', history: [] };

describe('Claude through claude.ai (sample)', () => {
  it('sends the instructions, the reply format and the request; checks the answer', async () => {
    let seen: { input: string; options: unknown } | null = null;
    const answer = { kind: 'answer', message: 'Hi', changes: [], operations: [] };
    const provider = new SampleAIProvider(
      fake((input, options) => {
        seen = { input, options };
        return answer;
      }),
    );
    expect(await provider.respond(body)).toEqual(answer);
    expect(seen!.input).toContain('REPLY FORMAT');
    expect(seen!.input).toContain('"set_component_field"');
    expect(seen!.input.endsWith('REQUEST\nMake gravity weaker')).toBe(true);
    expect(seen!.options).toMatchObject({ cache: false });
  });

  it('rejects answers in the wrong form, and explains refusals and missing consent', async () => {
    await expect(new SampleAIProvider(fake(() => ({ kind: 'apply' }))).respond(body)).rejects.toThrow(/expected form/);
    const failing = (code: string) => new SampleAIProvider(() => Promise.reject({ code, message: '' }));
    await expect(failing('not_granted').respond(body)).rejects.toThrow(/permission/);
    await expect(failing('rate_limited').respond(body)).rejects.toBeInstanceOf(AIUnavailableError);
    await expect(failing('cancelled').respond(body)).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('Fast uses claude.ai\'s quick model tier', async () => {
    const seen: unknown[] = [];
    const provider = new SampleAIProvider(
      fake((_input, options) => {
        seen.push(options);
        return { kind: 'answer', message: 'Hi', changes: [], operations: [] };
      }),
    );
    await provider.respond({ ...body, speed: 'fast' });
    await provider.respond(body);
    expect(seen[0]).toMatchObject({ modelTier: 'quick' });
    expect(seen[1]).not.toHaveProperty('modelTier');
  });

  it('reads an answer with words or a code fence around the JSON; says when an answer was cut off or unreadable', async () => {
    const answer = { kind: 'answer', message: 'Halló', changes: [], operations: [] };
    expect(await new SampleAIProvider(fake(() => answer, (s) => `Hér er svarið:\n\`\`\`json\n${s}\n\`\`\``)).respond(body)).toEqual(answer);
    expect(await new SampleAIProvider(fake(() => answer, (s) => `${s}\nVona að þetta hjálpi!`)).respond(body)).toEqual(answer);
    await expect(new SampleAIProvider(fake(() => answer, (s) => s.slice(0, 20), true)).respond(body)).rejects.toThrow(/too long and got cut off/);
    await expect(new SampleAIProvider(fake(() => answer, () => 'Ég get það ekki.')).respond(body)).rejects.toThrow(/wasn't in the form the app reads/);
  });
});
