import { describe, expect, it } from 'vitest';
import { least, most } from './extremes';

describe('the largest and smallest of a list of any length', () => {
  it('the answers Math.max and Math.min give, on lists a call can hold', () => {
    let s = 7;
    const next = () => ((s = (Math.imul(s, 1103515245) + 12345) >>> 0) / 4294967296) * 2000 - 1000;
    for (let n = 0; n < 60; n++) {
      const list = Array.from({ length: n }, next);
      expect(most(list, (v) => v)).toBe(Math.max(...list));
      expect(least(list, (v) => v)).toBe(Math.min(...list));
      expect(most(list, (v) => v * -2)).toBe(Math.max(...list.map((v) => v * -2)));
    }
    expect(most([], (v: number) => v)).toBe(-Infinity);
    expect(least([], (v: number) => v)).toBe(Infinity);
    expect(most([1, NaN, 3], (v) => v)).toBeNaN();
    expect(least([1, NaN, 3], (v) => v)).toBeNaN();
  });

  it('a list longer than a call can hold: no error, the right answer', () => {
    const list = Array.from({ length: 400000 }, (_, i) => (i * 7919) % 400009);
    expect(() => Math.max(...list)).toThrow(RangeError);
    expect(most(list, (v) => v)).toBe(list.reduce((a, b) => (b > a ? b : a), -Infinity));
    expect(least(list, (v) => v)).toBe(list.reduce((a, b) => (b < a ? b : a), Infinity));
  });
});
