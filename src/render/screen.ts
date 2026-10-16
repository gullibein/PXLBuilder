/**
 * What scripts draw on the screen (the "draw" statement): text, boxes,
 * circles and library objects' looks, at a screen corner, side or the
 * center, or in the level ("world", moving with the camera). Drawn over the
 * game in the order they were first drawn.
 */
import type { ComponentRegistry } from '../core/components/registry';
import { instantiateDefinition } from '../core/model/factory';
import { resolveEntity, type ResolvedEntity } from '../core/model/resolve';
import type { DrawAnchor } from '../core/script/language';
import type { Project } from '../core/types';
import type { ScreenDrawing } from '../runtime/runtime';
import { drawEntities, type ImageLookup } from './renderer';
import { drawPixelText, pixelTextSize } from './pixelFont';

/** Text less than this many canvas pixels tall is drawn in the pixel font (an ordinary font is a blur there). */
export const PIXEL_FONT_BELOW = 12;

const ANCHOR: Record<Exclude<DrawAnchor, 'world'>, [number, number]> = {
  top_left: [0, 0],
  top: [0.5, 0],
  top_right: [1, 0],
  left: [0, 0.5],
  center: [0.5, 0.5],
  right: [1, 0.5],
  bottom_left: [0, 1],
  bottom: [0.5, 1],
  bottom_right: [1, 1],
};

/** Library objects' looks, worked out once per play. */
export class LookCache {
  private readonly looks = new Map<string, ResolvedEntity | null>();
  constructor(
    private readonly project: Project,
    private readonly registry: ComponentRegistry,
  ) {}
  get(objectId: string): ResolvedEntity | null {
    if (!this.looks.has(objectId)) {
      const def = this.project.definitions.find((d) => d.id === objectId);
      this.looks.set(objectId, def ? { ...resolveEntity(this.project, instantiateDefinition(def, { x: 0, y: 0 }), this.registry), tile: false } : null);
    }
    return this.looks.get(objectId)!;
  }
}

/**
 * The game's pixel grid on the canvas: canvas pixels per picture pixel of the level (`cell`, a whole number, 1 when
 * zoomed out further), and whether the game has a resolution of its own (a low one: all its text in the pixel font).
 * Everything drawn over the game keeps to it: no picture, box or letter has pixels of another size than the level's.
 */
export interface PixelGrid {
  cell: number;
  lowRes: boolean;
}

/** The size a picture of `art` pixels is drawn closest to `want` canvas pixels: a whole number of the grid's cells per picture pixel. */
export function onGrid(art: number, want: number, cell: number): number {
  return art * cell * Math.max(1, Math.round(want / (art * cell)));
}

const snapTo = (v: number, origin: number, cell: number) => origin + Math.round((v - origin) / cell) * cell;

/** An ellipse of whole grid cells (a pixel-art circle), filling the box at (x, y), w × h canvas pixels. */
function gridEllipse(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cell: number): void {
  const cols = Math.max(1, Math.round(w / cell));
  const rows = Math.max(1, Math.round(h / cell));
  for (let j = 0; j < rows; j++) {
    const v = ((j + 0.5) / rows) * 2 - 1;
    // The row's run of cells inside the ellipse.
    const half = Math.sqrt(Math.max(0, 1 - v * v)) * (cols / 2);
    const from = Math.round(cols / 2 - half);
    const to = Math.round(cols / 2 + half);
    if (to > from) ctx.fillRect(x + from * cell, y + j * cell, (to - from) * cell, cell);
  }
}

/** A picture's own size in pixels (its sheet cell for sprite sheets), or null for a plain colored look. */
function artSize(look: ResolvedEntity, images: ImageLookup): { w: number; h: number } | null {
  const id = look.components.Sprite?.assetId;
  const img = typeof id === 'string' ? images(id) : null;
  if (!img) return null;
  if (img.grid) return { w: img.grid.cellWidth, h: img.grid.cellHeight };
  const src = img.source as { naturalWidth?: number; naturalHeight?: number; width: number; height: number };
  const w = src.naturalWidth || Number(src.width);
  const h = src.naturalHeight || Number(src.height);
  return w && h ? { w, h } : null;
}

