import { describe, expect, it } from 'vitest';
import { DrawingScanner, levelSketch, type StreamedDrawing } from './streamDrawings';

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

describe('the level map the AI is writing, read while it is written', () => {
  const answer = JSON.stringify({
    kind: 'preview',
    message: 'A cave.',
    operations: [
      { op: 'create_definition', ref: 'rock', name: 'Cave rock', components: [] },
      { op: 'draw_map', sceneId: 's', col: 0, row: 0, legend: [{ char: '#', object: 'rock' }, { char: ']', object: 'Ladder' }], rows: ['#####', '#.].#', '#P.G#', '#####'], clear: true },
      { op: 'place_instance', sceneId: 's', definitionRef: 'Teleporter', x: 0, y: 0 },
    ],
  });

  it('gives the rows written so far (never one still being written), its legend, and the names of objects made', () => {
    expect(levelSketch(answer.slice(0, answer.indexOf('"rows"')))).toBeNull();
    const cut = answer.indexOf('#P.G#') + 3;
    const half = levelSketch(answer.slice(0, cut))!;
    expect(half.rows).toEqual(['#####', '#.].#']);
    expect(half.legend).toEqual([{ char: '#', object: 'rock' }, { char: ']', object: 'Ladder' }]);
    expect(half.names).toEqual({ rock: 'Cave rock' });
    expect(levelSketch(answer)!.rows).toEqual(['#####', '#.].#', '#P.G#', '#####']);
    // (Bit by bit, the rows only ever grow.)
    let last = 0;
    for (let n = 1; n <= answer.length; n += 5) {
      const rows = levelSketch(answer.slice(0, n))?.rows.length ?? 0;
      expect(rows).toBeGreaterThanOrEqual(last);
      last = rows;
    }
  });
});
