import { describe, expect, it } from 'vitest';
import { keepLinesApart, type TextLine } from './screen';

/**
 * A line of text as a low-resolution game draws it: asked `size` px tall at `y`, drawn 40 px tall (each font pixel
 * one of the game's, 8 canvas pixels), 16 px between lines at least.
 */
const line = (y: number, size = 8, over: Partial<TextLine> = {}): TextLine => ({ group: 'top_left', fromBottom: false, askedTop: y, askedTall: size, left: 8, w: 400, top: Math.round(y / 8) * 8, h: 40, gap: 16, ...over });

describe('lines of text a script draws under each other', () => {
  it('stay under each other when the game draws them bigger than asked (8 px text, 14 px apart, drawn 40 px tall: a chess game\'s "WHITE TO MOVE" ran into "VS CPU - HARD")', () => {
    const tops = keepLinesApart([line(12), line(26), line(40)], 8);
    expect(tops).toEqual([16, 72, 128]);
    // Each clear of the one above: its height and the gap.
    for (let i = 1; i < tops.length; i++) expect(tops[i] - tops[i - 1]).toBeGreaterThanOrEqual(40 + 16);
    // (In whatever order they were drawn.)
    expect(keepLinesApart([line(40), line(12), line(26)], 8)).toEqual([128, 16, 72]);
  });

  it('nothing moves when nothing overlaps as drawn: a game of fine pixels keeps every line exactly where it was put', () => {
    const fine = (y: number): TextLine => ({ group: 'top_left', fromBottom: false, askedTop: y, askedTall: 12, left: 8, w: 90, top: y, h: 9, gap: 3 });
    expect(keepLinesApart([fine(12), fine(26), fine(40)], 1)).toEqual([12, 26, 40]);
  });

  it('what overlapped as asked is left alone: a shadow under a text, two texts on one row', () => {
    expect(keepLinesApart([line(12), line(13)], 8)).toEqual([16, 16]);
    expect(keepLinesApart([line(12), line(12, 8, { left: 200 })], 8)).toEqual([16, 16]);
    // (A row of two and a line under it: the line clears both.)
    expect(keepLinesApart([line(12), line(12, 8, { left: 200 }), line(26)], 8)).toEqual([16, 16, 72]);
  });

  it('lines that are not over each other (one left, one right of the screen), or anchored to different places, are not each other\'s business', () => {
    expect(keepLinesApart([line(12, 8, { w: 100 }), line(26, 8, { left: 600, w: 100 })], 8)).toEqual([16, 24]);
    expect(keepLinesApart([line(12), line(26, 8, { group: 'top' })], 8)).toEqual([16, 24]);
  });

  it("from the screen's bottom, lines are moved up: the lowest stays where it is", () => {
    const up = (y: number): TextLine => ({ group: 'bottom_left', fromBottom: true, askedTop: y - 8, askedTall: 8, left: 8, w: 400, top: Math.round((y - 40) / 8) * 8, h: 40, gap: 16 });
    // (Asked to end at 588 and 574 of a 600 px screen.)
    const tops = keepLinesApart([up(574), up(588)], 8);
    expect(tops[1]).toBe(552);
    expect(tops[0]).toBe(552 - 16 - 40);
  });
});