/** Text in the pixel font at (x, y) canvas pixels (anchored by ax, ay), `scale` canvas pixels per font pixel, with a shadow one grid cell down. */
export function pixelLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, ax: number, ay: number, scale: number, color: string, cell: number): { left: number; top: number; w: number; h: number } {
  const box = pixelTextSize(text);
  const w = box.w * scale;
  const h = box.h * scale;
  const left = snapTo(x - ax * w, 0, cell);
  const top = snapTo(y - ay * h, 0, cell);
  ctx.fillStyle = 'rgba(10, 8, 24, 0.7)';
  drawPixelText(ctx, text, left, top + cell, scale);
  ctx.fillStyle = color;
  drawPixelText(ctx, text, left, top, scale);
  return { left, top, w, h };
}

/** The pixel font's size for text meant to be `tall` canvas pixels: a whole number of grid cells per font pixel. */
export function pixelFontScale(tall: number, cell: number): number {
  return cell * Math.max(1, Math.round((tall * 0.7) / 5 / cell));
}

/**
 * Draws the drawings of one layer. "world" drawings expect the camera
 * transform on ctx (level coordinates); the others expect screen pixels
 * (CSS px) and the view size. With the game's pixel grid, everything is
 * drawn on it (in Play); without one, as given.
 */
export function drawScreenDrawings(ctx: CanvasRenderingContext2D, drawings: ScreenDrawing[], layer: 'world' | 'screen', view: { width: number; height: number }, looks: LookCache, images: ImageLookup, clock = 0, grid?: PixelGrid): void {
  const list = drawings.filter((d) => (d.anchor === 'world') === (layer === 'world')).sort((a, b) => a.order - b.order);
  for (const d of list) {
    const [ax, ay] = d.anchor === 'world' ? [0.5, 0.5] : ANCHOR[d.anchor];
    const px = d.anchor === 'world' ? d.x : ax * view.width + d.x;
    const py = d.anchor === 'world' ? d.y : ay * view.height + d.y;
    ctx.save();
    ctx.globalAlpha *= d.alpha;
    const m = ctx.getTransform();
    if (grid && m.b === 0 && m.c === 0) drawOnGrid(ctx, d, px, py, ax, ay, m, layer, grid, looks, images, clock);
    else drawFree(ctx, d, px, py, ax, ay, m, looks, images, clock);
    ctx.restore();
  }
}

