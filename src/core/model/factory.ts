import type { ComponentRegistry } from '../components/registry';
import { generateId } from '../ids';
import { FORMAT_VERSION } from '../serialization/version';
import type { AssetRecord, ComponentMap, EntityInstance, ObjectDefinition, Project, Scene, Transform, Vec2 } from '../types';

export function createTransform(position: Vec2 = { x: 0, y: 0 }): Transform {
  return { position: { ...position }, rotation: 0, scale: { x: 1, y: 1 } };
}

export function createScene(name: string): Scene {
  return {
    id: generateId('scn'),
    name,
    world: { gravity: { x: 0, y: 980 }, backgroundColor: '#8ecdf2', background: { imageAssetId: null, fit: 'cover', parallax: 0.3 } },
    entities: [],
    relationships: [],
    rules: [],
  };
}

export function createDefinition(name: string, components: ComponentMap = {}, tags: string[] = [], description = ''): ObjectDefinition {
  return { id: generateId('def'), name, description, components, tags, metadata: {} };
}

/** Creates a scene instance of a definition. The instance starts with no overrides. */
export function instantiateDefinition(def: ObjectDefinition, position: Vec2, name = def.name): EntityInstance {
  return {
    id: generateId('ent'),
    name,
    definitionId: def.id,
    transform: createTransform(position),
    components: {},
    removedComponents: [],
    tags: [],
    metadata: {},
  };
}

/** Creates an entity that is not linked to any definition. */
export function createStandaloneEntity(name: string, position: Vec2, components: ComponentMap = {}): EntityInstance {
  return {
    id: generateId('ent'),
    name,
    definitionId: null,
    transform: createTransform(position),
    components,
    removedComponents: [],
    tags: [],
    metadata: {},
  };
}

/** Starter art: a 32x32 ladder segment. Its rails meet the next segment's, so stacked ladders read as one. */
const LADDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">
<rect x="5" y="0" width="4" height="32" fill="#8a5a2b"/><rect x="23" y="0" width="4" height="32" fill="#8a5a2b"/>
<rect x="6" y="0" width="1" height="32" fill="#b07a42"/><rect x="24" y="0" width="1" height="32" fill="#b07a42"/>
<rect x="9" y="5" width="14" height="3" fill="#a46c36"/><rect x="9" y="21" width="14" height="3" fill="#a46c36"/>
<rect x="9" y="5" width="14" height="1" fill="#c8945a"/><rect x="9" y="21" width="14" height="1" fill="#c8945a"/>
</svg>`;

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg.replace(/\n/g, ''))}`;
}

export function createImageAsset(name: string, data: string, width: number, height: number, extension: string): AssetRecord {
  const id = generateId('ast');
  return { id, name, kind: 'image', path: `assets/${id}.${extension}`, data, width, height };
}

export function createLadderAsset(): AssetRecord {
  return createImageAsset('Ladder', svgDataUrl(LADDER_SVG), 32, 32, 'svg');
}

