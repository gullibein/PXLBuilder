import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIRequestBody } from '../../core/ai/protocol';
import { GeminiProvider, listGeminiModels, parseJsonReply } from './geminiProvider';

const body = (speed?: 'best' | 'fast'): AIRequestBody => ({ context: { scope: 'level' } as never, request: 'Make gravity weaker', history: [], ...(speed ? { speed } : {}) });
const answer = { kind: 'answer', message: 'Hi', changes: [], operations: [] };

/** Replaces fetch with a list of canned replies; returns the calls made. */
function fakeFetch(...replies: { status: number; json: unknown }[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.json } as Response;
  });
  return calls;
}
const ok = (text: string, finishReason = 'STOP') => ({ status: 200, json: { candidates: [{ content: { parts: [{ text: 'hmm', thought: true }, { text }] }, finishReason }] } });

afterEach(() => vi.unstubAllGlobals());

describe('Google Gemini', () => {
  it('asks the chosen model in JSON mode with the reply format, key in a header; skips thoughts; checks the answer', async () => {
    const calls = fakeFetch(ok(JSON.stringify(answer)));
    expect(await new GeminiProvider('AIza-key', 'gemini-3.8-flash').respond(body())).toEqual(answer);
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent');
    expect((calls[0].init.headers as Record<string, string>)['x-goog-api-key']).toBe('AIza-key');
    const sent = JSON.parse(calls[0].init.body as string);
    expect(sent.systemInstruction.parts[0].text).toContain('REPLY FORMAT');
    expect(sent.contents[0].parts[0].text.endsWith('REQUEST\nMake gravity weaker')).toBe(true);
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    expect(sent.generationConfig.thinkingConfig).toBeUndefined(); // best quality: the model's own thinking
  });

  it('Fast asks it to think less, and asks again without that if the model has no thinking levels', async () => {
    const calls = fakeFetch({ status: 400, json: { error: { message: 'Thinking level is not supported for this model.' } } }, ok(JSON.stringify(answer)));
    expect(await new GeminiProvider('k', 'gemini-x').respond(body('fast'))).toEqual(answer);
    expect(JSON.parse(calls[0].init.body as string).generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
    expect(JSON.parse(calls[1].init.body as string).generationConfig.thinkingConfig).toBeUndefined();
  });

  it('explains failures in plain words', async () => {
    const p = new GeminiProvider('k', 'gemini-nope');
    fakeFetch({ status: 400, json: { error: { message: 'API key not valid. Please pass a valid API key.' } } });
    await expect(p.respond(body())).rejects.toThrow(/Gemini API key was not accepted/);
    fakeFetch({ status: 404, json: { error: { message: 'models/gemini-nope is not found' } } });
    await expect(p.respond(body())).rejects.toThrow(/"gemini-nope" isn't available/);
    fakeFetch({ status: 429, json: {} });
    await expect(p.respond(body())).rejects.toThrow(/rate limited/);
    fakeFetch(ok('{"kind":', 'MAX_TOKENS'));
    await expect(p.respond(body())).rejects.toThrow(/incomplete/);
    fakeFetch(ok('not json'));
    await expect(p.respond(body())).rejects.toThrow(/could not be read/);
    fakeFetch(ok('{"kind":"apply"}'));
    await expect(p.respond(body())).rejects.toThrow(/expected form/);
    fakeFetch({ status: 200, json: { promptFeedback: { blockReason: 'SAFETY' } } });
    await expect(p.respond(body())).rejects.toThrow(/declined/);
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(p.respond(body())).rejects.toThrow(/Could not reach Gemini/);
  });

  it('reads a fenced JSON answer too', () => {
    expect(parseJsonReply('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('lists the models a key can use for answers, Flash first', async () => {
    const m = (name: string, methods = ['generateContent']) => ({ name: `models/${name}`, supportedGenerationMethods: methods });
    fakeFetch({ status: 200, json: { models: [m('gemini-3.5-pro'), m('gemini-3.8-flash-lite'), m('gemini-3.5-flash'), m('gemini-3.8-flash'), m('gemini-embedding-2', ['embedContent'])] } });
    expect(await listGeminiModels('k')).toEqual({ ok: true, models: ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.8-flash-lite', 'gemini-3.5-pro'] });
    fakeFetch({ status: 400, json: { error: { message: 'API key not valid' } } });
    expect(await listGeminiModels('bad')).toMatchObject({ ok: false, message: 'The key was not accepted.' });
  });
});