/** One drawing on the game's pixel grid, in canvas pixels. */
function drawOnGrid(ctx: CanvasRenderingContext2D, d: ScreenDrawing, px: number, py: number, ax: number, ay: number, m: DOMMatrix, layer: 'world' | 'screen', grid: PixelGrid, looks: LookCache, images: ImageLookup, clock: number): void {
  const cell = grid.cell;
  // Where the level's pixels start on the canvas (in the level they move with the camera, in whole canvas pixels).
  const ox = layer === 'world' ? m.e : 0;
  const oy = layer === 'world' ? m.f : 0;
  const cx = m.a * px + m.e;
  const cy = m.d * py + m.f;
  const W = Math.abs(d.w * m.a);
  const H = Math.abs(d.h * m.d);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (d.shape === 'text') {
    const tall = d.size * Math.abs(m.d);
    if (grid.lowRes || tall < PIXEL_FONT_BELOW) {
      pixelLabel(ctx, d.text, cx, cy, ax, ay, pixelFontScale(tall, cell), d.color, cell);
      return;
    }
    // (A game without a resolution of its own: ordinary text, as given.)
    ctx.setTransform(m);
    drawFree(ctx, d, px, py, ax, ay, m, looks, images, clock);
    return;
  }
  const look = d.shape === 'sprite' && d.object ? looks.get(d.object) : null;
  const art = look ? artSize(look, images) : null;
  // A picture: each of its pixels a whole number of grid cells; boxes, circles and plain looks: whole cells.
  const w = art ? onGrid(art.w, W, cell) : Math.max(cell, Math.round(W / cell) * cell);
  const h = art ? (w / art.w) * art.h : Math.max(cell, Math.round(H / cell) * cell);
  const left = snapTo(cx - ax * w, ox, cell);
  const top = snapTo(cy - ay * h, oy, cell);
  ctx.fillStyle = d.color;
  if (d.shape === 'rect') ctx.fillRect(left, top, w, h);
  else if (d.shape === 'circle') gridEllipse(ctx, left, top, w, h, cell);
  else if (look?.components.Sprite) {
    if (!art) ctx.fillStyle = typeof look.components.Sprite.color === 'string' ? look.components.Sprite.color : d.color;
    drawEntities(ctx, [{ ...look, transform: { position: { x: left + w / 2, y: top + h / 2 }, rotation: 0, scale: { x: 1, y: 1 } }, components: { ...look.components, Sprite: { ...look.components.Sprite, width: w, height: h, visible: true } } }], images, 0, clock);
  }
}

/** One drawing as given (no pixel grid: the editor's previews, a turned view). */
function drawFree(ctx: CanvasRenderingContext2D, d: ScreenDrawing, px: number, py: number, ax: number, ay: number, m: DOMMatrix, looks: LookCache, images: ImageLookup, clock: number): void {
  // Canvas pixels the text would be tall: too few for an ordinary font to be read (a game at a low resolution,
  // 128 pixels tall: 12 px text is 2 or 3 canvas pixels), and it is drawn in the pixel font, on whole canvas pixels.
  const tall = d.size * Math.abs(m.d);
  if (d.shape === 'text' && tall < PIXEL_FONT_BELOW && m.b === 0 && m.c === 0) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    pixelLabel(ctx, d.text, m.a * px + m.e, m.d * py + m.f, ax, ay, pixelFontScale(tall, 1), d.color, 1);
  } else if (d.shape === 'text') {
    ctx.font = `700 ${d.size}px Figtree, system-ui, sans-serif`;
    ctx.textAlign = ax === 0 ? 'left' : ax === 1 ? 'right' : 'center';
    ctx.textBaseline = ay === 0 ? 'top' : ay === 1 ? 'bottom' : 'middle';
    ctx.fillStyle = 'rgba(10, 8, 24, 0.7)';
    ctx.fillText(d.text, px + 1, py + 1.5);
    ctx.fillStyle = d.color;
    ctx.fillText(d.text, px, py);
  } else {
    const left = px - ax * d.w;
    const top = py - ay * d.h;
    if (d.shape === 'rect') {
      ctx.fillStyle = d.color;
      if (m.b === 0 && m.c === 0) {
        const x0 = Math.round(m.a * left + m.e);
        const y0 = Math.round(m.d * top + m.f);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillRect(x0, y0, Math.round(m.a * (left + d.w) + m.e) - x0, Math.round(m.d * (top + d.h) + m.f) - y0);
      } else ctx.fillRect(left, top, d.w, d.h);
    } else if (d.shape === 'circle') {
      ctx.fillStyle = d.color;
      ctx.beginPath();
      ctx.ellipse(left + d.w / 2, top + d.h / 2, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const look = d.object ? looks.get(d.object) : null;
      const sprite = look?.components.Sprite;
      if (look && sprite) {
        drawEntities(ctx, [{ ...look, transform: { position: { x: left + d.w / 2, y: top + d.h / 2 }, rotation: 0, scale: { x: 1, y: 1 } }, components: { ...look.components, Sprite: { ...sprite, width: d.w, height: d.h, visible: true } } }], images, 0, clock);
      }
    }
  }
}
