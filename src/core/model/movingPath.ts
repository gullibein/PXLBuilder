import type { Vec2 } from '../types';

/** A moving platform's path, relative to its start: the start, its points, the end (offset). */
export function moverPath(mv: Record<string, unknown>): Vec2[] {
  const pts = Array.isArray(mv.points) ? (mv.points as Vec2[]).filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  const end = (mv.offset as Vec2 | undefined) ?? { x: 96, y: 0 };
  return [{ x: 0, y: 0 }, ...pts.map((p) => ({ x: p.x, y: p.y })), { x: end.x, y: end.y }];
}
