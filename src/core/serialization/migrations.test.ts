import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { resolveEntity } from '../model/resolve';
import { createProject } from '../model/factory';
import { projectFromFiles, projectToFiles } from './serialize';
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
    // Old levels keep how they played: no camera limits, normal zoom (format v6).
    expect(project.scenes[0].camera).toEqual({ zoom: 1, lookAhead: 0, deadZone: { x: 0, y: 0 }, bounds: 'none', customBounds: null, fixedAt: null });
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

describe('format v2 -> v3', () => {
  /** A v2 save: the starter Player was 28x40 with jumpForce 450, ladders had climbSpeed. */
  function v2Files(playerTweaked = false) {
    const files = projectToFiles(createProject(registry)) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    files['project.json'].formatVersion = 2;
    for (const [path, def] of Object.entries(files)) {
      if (!path.startsWith('objects/')) continue;
      if (def.name === 'Player') {
        def.components.Sprite.height = 40;
        def.components.Collider.size = { x: 28, y: 40 };
        def.components.CharacterController.jumpForce = playerTweaked ? 600 : 450;
      }
      if (def.name === 'Ladder') def.components.Climbable = { climbSpeed: 120 };
    }
    return files;
  }

  it('makes the starter player one tile tall with a one-row jump, and drops climbSpeed', () => {
    const { project, warnings } = projectFromFiles(v2Files(), registry);
    expect(warnings).toEqual([]);
    const player = project.definitions.find((d) => d.name === 'Player')!;
    expect(player.components.Sprite).toMatchObject({ width: 28, height: 32 });
    expect(player.components.Collider.size).toEqual({ x: 28, y: 32 });
    expect(player.components.CharacterController.jumpForce).toBe(350); // 295 from v3, raised to 350 in v8
    expect(project.definitions.find((d) => d.name === 'Ladder')!.components.Climbable).toEqual({});
  });

  it('keeps values the user changed', () => {
    const { project } = projectFromFiles(v2Files(true), registry);
    expect(project.definitions.find((d) => d.name === 'Player')!.components.CharacterController.jumpForce).toBe(600);
  });

  it('v6 -> v7: the starter Player and Enemy get eyes, unless they were already restyled', async () => {
    const { migrateProject } = await import('./migrations');
    const def = (name: string, sprite: Record<string, unknown>) => ({ id: `def_${name}`, name, description: '', tags: [], metadata: {}, components: { Sprite: { width: 30, height: 30, frame: 1, assetId: null, ...sprite } } });
    const raw = {
      formatVersion: 6,
      assets: [],
      scenes: [],
      definitions: [def('Player', { color: '#4fa3ff' }), def('Enemy', { color: '#00ff00' })],
    };
    const out = migrateProject(raw) as { assets: { id: string; name: string }[]; definitions: { name: string; components: { Sprite: { assetId: string | null } } }[] };
    const player = out.definitions.find((d) => d.name === 'Player')!;
    expect(out.assets.find((a) => a.id === player.components.Sprite.assetId)?.name).toBe('Player');
    // A recolored enemy keeps its own look.
    expect(out.definitions.find((d) => d.name === 'Enemy')!.components.Sprite.assetId).toBeNull();
    expect(out.assets).toHaveLength(1);
  });

  it('v7 -> v8: the starter Player jumps with 350 and the starter Hazard looks like spikes, unless changed', async () => {
    const { migrateProject } = await import('./migrations');
    const raw = (jumpForce: number, color: string) => ({
      formatVersion: 7,
      assets: [],
      scenes: [],
      definitions: [
        { id: 'def_p', name: 'Player', description: '', tags: [], metadata: { starter: 'Player' }, components: { CharacterController: { speed: 200, acceleration: 1600, jumpForce, airControl: 0.8 } } },
        { id: 'def_h', name: 'Hazard', description: '', tags: [], metadata: { starter: 'Hazard' }, components: { Sprite: { width: 64, height: 16, frame: 1, assetId: null, color } } },
      ],
    });
    type Out = { assets: { id: string; name: string }[]; definitions: { name: string; components: Record<string, Record<string, unknown>> }[] };
    const out = migrateProject(raw(295, '#ff6b2c')) as Out;
    expect(out.definitions[0].components.CharacterController.jumpForce).toBe(350);
    expect(out.assets.find((a) => a.id === out.definitions[1].components.Sprite.assetId)?.name).toBe('Spikes');
    const kept = migrateProject(raw(420, '#00ff00')) as Out;
    expect(kept.definitions[0].components.CharacterController.jumpForce).toBe(420);
    expect(kept.definitions[1].components.Sprite.assetId).toBeNull();
  });

  it('v8 -> v9: the starter Hazard becomes one tile wide; placed copies become two, covering the same ground', async () => {
    const { migrateProject } = await import('./migrations');
    const { SPIKES_ART_V8_ROWS } = await import('../model/factory');
    const entity = (id: string, x: number, components = {}) => ({ id, name: 'Hazard', definitionId: 'def_h', transform: { position: { x, y: 24 }, rotation: 0, scale: { x: 1, y: 1 } }, components, removedComponents: [], tags: [] });
    const raw = {
      formatVersion: 8,
      assets: [{ id: 'ast_old', name: 'Spikes', kind: 'image', data: '', width: 32, height: 8, pixelArt: { palette: [], rows: [...SPIKES_ART_V8_ROWS] } }],
      scenes: [{ id: 'scn', name: 'Level 1', entities: [entity('ent_a', 64), entity('ent_b', 200, { Sprite: { width: 64 } })], relationships: [], rules: [] }],
      definitions: [{ id: 'def_h', name: 'Hazard', description: '', tags: ['hazard'], metadata: { starter: 'Hazard' }, components: { Sprite: { width: 64, height: 16, frame: 1, assetId: 'ast_old', color: '#ff6b2c' }, Collider: { size: { x: 64, y: 16 }, isTrigger: true } } }],
    };
    type E = { id: string; transform: { position: { x: number } } };
    const out = migrateProject(raw) as unknown as { assets: { id: string; pixelArt?: { rows: string[] } }[]; scenes: { entities: E[] }[]; definitions: { components: Record<string, Record<string, unknown>> }[] };
    const hazard = out.definitions[0].components;
    expect(hazard.Sprite).toMatchObject({ width: 32, height: 16 });
    expect(hazard.Collider.size).toEqual({ x: 32, y: 16 });
    expect(out.assets.find((a) => a.id === hazard.Sprite.assetId)!.pixelArt!.rows[0]).toHaveLength(16);
    const xs = out.scenes[0].entities.map((e) => [e.id === 'ent_a' ? 'a' : e.id === 'ent_b' ? 'b' : 'new', e.transform.position.x]);
    expect(xs).toEqual([['a', 48], ['new', 80], ['b', 200]]); // a copy with its own size is left alone
  });
});
