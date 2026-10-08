/**
 * The starter objects of a top-down game (seen from above, like Zelda or
 * Rogue): a hero who walks in every direction (with looks for walking up,
 * down and sideways), stone walls, floor tiles under everything, a wandering
 * slime, and the usual items, door, switch, spikes, teleporter and goal,
 * drawn from above. Ordinary data built from the same generic components as
 * the platformer starters; the names match them (Player, Enemy, Door, Goal…)
 * so requests and rules read the same in both kinds of game.
 */
import type { ComponentRegistry } from '../components/registry';
import type { AssetRecord, ObjectDefinition } from '../types';
import { createAnimatedPixelArtAsset, createDefinition, createLeverAsset, createPixelArtAsset } from './factory';
import type { PixelArt } from './pixelArt';

const PLAYER_DOWN: PixelArt = {
  palette: [{ key: 'o', color: '#1b1430' }, { key: 'h', color: '#7a4a24' }, { key: 'H', color: '#a8692f' }, { key: 's', color: '#f2c39b' }, { key: 't', color: '#3f9e5a' }, { key: 'T', color: '#2c7a43' }, { key: 'b', color: '#8a5a2b' }, { key: 'f', color: '#4a3a2a' }],
  rows: [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohssssssho...',
    '...osossssoso...',
    '...osssssssso...',
    '....osssssso....',
    '...oottttttoo...',
    '..ottTttttTtto..',
    '..osttttttttso..',
    '..osTbbbbbbTso..',
    '...otttttttto...',
    '...oTTo..oTTo...',
    '...offo..offo...',
    '....oo....oo....',
  ],
};

const PLAYER_UP: PixelArt = {
  palette: [{ key: 'o', color: '#1b1430' }, { key: 'h', color: '#7a4a24' }, { key: 'H', color: '#a8692f' }, { key: 's', color: '#f2c39b' }, { key: 't', color: '#3f9e5a' }, { key: 'T', color: '#2c7a43' }, { key: 'b', color: '#8a5a2b' }, { key: 'f', color: '#4a3a2a' }],
  rows: [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '....ohhhhhho....',
    '...oottttttoo...',
    '..ottTttttTtto..',
    '..osttttttttso..',
    '..osTbbbbbbTso..',
    '...otttttttto...',
    '...oTTo..oTTo...',
    '...offo..offo...',
    '....oo....oo....',
  ],
};

const PLAYER_SIDE: PixelArt = {
  palette: [{ key: 'o', color: '#1b1430' }, { key: 'h', color: '#7a4a24' }, { key: 'H', color: '#a8692f' }, { key: 's', color: '#f2c39b' }, { key: 't', color: '#3f9e5a' }, { key: 'T', color: '#2c7a43' }, { key: 'b', color: '#8a5a2b' }, { key: 'f', color: '#4a3a2a' }],
  rows: [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohhhssssso...',
    '...ohhhsssoso...',
    '...ohhhsssssso..',
    '....ohssssso....',
    '....otttttto....',
    '...ottTtttTto...',
    '...otsttttsto...',
    '...otTbbbbTto...',
    '....otttttto....',
    '...oTTo.oTTo....',
    '..offo...offo...',
    '...oo.....oo....',
  ],
};

const WALL: PixelArt = {
  palette: [{ key: 'd', color: '#3d3f52' }, { key: 'm', color: '#6c6f86' }, { key: 'l', color: '#8e91a8' }, { key: 'k', color: '#2a2b3a' }],
  rows: [
    'llllllllllllllll',
    'mmmmmmmkmmmmmmmk',
    'mmmmmmmkmmmmmmmk',
    'mmmmmmmkmmmmmmmk',
    'dddddddkdddddddk',
    'kkkkkkkkkkkkkkkk',
    'mmmkmmmmmmmkmmmm',
    'mmmkmmmmmmmkmmmm',
    'mmmkmmmmmmmkmmmm',
    'dddkdddddddkdddd',
    'kkkkkkkkkkkkkkkk',
    'mmmmmmmkmmmmmmmk',
    'mmmmmmmkmmmmmmmk',
    'mmmmmmmkmmmmmmmk',
    'dddddddkdddddddk',
    'kkkkkkkkkkkkkkkk',
  ],
};

