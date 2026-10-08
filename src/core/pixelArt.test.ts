import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { checkPixelArt, normalizePixelArt, pixelArtToSvg, suggestedGrid } from './model/pixelArt';
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
    // A two-tile-wide hazard (64×16), drawn on a 32×8 grid.
    project = produce(project, (d) => {
      const h = d.definitions.find((x) => x.name === 'Hazard')!;
      h.components.Sprite.width = 64;
      h.components.Collider.size = { x: 64, y: 16 };
    });
    const hazard = project.definitions.find((d) => d.name === 'Hazard')!;
    const placed = instantiateDefinition(hazard, { x: 0, y: 0 });
    project = produce(project, (d) => m.addEntity(d, sceneId, placed));
    const p = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: hazard.id, name: 'Spikes', palette, rows: spikes, situation: null }], registry));
    const asset = p.assets.filter((a) => a.name === 'Spikes').at(-1)!; // (the starter Hazard's own spikes come first)
    expect(asset).toMatchObject({ kind: 'image', width: 32, height: 8 });
    expect(asset.data.startsWith('data:image/svg+xml')).toBe(true);
    const def = p.definitions.find((d) => d.id === hazard.id)!;
    expect(def.components.Sprite).toMatchObject({ assetId: asset.id, frame: 1, width: 64, height: 16 }); // size unchanged
    expect(m.getDefinitionSprites(def)).toContainEqual({ assetId: asset.id, frame: 1 });

    const one = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', frames: null, fps: null, target: 'instance', id: placed.id, name: 'Spikes', palette, rows: spikes, situation: null }], registry));
    expect(resolveEntity(one, one.scenes[0].entities.at(-1)!, registry).components.Sprite.assetId).toBe(one.assets.at(-1)!.id);
    expect(one.definitions.find((d) => d.id === hazard.id)!.components.Sprite.assetId).toBe(hazard.components.Sprite.assetId); // the object keeps its look

    // Other proportions are fitted, not rejected: a square drawn for the 4:1 hazard is resampled to 32×8.
    const square = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: hazard.id, name: 'Square', palette, rows: Array(32).fill('g'.repeat(32)), situation: null }], registry));
    expect(square.assets.find((a) => a.name === 'Square')).toMatchObject({ width: 32, height: 8 });
  });

  it('art in other proportions is fitted: a pattern repeats, anything else gets transparent space', async () => {
    const { fitPixelArt } = await import('./model/pixelArt');
    const spike = { palette: [{ key: 'g', color: '#cccccc' }], rows: ['...g....', '..ggg...', '.ggggg..', 'gggggggg', 'gggggggg', 'gggggggg', 'gggggggg', 'gggggggg'] };
    const row = fitPixelArt(spike, { x: 64, y: 16 });
    expect(row.rows).toHaveLength(8);
    expect(row.rows[0]).toBe('...g....'.repeat(4)); // four spikes in a row
    const tall = fitPixelArt({ palette: spike.palette, rows: ['gggg', 'gggg', 'gggg'] }, { x: 32, y: 48 });
    expect(tall.rows).toEqual(['....', '....', '....', 'gggg', 'gggg', 'gggg']); // standing on the bottom
    const knight = fitPixelArt({ palette: spike.palette, rows: ['.gg.', '.gg.', 'gggg', '.gg.'] }, { x: 64, y: 32 });
    expect(knight.rows).toEqual(['...gg...', '...gg...', '..gggg..', '...gg...']); // a character is never copied: centered with space
    const wide = fitPixelArt({ palette: spike.palette, rows: ['.g.', '.g.', '.g.'] }, { x: 32, y: 16 });
    expect(wide.rows).toEqual(['..g...', '..g...', '..g...']); // padded to 2:1
    expect(fitPixelArt(spike, { x: 32, y: 32 })).toBe(spike); // already right
  });

  it('draws an object made in the same answer (by its ref), and reads spaces as transparent', () => {
    const project = createProject(registry);
    let assetId = '';
    const next = produce(project, (d) => {
      applyOperations(
        d,
        [
          { op: 'create_definition', ref: 'mush', name: 'Mushroom', description: 'A mushroom enemy', category: 'Enemies', tags: ['enemy'], components: [{ component: 'Sprite', propsJson: '{"width":16,"height":16}' }] },
          { op: 'draw_sprite', frames: null, fps: null, target: 'definition', id: 'mush', name: 'Mushroom', palette: [{ key: 'r', color: '#d33b3b' }], rows: Array.from({ length: 16 }, (_, y) => (y < 8 ? 'r'.repeat(16) : '    rrrrrrrr    ')), situation: null },
        ],
        registry,
      );
      const def = d.definitions.find((x) => x.name === 'Mushroom')!;
      assetId = def.components.Sprite.assetId as string;
    });
    const asset = next.assets.find((a) => a.id === assetId)!;
    expect(asset.pixelArt!.rows[15]).toBe('....rrrrrrrr....');
  });

  it('forgives the usual notation slips in a drawing', () => {
    const art = normalizePixelArt({
      palette: [
        { key: '.', color: '#000000' },
        { key: 'g', color: 'c9ced8' },
        { key: 'd', color: '#56f' },
        { key: 'x', color: 'transparent' },
        { key: 'a', color: '#11223300' },
        { key: 'b', color: '#112233ff' },
      ],
      rows: ['g d.', 'xabg'],
    });
    expect(art.palette).toEqual([
      { key: 'g', color: '#c9ced8' },
      { key: 'd', color: '#5566ff' },
      { key: 'b', color: '#112233' },
    ]);
    expect(art.rows).toEqual(['g.d.', '..bg']);
    expect(checkPixelArt(art)).toBeNull();
    // A space the palette colors stays a color.
    expect(normalizePixelArt({ palette: [{ key: ' ', color: '#ffffff' }], rows: [' .'] }).rows).toEqual([' .']);
  });

  it('rows of slightly different lengths are evened out to what most rows are (AIs miscount), so the drawing is kept', () => {
    const art = normalizePixelArt({ palette: [{ key: 'g', color: '#4fbf4f' }], rows: ['gggg', 'ggg', 'ggggg', 'gggg', '.gg.'] });
    expect(art.rows).toEqual(['gggg', 'ggg.', 'gggg', 'gggg', '.gg.']);
    expect(checkPixelArt(art)).toBeNull();
  });

  it('a new object always has a look: a placeholder box until it is drawn', () => {
    const next = produce(createProject(registry), (d) => {
      applyOperations(d, [{ op: 'create_definition', ref: 's', name: 'Spikes', description: 'Hurts', category: 'Environment', tags: ['hazard'], components: [{ component: 'Collider', propsJson: '{"size":{"x":64,"y":16},"isTrigger":true}' }, { component: 'Damage', propsJson: '{"amount":1}' }] }], registry);
    });
    const spikes = next.definitions.find((x) => x.name === 'Spikes')!;
    expect(spikes.components.Sprite).toMatchObject({ width: 64, height: 16, color: '#d9dde6', visible: true });
  });

  it('tile objects placed or moved by the AI land on whole cells (so they can be dragged on the grid)', () => {
    const project = createProject(registry);
    const sceneId = project.scenes[0].id;
    const stone = project.definitions.find((d) => d.name === 'Stone')!.id;
    const coin = project.definitions.find((d) => d.name === 'Coin')!.id;
    const next = produce(project, (d) => {
      applyOperations(d, [
        { op: 'place_instance', sceneId, definitionRef: stone, x: 100, y: -50, name: null, ref: 's' },
        { op: 'place_instance', sceneId, definitionRef: coin, x: 100, y: -50, name: null, ref: null },
      ], registry);
    });
    const [s, c] = next.scenes[0].entities;
    expect(s.transform.position).toEqual({ x: 112, y: -48 });
    expect(c.transform.position).toEqual({ x: 100, y: -50 }); // not a tile: where it was put
    const moved = produce(next, (d) => void applyOperations(d, [{ op: 'set_transform', entityId: s.id, x: 30, y: 70, rotation: null, scaleX: null, scaleY: null }], registry));
    expect(moved.scenes[0].entities[0].transform.position).toEqual({ x: 16, y: 80 });
  });
});

