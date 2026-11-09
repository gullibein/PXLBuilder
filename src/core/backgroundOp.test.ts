import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations, type ApplyResult, type Operation } from './commands/operations';
import { createBuiltinRegistry } from './components/builtin';
import { createProject } from './model/factory';
import { projectFromBundle, projectToBundle } from './serialization/serialize';
import { drawBackground } from '../render/renderer';

const registry = createBuiltinRegistry();

describe('generate_background: the AI asks the image generator for the backdrop', () => {
  it('is handed to the editor to make (the generator takes a while), changing nothing in the game itself', () => {
    const project = createProject(registry);
    const sceneId = project.scenes[0].id;
    let result: ApplyResult | null = null;
    const after = produce(project, (d) => void (result = applyOperations(d, [{ op: 'generate_background', sceneId, prompt: 'rolling hills under a summer sky', size: 'screen', parallax: null } as Operation], registry)));
    expect(result!.backgroundRequests).toEqual([{ sceneId, prompt: 'rolling hills under a summer sky', size: 'screen', parallax: null }]);
    expect(after).toBe(project);
    // A level that isn't there: refused.
    expect(() => produce(project, (d) => void applyOperations(d, [{ op: 'generate_background', sceneId: 'nope', prompt: 'x', size: null, parallax: null } as Operation], registry))).toThrow();
  });

  it('a custom size needs a width and height; it is handed on with them', () => {
    const project = createProject(registry);
    const sceneId = project.scenes[0].id;
    let result: ApplyResult | null = null;
    produce(project, (d) => void (result = applyOperations(d, [{ op: 'generate_background', sceneId, prompt: 'a wide panorama', size: 'custom', customSize: { width: 640, height: 160 }, parallax: 0.3 } as Operation], registry)));
    expect(result!.backgroundRequests![0]).toMatchObject({ size: 'custom', width: 640, height: 160, parallax: 0.3 });
    expect(() => produce(project, (d) => void applyOperations(d, [{ op: 'generate_background', sceneId, prompt: 'x', size: 'custom', parallax: null } as Operation], registry))).toThrow(/customSize/);
  });
});

describe('a background that fades between two colors', () => {
  it('set_background gradient: top and bottom colors, smooth or in bands; removeGradient goes back to the plain color; kept when saved', () => {
    const project = createProject(registry);
    const sceneId = project.scenes[0].id;
    const sky = produce(project, (d) => void applyOperations(d, [{ op: 'set_background', sceneId, color: null, fit: null, parallax: null, parallaxY: null, removeImage: false, scroll: null, stars: null, gradient: { top: '#8fd3ff', bottom: '#0b1d4a', bands: 0 } } as Operation], registry));
    expect(sky.scenes[0].world.background.gradient).toEqual({ top: '#8fd3ff', bottom: '#0b1d4a' });
    const banded = produce(sky, (d) => void applyOperations(d, [{ op: 'set_background', sceneId, color: null, fit: null, parallax: null, parallaxY: null, removeImage: false, scroll: null, stars: null, gradient: { top: '#8fd3ff', bottom: '#0b1d4a', bands: 6 } } as Operation], registry));
    expect(banded.scenes[0].world.background.gradient?.bands).toBe(6);
    const loaded = projectFromBundle(JSON.parse(JSON.stringify(projectToBundle(banded))), registry).project;
    expect(loaded.scenes[0].world.background.gradient).toEqual({ top: '#8fd3ff', bottom: '#0b1d4a', bands: 6 });
    const plain = produce(banded, (d) => void applyOperations(d, [{ op: 'set_background', sceneId, color: null, fit: null, parallax: null, parallaxY: null, removeImage: false, scroll: null, stars: null, removeGradient: true } as Operation], registry));
    expect(plain.scenes[0].world.background.gradient).toBeNull();
    expect(() => produce(project, (d) => void applyOperations(d, [{ op: 'set_background', sceneId, color: null, fit: null, parallax: null, parallaxY: null, removeImage: false, scroll: null, stars: null, gradient: { top: 'blue', bottom: '#000000', bands: 0 } } as Operation], registry))).toThrow(/two colors/);
  });

  it('is drawn over the screen: smooth, or in even bands from the top color to the bottom one', () => {
    const fills: { style: unknown; y: number; h: number }[] = [];
    let style: unknown = null;
    const ctx = {
      setTransform() {},
      fillRect: (_x: number, y: number, _w: number, h: number) => fills.push({ style, y, h }),
      createLinearGradient: () => ({ addColorStop() {} }),
      set fillStyle(v: unknown) {
        style = v;
      },
    } as unknown as CanvasRenderingContext2D;
    const world = { backgroundColor: '#000000', background: { imageAssetId: null, fit: 'cover', parallax: 0, gradient: { top: '#ffffff', bottom: '#000000', bands: 3 } } } as never;
    drawBackground(ctx, { width: 100, height: 90 }, 1, world, { x: 0, y: 0, zoom: 1 });
    // (The plain color first, then the three bands: white, grey, black.)
    expect(fills.slice(1).map((f) => [f.style, f.y, f.h])).toEqual([
      ['#ffffff', 0, 30],
      ['#808080', 30, 30],
      ['#000000', 60, 30],
    ]);
  });
});

describe('paint_background: the AI paints the backdrop itself (where the image generator cannot be used)', () => {
  const sky = Array.from({ length: 27 }, (_, y) => (y < 14 ? 's' : y < 20 ? 'm' : 'g').repeat(48));
  const paint = (rows: string[], palette = [{ key: 's', color: '#8fd3ff' }, { key: 'm', color: '#5a6fa8' }, { key: 'g', color: '#3f9b4a' }]) =>
    ({ op: 'paint_background', sceneId: '', name: 'Summer hills', palette, rows, parallax: 0.2 }) as unknown as Operation;

  it('becomes the level background: a pixel-art picture filling the screen height, repeating sideways', () => {
    const project = createProject(registry);
    const sceneId = project.scenes[0].id;
    const after = produce(project, (d) => void applyOperations(d, [{ ...paint(sky), sceneId } as Operation], registry));
    const bg = after.scenes[0].world.background;
    const asset = after.assets.find((a) => a.id === bg.imageAssetId)!;
    expect(asset.name).toBe('Summer hills');
    expect([asset.width, asset.height]).toEqual([48, 27]);
    expect(asset.pixelArt!.rows).toHaveLength(27);
    expect(bg).toMatchObject({ fit: 'cover', parallax: 0.2 });
  });

  it('refuses a picture too small or too big, or with colors it does not list, saying why', () => {
    const project = createProject(registry);
    const sceneId = project.scenes[0].id;
    const run = (op: Operation) => () => produce(project, (d) => void applyOperations(d, [{ ...op, sceneId } as Operation], registry));
    expect(run(paint(['ss', 'ss']))).toThrow(/16-160 wide/);
    expect(run(paint(Array(120).fill('s'.repeat(48))))).toThrow(/9-100 tall/);
    expect(run(paint(sky.map((r, i) => (i === 0 ? 'x' + r.slice(1) : r))))).toThrow(/"x"/);
  });
});
