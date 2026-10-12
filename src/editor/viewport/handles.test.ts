import { describe, expect, it } from 'vitest';
import { extendCount, extendOffsets, handleAt, handlesFor, resizeRect, unionRect } from './handles';

const tile = { minX: 0, minY: 0, maxX: 32, maxY: 32 };

describe('selection handles', () => {
  it('sides always, corners only when resizable', () => {
    expect(handlesFor(tile, false).map((h) => h.kind)).toEqual(['side', 'side', 'side', 'side']);
    expect(handlesFor(tile, true).filter((h) => h.kind === 'corner').map((h) => h.at)).toEqual([{ x: 0, y: 0 }, { x: 32, y: 0 }, { x: 0, y: 32 }, { x: 32, y: 32 }]);
    expect(handlesFor(tile, true).find((h) => h.dir.x === 1 && h.dir.y === 0)!.at).toEqual({ x: 32, y: 16 });
  });
  it('finds the handle under the pointer, within a few screen pixels', () => {
    const hs = handlesFor(tile, true);
    expect(handleAt(hs, tile, { x: 33, y: 17 }, 2, 8)?.dir).toEqual({ x: 1, y: 0 });
    expect(handleAt(hs, tile, { x: 31, y: 31 }, 2, 8)?.kind).toBe('corner');
    // The middle stays free for moving.
    expect(handleAt(hs, tile, { x: 16, y: 16 }, 2, 8)).toBeNull();
    // A small object on screen: the reach shrinks so its middle can still be grabbed.
    expect(handleAt(hs, tile, { x: 16, y: 16 }, 0.25, 20)).toBeNull();
  });
  it('a side drag counts copies one box width at a time', () => {
    expect(extendCount(tile, { x: 1, y: 0 }, { x: 40, y: 16 })).toBe(0);
    expect(extendCount(tile, { x: 1, y: 0 }, { x: 50, y: 16 })).toBe(1);
    expect(extendCount(tile, { x: 1, y: 0 }, { x: 130, y: 0 })).toBe(3);
    expect(extendCount(tile, { x: -1, y: 0 }, { x: -70, y: 0 })).toBe(2);
    expect(extendCount(tile, { x: 0, y: -1 }, { x: 0, y: -40 })).toBe(1);
    expect(extendCount(tile, { x: 1, y: 0 }, { x: -100, y: 0 })).toBe(0);
    expect(extendOffsets({ minX: 0, minY: 0, maxX: 96, maxY: 32 }, { x: 0, y: 1 }, 2)).toEqual([{ x: 0, y: 32 }, { x: 0, y: 64 }]);
  });
  it('a corner drag resizes from the opposite corner, on the grid', () => {
    expect(resizeRect(tile, { x: 1, y: 1 }, { x: 70, y: 30 }, 32, 4)).toEqual({ minX: 0, minY: 0, maxX: 64, maxY: 32 });
    expect(resizeRect(tile, { x: -1, y: -1 }, { x: -20, y: 10 }, null, 4)).toEqual({ minX: -20, minY: 10, maxX: 32, maxY: 32 });
    // Never inside out or smaller than the minimum.
    expect(resizeRect(tile, { x: 1, y: 1 }, { x: -50, y: -50 }, null, 4)).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 4 });
  });
  it('union of bounds', () => {
    expect(unionRect([tile, { minX: 32, minY: 0, maxX: 64, maxY: 32 }])).toEqual({ minX: 0, minY: 0, maxX: 64, maxY: 32 });
    expect(unionRect([])).toBeNull();
  });
});
