import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { boxesFromPixels, refreshPixelColliders } from '../core/model/colliderBoxes';
import { createDefinition, createPixelArtAsset, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Vec2 } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

describe('a collider made of several boxes', () => {
  it("worked out from a picture's pixels: an L of pixels is two boxes, sized to the sprite", () => {
    const rows = ['xx..', 'xx..', 'xxxx', 'xxxx'];
    const boxes = boxesFromPixels(rows, 32, 32);
    expect(boxes).toEqual([
      { x: 0, y: 0, w: 16, h: 16 },
      { x: 0, y: 16, w: 32, h: 16 },
    ]);
    // A busy picture is covered more coarsely, never by more than 48 boxes.
    const checker = Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => ((x + y) % 2 ? 'x' : '.')).join(''));
    expect(boxesFromPixels(checker, 32, 32).length).toBeLessThanOrEqual(48);
  });

  /** An L-shaped block (64x64: the bottom half and the top-left quarter) on the ground, the player dropped over its empty corner. */
  function lBlock(shape: 'boxes' | 'box') {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const block = createDefinition('Block', {
        Sprite: registry.createDefault('Sprite', { width: 64, height: 64, color: '#888888' }),
        Collider: registry.createDefault('Collider', { shape, size: { x: 64, y: 64 }, matchSprite: false, boxes: [{ x: 0, y: 32, w: 64, h: 32 }, { x: 0, y: 0, w: 32, h: 32 }] }),
        PhysicsBody: registry.createDefault('PhysicsBody', { bodyType: 'static' }),
      });
      m.addDefinition(d, block, registry);
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = -4; c <= 4; c++) place('Platform', { x: c * 32 + 16, y: 80 });
      // The block's middle at (0, 32): it spans y 0…64, its notch top-right (x 0…32, y 0…32).
      place('Block', { x: 0, y: 32 });
      place('Player', { x: 16, y: -80 });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    for (let t = 0; t < 2; t += 1 / 120) rt.update(1 / 120, input);
    return rt.find('Player')!;
  }

  it('walls and floors are each box: the player lands in the notch of an L (with one box, on top of it all)', () => {
    const inNotch = lBlock('boxes');
    expect(inNotch.grounded).toBe(true);
    expect(inNotch.y + 16).toBeCloseTo(32, 0);
    const onTop = lBlock('box');
    expect(onTop.y + 16).toBeCloseTo(0, 0);
  });

  /** A coin drawn in the top half of its square, hanging so its empty bottom half is where the player's head goes by. */
  function lowCoin(pixelPerfect: boolean) {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      d.scenes[0].entities = [];
      const art = createPixelArtAsset('High coin', { palette: [{ key: 'y', color: '#ffd84a' }], rows: ['yyyy', 'yyyy', '....', '....'] });
      m.addAsset(d, art);
      const coin = d.definitions.find((x) => x.name === 'Coin')!;
      coin.components.Sprite = { ...coin.components.Sprite, width: 32, height: 32, assetId: art.id };
      coin.components.Collider = { ...coin.components.Collider, shape: pixelPerfect ? 'boxes' : 'box', fromPixels: pixelPerfect, size: { x: 32, y: 32 }, matchSprite: false };
      refreshPixelColliders(d);
      const place = (name: string, pos: Vec2) => m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.name === name)!, pos));
      for (let c = -4; c <= 6; c++) place('Platform', { x: c * 32 + 16, y: 48 });
      // The player's head is at y 0 as it walks: the coin's square spans y -18…14, its pixels (the top half) -18…-2.
      place('Coin', { x: 96, y: -2 });
      place('Player', { x: -60, y: 16 });
    });
    const rt = new Runtime(project, sceneId, registry);
    const input = new InputState();
    input.press('right');
    for (let t = 0; t < 1.5; t += 1 / 120) rt.update(1 / 120, input);
    return { project, collected: !rt.find('Coin')?.alive };
  }

  it('pixel-perfect follows the picture (worked out from its pixels); touching counts only its pixels', () => {
    const exact = lowCoin(true);
    expect(exact.project.definitions.find((x) => x.name === 'Coin')!.components.Collider!.boxes).toEqual([{ x: 0, y: 0, w: 32, h: 16 }]);
    // Its pixels (y -18…-2) stay clear of the head (0…32); its whole square (-18…14) would not.
    expect(exact.collected).toBe(false);
    expect(lowCoin(false).collected).toBe(true);
  });
});
