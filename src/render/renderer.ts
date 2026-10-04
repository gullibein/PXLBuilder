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

/** Mixes a hex color toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const ch = (v: number) => Math.round(v + (target - v) * a);
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

const tileKey = (definitionId: string | null, x: number, y: number) => `${definitionId}|${Math.round(x)}|${Math.round(y)}`;

/**
 * Draws entities in order (later entities on top). Expects world-space transform on ctx.
 * Tile objects of the same kind join into one surface: a lighter top edge only
 * where nothing sits above, a darker base only where nothing sits below.
 */
export function drawEntities(ctx: CanvasRenderingContext2D, entities: ResolvedEntity[]): void {
  const tiles = new Set<string>();
  for (const e of entities) if (e.tile) tiles.add(tileKey(e.definitionId, e.transform.position.x, e.transform.position.y));

  for (const entity of entities) {
    const sprite = entity.components.Sprite;
    if (!sprite || sprite.visible === false) continue;
    const size = getEntitySize(entity);
    const { position, rotation, scale } = entity.transform;
    const color = typeof sprite.color === 'string' ? sprite.color : '#cccccc';
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale.x, scale.y);
    ctx.fillStyle = color;
    if (entity.tile) {
      const w = size.x;
      const h = size.y;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      const above = tiles.has(tileKey(entity.definitionId, position.x, position.y - h * scale.y));
      const below = tiles.has(tileKey(entity.definitionId, position.x, position.y + h * scale.y));
      if (!above) {
        ctx.fillStyle = shade(color, 0.35);
        ctx.fillRect(-w / 2, -h / 2, w, Math.max(2, h * 0.22));
      }
      if (!below) {
        ctx.fillStyle = shade(color, -0.25);
        ctx.fillRect(-w / 2, h / 2 - Math.max(2, h * 0.12), w, Math.max(2, h * 0.12));
      }
    } else if (entity.components.Collider?.shape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(0, 0, size.x / 2, size.y / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-size.x / 2, -size.y / 2, size.x, size.y);
    }
    ctx.restore();
  }
}
