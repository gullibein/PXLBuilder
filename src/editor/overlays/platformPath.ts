/**
 * Moving platforms' paths on the level: a dashed line from where each starts, through its points, to its end (and
 * back to the start for a loop), with an outline of the platform at the end. The selected platform's points are
 * handles: dragged to change the path, a "+" halfway along each stretch adds a point there, a double-click on a
 * point (not the end) takes it away.
 */
import type { ResolvedEntity } from '../../core/model/resolve';
import { getWorldBounds } from '../../core/model/geometry';
import type { Id, Vec2 } from '../../core/types';

export interface PlatformPath {
  id: Id;
  /** Absolute points: the start (the platform's place), its points, the end. */
  points: Vec2[];
  loop: boolean;
  /** Its size (for the outline at the end). */
  w: number;
  h: number;
}

export function platformPaths(entities: ResolvedEntity[]): PlatformPath[] {
  const out: PlatformPath[] = [];
  for (const e of entities) {
    const mv = e.components.MovingPlatform;
    if (!mv) continue;
    const at = e.transform.position;
    const rel = relativePath(mv);
    const b = getWorldBounds(e);
    out.push({ id: e.id, points: rel.map((p) => ({ x: at.x + p.x, y: at.y + p.y })), loop: mv.loop === true, w: b.maxX - b.minX, h: b.maxY - b.minY });
  }
  return out;
}

/** The path relative to the start: the start (0, 0), the points, the end (offset). */
export function relativePath(mv: Record<string, unknown>): Vec2[] {
  const pts = Array.isArray(mv.points) ? (mv.points as Vec2[]) : [];
  const end = (mv.offset as Vec2 | undefined) ?? { x: 96, y: 0 };
  return [{ x: 0, y: 0 }, ...pts.map((p) => ({ x: p.x, y: p.y })), { x: end.x, y: end.y }];
}

export type PathHandle = { id: Id; kind: 'point'; index: number } | { id: Id; kind: 'add'; after: number; at: Vec2 };

/** The handles of a selected platform's path: its points (not the start: that is the platform itself) and a "+" on each stretch. */
export function pathHandles(path: PlatformPath): { handle: PathHandle; at: Vec2 }[] {
  const out: { handle: PathHandle; at: Vec2 }[] = [];
  const pts = path.points;
  for (let i = 1; i < pts.length; i++) out.push({ handle: { id: path.id, kind: 'point', index: i }, at: pts[i] });
  for (let i = 0; i + 1 < pts.length; i++) {
    const at = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
    out.push({ handle: { id: path.id, kind: 'add', after: i, at }, at });
  }
  return out;
}

/** The handle under a point of the level (`radius` in screen pixels). */
export function pathHandleAt(paths: PlatformPath[], selected: Id[], world: Vec2, zoom: number, radius = 8): PathHandle | null {
  if (selected.length !== 1) return null;
  const path = paths.find((p) => p.id === selected[0]);
  if (!path) return null;
  let best: { h: PathHandle; d: number } | null = null;
  for (const { handle, at } of pathHandles(path)) {
    const d = Math.hypot(world.x - at.x, world.y - at.y) * zoom;
    // (A point wins over a "+" at the same spot.)
    const score = d + (handle.kind === 'add' ? 0.5 : 0);
    if (d <= radius && (!best || score < best.d)) best = { h: handle, d: score };
  }
  return best?.h ?? null;
}

/** The path with point `index` (1…: the points, then the end) moved to `to` (absolute), as MovingPlatform fields. */
export function movedPath(path: PlatformPath, index: number, to: Vec2): { points: Vec2[]; offset: Vec2 } {
  const start = path.points[0];
  const rel = path.points.map((p, i) => (i === index ? { x: to.x - start.x, y: to.y - start.y } : { x: p.x - start.x, y: p.y - start.y }));
  return { points: rel.slice(1, -1), offset: rel[rel.length - 1] };
}

