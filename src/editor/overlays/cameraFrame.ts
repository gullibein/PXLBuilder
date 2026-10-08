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

export type CameraOutline = 'start' | 'limits';

/** The outline whose edge is at this point (within a few screen pixels), if any: the start frame first. */
export function outlineAt(f: CameraFrame, p: { x: number; y: number }, zoom: number): CameraOutline | null {
  const near = 6 / zoom;
  const onEdge = (b: CameraBounds) => {
    const inside = p.x > b.minX - near && p.x < b.maxX + near && p.y > b.minY - near && p.y < b.maxY + near;
    const deep = p.x > b.minX + near && p.x < b.maxX - near && p.y > b.minY + near && p.y < b.maxY - near;
    return inside && !deep;
  };
  if (onEdge(f.frame)) return 'start';
  if (f.limits && onEdge(f.limits)) return 'limits';
  return null;
}

/**
 * Draws it in level coordinates (the editor camera is already applied): the
 * start frame in white, the limits in red. The one under the mouse glows a
 * little, the selected one fully.
 */
export function drawCameraFrame(ctx: CanvasRenderingContext2D, f: CameraFrame, zoom: number, highlight: { hover: CameraOutline | null; selected: CameraOutline | null } = { hover: null, selected: null }): void {
  const px = 1 / zoom;
  ctx.save();
  const label = (text: string, x: number, y: number, color: string) => {
    ctx.font = `600 ${11 * px}px Figtree, system-ui, sans-serif`;
    ctx.fillStyle = color;
    ctx.textBaseline = 'bottom';
    ctx.fillText(text, x + 2 * px, y - 3 * px);
  };
  const outline = (b: CameraBounds, part: CameraOutline, color: string, glow: string, width: number, dash: number[]) => {
    const level = highlight.selected === part ? 2 : highlight.hover === part ? 1 : 0;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = (width + level) * px;
    ctx.setLineDash(dash.map((d) => d * px));
    if (level) {
      // Glow: a soft blur around the line (in screen pixels, whatever the zoom).
      ctx.shadowColor = glow;
      ctx.shadowBlur = level === 2 ? 16 : 7;
    }
    ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.restore();
  };
  if (f.limits) {
    const b = f.limits;
    outline(b, 'limits', 'rgba(255, 82, 82, 0.85)', 'rgba(255, 60, 60, 0.95)', 1.5, [6, 5]);
    label('Camera limits', b.minX, b.maxY + 16 * px, 'rgba(255, 120, 120, 0.95)');
  }
  const r = f.frame;
  outline(r, 'start', 'rgba(255, 255, 255, 0.75)', 'rgba(255, 255, 255, 0.95)', 2, [10, 6]);
  label(f.follows ? `Camera at start (follows ${f.follows})` : 'Camera (stays still)', r.minX, r.minY, 'rgba(255, 255, 255, 0.9)');
  ctx.restore();
}