/** Starter art: a floor lever, handle leaning left. Drawn mirrored while the switch is on. */
const LEVER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges">
<rect x="14" y="10" width="3" height="3" fill="#6b6f7a"/><rect x="12" y="13" width="3" height="3" fill="#6b6f7a"/><rect x="10" y="16" width="3" height="3" fill="#6b6f7a"/>
<rect x="15" y="19" width="3" height="5" fill="#6b6f7a"/>
<rect x="11" y="6" width="5" height="5" fill="#e5534b"/><rect x="12" y="7" width="2" height="2" fill="#ff8f86"/>
<rect x="6" y="24" width="20" height="8" fill="#4b4f5c"/><rect x="6" y="24" width="20" height="2" fill="#7a7f8f"/>
</svg>`;

export function createLeverAsset(): AssetRecord {
  return createImageAsset('Lever', svgDataUrl(LEVER_SVG), 32, 32, 'svg');
}

/** Images the starter objects use. */
export interface StarterAssets {
  ladder: AssetRecord;
  lever: AssetRecord;
}

export function createStarterAssets(): StarterAssets {
  return { ladder: createLadderAsset(), lever: createLeverAsset() };
}

/** Library categories of the starter objects. */
const STARTER_CATEGORIES: Record<string, string> = {
  Player: 'Characters',
  Platform: 'Platforms',
  Stone: 'Platforms',
  Ladder: 'Environment',
  Enemy: 'Enemies',
  Coin: 'Items',
  Key: 'Items',
  Door: 'Environment',
  Switch: 'Environment',
  Hazard: 'Environment',
};
const STARTER_TILES = new Set(['Platform', 'Stone', 'Ladder']);

/**
 * Starter object definitions. These are ordinary data built from generic
 * components; the engine has no special knowledge of "Player" or "Enemy".
 * Platform, Stone and Ladder are 32x32 tiles: draw rows and columns of them.
 */
export function createStarterDefinitions(registry: ComponentRegistry, assets: StarterAssets): ObjectDefinition[] {
  const c = (type: string, props: Record<string, unknown> = {}) => registry.createDefault(type, props);
  const tile = (color: string) => ({
    Sprite: c('Sprite', { width: 32, height: 32, color }),
    Collider: c('Collider', { size: { x: 32, y: 32 } }),
    PhysicsBody: c('PhysicsBody', { bodyType: 'static' }),
  });
  const defs = [
    createDefinition(
      'Player',
      {
        // As tall as a tile, so one-row-high steps and ladders line up.
        Sprite: c('Sprite', { width: 28, height: 32, color: '#4fa3ff' }),
        Collider: c('Collider', { size: { x: 28, y: 32 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'dynamic' }),
        CharacterController: c('CharacterController'),
        CameraTarget: c('CameraTarget'),
        Health: c('Health', { maxHealth: 3, currentHealth: 3 }),
        DamageReceiver: c('DamageReceiver'),
        Inventory: c('Inventory'),
      },
      ['player'],
      'The player-controlled character.',
    ),
    createDefinition('Platform', tile('#5fa83f'), ['platform', 'ground'], 'A square ground tile. Draw rows of them to build platforms.'),
    createDefinition('Stone', tile('#8a8f9c'), ['platform', 'stone'], 'A square stone tile for walls, ledges and floors.'),
    createDefinition(
      'Ladder',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#a0703f', assetId: assets.ladder.id }),
        Collider: c('Collider', { size: { x: 20, y: 32 }, isTrigger: true, matchSprite: false }),
        Climbable: c('Climbable'),
      },
      ['ladder', 'climbable'],
      'A ladder segment. Draw a column of them to make a ladder of any height.',
    ),
    createDefinition(
      'Enemy',
      {
        Sprite: c('Sprite', { width: 30, height: 30, color: '#e5534b' }),
        Collider: c('Collider', { size: { x: 30, y: 30 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'dynamic' }),
        Damage: c('Damage', { amount: 1 }),
      },
      ['enemy'],
      'A basic enemy that hurts on contact.',
    ),
    createDefinition(
      'Coin',
      {
        Sprite: c('Sprite', { width: 16, height: 16, color: '#f2c94c' }),
        Collider: c('Collider', { shape: 'circle', size: { x: 16, y: 16 }, isTrigger: true }),
        Collectible: c('Collectible', { collectionBehavior: 'addToInventory', itemId: 'coin' }),
      },
      ['collectible'],
      'A collectible coin.',
    ),
    createDefinition(
      'Key',
      {
        Sprite: c('Sprite', { width: 20, height: 12, color: '#f0b429' }),
        Collider: c('Collider', { size: { x: 20, y: 12 }, isTrigger: true }),
        Collectible: c('Collectible', { collectionBehavior: 'addToInventory', itemId: 'key' }),
      },
      ['collectible', 'key'],
      'A key to pick up. Doors can require it.',
    ),
    createDefinition(
      'Door',
      {
        Sprite: c('Sprite', { width: 32, height: 64, color: '#9b6a3c' }),
        Collider: c('Collider', { size: { x: 32, y: 64 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'static' }),
        Openable: c('Openable'),
      },
      ['door'],
      'A door that blocks the way until it is opened (by a switch, a key or a rule).',
    ),
    createDefinition(
      'Switch',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#6b6f7a', assetId: assets.lever.id }),
        Collider: c('Collider', { size: { x: 24, y: 32 }, isTrigger: true, matchSprite: false }),
        Switch: c('Switch'),
      },
      ['switch'],
      'A lever. Press E next to it to flip it. Make it control a door.',
    ),
    createDefinition(
      'Hazard',
      {
        Sprite: c('Sprite', { width: 64, height: 16, color: '#ff6b2c' }),
        Collider: c('Collider', { size: { x: 64, y: 16 }, isTrigger: true }),
        Damage: c('Damage', { amount: 1 }),
      },
      ['hazard'],
      'Damages anything that touches it.',
    ),
  ];
  for (const def of defs) {
    // Remembers which starter this is, so it can be reset even after being renamed.
    def.metadata.starter = def.name;
    def.metadata.category = STARTER_CATEGORIES[def.name];
    if (STARTER_TILES.has(def.name)) def.metadata.placement = 'tile';
  }
  return defs;
}

/** A new, empty project with starter definitions and one empty scene. */
export function createProject(registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const scene = createScene('Level 1');
  const assets = createStarterAssets();
  return {
    formatVersion: FORMAT_VERSION,
    id: generateId('prj'),
    name,
    settings: { gridSize: 16 },
    startSceneId: scene.id,
    scenes: [scene],
    definitions: createStarterDefinitions(registry, assets),
    assets: [assets.ladder, assets.lever],
  };
}
