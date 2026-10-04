import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { resolveEntity } from '../model/resolve';
import { projectFromFiles } from './serialize';
import { FORMAT_VERSION } from './version';

const registry = createBuiltinRegistry();

/** A project saved by the v1 editor: wide starter platform, no background settings, no assets. */
function v1Files() {
  const platform = {
    id: 'def_platform',
    name: 'Platform',
    description: 'Solid, static ground.',
    components: {
      Sprite: { assetId: null, width: 160, height: 24, color: '#6b7a8f', visible: true },
      Collider: { shape: 'box', size: { x: 160, y: 24 }, offset: { x: 0, y: 0 }, isTrigger: false },
      PhysicsBody: { bodyType: 'static', mass: 1, velocity: { x: 0, y: 0 }, gravityScale: 1, friction: 0.2 },
    },
    tags: ['platform'],
    metadata: {},
  };
  const entity = (id: string, x: number, y: number, components = {}) => ({
    id, name: 'Platform', definitionId: 'def_platform', transform: { position: { x, y }, rotation: 0, scale: { x: 1, y: 1 } },
    components, removedComponents: [], tags: [], metadata: {},
  });
  const scene = {
    id: 'scn_1', name: 'Level 1',
    world: { gravity: { x: 0, y: 980 }, backgroundColor: '#1d2330' },
    entities: [entity('ent_a', 96, 48), entity('ent_b', 400, 200, { Sprite: { color: '#ff0000' } })],
  };
  return {
    'project.json': {
      formatVersion: 1, id: 'prj_1', name: 'Old', settings: { gridSize: 16 }, startSceneId: 'scn_1',
      scenes: [{ id: 'scn_1', name: 'Level 1', file: 'scenes/scn_1.json' }],
      objects: [{ id: 'def_platform', name: 'Platform', file: 'objects/def_platform.json' }],
      assets: [],
    },
    'scenes/scn_1.json': scene,
    'objects/def_platform.json': platform,
  };
}

describe('format v1 -> v2', () => {
  it('turns the wide starter platform into square tiles, keeping each placed platform as a row', () => {
    const { project, warnings } = projectFromFiles(v1Files(), registry);
    expect(project.formatVersion).toBe(FORMAT_VERSION);
    expect(warnings).toEqual([]);
    const def = project.definitions.find((d) => d.name === 'Platform')!;
    expect(def.components.Sprite).toMatchObject({ width: 32, height: 32, color: '#5fa83f' });
    expect(def.metadata.placement).toBe('tile');

    const scene = project.scenes[0];
    const rowA = scene.entities.filter((e) => e.name.startsWith('Platform') && e.transform.position.y === 48);
    // 160px wide at x=96 spanned 16..176: five 32px tiles on the tile grid nearest that span (32..192).
    expect(rowA.map((e) => e.transform.position.x)).toEqual([48, 80, 112, 144, 176]);
    expect(rowA[0].id).toBe('ent_a');
    const rowB = scene.entities.filter((e) => e.transform.position.y === 208);
    expect(rowB).toHaveLength(5);
    // Color override survives; the old size override is gone.
    const r = resolveEntity(project, rowB[2], registry);
    expect(r.components.Sprite).toMatchObject({ color: '#ff0000', width: 32, height: 32 });
    expect(r.tile).toBe(true);
  });

  it('adds background settings and the new starter objects', () => {
    const { project } = projectFromFiles(v1Files(), registry);
    expect(project.scenes[0].world.background).toEqual({ imageAssetId: null, fit: 'cover', parallax: 0.3 });
    const ladder = project.definitions.find((d) => d.name === 'Ladder')!;
    expect(ladder.components.Climbable).toBeDefined();
    expect(project.assets.find((a) => a.id === ladder.components.Sprite.assetId)?.data).toMatch(/^data:image\/svg\+xml/);
    expect(project.definitions.some((d) => d.name === 'Stone')).toBe(true);
  });
});