const FLOOR: PixelArt = {
  palette: [{ key: 'a', color: '#3a3550' }, { key: 'b', color: '#433d5c' }, { key: 'c', color: '#2f2b42' }],
  rows: [
    'bbbbbbbcbbbbbbbc',
    'baaaaaacbaaaaaac',
    'baaaaaacbaaaaaac',
    'baaabaacbaaaaaac',
    'baaaaaacbaaaaaac',
    'baaaaaacbaaabaac',
    'baaaaaacbaaaaaac',
    'cccccccccccccccc',
    'bbbbbbbcbbbbbbbc',
    'baaaaaacbaaaaaac',
    'baaaaaacbabaaaac',
    'baaaaaacbaaaaaac',
    'baabaaacbaaaaaac',
    'baaaaaacbaaaaaac',
    'baaaaaacbaaaaaac',
    'cccccccccccccccc',
  ],
};

const SLIME: PixelArt = {
  palette: [{ key: 'o', color: '#1b1430' }, { key: 'g', color: '#5fd068' }, { key: 'G', color: '#3ea84a' }, { key: 'l', color: '#a6f0aa' }, { key: 'w', color: '#ffffff' }],
  rows: [
    '................',
    '................',
    '.....oooooo.....',
    '...oolllgggoo...',
    '..ollggggggggo..',
    '..olgggggggggo..',
    '.oggwogggwoggGo.',
    '.oggwogggwoggGo.',
    '.ogggggggggggGo.',
    '.ogggggggggggGo.',
    '.oGgggggggggGGo.',
    '..oGGggggggGGo..',
    '..ooGGGGGGGGoo..',
    '....oooooooo....',
    '................',
    '................',
  ],
};

const FLOOR_SPIKES: PixelArt = {
  palette: [{ key: 'k', color: '#2a2b3a' }, { key: 'p', color: '#5b6070' }, { key: 'h', color: '#f4f6fa' }, { key: 'g', color: '#b9bfcc' }],
  rows: [
    'kkkkkkkkkkkkkkkk',
    'kppppppppppppppk',
    'kphpppphpppphppk',
    'kpgghppgghpgghpk',
    'kpggppggppggpppk',
    'kppppppppppppppk',
    'kpphpppphpppphpk',
    'kppgghppgghppggk',
    'kppggppggppggppk',
    'kppppppppppppppk',
    'kphpppphpppphppk',
    'kpgghppgghpgghpk',
    'kpggppggppggpppk',
    'kppppppppppppppk',
    'kppppppppppppppk',
    'kkkkkkkkkkkkkkkk',
  ],
};

const DOOR: PixelArt = {
  palette: [{ key: 'k', color: '#2a1a10' }, { key: 'w', color: '#9b6a3c' }, { key: 'W', color: '#7a522c' }, { key: 'l', color: '#c08850' }, { key: 'm', color: '#d9b45a' }],
  rows: [
    'kkkkkkkkkkkkkkkk',
    'klllllllllllllkk',
    'kwwwwkwwwwkwwwwk',
    'kwwwwkwwwwkwwwwk',
    'kWWWWkWWWWkWWWWk',
    'kwwwwkwwwwkwwwwk',
    'kwwwwkwwwwkwwwwk',
    'kwwwwkwwwwkwmmwk',
    'kwwwwkwwwwkwmmwk',
    'kwwwwkwwwwkwwwwk',
    'kWWWWkWWWWkWWWWk',
    'kwwwwkwwwwkwwwwk',
    'kwwwwkwwwwkwwwwk',
    'kwwwwkwwwwkwwwwk',
    'kWWWWkWWWWkWWWWk',
    'kkkkkkkkkkkkkkkk',
  ],
};

