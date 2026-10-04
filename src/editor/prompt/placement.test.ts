import { describe, expect, it } from 'vitest';
import { placePrompt } from './placement';

const view = { w: 1000, h: 700 };
const size = { w: 300, h: 44 };
const box = (cx: number, cy: number, r = 20) => ({ minX: cx - r, minY: cy - r, maxX: cx + r, maxY: cy + r });
const inside = (p: { x: number; y: number }) => p.x >= 0 && p.y >= 0 && p.x + size.w <= view.w && p.y + size.h <= view.h;

describe('placePrompt', () => {
  it('goes above an object in open space, centered', () => {
    const p = placePrompt(box(500, 400), size, view);
    expect(p.side).toBe('top');
    expect(p.x + size.w / 2).toBeCloseTo(500);
    expect(p.y + size.h).toBeLessThan(380);
  });
  it('goes below an object near the top', () => {
    expect(placePrompt(box(500, 30), size, view).side).toBe('bottom');
  });
  it('goes to the right of an object near the left edge', () => {
    expect(placePrompt(box(40, 400), size, view).side).toBe('right');
  });
  it('goes to the left of an object near the right edge', () => {
    expect(placePrompt(box(970, 400), size, view).side).toBe('left');
  });
  it('is never clipped, even for an object filling the view', () => {
    for (const anchor of [box(500, 350, 600), box(0, 0), box(1000, 700), box(-50, 350)]) {
      expect(inside(placePrompt(anchor, size, view))).toBe(true);
    }
  });
  it('respects reserved insets (top bar)', () => {
    const p = placePrompt(box(500, 90), size, view, { insetTop: 56 });
    expect(p.y).toBeGreaterThanOrEqual(56);
  });
  it('connector touches the prompt and points at the object', () => {
    const p = placePrompt(box(500, 400), size, view);
    expect(p.connector.y1).toBeCloseTo(p.y + size.h);
    expect(p.connector.y2).toBeLessThan(400);
  });
});
