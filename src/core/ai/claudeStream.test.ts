import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { askClaude } from './claude';
import type { AIRequestBody } from './protocol';
import { DrawingScanner } from './streamDrawings';

/**
 * The real SDK, over a stand-in network: the answer comes as the API sends it (server-sent events), a bit at a
 * time, and askClaude hands on the text so far as it comes.
 */
function sseClient(text: string, pieces: number, onPiece: (i: number) => void): Anthropic {
  const events: string[] = [
    JSON.stringify({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
  ];
  const size = Math.ceil(text.length / pieces);
  for (let i = 0; i < text.length; i += size) events.push(JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: text.slice(i, i + size) } }));
  events.push(JSON.stringify({ type: 'content_block_stop', index: 0 }), JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 50 } }), JSON.stringify({ type: 'message_stop' }));
  const fetch = async () => {
    let i = 0;
    const enc = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (i >= events.length) return controller.close();
        onPiece(i);
        const type = JSON.parse(events[i]).type;
        controller.enqueue(enc.encode(`event: ${type}\ndata: ${events[i]}\n\n`));
        i++;
        await new Promise((r) => setTimeout(r, 0));
      },
    });
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  return new Anthropic({ apiKey: 'test', fetch: fetch as never, maxRetries: 0 });
}

describe('Claude with your own key: the answer as it is written', () => {
  it("hands on the text so far as it streams in, so finished drawings are seen long before the end", async () => {
    const drawing = (name: string) => ({ op: 'draw_sprite', target: 'definition', id: `def_${name}`, name, palette: [{ key: 'a', color: '#ff0000' }], rows: ['aa', 'aa'], frames: null, fps: null, situation: null });
    const answer = { kind: 'answer', message: 'Done.', changes: [], operations: [drawing('Hero'), drawing('Slime')], needCode: null, starter: null };
    const text = JSON.stringify(answer);
    let piece = 0;
    const seen: { name: string; piece: number }[] = [];
    const scanner = new DrawingScanner((d) => seen.push({ name: d.name, piece }));
    const body: AIRequestBody = { context: { scope: 'level' } as never, request: 'Hello', history: [] };
    const result = await askClaude(sseClient(text, 20, (i) => (piece = i)), body, undefined, undefined, undefined, (soFar) => scanner.feed(soFar));
    expect(seen.map((s) => s.name)).toEqual(['Hero', 'Slime']);
    // The Hero's drawing was read while the answer was still coming (20 pieces after the first two events).
    expect(seen[0].piece).toBeLessThan(16);
    // (And the whole answer is read at the end as before.)
    expect(result.ok && result.response.operations.length).toBe(2);
  });
});