const PAD: PixelArt = {
  palette: [{ key: 'a', color: '#d9ccff' }, { key: 'b', color: '#9c7dff' }, { key: 'c', color: '#6b4be0' }, { key: 'o', color: '#2e2a5a' }],
  rows: [
    '................',
    '.....oooooo.....',
    '...ooccccccoo...',
    '..occbbbbbbcco..',
    '..ocbbbbbbbbco..',
    '.ocbbbaaaabbbco.',
    '.ocbbaaaaaabbco.',
    '.ocbbaaaaaabbco.',
    '.ocbbaaaaaabbco.',
    '.ocbbaaaaaabbco.',
    '.ocbbbaaaabbbco.',
    '..ocbbbbbbbbco..',
    '..occbbbbbbcco..',
    '...ooccccccoo...',
    '.....oooooo.....',
    '................',
  ],
};

const STAIRS: PixelArt = {
  palette: [{ key: 'k', color: '#1b1430' }, { key: 'a', color: '#8e91a8' }, { key: 'b', color: '#6c6f86' }, { key: 'c', color: '#4a4c60' }, { key: 'd', color: '#33354a' }, { key: 'e', color: '#22232f' }],
  rows: [
    'kkkkkkkkkkkkkkkk',
    'kaaaaaaaaaaaaaak',
    'kaaaaaaaaaaaaaak',
    'kkkkkkkkkkkkkkkk',
    'kbbbbbbbbbbbbbbk',
    'kbbbbbbbbbbbbbbk',
    'kkkkkkkkkkkkkkkk',
    'kccccccccccccckk',
    'kcccccccccccccck',
    'kkkkkkkkkkkkkkkk',
    'kddddddddddddddk',
    'kddddddddddddddk',
    'kkkkkkkkkkkkkkkk',
    'keeeeeeeeeeeeeek',
    'keeeeeeeeeeeeeek',
    'kkkkkkkkkkkkkkkk',
  ],
};

// A barrel seen from above (to push).
const BARREL: PixelArt = {
  palette: [{ key: 'k', color: '#2a1a10' }, { key: 'i', color: '#4b4f5c' }, { key: 'w', color: '#9b6a3c' }, { key: 'l', color: '#c08850' }, { key: 'd', color: '#7a522c' }],
  rows: [
    '.....kkkkkk.....',
    '...kkiiiiiikk...',
    '..kiiwwwwwwiik..',
    '.kiwwllllllwwik.',
    '.kiwlwwwwwwlwik.',
    'kiwlwwddddwwlwik',
    'kiwlwdwwwwdwlwik',
    'kiwlwdwwwwdwlwik',
    'kiwlwdwwwwdwlwik',
    'kiwlwdwwwwdwlwik',
    'kiwlwwddddwwlwik',
    '.kiwlwwwwwwlwik.',
    '.kiwwllllllwwik.',
    '..kiiwwwwwwiik..',
    '...kkiiiiiikk...',
    '.....kkkkkk.....',
  ],
};


/** Walk cycles: two frames each (one foot up, then the other; sideways, legs apart and together). */
const WALK_DOWN: string[][] = [
  [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohssssssho...',
    '...osossssoso...',
    '...osssssssso...',
    '....osssssso....',
    '...oottttttoo...',
    '..ottTttttTtto..',
    '..osttttttttso..',
    '..osTbbbbbbTso..',
    '...otttttttto...',
    '...oTTo..oTTo...',
    '...offo..oTTo...',
    '....oo....oo....',
  ],
  [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohssssssho...',
    '...osossssoso...',
    '...osssssssso...',
    '....osssssso....',
    '...oottttttoo...',
    '..ottTttttTtto..',
    '..osttttttttso..',
    '..osTbbbbbbTso..',
    '...otttttttto...',
    '...oTTo..oTTo...',
    '...oTTo..offo...',
    '....oo....oo....',
  ],
];

