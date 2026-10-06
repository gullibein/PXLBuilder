import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { checkPixelArt, pixelArtToSvg, suggestedGrid } from './model/pixelArt';
import { resolveEntity } from './model/resolve';

const registry = createBuiltinRegistry();
const palette = [
  { key: 'g', color: '#c9ced8' },
  { key: 'd', color: '#5b6070' },
];
/** Spikes for a 64x16 Hazard: a 32x8 grid. */
const spikes = Array.from({ length: 8 }, (_, y) => Array.from({ length: 32 }, (_, x) => (Math.abs((x % 8) - 3.5) <= (y + 1) / 2 ? (y === 7 ? 'd' : 'g') : '.')).join(''));

describe('pixel-art sprites', () => {
  it('suggests a grid with the object proportions, at most 32 on the long side', () => {
    expect(suggestedGrid({ x: 64, y: 16 })).toEqual({ width: 32, height: 8 });
    expect(suggestedGrid({ x: 32, y: 32 })).toEqual({ width: 32, height: 32 });
    expect(suggestedGrid({ x: 20, y: 12 })).toEqual({ width: 20, height: 12 });
    expect(suggestedGrid({ x: 32, y: 64 })).toEqual({ width: 16, height: 32 });
  });

  it('checks the rows, the palette and the proportions', () => {
    expect(checkPixelArt({ palette, rows: spikes }, { x: 64, y: 16 })).toBeNull();
    expect(checkPixelArt({ palette, rows: ['gg', 'g'] })).toMatch(/same length/);
    expect(checkPixelArt({ palette, rows: ['gx'] })).toMatch(/"x" is used/);
    expect(checkPixelArt({ palette: [{ key: 'g', color: 'grey' }], rows: ['g'] })).toMatch(/#ff8800/);
    expect(checkPixelArt({ palette, rows: spikes }, { x: 32, y: 32 })).toMatch(/draw it 32×32/);
    expect(checkPixelArt({ palette, rows: Array(65).fill('g') })).toMatch(/at most 64/);
  });

  it('becomes a crisp SVG with one rectangle per run of equal pixels', () => {
    const svg = pixelArtToSvg({ palette, rows: ['gg.d', '....'] });
    expect(svg).toContain('width="4" height="2"');
    expect(svg).toContain('<rect x="0" y="0" width="2" height="1" fill="#c9ced8"/>');
    expect(svg).toContain('<rect x="3" y="0" width="1" height="1" fill="#5b6070"/>');
    expect(svg.match(/<rect/g)).toHaveLength(2);
    expect(svg).toContain('crispEdges');
  });

  it('draw_sprite makes it the look of every copy (definition) or one copy (instance), as one undoable change', () => {
    let project = createProject(registry);
    const sceneId = project.scenes[0].id;
    const hazard = project.definitions.find((d) => d.name === 'Hazard')!;
    const placed = instantiateDefinition(hazard, { x: 0, y: 0 });
    project = produce(project, (d) => m.addEntity(d, sceneId, placed));
    const p = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', target: 'definition', id: hazard.id, name: 'Spikes', palette, rows: spikes, situation: null }], registry));
    const asset = p.assets.find((a) => a.name === 'Spikes')!;
    expect(asset).toMatchObject({ kind: 'image', width: 32, height: 8 });
    expect(asset.data.startsWith('data:image/svg+xml')).toBe(true);
    const def = p.definitions.find((d) => d.id === hazard.id)!;
    expect(def.components.Sprite).toMatchObject({ assetId: asset.id, frame: 1, width: 64, height: 16 }); // size unchanged
    expect(m.getDefinitionSprites(def)).toContainEqual({ assetId: asset.id, frame: 1 });

    const one = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', target: 'instance', id: placed.id, name: 'Spikes', palette, rows: spikes, situation: null }], registry));
    expect(resolveEntity(one, one.scenes[0].entities.at(-1)!, registry).components.Sprite.assetId).toBe(one.assets.at(-1)!.id);
    expect(one.definitions.find((d) => d.id === hazard.id)!.components.Sprite.assetId).toBeNull();

    expect(() => produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', target: 'definition', id: hazard.id, name: 'Square', palette, rows: Array(32).fill('g'.repeat(32)), situation: null }], registry))).toThrow(/object is 64×16/);
  });
});
