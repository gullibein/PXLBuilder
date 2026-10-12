/**
 * The handles on a selection box. The box fits the selection exactly (a 32×32
 * object gets a 32×32 box). The points on its sides repeat what is along that
 * side, one object at a time (a floor, a wall, a ladder: drag the right side
 * out and copies of the last tile fill in; drag a row's top up and copies of
 * the row stack on it); the corner points resize a single object
 * (the opposite corner stays put).
 */
import type { Rect } from '../../core/model/geometry';
import type { Vec2 } from '../../core/types';

export type Side = -1 | 0 | 1;
export interface Handle {
  kind: 'corner' | 'side';
  /** Which way it points: (1, 0) the right side, (-1, -1) the top left corner… */
  dir: { x: Side; y: Side };
  at: Vec2;
}

/** Most copies one side drag makes. */
export const MAX_EXTEND = 200;

/** The box around these bounds (null for none). */
export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  return rects.reduce((a, r) => ({ minX: Math.min(a.minX, r.minX), minY: Math.min(a.minY, r.minY), maxX: Math.max(a.maxX, r.maxX), maxY: Math.max(a.maxY, r.maxY) }));
}

/** The handles of a selection box: side points always, corners when one unturned object is selected (it can be resized). */
export function handlesFor(box: Rect, resizable: boolean): Handle[] {
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  const x = (d: Side) => (d < 0 ? box.minX : d > 0 ? box.maxX : cx);
  const y = (d: Side) => (d < 0 ? box.minY : d > 0 ? box.maxY : cy);
  const sides: Handle[] = ([[1, 0], [-1, 0], [0, -1], [0, 1]] as [Side, Side][]).map(([dx, dy]) => ({ kind: 'side', dir: { x: dx, y: dy }, at: { x: x(dx), y: y(dy) } }));
  if (!resizable) return sides;
  const corners: Handle[] = ([[-1, -1], [1, -1], [-1, 1], [1, 1]] as [Side, Side][]).map(([dx, dy]) => ({ kind: 'corner', dir: { x: dx, y: dy }, at: { x: x(dx), y: y(dy) } }));
  return [...corners, ...sides];
}

/**
 * The handle at a point (within `radius` screen pixels; less on a small box, so its middle can still be dragged),
 * the nearest one if several.
 */
export function handleAt(handles: Handle[], box: Rect, p: Vec2, zoom: number, radius: number): Handle | null {
  const smallest = Math.min(box.maxX - box.minX, box.maxY - box.minY) * zoom;
  // Too small on screen to tell handles from the middle: it's for moving (zoom in to resize).
  if (smallest < 12) return null;
  const r = Math.min(radius, smallest / 3) / zoom;
  let best: Handle | null = null;
  let bestD = Infinity;
  for (const h of handles) {
    const d = Math.max(Math.abs(p.x - h.at.x), Math.abs(p.y - h.at.y));
    if (d <= r && d < bestD) {
      best = h;
      bestD = d;
    }
  }
  return best;
}

/**
 * What a side drag repeats: the objects along that side of the box (for a row of tiles dragged right, the last
 * tile; dragged up, the whole row), one of their thickness at a time. `step` is that thickness.
 */
export function edgeSlice<T extends { id: string; bounds: Rect }>(items: T[], box: Rect, dir: Handle['dir']): { ids: string[]; step: number } {
  const eps = 0.5;
  const at = items.filter((i) => (dir.x > 0 ? i.bounds.maxX >= box.maxX - eps : dir.x < 0 ? i.bounds.minX <= box.minX + eps : dir.y > 0 ? i.bounds.maxY >= box.maxY - eps : i.bounds.minY <= box.minY + eps));
  const step = dir.x > 0 ? box.maxX - Math.min(...at.map((i) => i.bounds.minX)) : dir.x < 0 ? Math.max(...at.map((i) => i.bounds.maxX)) - box.minX : dir.y > 0 ? box.maxY - Math.min(...at.map((i) => i.bounds.minY)) : Math.max(...at.map((i) => i.bounds.maxY)) - box.minY;
  return { ids: at.map((i) => i.id), step: at.length ? step : 0 };
}

/** How many copies a side drag to this point makes: one per `step` past the side, from half way. */
export function extendCount(box: Rect, dir: Handle['dir'], p: Vec2, step: number): number {
  if (step <= 0) return 0;
  const past = dir.x > 0 ? p.x - box.maxX : dir.x < 0 ? box.minX - p.x : dir.y > 0 ? p.y - box.maxY : box.minY - p.y;
  return Math.max(0, Math.min(MAX_EXTEND, Math.floor(past / step + 0.5)));
}

/** Where the copies go, relative to the objects repeated. */
export function extendOffsets(dir: Handle['dir'], step: number, count: number): Vec2[] {
  return Array.from({ length: count }, (_, i) => ({ x: dir.x * step * (i + 1), y: dir.y * step * (i + 1) }));
}

/**
 * The box after dragging a corner to a point: the opposite corner stays, the dragged one follows (on the grid when
 * snapping), never smaller than `min` either way (nor turned inside out).
 */
export function resizeRect(box: Rect, dir: Handle['dir'], p: Vec2, grid: number | null, min: number): Rect {
  const snap = (v: number) => (grid ? Math.round(v / grid) * grid : Math.round(v));
  const fixedX = dir.x > 0 ? box.minX : box.maxX;
  const fixedY = dir.y > 0 ? box.minY : box.maxY;
  const x = dir.x > 0 ? Math.max(fixedX + min, snap(p.x)) : Math.min(fixedX - min, snap(p.x));
  const y = dir.y > 0 ? Math.max(fixedY + min, snap(p.y)) : Math.min(fixedY - min, snap(p.y));
  return { minX: Math.min(fixedX, x), maxX: Math.max(fixedX, x), minY: Math.min(fixedY, y), maxY: Math.max(fixedY, y) };
}

/** The mouse cursor over a handle. */
export function handleCursor(h: Handle): string {
  if (h.kind === 'side') return h.dir.x ? 'ew-resize' : 'ns-resize';
  return h.dir.x === h.dir.y ? 'nwse-resize' : 'nesw-resize';
}
