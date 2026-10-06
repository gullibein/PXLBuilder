/**
 * The camera frame shown while editing: what Play shows when the level
 * starts (on this screen size), and the camera's limits. It uses the same
 * camera math as Play (core/model/camera.ts), so the frame is exact.
 */
import { boundsOf, cameraLimits, startCamera, type CameraBounds } from '../../core/model/camera';
import { getEntitySize } from '../../core/model/geometry';
import type { ResolvedEntity } from '../../core/model/resolve';
import type { Scene } from '../../core/types';
import type { ViewSize } from '../../render/renderer';

export interface CameraFrame {
  /** What the screen shows at the start of play, in level pixels. */
  frame: CameraBounds;
  /** Where the camera can't look past (null: no limits). */
  limits: CameraBounds | null;
  /** Name of what it follows (null: a still camera). */
  follows: string | null;
}

export function cameraFrame(scene: Scene, entities: ResolvedEntity[], view: ViewSize): CameraFrame {
  const target = entities.find((e) => e.components.CameraTarget) ?? null;
  const level = boundsOf(
    entities.map((e) => {
      const s = getEntitySize(e);
      return { x: e.transform.position.x, y: e.transform.position.y, w: s.x, h: s.y };
    }),
  );
  const c = startCamera(scene.camera, target ? target.transform.position : null, level, view);
  const hw = view.width / 2 / scene.camera.zoom;
  const hh = view.height / 2 / scene.camera.zoom;
  return { frame: { minX: c.x - hw, minY: c.y - hh, maxX: c.x + hw, maxY: c.y + hh }, limits: cameraLimits(scene.camera, level), follows: target?.name ?? null };
}

/** Draws it in level coordinates (the editor camera is already applied). */
export function drawCameraFrame(ctx: CanvasRenderingContext2D, f: CameraFrame, zoom: number): void {
  const px = 1 / zoom;
  ctx.save();
  const label = (text: string, x: number, y: number, color: string) => {
    ctx.font = `600 ${11 * px}px Figtree, system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, x + 2 * px, y - 3 * px);
  };
  if (f.limits) {
    const b = f.limits;
    ctx.strokeStyle = 'rgba(255, 170, 70, 0.7)';
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([2 * px, 5 * px]);
    ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    label('Camera limits', b.minX, b.maxY + 16 * px, 'rgba(255, 190, 110, 0.95)');
  }
  const r = f.frame;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 2 * px;
  ctx.setLineDash([10 * px, 6 * px]);
  ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
  label(f.follows ? `Camera at start (follows ${f.follows})` : 'Camera (stays still)', r.minX, r.minY, 'rgba(255, 255, 255, 0.9)');
  ctx.restore();
}
