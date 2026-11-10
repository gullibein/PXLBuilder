import { describe, expect, it } from 'vitest';
import { DrawingScanner, type StreamedDrawing } from './streamDrawings';

const sprite = (name: string, extra: Record<string, unknown> = {}) => ({ op: 'draw_sprite', target: { object: name }, name, palette: [{ key: 'a', color: '#ff0000' }, { key: 'b', color: '#00ff00' }], rows: ['ab', 'ba'], ...extra });

describe("the AI's drawings, read while its answer is still being written", () => {
  const answer = JSON.stringify({
    kind: 'preview',
    message: 'A game with a {curly} "quoted" message',
    operations: [
      { op: 'create_definition', name: 'Bat', components: { Sprite: { width: 16 } } },
      sprite('Player'),
      sprite('Player', { situation: 'running', rows: ['ba', 'ab'] }),
      { op: 'set_component_field', name: 'Player', value: '} not a brace {' },
      sprite('Bat', { situation: '' }),
    ],
  });

  it('gives each finished drawing as soon as its closing brace has come, never one still being written', () => {
    const found: { at: number; d: StreamedDrawing }[] = [];
    const scanner = new DrawingScanner((d) => found.push({ at: n, d }));
    let n = 0;
    // Bit by bit, as a stream comes: the whole answer so far each time.
    for (n = 1; n <= answer.length; n += 7) scanner.feed(answer.slice(0, n));
    scanner.feed(answer);
    expect(found.map((f) => f.d.name)).toEqual(['Player', 'Bat']);
    expect(found[0].d).toEqual({ name: 'Player', palette: [{ key: 'a', color: '#ff0000' }, { key: 'b', color: '#00ff00' }], rows: ['ab', 'ba'] });
    // The Player's came long before the end of the answer.
    const playerEnds = answer.indexOf('}', answer.indexOf('"rows":["ab","ba"]')) + 1;
    expect(found[0].at).toBeGreaterThanOrEqual(playerEnds);
    expect(found[0].at).toBeLessThan(playerEnds + 8);
  });

  it('reads an answer that starts again from its beginning (asked again), without giving the same drawing twice', () => {
    const found: string[] = [];
    const scanner = new DrawingScanner((d) => found.push(d.name));
    scanner.feed(answer);
    scanner.feed('{"operations":[');
    scanner.feed(answer);
    expect(found).toEqual(['Player', 'Bat']);
  });

  it('reads it in a sentence or a code fence too', () => {
    const found: string[] = [];
    new DrawingScanner((d) => found.push(d.name)).feed('Here it is:\n```json\n' + answer.slice(0, -40));
    expect(found).toEqual(['Player']);
  });
});
