import type { Vec2 } from '../types';
import type { ResolvedEntity } from './resolve';

const DEFAULT_SIZE = 32;

/** Unscaled local size of an entity: its sprite size, else its collider size, else a default. */
export function getEntitySize(entity: ResolvedEntity): Vec2 {
  const sprite = entity.components.Sprite;
  if (sprite && typeof sprite.width === 'number' && typeof sprite.height === 'number') return { x: sprite.width, y: sprite.height };
  const collider = entity.components.Collider;
  if (collider && typeof collider.size === 'object' && collider.size !== null) {
    const s = collider.size as Vec2;
    return collider.shape === 'circle' ? { x: s.x, y: s.x } : { x: s.x, y: s.y };
  }
  return { x: DEFAULT_SIZE, y: DEFAULT_SIZE };
}

/** Converts a world point into the entity's local (unrotated, unscaled, centered) space. */
export function worldToLocal(entity: ResolvedEntity, p: Vec2): Vec2 {
  const { position, rotation, scale } = entity.transform;
  const dx = p.x - position.x;
  const dy = p.y - position.y;
  const r = (-rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return {
    x: (dx * cos - dy * sin) / (scale.x || 1),
    y: (dx * sin + dy * cos) / (scale.y || 1),
  };
}

export function containsPoint(entity: ResolvedEntity, p: Vec2): boolean {
  const size = getEntitySize(entity);
  const local = worldToLocal(entity, p);
  return Math.abs(local.x) <= size.x / 2 && Math.abs(local.y) <= size.y / 2;
}

export interface Rect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** World-space axis-aligned bounds (accounts for rotation and scale). */
export function getWorldBounds(entity: ResolvedEntity): Rect {
  const size = getEntitySize(entity);
  const { position, rotation, scale } = entity.transform;
  const hw = (size.x * Math.abs(scale.x)) / 2;
  const hh = (size.y * Math.abs(scale.y)) / 2;
  const r = (rotation * Math.PI) / 180;
  const ex = Math.abs(hw * Math.cos(r)) + Math.abs(hh * Math.sin(r));
  const ey = Math.abs(hw * Math.sin(r)) + Math.abs(hh * Math.cos(r));
  return { minX: position.x - ex, minY: position.y - ey, maxX: position.x + ex, maxY: position.y + ey };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}