/** The path with a new point after point `after` (0: the start), at `at` (absolute); and where it is in the path. */
export function withPointAdded(path: PlatformPath, after: number, at: Vec2): { points: Vec2[]; offset: Vec2; index: number } {
  const all = [...path.points.slice(0, after + 1), at, ...path.points.slice(after + 1)];
  const start = all[0];
  const rel = all.map((p) => ({ x: p.x - start.x, y: p.y - start.y }));
  return { points: rel.slice(1, -1), offset: rel[rel.length - 1], index: after + 1 };
}

/** The path without point `index` (one of the points between: the start and the end stay). */
export function withPointRemoved(path: PlatformPath, index: number): { points: Vec2[]; offset: Vec2 } | null {
  if (index <= 0 || index >= path.points.length - 1) return null;
  const all = path.points.filter((_, i) => i !== index);
  const start = all[0];
  const rel = all.map((p) => ({ x: p.x - start.x, y: p.y - start.y }));
  return { points: rel.slice(1, -1), offset: rel[rel.length - 1] };
}

export function drawPlatformPaths(ctx: CanvasRenderingContext2D, paths: PlatformPath[], selected: Id[], zoom: number): void {
  const px = 1 / zoom;
  for (const path of paths) {
    const on = selected.length === 1 && selected[0] === path.id;
    const pts = path.points;
    ctx.save();
    ctx.strokeStyle = on ? 'rgba(255, 214, 102, 0.95)' : 'rgba(255, 214, 102, 0.45)';
    ctx.lineWidth = (on ? 2 : 1.5) * px;
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (path.loop) ctx.lineTo(pts[0].x, pts[0].y);
    ctx.stroke();
    ctx.setLineDash([]);
    // The platform where its path ends, as an outline.
    const end = pts[pts.length - 1];
    ctx.strokeStyle = on ? 'rgba(255, 214, 102, 0.8)' : 'rgba(255, 214, 102, 0.35)';
    ctx.lineWidth = px;
    ctx.strokeRect(end.x - path.w / 2, end.y - path.h / 2, path.w, path.h);
    // Which way it goes: a little arrow on the first stretch.
    if (pts.length > 1) {
      const a = pts[0];
      const b = pts[1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len > 1) {
        const ux = (b.x - a.x) / len;
        const uy = (b.y - a.y) / len;
        const m = { x: a.x + ux * Math.min(len / 2, 24), y: a.y + uy * Math.min(len / 2, 24) };
        const s = 5 * px;
        ctx.fillStyle = ctx.strokeStyle;
        ctx.beginPath();
        ctx.moveTo(m.x + ux * s, m.y + uy * s);
        ctx.lineTo(m.x - ux * s - uy * s, m.y - uy * s + ux * s);
        ctx.lineTo(m.x - ux * s + uy * s, m.y - uy * s - ux * s);
        ctx.fill();
      }
    }
    if (on) {
      for (const { handle, at } of pathHandles(path)) {
        if (handle.kind === 'point') {
          ctx.fillStyle = handle.index === pts.length - 1 ? '#ffd666' : '#fff4cc';
          ctx.strokeStyle = '#5a4300';
          ctx.lineWidth = 1.5 * px;
          ctx.beginPath();
          ctx.arc(at.x, at.y, 5 * px, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        } else {
          ctx.fillStyle = 'rgba(255, 214, 102, 0.85)';
          ctx.beginPath();
          ctx.arc(at.x, at.y, 4 * px, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = '#5a4300';
          ctx.lineWidth = 1.2 * px;
          ctx.beginPath();
          ctx.moveTo(at.x - 2.5 * px, at.y);
          ctx.lineTo(at.x + 2.5 * px, at.y);
          ctx.moveTo(at.x, at.y - 2.5 * px);
          ctx.lineTo(at.x, at.y + 2.5 * px);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
}
