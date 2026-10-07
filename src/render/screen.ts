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
export function drawScreenDrawings(ctx: CanvasRenderingContext2D, drawings: ScreenDrawing[], layer: 'world' | 'screen', view: { width: number; height: number }, looks: LookCache, images: ImageLookup): void {
  const list = drawings.filter((d) => (d.anchor === 'world') === (layer === 'world')).sort((a, b) => a.order - b.order);
  for (const d of list) {
    const [ax, ay] = d.anchor === 'world' ? [0.5, 0.5] : ANCHOR[d.anchor];
    const px = d.anchor === 'world' ? d.x : ax * view.width + d.x;
    const py = d.anchor === 'world' ? d.y : ay * view.height + d.y;
    ctx.save();
    ctx.globalAlpha *= d.alpha;
    if (d.shape === 'text') {
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
        ctx.fillRect(left, top, d.w, d.h);
      } else if (d.shape === 'circle') {
        ctx.fillStyle = d.color;
        ctx.beginPath();
        ctx.ellipse(left + d.w / 2, top + d.h / 2, d.w / 2, d.h / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const look = d.object ? looks.get(d.object) : null;
        const sprite = look?.components.Sprite;
        if (look && sprite) {
          drawEntities(ctx, [{ ...look, transform: { position: { x: left + d.w / 2, y: top + d.h / 2 }, rotation: 0, scale: { x: 1, y: 1 } }, components: { ...look.components, Sprite: { ...sprite, width: d.w, height: d.h, visible: true } } }], images);
        }
      }
    }
    ctx.restore();
  }
}