const WALK_UP: string[][] = [
  [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '....ohhhhhho....',
    '...oottttttoo...',
    '..ottTttttTtto..',
    '..osttttttttso..',
    '..osTbbbbbbTso..',
    '...otttttttto...',
    '...oTTo..oTTo...',
    '...offo..oTTo...',
    '....oo....oo....',
  ],
  [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '...ohhhhhhhho...',
    '....ohhhhhho....',
    '...oottttttoo...',
    '..ottTttttTtto..',
    '..osttttttttso..',
    '..osTbbbbbbTso..',
    '...otttttttto...',
    '...oTTo..oTTo...',
    '...oTTo..offo...',
    '....oo....oo....',
  ],
];

const WALK_SIDE: string[][] = [
  [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohhhssssso...',
    '...ohhhsssoso...',
    '...ohhhsssssso..',
    '....ohssssso....',
    '....otttttto....',
    '...ottTtttTto...',
    '...otsttttsto...',
    '...otTbbbbTto...',
    '....otttttto....',
    '...oTTo.oTTo....',
    '..offo...offo...',
    '...oo.....oo....',
  ],
  [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...oHhhhhhhHo...',
    '...ohhhhhhhho...',
    '...ohhhssssso...',
    '...ohhhsssoso...',
    '...ohhhsssssso..',
    '....ohssssso....',
    '....otttttto....',
    '...ottTtttTto...',
    '...otsttttsto...',
    '...otTbbbbTto...',
    '....otttttto....',
    '.....oTTTo......',
    '.....offfo......',
    '......ooo.......',
  ],
];

/** Images the top-down starter objects use. */
export interface TopDownStarterAssets {
  player: AssetRecord;
  /** Walking down, up and sideways: animations. */
  playerDown: AssetRecord;
  playerUp: AssetRecord;
  playerSide: AssetRecord;
  wall: AssetRecord;
  floor: AssetRecord;
  enemy: AssetRecord;
  hazard: AssetRecord;
  door: AssetRecord;
  teleporter: AssetRecord;
  goal: AssetRecord;
  lever: AssetRecord;
  barrel: AssetRecord;
}

export function createTopDownStarterAssets(): TopDownStarterAssets {
  return {
    player: createPixelArtAsset('Hero', PLAYER_DOWN),
    playerDown: createAnimatedPixelArtAsset('Hero walking down', PLAYER_DOWN.palette, WALK_DOWN, 6),
    playerUp: createAnimatedPixelArtAsset('Hero walking up', PLAYER_UP.palette, WALK_UP, 6),
    playerSide: createAnimatedPixelArtAsset('Hero walking sideways', PLAYER_SIDE.palette, WALK_SIDE, 6),
    wall: createPixelArtAsset('Stone wall', WALL),
    floor: createPixelArtAsset('Floor', FLOOR),
    enemy: createPixelArtAsset('Slime', SLIME),
    hazard: createPixelArtAsset('Floor spikes', FLOOR_SPIKES),
    door: createPixelArtAsset('Door (from above)', DOOR),
    teleporter: createPixelArtAsset('Teleporter pad', PAD),
    goal: createPixelArtAsset('Stairs', STAIRS),
    lever: createLeverAsset(),
    barrel: createPixelArtAsset('Barrel', BARREL),
  };
}

const CATEGORIES: Record<string, string> = {
  Player: 'Characters',
  Wall: 'Walls and floors',
  Floor: 'Walls and floors',
  Enemy: 'Enemies',
  Coin: 'Items',
  Key: 'Items',
  Door: 'Environment',
  Switch: 'Environment',
  Hazard: 'Environment',
  Teleporter: 'Environment',
  Goal: 'Environment',
  Barrel: 'Environment',
};
const TILES = new Set(['Wall', 'Floor', 'Hazard']);

