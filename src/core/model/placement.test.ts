import { describe, expect, it } from 'vitest';
import { cellAt, cellCenter, cellSize, cellsOnLine, constrainToAxis, snapToCell } from './placement';

describe('placement grid', () => {
  it('rounds object size up to whole grid steps', () => {
    expect(cellSize({ x: 32, y: 32 }, 16)).toEqual({ x: 32, y: 32 });
    expect(cellSize({ x: 28, y: 40 }, 16)).toEqual({ x: 32, y: 48 });
    expect(cellSize({ x: 4, y: 4 }, 16)).toEqual({ x: 16, y: 16 });
  });

  it('maps points to cells and back to centers, including negative space', () => {
    const cell = { x: 32, y: 32 };
    expect(cellAt({ x: 0, y: 0 }, cell)).toEqual({ i: 0, j: 0 });
    expect(cellAt({ x: -1, y: 31.9 }, cell)).toEqual({ i: -1, j: 0 });
    expect(cellCenter({ i: -1, j: 2 }, cell)).toEqual({ x: -16, y: 80 });
    expect(snapToCell({ x: 40, y: -5 }, cell)).toEqual({ x: 48, y: -16 });
  });

  it('fills every cell on a stroke, with no gaps', () => {
    expect(cellsOnLine({ i: 0, j: 0 }, { i: 4, j: 0 }).map((c) => c.i)).toEqual([0, 1, 2, 3, 4]);
    expect(cellsOnLine({ i: 2, j: 1 }, { i: -1, j: 1 }).map((c) => c.i)).toEqual([2, 1, 0, -1]);
    const diag = cellsOnLine({ i: 0, j: 0 }, { i: 3, j: 3 });
    expect(diag).toHaveLength(4);
    expect(diag.at(-1)).toEqual({ i: 3, j: 3 });
    expect(cellsOnLine({ i: 5, j: 5 }, { i: 5, j: 5 })).toEqual([{ i: 5, j: 5 }]);
  });

  it('locks a stroke to its dominant axis', () => {
    expect(constrainToAxis({ i: 0, j: 0 }, { i: 5, j: 2 })).toEqual({ i: 5, j: 0 });
    expect(constrainToAxis({ i: 0, j: 0 }, { i: 1, j: -4 })).toEqual({ i: 0, j: -4 });
  });
});
