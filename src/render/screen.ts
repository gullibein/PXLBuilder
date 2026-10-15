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
 * Draws the drawings of one layer. "world" drawings expect the camera
 * transform on ctx (level coordinates); the others expect screen pixels
 * (CSS px) and the view size.
 */
export function drawScreenDrawings(ctx: CanvasRenderingContext2D, drawings: ScreenDrawing[], layer: 'world' | 'screen', view: { width: number; height: number }, looks: LookCache, images: ImageLookup, clock = 0): void {
  const list = drawings.filter((d) => (d.anchor === 'world') === (layer === 'world')).sort((a, b) => a.order - b.order);
  for (const d of list) {
    const [ax, ay] = d.anchor === 'world' ? [0.5, 0.5] : ANCHOR[d.anchor];
    const px = d.anchor === 'world' ? d.x : ax * view.width + d.x;
    const py = d.anchor === 'world' ? d.y : ay * view.height + d.y;
    ctx.save();
    ctx.globalAlpha *= d.alpha;
    const m = ctx.getTransform();
    // Canvas pixels the text would be tall: too few for an ordinary font to be read (a game at a low resolution,
    // 128 pixels tall: 12 px text is 2 or 3 canvas pixels), and it is drawn in the pixel font, on whole canvas pixels.
    const tall = d.size * Math.abs(m.d);
    if (d.shape === 'text' && tall < PIXEL_FONT_BELOW && m.b === 0 && m.c === 0) {
      const scale = Math.max(1, Math.round((tall * 0.7) / 5));
      const box = pixelTextSize(d.text);
      const w = box.w * scale;
      const h = box.h * scale;
      const left = Math.round(m.a * px + m.e - ax * w);
      const top = Math.round(m.d * py + m.f - ay * h);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = 'rgba(10, 8, 24, 0.7)';
      drawPixelText(ctx, d.text, left, top + scale, scale);
      ctx.fillStyle = d.color;
      drawPixelText(ctx, d.text, left, top, scale);
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
          // On whole canvas pixels: at a low resolution a bar's edge between pixels would show as a blur.
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
    ctx.restore();
  }
}
