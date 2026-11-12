/**
 * Colliders made of several boxes (Collider shape "boxes"): drawn in the sprite editor, or worked out from the
 * picture's pixels ("pixel-perfect": the boxes cover exactly its visible pixels, and are worked out again whenever
 * the picture changes, Collider.fromPixels). Boxes are in the object's own pixels, from its sprite's top-left corner.
 */
import type { Box } from '../components/schema';
import type { Project } from '../types';

/** At most this many boxes: a busier picture is covered a little more coarsely (2×2 pixels a cell, then 4×4…). */
export const MAX_BOXES = 48;

/**
 * The boxes covering a picture's visible pixels ("." is see-through), sized to a sprite `spriteW` × `spriteH`:
 * each row's runs of pixels, a run joined with the same run in the rows under it.
 */
export function boxesFromPixels(rows: readonly string[], spriteW: number, spriteH: number): Box[] {
  const h = rows.length;
  const w = h ? Math.max(...rows.map((r) => r.length)) : 0;
  if (!w || !h) return [];
  for (let cell = 1; cell <= Math.max(w, h); cell *= 2) {
    const cw = Math.ceil(w / cell);
    const ch = Math.ceil(h / cell);
    const solid = (cx: number, cy: number) => {
      for (let y = cy * cell; y < Math.min(h, (cy + 1) * cell); y++) for (let x = cx * cell; x < Math.min(w, (cx + 1) * cell); x++) if ((rows[y][x] ?? '.') !== '.') return true;
      return false;
    };
    const open: { x: number; w: number; y: number; h: number }[] = [];
    const done: { x: number; w: number; y: number; h: number }[] = [];
    for (let cy = 0; cy < ch; cy++) {
      const runs: { x: number; w: number }[] = [];
      for (let cx = 0; cx < cw; ) {
        if (!solid(cx, cy)) {
          cx++;
          continue;
        }
        const x0 = cx;
        while (cx < cw && solid(cx, cy)) cx++;
        runs.push({ x: x0, w: cx - x0 });
      }
      // (A run just like one in the row above makes that box a row taller.)
      const still: typeof open = [];
      for (const r of runs) {
        const above = open.find((o) => o.x === r.x && o.w === r.w && o.y + o.h === cy);
        if (above) {
          above.h++;
          still.push(above);
        } else still.push({ ...r, y: cy, h: 1 });
      }
      for (const o of open) if (!still.includes(o)) done.push(o);
      open.length = 0;
      open.push(...still);
    }
    done.push(...open);
    if (done.length <= MAX_BOXES || cell >= Math.max(w, h)) {
      const sx = spriteW / w;
      const sy = spriteH / h;
      return done.map((b) => {
        const x = b.x * cell;
        const y = b.y * cell;
        return { x: round(x * sx), y: round(y * sy), w: round(Math.min(b.w * cell, w - x) * sx), h: round(Math.min(b.h * cell, h - y) * sy) };
      });
    }
  }
  return [];
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Objects whose collider follows their picture's pixels (Collider shape "boxes", fromPixels): their boxes worked
 * out again from the picture they have now (after it was drawn anew, or resized). `only`: just that object.
 */
export function refreshPixelColliders(project: Project, only?: string): void {
  for (const d of project.definitions) {
    if (only && d.id !== only) continue;
    const col = d.components.Collider;
    const sprite = d.components.Sprite;
    if (!col || col.shape !== 'boxes' || col.fromPixels !== true || !sprite) continue;
    const asset = project.assets.find((a) => a.id === sprite.assetId);
    const rows = asset?.pixelArt?.rows;
    if (!rows?.length) continue;
    col.boxes = boxesFromPixels(rows, Number(sprite.width) || 32, Number(sprite.height) || 32);
  }
}
