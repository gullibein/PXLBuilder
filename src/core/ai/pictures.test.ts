import { beforeEach, describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { askClaude, resetClaudeFeatures } from './claude';
import { picturesText, userMessage } from './prompt';
import type { AIPicture, AIRequestBody } from './protocol';
import { sendSize } from '../../editor/ai/pictures';
import { GeminiProvider, resetGeminiBusy } from '../../editor/ai/geminiProvider';
import { SampleAIProvider } from '../../editor/ai/sampleProvider';

const pic = (over: Partial<AIPicture> = {}): AIPicture => ({ name: 'game.png', mediaType: 'image/png', data: 'iVBORw0KGgo=', width: 1200, height: 900, sourceWidth: 400, sourceHeight: 300, ...over });
const body = (images?: AIPicture[]): AIRequestBody => ({ context: { scope: 'project' } as never, request: 'A game like this', history: [], ...(images ? { images } : {}) });
const answer = { kind: 'answer', message: 'Hi', changes: [], operations: [], needCode: null, starter: null };

describe('pictures attached to a request', () => {
  beforeEach(() => resetClaudeFeatures());

  it('are sent at a size the AI reads well: small pixel art enlarged by a whole number (sharp), big pictures scaled down', () => {
    expect(sendSize(400, 300)).toEqual({ width: 1200, height: 900, sharp: true });
    expect(sendSize(160, 144)).toEqual({ width: 1120, height: 1008, sharp: true });
    expect(sendSize(1000, 900)).toEqual({ width: 1000, height: 900, sharp: true });
    const big = sendSize(2000, 1193);
    expect(big.sharp).toBe(false);
    expect(big.width * big.height).toBeLessThanOrEqual(1_150_000);
    expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(1568);
  });

  it('the request says what they are (their own size, how they are shown), only when there are some', () => {
    expect(picturesText(body())).toBe('');
    const text = userMessage(body([pic(), pic({ name: 'sheet.png', width: 1000, height: 600, sourceWidth: 2000, sourceHeight: 1200 })]));
    expect(text).toContain('Picture 1 ("game.png"): 400×300 pixels as the user\'s file is, shown enlarged 3× with sharp pixels.');
    expect(text).toContain('Picture 2 ("sheet.png"): 2000×1200 pixels as the user\'s file is, shown scaled down to 1000×600.');
    expect(text.indexOf('PICTURES THE USER ATTACHED')).toBeLessThan(text.indexOf('REQUEST\n'));
  });

  it('Claude gets them as image blocks after the (cached) game data, before the words', async () => {
    const seen: Record<string, unknown>[] = [];
    const parse = async (params: Record<string, unknown>) => {
      seen.push(params);
      return { stop_reason: 'end_turn', parsed_output: answer };
    };
    const stream = (params: Record<string, unknown>) => ({ finalMessage: () => parse(params) });
    await askClaude({ beta: { messages: { stream } } } as unknown as Anthropic, body([pic(), pic({ mediaType: 'image/jpeg', data: 'abc' })]));
    const content = (seen[0].messages as { content: { type: string; source?: { media_type: string; data: string } }[] }[])[0].content;
    expect(content.map((c) => c.type)).toEqual(['text', 'image', 'image', 'text']);
    expect(content[2].source).toEqual({ type: 'base64', media_type: 'image/jpeg', data: 'abc' });
  });

  it('Gemini gets them as inline data before the words', async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      calls.push(init);
      return { status: 200, ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: 'STOP' }] }) } as Response;
    });
    await new GeminiProvider('k', 'gemini-x').respond(body([pic()]));
    const parts = JSON.parse(calls[0].body as string).contents[0].parts;
    expect(parts[0]).toEqual({ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } });
    expect(parts[1].text).toContain('PICTURES THE USER ATTACHED');
    vi.unstubAllGlobals();
    resetGeminiBusy();
  });

  it('through claude.ai: sent as files where the view takes pictures; a clear message where it does not', async () => {
    let options: { images?: Blob[] } = {};
    const sample = Object.assign(
      async (_input: unknown, o?: { images?: Blob[] }) => {
        options = o ?? {};
        return { text: JSON.stringify(answer), truncated: false };
      },
      { limits: async () => ({ images: { maxCount: 4, maxInputBytes: 20e6, mediaTypes: ['image/png', 'image/jpeg'] } }) },
    );
    await new SampleAIProvider(sample).respond(body([pic(), pic()]));
    expect(options.images!.map((b) => [b.type, b.size])).toEqual([
      ['image/png', 8],
      ['image/png', 8],
    ]);
    const without = Object.assign(async () => ({ text: JSON.stringify(answer), truncated: false }), { limits: async () => ({}) });
    await expect(new SampleAIProvider(without).respond(body([pic()]))).rejects.toThrow(/Pictures can't be sent/);
    const two = Object.assign(sample, { limits: async () => ({ images: { maxCount: 1, maxInputBytes: 1, mediaTypes: [] } }) });
    await expect(new SampleAIProvider(two).respond(body([pic(), pic()]))).rejects.toThrow(/at most 1 picture/);
  });
});
