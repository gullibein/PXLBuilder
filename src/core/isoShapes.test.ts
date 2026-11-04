import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { codeFor } from './ai/context';
import { applyOperations } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createIsometricProject } from './model/isometricStarter';

const registry = createBuiltinRegistry();
const palette = [{ key: 's', color: '#f4f8ff' }];
const snow = Array(16).fill('s'.repeat(16));

describe('auto-tiled isometric blocks and the AI', () => {
  it('the AI gets a block\'s shapes with their pixels ("look:<object>"), to build on them', () => {
    const project = createIsometricProject(registry);
    const [grass] = codeFor(project, ['look:Grass']);
    expect(grass.id).toMatch(/^look:/);
    expect(grass.look!.sprite!.pixelArt!.rows).toHaveLength(16);
    expect(Object.keys(grass.look!.isoShapes!)).toEqual(['corner_north', 'corner_east', 'corner_south', 'corner_west', 'variation']);
    expect(grass.look!.isoShapes!.corner_north!.image).toBe('Island Corner North');
    expect(grass.look!.isoShapes!.corner_north!.pixelArt!.rows).toHaveLength(16);
  });

  it('draw_sprite isoShape redraws one shape; the look and the other shapes stay', () => {
    const project = createIsometricProject(registry);
    const dirt = project.definitions.find((d) => d.name === 'Dirt')!;
    const before = [...(dirt.components.Sprite.isoPictures as string[])];
    const oldTurn = project.assets.find((a) => a.id === before[1])!;
    const p = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: dirt.id, name: 'Snowy turn', palette, rows: snow, situation: null, isoShape: 'turn_se_sw' }], registry));
    const after = p.definitions.find((d) => d.id === dirt.id)!.components.Sprite;
    const pics = after.isoPictures as string[];
    expect(p.assets.find((a) => a.id === pics[1])!.name).toBe('Snowy turn');
    expect(pics.filter((_, n) => n !== 1)).toEqual(before.filter((_, n) => n !== 1));
    expect(after.assetId).toBe(dirt.components.Sprite.assetId);
    // (The picture it replaced, used by nothing else, leaves the game.)
    expect(p.assets.some((a) => a.id === oldTurn.id)).toBe(false);
    // A shape the block doesn't have, or a block that isn't auto-tiled: refused, saying why.
    const wood = project.definitions.find((d) => d.name === 'Wood')!;
    expect(() => produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: wood.id, name: 'x', palette, rows: snow, situation: null, isoShape: 'variation' }], registry))).toThrow(/not auto-tiled/);
    expect(() => produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: dirt.id, name: 'x', palette, rows: snow, situation: null, isoShape: 'corner_north' }], registry))).toThrow(/no such shape/);
  });

  it('redrawing the normal look keeps the shapes', () => {
    const project = createIsometricProject(registry);
    const water = project.definitions.find((d) => d.name === 'Water')!;
    const pics = water.components.Sprite.isoPictures as string[];
    const p = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: water.id, name: 'Ice water', palette, rows: snow, situation: null }], registry));
    const after = p.definitions.find((d) => d.id === water.id)!.components.Sprite;
    expect(after.isoPictures).toEqual(pics);
    for (const id of pics.filter(Boolean)) expect(p.assets.some((a) => a.id === id)).toBe(true);
  });
});
