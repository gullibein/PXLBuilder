import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations, type Operation } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createProject } from './model/factory';
import { BACKGROUND_KINDS, makeBackground, type BackgroundKind } from './model/backgroundArt';
import { madeBackgroundOf } from './model/mutations';

const registry = createBuiltinRegistry();
const kinds = Object.keys(BACKGROUND_KINDS) as BackgroundKind[];

describe('backgrounds the engine draws itself', () => {
  it('every kind makes a picture, small enough to keep in a game, the same every time for the same settings', () => {
    for (const k of kinds) {
      const a = makeBackground(k, [], 16, 1);
      expect(a.data.startsWith('data:image/svg+xml'), k).toBe(true);
      expect(a.data.length, k).toBeLessThan(80_000);
      expect(makeBackground(k, [], 16, 1).data, k).toBe(a.data);
      expect(a.fit, k).toBe(BACKGROUND_KINDS[k].fit);
    }
    // Another variant is another picture.
    expect(makeBackground('stone', [], 16, 2).data).not.toBe(makeBackground('stone', [], 16, 1).data);
  });

  it("patterns are drawn at the game's pixel size: a picture pixel is a game pixel (one tile is the sprite size)", () => {
    // Checks are a tile each, so two tiles across: 64 level pixels whatever the sprite size; with more pixels.
    for (const res of [8, 16, 32]) {
      const a = makeBackground('checker', [], res, 1);
      expect([a.width, a.height]).toEqual([64, 64]);
      expect(decodeURIComponent(a.data)).toContain(`viewBox="0 0 ${res * 2} ${res * 2}"`);
    }
  });

  it('uses the colors given (in the kind\'s order) and its own for the rest', () => {
    const a = decodeURIComponent(makeBackground('bricks', ['#123456'], 16, 1).data);
    expect(a).toContain('#4a2c24');
    expect(a).not.toContain('#7a4a3a');
  });

  it('make_background makes it the level\'s background: scenery fills the screen, walls repeat with the level', () => {
    const p0 = createProject(registry);
    const sceneId = p0.scenes[0].id;
    const p = produce(p0, (d) => void applyOperations(d, [{ op: 'make_background', sceneId, kind: 'stone', colors: ['#3a3f4c', '#1d2028'], variant: 2, parallax: 1 } as Operation], registry));
    const bg = p.scenes[0].world.background;
    expect(bg).toMatchObject({ fit: 'tile', parallax: 1 });
    const asset = p.assets.find((a) => a.id === bg.imageAssetId);
    expect(madeBackgroundOf(asset)).toEqual({ background: 'stone', colors: ['#3a3f4c', '#1d2028'], variant: 2 });
    const q = produce(p0, (d) => void applyOperations(d, [{ op: 'make_background', sceneId, kind: 'hills', colors: [], variant: 1, parallax: 0.3 } as Operation], registry));
    expect(q.scenes[0].world.background).toMatchObject({ fit: 'cover', parallax: 0.3 });
  });
});
