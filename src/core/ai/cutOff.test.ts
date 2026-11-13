import { describe, expect, it } from 'vitest';
import { continueRequest, readCutOff, shortened } from './cutOff';

const full = {
  kind: 'preview',
  message: 'Built a level.',
  changes: ['Level 1', 'Player: new look'],
  needCode: null,
  starter: null,
  operations: [
    { op: 'make_background', sceneId: 's', kind: 'hills', colors: ['#79c8ff'], variant: 1, parallax: 0.3 },
    { op: 'draw_sprite', target: 'definition', id: 'd1', name: 'Hero', palette: [{ key: 'R', color: '#e8412c' }], rows: ['R.R', '.R}'], frames: null, fps: null, situation: null },
    { op: 'make_autotile', id: 'd2', edge: 'outline', top: 'grass', round: false },
    { op: 'draw_sprite', target: 'definition', id: 'd3', name: 'Crate', palette: [{ key: 'W', color: '#c98a46' }], rows: ['WWWW', 'WWWW'], frames: null, fps: null, situation: null },
  ],
};

describe('an answer cut off by the length limit', () => {
  it('keeps every operation that arrived complete (braces inside strings are text)', () => {
    const text = JSON.stringify(full);
    const cut = text.slice(0, text.indexOf('"Crate"') + 30);
    const r = readCutOff(cut)!;
    expect(r.reply.operations.map((o) => o.op)).toEqual(['make_background', 'draw_sprite', 'make_autotile']);
    expect(r.reply.message).toBe('Built a level.');
    expect(r.reply.changes).toEqual(['Level 1', 'Player: new look']);
    expect((r.reply.operations[1].rows as string[])[1]).toBe('.R}');
  });

  it('cut right after an operation, or before any: what there is', () => {
    const text = JSON.stringify(full);
    const after = text.slice(0, text.indexOf('{"op":"make_autotile"'));
    expect(readCutOff(after)!.reply.operations).toHaveLength(2);
    expect(readCutOff(text.slice(0, text.indexOf('"operations"') + 20))).toBeNull();
    // A whole answer is not a cut-off one.
    expect(readCutOff(text)).toBeNull();
  });

  it('the operations kept are shown to the AI again without their pixels, and it is asked for the rest only', () => {
    const short = shortened(full.operations);
    expect(short[1].rows).toEqual(['(drawn: arrived in full)']);
    expect(short[2]).toEqual(full.operations[2]);
    const ask = continueRequest(3, full.operations[2]);
    expect(ask).toMatch(/first 3 operations \(up to and including make_autotile d2\)/);
    expect(ask).toMatch(/ONLY THE REST/);
  });
});
