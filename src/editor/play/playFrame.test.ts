import { describe, expect, it } from 'vitest';
import { cameraView, drawnZoom } from './playFrame';

describe('what the camera reckons the screen shows', () => {
  it('is what is drawn: the zoom rounded to whole canvas pixels per picture pixel (a screen at 125%, 16×16 sprites: zoom 1 is drawn at 1.2)', () => {
    // 16×16 sprites on 32 px squares: 2 level px per picture pixel; 1.25 canvas pixels per screen px: 2.5 → 3 each.
    const drawn = drawnZoom(1, 1, 1.25, 2, { fit: null });
    expect(drawn).toBeCloseTo(1.2, 10);
    const seen = cameraView({ width: 1524, height: 650 }, 1, drawn);
    expect(seen.width).toBeCloseTo(1270, 6);
    expect(seen.height).toBeCloseTo(541.67, 1);
    // Kept to a level's left edge, such a camera stands at 635: the edge is at the screen's edge. (Reckoning with
    // the full 1524, it stood at 762, and the first 127 px of the level, with the player, were off the screen.)
    const cameraX = seen.width / 2;
    expect((0 - cameraX) * drawn + 1524 / 2).toBeCloseTo(0, 6);
    expect((0 - 762) * drawn + 1524 / 2).toBeLessThan(-150);
  });

  it('nothing changes where the zoom is drawn as asked: whole pixels already, or a level fitted to the screen', () => {
    expect(cameraView({ width: 960, height: 600 }, 1, drawnZoom(1, 1, 1, 1, null))).toEqual({ width: 960, height: 600 });
    expect(cameraView({ width: 960, height: 600 }, 2, drawnZoom(2, 1, 2, 2, undefined))).toEqual({ width: 960, height: 600 });
    // (Fitted: exactly the zoom the camera worked out, also at 125%.)
    expect(drawnZoom(1.354, 1, 1.25, 2, { fit: 'height' })).toBe(1.354);
    // (A game with its own resolution: the screen divided by its extra zoom, as before.)
    expect(cameraView({ width: 1000, height: 500 }, 1, drawnZoom(1, 2, 1, 1, { fit: 'width' }))).toEqual({ width: 500, height: 250 });
  });
});
