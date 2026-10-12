import { describe, expect, it } from 'vitest';
import { createAnimatedPixelArtAsset, createImageAsset, createPixelArtAsset } from './factory';
import { atlasJson, fileBase, packSheet, sheetAssets, usedAssetIds } from './spriteSheet';

describe('sprite sheet export', () => {
  const coin = createPixelArtAsset('Coin', { palette: [{ key: 'a', color: '#ffcc00' }], rows: ['.a.', 'aaa', '.a.'] });
  const walk = createAnimatedPixelArtAsset('Walk', [{ key: 'a', color: '#ff0000' }], [['aa', 'a.'], ['aa', '.a']], 6);
  const big = createImageAsset('Big', 'data:image/png;base64,AAAA', 10, 4, 'png');
  const sound = { ...createImageAsset('Boing', 'data:audio/wav;base64,AAAA', 0, 0, 'wav'), kind: 'sound' as const };

  it('packs every picture (not sounds) without overlaps', () => {
    const assets = sheetAssets([coin, walk, big, sound as never]);
    expect(assets.map((a) => a.name)).toEqual(['Coin', 'Walk', 'Big']);
    const layout = packSheet(assets);
    const boxes = layout.items.map((i) => ({ x0: i.x, y0: i.y, x1: i.x + i.asset.width, y1: i.y + i.asset.height }));
    for (const [i, a] of boxes.entries()) {
      expect(a.x1).toBeLessThanOrEqual(layout.width);
      expect(a.y1).toBeLessThanOrEqual(layout.height);
      for (const b of boxes.slice(i + 1)) expect(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0).toBe(true);
    }
  });

  it('the JSON names every picture, cell and animation, scaled, with pixel art as data', () => {
    const layout = packSheet([coin, walk]);
    const json = atlasJson(layout, 'game@4x.png', 4) as { frames: Record<string, { frame: { x: number; y: number; w: number; h: number } }>; animations: Record<string, { frames: string[]; fps: number }>; meta: { size: { w: number; h: number }; image: string }; pixelArt: Record<string, { frames: string[][] }> };
    expect(Object.keys(json.frames).sort()).toEqual(['Coin', 'Walk', 'Walk #1', 'Walk #2']);
    expect(json.frames.Coin.frame.w).toBe(12);
    const sheet = layout.items.find((i) => i.asset.name === 'Walk')!;
    expect(json.frames['Walk #2'].frame).toEqual({ x: (sheet.x + 2) * 4, y: sheet.y * 4, w: 8, h: 8 });
    expect(json.animations.Walk).toEqual({ frames: ['Walk #1', 'Walk #2'], fps: 6 });
    expect(json.meta).toMatchObject({ image: 'game@4x.png', size: { w: layout.width * 4, h: layout.height * 4 } });
    expect(json.pixelArt.Walk.frames).toHaveLength(2);
  });

  it('two pictures with the same name get different frame names; file names are tidy', () => {
    const json = atlasJson(packSheet([coin, { ...coin, id: 'other' }]), 'x.png', 1) as { frames: Record<string, unknown> };
    expect(Object.keys(json.frames).sort()).toEqual(['Coin', 'Coin 2']);
    expect(fileBase('My Lode Runner!')).toBe('my-lode-runner');
  });
  it('only the pictures the game uses, when asked', async () => {
    const { createBuiltinRegistry } = await import('../components/builtin');
    const { createProject } = await import('./factory');
    const p = createProject(createBuiltinRegistry());
    const used = usedAssetIds({ ...p, assets: [...p.assets, coin] });
    expect(used.has(coin.id)).toBe(false);
    const player = p.definitions.find((d) => d.name === 'Player')!.components.Sprite as { assetId: string };
    expect(used.has(player.assetId)).toBe(true);
  });
});
