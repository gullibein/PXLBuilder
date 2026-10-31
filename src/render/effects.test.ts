import { describe, expect, it } from 'vitest';
import { drawEntities } from './renderer';

/** A canvas stand-in that records the rectangles filled (in level pixels: no camera here). */
function recorder() {
  const rects: { x: number; y: number; w: number; h: number; style: string; op: string }[] = [];
  const ctx = {
    canvas: { width: 1000, height: 1000 },
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    imageSmoothingEnabled: true,
    lineWidth: 1,
    lineCap: 'butt',
    getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    setTransform() {},
    translate() {},
    rotate() {},
    scale() {},
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    ellipse() {},
    fill() {},
    stroke() {},
    moveTo() {},
    lineTo() {},
    fillRect(x: number, y: number, w: number, h: number) {
      rects.push({ x, y, w, h, style: String(this.fillStyle), op: this.globalCompositeOperation });
    },
    createRadialGradient: () => {
      throw new Error('no smooth gradients in pixel art');
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

const shot = (comps: Record<string, Record<string, unknown>>, trail: { x: number; y: number }[] = []) => ({
  id: 'e',
  name: 'Shot',
  definitionId: 'd',
  tile: false,
  transform: { position: { x: 101, y: 50 }, rotation: 0, scale: { x: 1, y: 1 } },
  components: comps,
  scripts: [],
  tags: [],
  trail,
});

describe('glows and tails are pixel art', () => {
  it('every rectangle sits on the art-pixel grid (4 level px at 8x8 sprites), in a few solid steps of color', () => {
    const px = 4;
    const tail = Array.from({ length: 20 }, (_, i) => ({ x: 101, y: 150 - i * 5 }));
    for (const style of ['fade', 'sparks', 'dots']) {
      const { ctx, rects } = recorder();
      drawEntities(ctx, [shot({ Sprite: { width: 8, height: 8, color: '#5ef2ff' }, Glow: { color: '#5ef2ff', size: 12 }, Trail: { color: '#2a9df4', style } }, tail) as never], () => null, 0, 0.3, px);
      const effects = rects.filter((r) => r.style !== '#5ef2ff' || r.op === 'lighter');
      expect(effects.length).toBeGreaterThan(5);
      for (const r of effects) for (const v of [r.x, r.y, r.w, r.h]) expect(Math.abs(v / px - Math.round(v / px))).toBeLessThan(1e-9);
      // The tail: at most three shades of its color.
      expect(new Set(rects.filter((r) => r.op !== 'lighter' && r.style !== '#5ef2ff').map((r) => r.style)).size).toBeLessThanOrEqual(3);
    }
  });
});
