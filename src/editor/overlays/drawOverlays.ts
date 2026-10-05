/** Canvas drawing for editor overlays (see overlays.ts). */
import { getEntitySize, getWorldBounds, type Rect } from '../../core/model/geometry';
import type { ResolvedEntity } from '../../core/model/resolve';
import type { Scene, Vec2 } from '../../core/types';
import { theme } from '../theme';
import { jumpReach, overlayEntities, readMetric, type EditorOverlay } from './overlays';

const GUIDE = 'rgba(255, 255, 255, 0.85)';

/** World space: the arc of a full running jump to each side, with a tick at its peak. */
export function drawJumpArcs(ctx: CanvasRenderingContext2D, overlays: EditorOverlay[], entities: ResolvedEntity[], scene: Scene, zoom: number): void {
  for (const o of overlays) {
    if (o.kind !== 'jump_reach') continue;
    for (const e of overlayEntities(o, entities)) {
      const r = jumpReach({ e, scene });
      if (!r) continue;
      const feet = { x: e.transform.position.x, y: e.transform.position.y + getEntitySize(e).y / 2 };
      const airtime = (2 * r.jumpForce) / r.gravity;
      ctx.save();
      ctx.strokeStyle = GUIDE;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([5 / zoom, 4 / zoom]);
      for (const dir of [-1, 1]) {
        ctx.beginPath();
        for (let i = 0; i <= 32; i++) {
          const t = (airtime * i) / 32;
          const p = { x: feet.x + dir * r.speed * t, y: feet.y - r.jumpForce * t + (r.gravity * t * t) / 2 };
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      // Peak height marker.
      ctx.setLineDash([]);
      const peak = feet.y - r.height;
      ctx.beginPath();
      ctx.moveTo(feet.x - 10 / zoom, peak);
      ctx.lineTo(feet.x + 10 / zoom, peak);
      ctx.moveTo(feet.x, feet.y);
      ctx.lineTo(feet.x, peak);
      ctx.stroke();
      ctx.restore();
    }
  }
}

export interface InfoPanel {
  entityId: string;
  /** Screen rect of the panel. */
  rect: Rect;
}

/**
 * Screen space: a small panel above each entity with the overlay's values.
 * Returns the panels drawn, so the prompt can sit above them instead of on them.
 */
export function drawInfoPanels(ctx: CanvasRenderingContext2D, overlays: EditorOverlay[], entities: ResolvedEntity[], scene: Scene, toScreen: (p: Vec2) => Vec2): InfoPanel[] {
  // One panel per entity, even when several overlays match it.
  const lines = new Map<string, { e: ResolvedEntity; rows: { label: string; value: string }[] }>();
  for (const o of overlays) {
    if (o.kind !== 'info') continue;
    for (const e of overlayEntities(o, entities)) {
      const entry = lines.get(e.id) ?? { e, rows: [] };
      for (const key of o.show) {
        const m = readMetric(key, { e, scene });
        if (m && !entry.rows.some((r) => r.label === m.label)) entry.rows.push(m);
      }
      lines.set(e.id, entry);
    }
  }
  const panels: InfoPanel[] = [];
  ctx.save();
  ctx.font = `600 11px ${theme.uiFont}`;
  ctx.textBaseline = 'middle';
  for (const { e, rows } of lines.values()) {
    if (!rows.length) continue;
    const b = getWorldBounds(e);
    const top = toScreen({ x: (b.minX + b.maxX) / 2, y: b.minY });
    const labelW = Math.max(...rows.map((r) => ctx.measureText(r.label).width));
    const valueW = Math.max(...rows.map((r) => ctx.measureText(r.value).width));
    const w = labelW + valueW + 26;
    const h = rows.length * 16 + 10;
    const x = Math.round(top.x - w / 2);
    const y = Math.round(top.y - 10 - h);
    ctx.fillStyle = 'rgba(15, 12, 30, 0.82)';
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    // Pointer toward the entity.
    ctx.beginPath();
    ctx.moveTo(top.x - 5, y + h);
    ctx.lineTo(top.x + 5, y + h);
    ctx.lineTo(top.x, y + h + 5);
    ctx.fill();
    rows.forEach((r, i) => {
      const ry = y + 13 + i * 16;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
      ctx.textAlign = 'left';
      ctx.fillText(r.label, x + 9, ry);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'right';
      ctx.fillText(r.value, x + w - 9, ry);
    });
    panels.push({ entityId: e.id, rect: { minX: x, minY: y, maxX: x + w, maxY: y + h + 5 } });
  }
  ctx.restore();
  return panels;
}
