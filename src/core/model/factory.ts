import type { ComponentRegistry } from '../components/registry';
import { pixelArtToSvg, type PixelArt } from './pixelArt';
import { defaultCamera } from './camera';
import { generateId } from '../ids';
import { FORMAT_VERSION } from '../serialization/version';
import type { AssetRecord, ComponentMap, EntityInstance, GameType, ObjectDefinition, Project, Scene, Transform, Vec2 } from '../types';
import { createTopDownStarterAssets, createTopDownStarterDefinitions } from './topDownStarters';

export function createTransform(position: Vec2 = { x: 0, y: 0 }): Transform {
  return { position: { ...position }, rotation: 0, scale: { x: 1, y: 1 } };
}

export function createScene(name: string): Scene {
  return {
    id: generateId('scn'),
    name,
    world: { gravity: { x: 0, y: 980 }, backgroundColor: '#1d2330', background: { imageAssetId: null, fit: 'cover', parallax: 0.3 } },
    entities: [],
    relationships: [],
    rules: [],
    camera: defaultCamera(),
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
<rect x="14" y="20" width="4" height="4" fill="#6b6f7a"/><rect x="12" y="17" width="4" height="4" fill="#6b6f7a"/><rect x="10" y="14" width="4" height="4" fill="#6b6f7a"/><rect x="8" y="11" width="4" height="4" fill="#6b6f7a"/>
<rect x="4" y="5" width="7" height="7" fill="#e5534b"/><rect x="5" y="6" width="3" height="2" fill="#ff8f86"/>
<rect x="6" y="24" width="20" height="8" fill="#4b4f5c"/><rect x="6" y="24" width="20" height="2" fill="#7a7f8f"/>
</svg>`;

export function createLeverAsset(): AssetRecord {
  return createImageAsset('Lever', svgDataUrl(LEVER_SVG), 32, 32, 'svg');
}

/** Starter art: the player, a blue block with an ink outline and one eye on the side it faces (right; it is drawn mirrored going left). Pixel art, so the AI can draw variations of it. */
const PLAYER_ART: PixelArt = {
  palette: [{ key: 'o', color: '#0f1a33' }, { key: 'a', color: '#4fa3ff' }, { key: 'b', color: '#8cc6ff' }, { key: 'c', color: '#2f7dd6' }, { key: 'd', color: '#ffffff' }],
  rows: [
    '..oooooooooooooooooooooooo..',
    '..oooooooooooooooooooooooo..',
    'oobbbbbbbbbbbbbbbbbbbbbbbboo',
    'oobbbbbbbbbbbbbbbbbbbbbbbboo',
    'oobbbbbbbbbbbbbbbbbbbbbbbboo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaoooooaaaaaoo',
    'ooaaaaaaaaaaaaaaoddooaaaaaoo',
    'ooaaaaaaaaaaaaaaoddooaaaaaoo',
    'ooaaaaaaaaaaaaaaoooooaaaaaoo',
    'ooaaaaaaaaaaaaaaoooooaaaaaoo',
    'ooaaaaaaaaaaaaaaoooooaaaaaoo',
    'ooaaaaaaaaaaaaaaoooooaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccoo',
    '..oooooooooooooooooooooooo..',
    '..oooooooooooooooooooooooo..',
  ],
};

/** Starter art: the enemy, a red blob with a rounded top and two eyes. */
const ENEMY_ART: PixelArt = {
  palette: [{ key: 'o', color: '#0f1a33' }, { key: 'a', color: '#e5534b' }, { key: 'b', color: '#ff8a80' }, { key: 'c', color: '#b83a33' }, { key: 'd', color: '#ffffff' }],
  rows: [
    '......oooooooooooooooooo......',
    '......oooooooooooooooooo......',
    '..oooobbbbbbbbbbbbbbbbbboooo..',
    '..oooobbbbbbbbbbbbbbbbbboooo..',
    '..ooaaaaaaaaaaaaaaaaaaaaaaoo..',
    '..ooaaaaaaaaaaaaaaaaaaaaaaoo..',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaoooooaaaaoooooaaaaaaoo',
    'ooaaaaaaoddooaaaaoddooaaaaaaoo',
    'ooaaaaaaoddooaaaaoddooaaaaaaoo',
    'ooaaaaaaoooooaaaaoooooaaaaaaoo',
    'ooaaaaaaoooooaaaaoooooaaaaaaoo',
    'ooaaaaaaoooooaaaaoooooaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooaaaaaaaaaaaaaaaaaaaaaaaaaaoo',
    'ooccccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccccoo',
    'ooccccccccccccccccccccccccccoo',
    'oooooooooooooooooooooooooooooo',
    'oooooooooooooooooooooooooooooo',
  ],
};

/** A wooden crate (to push). */
const CRATE: PixelArt = {
  palette: [{ key: 'k', color: '#2a1a10' }, { key: 'w', color: '#b07a43' }, { key: 'd', color: '#7a522c' }, { key: 'l', color: '#d49a5c' }],
  rows: [
    'kkkkkkkkkkkkkkkk',
    'kllllllllllllllk',
    'kldddddddddddddk',
    'kldwwwwwwwwwwdlk',
    'kldwdwwwwwwdwdlk',
    'kldwwdwwwwdwwdlk',
    'kldwwwdwwdwwwdlk',
    'kldwwwwddwwwwdlk',
    'kldwwwwddwwwwdlk',
    'kldwwwdwwdwwwdlk',
    'kldwwdwwwwdwwdlk',
    'kldwdwwwwwwdwdlk',
    'kldwwwwwwwwwwdlk',
    'kldddddddddddddk',
    'kllllllllllllllk',
    'kkkkkkkkkkkkkkkk',
  ],
};

/** An image asset drawn from pixel art; it keeps the pixels, so they can be redrawn and varied later. */
/** The two-tile spikes drawing of format v8 (recognized when upgrading older games). */
export const SPIKES_ART_V8_ROWS: readonly string[] = [
  '...gg......gg......gg......gg...',
  '...gg......gg......gg......gg...',
  '..ghgg....ghgg....ghgg....ghgg..',
  '..ghgg....ghgg....ghgg....ghgg..',
  '.ghhggg..ghhggg..ghhggg..ghhggg.',
  '.ghhggg..ghhggg..ghhggg..ghhggg.',
  'ghhhggggghhhggggghhhggggghhhgggg',
  'dddddddddddddddddddddddddddddddd',
];

/** Spikes, one tile wide (two points), drawn for the starter Hazard. Rows of them line up seamlessly. */
const SPIKES_ART: PixelArt = {
  palette: [{ key: 'h', color: '#f4f6fa' }, { key: 'g', color: '#b9bfcc' }, { key: 'd', color: '#5b6070' }],
  rows: [
    '...gg......gg...',
    '...gg......gg...',
    '..ghgg....ghgg..',
    '..ghgg....ghgg..',
    '.ghhggg..ghhggg.',
    '.ghhggg..ghhggg.',
    'ghhhggggghhhgggg',
    'dddddddddddddddd',
  ],
};

/** A glowing teleporter pad (32×12). */
const TELEPORTER_ART: PixelArt = {
  palette: [{ key: 'a', color: '#d9ccff' }, { key: 'b', color: '#9c7dff' }, { key: 'c', color: '#6b4be0' }, { key: 'o', color: '#2e2a5a' }, { key: 'd', color: '#16132e' }],
  rows: [
    '.....cccccc.....',
    '...cbbbbbbbbc...',
    '..cbaaaaaaaabc..',
    '.cbaaaaaaaaaabc.',
    'oooooooooooooooo',
    'dddddddddddddddd',
  ],
};

/** A goal flag (32×32). */
const GOAL_ART: PixelArt = {
  palette: [{ key: 'p', color: '#e8e2d0' }, { key: 'f', color: '#ffcc33' }, { key: 'g', color: '#5b6070' }],
  rows: [
    '....pff.........',
    '....pffff.......',
    '....pfffffff....',
    '....pffffffff...',
    '....pfffffff....',
    '....pffff.......',
    '....pff.........',
    '....p...........',
    '....p...........',
    '....p...........',
    '....p...........',
    '....p...........',
    '....p...........',
    '....p...........',
    '...ggg..........',
    '..ggggg.........',
  ],
};

export function createTeleporterAsset(): AssetRecord {
  return createPixelArtAsset('Teleporter', TELEPORTER_ART);
}

export function createGoalAsset(): AssetRecord {
  return createPixelArtAsset('Goal', GOAL_ART);
}

export function createSpikesAsset(): AssetRecord {
  return createPixelArtAsset('Spikes', SPIKES_ART);
}

export function createPixelArtAsset(name: string, art: PixelArt): AssetRecord {
  const asset = createImageAsset(name, svgDataUrl(pixelArtToSvg(art)), art.rows[0].length, art.rows.length, 'svg');
  return { ...asset, pixelArt: { palette: art.palette.map((p) => ({ ...p })), rows: [...art.rows] } };
}

export function createPlayerAsset(): AssetRecord {
  return createPixelArtAsset('Player', PLAYER_ART);
}

export function createEnemyAsset(): AssetRecord {
  return createPixelArtAsset('Enemy', ENEMY_ART);
}

/** Images the starter objects use. */
export interface StarterAssets {
  ladder: AssetRecord;
  lever: AssetRecord;
  player: AssetRecord;
  enemy: AssetRecord;
  hazard: AssetRecord;
  teleporter: AssetRecord;
  goal: AssetRecord;
  crate: AssetRecord;
}

export function createStarterAssets(): StarterAssets {
  return { ladder: createLadderAsset(), lever: createLeverAsset(), player: createPlayerAsset(), enemy: createEnemyAsset(), hazard: createSpikesAsset(), teleporter: createTeleporterAsset(), goal: createGoalAsset(), crate: createPixelArtAsset('Crate', CRATE) };
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
  Teleporter: 'Environment',
  Goal: 'Environment',
  Crate: 'Environment',
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
        Sprite: c('Sprite', { width: 28, height: 32, color: '#4fa3ff', assetId: assets.player.id }),
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
        Sprite: c('Sprite', { width: 30, height: 30, color: '#e5534b', assetId: assets.enemy.id }),
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
        Sprite: c('Sprite', { width: 32, height: 16, color: '#ff6b2c', assetId: assets.hazard.id }),
        Collider: c('Collider', { size: { x: 32, y: 16 }, isTrigger: true }),
        Damage: c('Damage', { amount: 1 }),
      },
      ['hazard'],
      'Spikes, one tile wide: damages anything that touches it. Draw a row of them for longer spikes.',
    ),
    createDefinition(
      'Teleporter',
      {
        Sprite: c('Sprite', { width: 32, height: 12, color: '#9c7dff', assetId: assets.teleporter.id }),
        Collider: c('Collider', { size: { x: 32, y: 12 }, isTrigger: true }),
      },
      ['teleporter'],
      'A teleporter pad. Connect two with "teleports to" (each way for a two-way pair): stepping on one puts the player on the other.',
    ),
    createDefinition(
      'Goal',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#ffcc33', assetId: assets.goal.id }),
        Collider: c('Collider', { size: { x: 20, y: 32 }, isTrigger: true, matchSprite: false }),
        Goal: c('Goal'),
      },
      ['goal'],
      'The level goal: reaching it wins the level (play goes on to the next level).',
    ),
    createDefinition(
      'Crate',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#b07a43', assetId: assets.crate.id }),
        Collider: c('Collider', { size: { x: 32, y: 32 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'dynamic' }),
        Pushable: c('Pushable'),
      },
      ['crate', 'pushable'],
      'A crate the player can push sideways (it falls off ledges); stand on it to reach higher.',
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
export function createProject(registry: ComponentRegistry, name = 'Untitled Game', gameType: GameType = 'platformer'): Project {
  const scene = createScene('Level 1');
  if (gameType === 'topdown') {
    // Seen from above: nothing falls, and the space between rooms is dark.
    scene.world.gravity = { x: 0, y: 0 };
    scene.world.backgroundColor = '#16131f';
    const assets = createTopDownStarterAssets();
    return {
      formatVersion: FORMAT_VERSION,
      id: generateId('prj'),
      name,
      settings: { gridSize: 16, gameType },
      startSceneId: scene.id,
      scenes: [scene],
      definitions: createTopDownStarterDefinitions(registry, assets),
      assets: Object.values(assets),
    };
  }
  const assets = createStarterAssets();
  return {
    formatVersion: FORMAT_VERSION,
    id: generateId('prj'),
    name,
    settings: { gridSize: 16, gameType },
    startSceneId: scene.id,
    scenes: [scene],
    definitions: createStarterDefinitions(registry, assets),
    assets: [assets.ladder, assets.lever, assets.player, assets.enemy, assets.hazard, assets.teleporter, assets.goal, assets.crate],
  };
}