describe('animated sprites drawn by the AI', () => {
  const coin = (shift: number) => Array.from({ length: 16 }, (_, y) => Array.from({ length: 16 }, (_, x) => (Math.abs(x - 7.5) <= 7 - Math.abs(shift) && Math.abs(y - 7.5) <= 7 ? 'g' : '.')).join(''));
  const project = createProject(registry);
  const coinDef = project.definitions.find((d) => d.name === 'Coin')!;

  it('frames after rows make an animation (a sheet of frames that plays at fps), used as the look', () => {
    const p = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', target: 'definition', id: coinDef.id, name: 'Spinning coin', palette, rows: coin(0), frames: [coin(3), coin(6), coin(3)], fps: 10, situation: null }], registry));
    const asset = p.assets.find((a) => a.name === 'Spinning coin')!;
    expect(asset.kind).toBe('spritesheet');
    expect(asset.animation).toEqual({ frames: [1, 2, 3, 4], fps: 10 });
    expect(asset.grid).toMatchObject({ columns: 4, cellWidth: 16, cellHeight: 16 });
    expect(asset.pixelArt!.frames).toHaveLength(4);
    expect(p.definitions.find((d) => d.id === coinDef.id)!.components.Sprite.assetId).toBe(asset.id);
  });

  it('as a situation (a walk cycle while running)', () => {
    const player = project.definitions.find((d) => d.name === 'Player')!;
    const rows = Array.from({ length: 32 }, () => 'g'.repeat(28));
    const p = produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', target: 'definition', id: player.id, name: 'Run cycle', palette, rows, frames: [rows.map((r) => r.replace('g', 'd'))], fps: null, situation: 'run' }], registry));
    const asset = p.assets.find((a) => a.name === 'Run cycle')!;
    expect(asset.animation).toEqual({ frames: [1, 2], fps: 8 });
    expect(p.definitions.find((d) => d.id === player.id)!.components.SpriteStates.run).toBe(asset.id);
  });

  it('every frame must be the size of the first', () => {
    expect(() => produce(project, (d) => void applyOperations(d, [{ op: 'draw_sprite', target: 'definition', id: coinDef.id, name: 'Bad', palette, rows: coin(0), frames: [['gg', 'gg']], fps: 8, situation: null }], registry))).toThrow(/frame 2 is 2×2; every frame must be the size of the first \(16×16\)/);
  });

  it('a reply that leaves out fields that may be null (frames, fps) is still read', async () => {
    const { aiResponseSchema, fillMissingNulls } = await import('./ai/protocol');
    const reply = { kind: 'apply', message: 'ok', changes: [], operations: [{ op: 'draw_sprite', target: 'definition', id: coinDef.id, name: 'C', palette, rows: coin(0), situation: null }] };
    expect(aiResponseSchema.safeParse(reply).success).toBe(false);
    const filled = aiResponseSchema.safeParse(fillMissingNulls(reply));
    expect(filled.success).toBe(true);
    // A required field that is missing is still an error.
    const broken = { ...reply, operations: [{ op: 'draw_sprite', target: 'definition', id: coinDef.id, palette, rows: coin(0) }] };
    expect(aiResponseSchema.safeParse(fillMissingNulls(broken)).success).toBe(false);
  });
});
