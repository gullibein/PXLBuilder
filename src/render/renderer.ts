/**
 * Scene renderer shared by the editor viewport and (later) the play-mode
 * runtime, so both draw the game identically.
 */
import { getEntitySize } from '../core/model/geometry';
import type { ResolvedEntity } from '../core/model/resolve';
import type { Vec2 } from '../core/types';

export interface Camera {
  /** World point at the center of the view. */
  x: number;
  y: number;
  zoom: number;
}

export interface ViewSize {
  width: number;
  height: number;
}

export function worldToScreen(camera: Camera, view: ViewSize, p: Vec2): Vec2 {
  return { x: (p.x - camera.x) * camera.zoom + view.width / 2, y: (p.y - camera.y) * camera.zoom + view.height / 2 };
}

export function screenToWorld(camera: Camera, view: ViewSize, p: Vec2): Vec2 {
  return { x: (p.x - view.width / 2) / camera.zoom + camera.x, y: (p.y - view.height / 2) / camera.zoom + camera.y };
}

/** Sets the canvas transform so subsequent drawing is in world coordinates. */
export function applyCamera(ctx: CanvasRenderingContext2D, camera: Camera, view: ViewSize, dpr: number): void {
  ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * (view.width / 2 - camera.x * camera.zoom), dpr * (view.height / 2 - camera.y * camera.zoom));
}

export function drawBackground(ctx: CanvasRenderingContext2D, view: ViewSize, dpr: number, color: string): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, view.width, view.height);
}

/** Draws entities in order (later entities on top). Expects world-space transform on ctx. */
export function drawEntities(ctx: CanvasRenderingContext2D, entities: ResolvedEntity[]): void {
  for (const entity of entities) {
    const sprite = entity.components.Sprite;
    if (!sprite || sprite.visible === false) continue;
    const size = getEntitySize(entity);
    const { position, rotation, scale } = entity.transform;
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale.x, scale.y);
    ctx.fillStyle = typeof sprite.color === 'string' ? sprite.color : '#cccccc';
    const isCircle = entity.components.Collider?.shape === 'circle';
    if (isCircle) {
      ctx.beginPath();
      ctx.ellipse(0, 0, size.x / 2, size.y / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-size.x / 2, -size.y / 2, size.x, size.y);
    }
    ctx.restore();
  }
}
