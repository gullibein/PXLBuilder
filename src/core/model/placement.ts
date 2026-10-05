/**
 * Grid placement for drawing objects onto the level.
 *
 * Every object has a placement cell: its size rounded up to whole grid
 * steps. Drawing puts at most one copy of an object in each cell, centered,
 * so painted rows never overlap or leave gaps. Objects whose definition has
 * `metadata.placement = "tile"` also snap to their cells when moved and are
 * drawn as one continuous surface with their neighbours.
 */
import type { Vec2 } from '../types';

/**
 * The level grid the AI draws on: 32 px cells, the size of the starter tiles.
 * Cell (col, row) covers x in [col*32, col*32+32) and y in [row*32, row*32+32);
 * y grows downward.
 */
export const LEVEL_CELL = 32;

export interface Cell {
  i: number;
  j: number;
}

export function cellSize(size: Vec2, grid: number): Vec2 {
  const g = Math.max(1, grid);
  return { x: Math.max(g, Math.ceil(size.x / g) * g), y: Math.max(g, Math.ceil(size.y / g) * g) };
}

export function cellAt(p: Vec2, cell: Vec2): Cell {
  return { i: Math.floor(p.x / cell.x), j: Math.floor(p.y / cell.y) };
}

export function cellCenter(c: Cell, cell: Vec2): Vec2 {
  return { x: c.i * cell.x + cell.x / 2, y: c.j * cell.y + cell.y / 2 };
}

/** Snaps a point to the center of the cell containing it. */
export function snapToCell(p: Vec2, cell: Vec2): Vec2 {
  return cellCenter(cellAt(p, cell), cell);
}

export const cellKey = (c: Cell) => `${c.i},${c.j}`;

/** Every cell on the straight line from a to b, inclusive (Bresenham), so fast strokes leave no gaps. */
export function cellsOnLine(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  let { i, j } = a;
  const di = Math.abs(b.i - a.i);
  const dj = -Math.abs(b.j - a.j);
  const si = a.i < b.i ? 1 : -1;
  const sj = a.j < b.j ? 1 : -1;
  let err = di + dj;
  for (;;) {
    cells.push({ i, j });
    if (i === b.i && j === b.j) return cells;
    const e2 = 2 * err;
    if (e2 >= dj) {
      err += dj;
      i += si;
    }
    if (e2 <= di) {
      err += di;
      j += sj;
    }
  }
}

/** With Shift held, a stroke is locked to the axis it started moving along. */
export function constrainToAxis(start: Cell, c: Cell): Cell {
  return Math.abs(c.i - start.i) >= Math.abs(c.j - start.j) ? { i: c.i, j: start.j } : { i: start.i, j: c.j };
}