export function createTopDownStarterDefinitions(registry: ComponentRegistry, assets: TopDownStarterAssets): ObjectDefinition[] {
  const c = (type: string, props: Record<string, unknown> = {}) => registry.createDefault(type, props);
  const defs = [
    createDefinition(
      'Player',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#3f9e5a', assetId: assets.player.id }),
        // A little smaller than a tile, so one-tile corridors and doorways are easy to walk through.
        Collider: c('Collider', { size: { x: 22, y: 24 }, matchSprite: false }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'dynamic', gravityScale: 0 }),
        CharacterController: c('CharacterController', { movement: 'topdown', speed: 150, acceleration: 1600 }),
        SpriteStates: c('SpriteStates', { up: assets.playerUp.id, down: assets.playerDown.id, run: assets.playerSide.id }),
        CameraTarget: c('CameraTarget'),
        Health: c('Health', { maxHealth: 3, currentHealth: 3 }),
        DamageReceiver: c('DamageReceiver'),
        Inventory: c('Inventory'),
      },
      ['player'],
      'The hero, seen from above: walks in every direction with the arrow keys or WASD (no jumping), with a walk cycle for each way.',
    ),
    createDefinition(
      'Wall',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#6c6f86', assetId: assets.wall.id }),
        Collider: c('Collider', { size: { x: 32, y: 32 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'static' }),
      },
      ['wall', 'solid'],
      'A stone wall tile. Draw rows and columns of them to make rooms and corridors.',
    ),
    createDefinition(
      'Floor',
      {
        // No collider: it is only a look, drawn under everything (layer -1).
        Sprite: c('Sprite', { width: 32, height: 32, color: '#3a3550', assetId: assets.floor.id, layer: -1 }),
      },
      ['floor'],
      'A floor tile: only a look, drawn under everything. Paint the inside of rooms with it.',
    ),
    createDefinition(
      'Enemy',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#5fd068', assetId: assets.enemy.id }),
        Collider: c('Collider', { size: { x: 24, y: 20 }, matchSprite: false }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'dynamic', gravityScale: 0 }),
        Wander: c('Wander', { speed: 45, interval: 1.8 }),
        Damage: c('Damage', { amount: 1 }),
      },
      ['enemy'],
      'A slime that wanders around and hurts on contact.',
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
        Sprite: c('Sprite', { width: 32, height: 32, color: '#9b6a3c', assetId: assets.door.id }),
        Collider: c('Collider', { size: { x: 32, y: 32 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'static' }),
        Openable: c('Openable'),
      },
      ['door'],
      'A door in a wall, seen from above: blocks the way until it is opened (by a switch, a key or a rule).',
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
        Sprite: c('Sprite', { width: 32, height: 32, color: '#b9bfcc', assetId: assets.hazard.id }),
        Collider: c('Collider', { size: { x: 28, y: 28 }, isTrigger: true, matchSprite: false }),
        Damage: c('Damage', { amount: 1 }),
      },
      ['hazard'],
      'Floor spikes, one tile: damage anything that walks over them.',
    ),
    createDefinition(
      'Teleporter',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#9c7dff', assetId: assets.teleporter.id }),
        Collider: c('Collider', { size: { x: 20, y: 20 }, isTrigger: true, matchSprite: false }),
      },
      ['teleporter'],
      'A teleporter pad. Connect two with "teleports to" (each way for a two-way pair): stepping on one puts the player on the other.',
    ),
    createDefinition(
      'Goal',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#8e91a8', assetId: assets.goal.id }),
        Collider: c('Collider', { size: { x: 20, y: 20 }, isTrigger: true, matchSprite: false }),
        Goal: c('Goal'),
      },
      ['goal'],
      'Stairs down: reaching them wins the level (play goes on to the next level).',
    ),
    createDefinition(
      'Barrel',
      {
        Sprite: c('Sprite', { width: 32, height: 32, color: '#9b6a3c', assetId: assets.barrel.id }),
        // A hair smaller than a tile, so it slides along corridors without catching on wall corners.
        Collider: c('Collider', { size: { x: 30, y: 30 }, matchSprite: false }),
        Pushable: c('Pushable', { step: 32 }),
      },
      ['barrel', 'pushable'],
      'A barrel the player can push, one tile per push (for puzzles); it blocks everything else like a wall.',
    ),
  ];
  for (const def of defs) {
    def.metadata.starter = def.name;
    def.metadata.category = CATEGORIES[def.name];
    if (TILES.has(def.name)) def.metadata.placement = 'tile';
  }
  return defs;
}
