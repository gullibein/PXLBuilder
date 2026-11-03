/**
 * The Isometric starter: a top-down game seen at an angle (the level's view "iso"): an island of grass blocks in
 * the water, a dirt path, ruins of cobblestone, wooden crates, a lava pool with magma round it, coins, a wandering
 * enemy and a goal. It plays exactly as a top-down game (the arrow keys go the way they point on the screen); every
 * block is an ordinary object (its Sprite's isoLook says how it stands: a floor block or a wall block).
 */
import type { ComponentRegistry } from '../components/registry';
import type { ObjectDefinition, Project } from '../types';
import { createDefinition, createPixelArtAsset, createProject, instantiateDefinition } from './factory';
import { defaultCamera } from './camera';
import { ISO_TILES } from './isoTiles';
import * as m from './mutations';
import type { PixelArt } from './pixelArt';

const art = (palette: Record<string, string>, rows: string[]): PixelArt => ({ palette: Object.entries(palette).map(([key, color]) => ({ key, color })), rows });

/** A coin standing on its edge, in the blocks' pixel size (16 × 16 for a whole square; the coin in its middle). */
const COIN = art({ o: '#3a2a08', y: '#ffd166', Y: '#fff2a8', d: '#c8902a' }, [
  '................',
  '................',
  '................',
  '................',
  '................',
  '......oooo......',
  '.....oyyyyo.....',
  '....oyYYyydo....',
  '....oyYyyydo....',
  '....oyYyyydo....',
  '....oyyyyddo....',
  '.....oyyddo.....',
  '......oooo......',
  '................',
  '................',
  '................',
]);

/** The goal: a flag on a pole in a stone base. */
const FLAG = art({ o: '#1a1420', w: '#d8d2c8', r: '#e8344a', R: '#ff7a8a', g: '#8a8f9e', G: '#b8bcc8' }, [
  '.....oo.........',
  '.....owoooooo...',
  '.....owRrrrrro..',
  '.....owRrrrrrro.',
  '.....owrrrrrrro.',
  '.....owrrrrrro..',
  '.....owoooooo...',
  '.....ow.........',
  '.....ow.........',
  '.....ow.........',
  '.....ow.........',
  '.....ow.........',
  '...ooowooo......',
  '..oGGGGGGGo.....',
  '..ogggggggo.....',
  '...ooooooo......',
]);

/** Blocks that are floors (walked on), walls (in the way, one block high), water (in the way, at floor height). */
const FLOORS = ['Grass', 'Dirt', 'Snow'];
const WALLS = ['Cobblestone', 'Wood', 'Dark Stone', 'Light Stone', 'Ice'];
const WATER = ['Water'];
/**
 * Auto-tiled blocks (Sprite.isoAuto) and the pictures each holds besides its own (Sprite.isoPictures, in that
 * order): the dirt road turns where it bends and mixes in its variation; grass rounds off into the water at its
 * corners and mixes in the dark grass; water has shore corners where land is on two sides.
 */
const AUTO: Record<string, { kind: 'road' | 'land' | 'water'; pictures: string[] }> = {
  Dirt: { kind: 'road', pictures: ['Dark Dirt', 'Road Turn SE-SW', 'Road Turn SE-NE', 'Road Turn NW-NE', 'Road Turn NW-SW'] },
  Grass: { kind: 'land', pictures: ['Island Corner North', 'Island Corner East', 'Island Corner South', 'Island Corner West', 'Dark Grass'] },
  Water: { kind: 'water', pictures: ['Water Corner North', 'Water Corner East', 'Water Corner South', 'Water Corner West'] },
};

/** A road through these corners (squares; each leg straight along the level's x or y): its squares. */
function windingRoad(corners: [number, number][]): Set<string> {
  const out = new Set<string>([corners[0].join(',')]);
  for (let n = 1; n < corners.length; n++) {
    const [x1, y1] = corners[n];
    let [x, y] = corners[n - 1];
    while (x !== x1 || y !== y1) {
      if (x !== x1) x += Math.sign(x1 - x);
      else y += Math.sign(y1 - y);
      out.add(`${x},${y}`);
    }
  }
  return out;
}

export function createIsometricProject(registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const project = createProject(registry, name, 'topdown');
  const c = (type: string, props: Record<string, unknown> = {}) => registry.createDefault(type, props);
  const block = (n: string, look: 'iso_floor' | 'iso_block', extra: Record<string, Record<string, unknown>>, tags: string[], description: string, picture = n): ObjectDefinition => {
    const asset = createPixelArtAsset(picture, ISO_TILES[picture]);
    project.assets.push(asset);
    const auto = AUTO[n];
    const pictures = (auto?.pictures ?? []).map((p) => {
      const a = createPixelArtAsset(p, ISO_TILES[p]);
      project.assets.push(a);
      return a.id;
    });
    const look2 = auto ? { isoAuto: auto.kind, isoPictures: pictures } : {};
    const d = createDefinition(n, { Sprite: c('Sprite', { width: 32, height: 32, assetId: asset.id, isoLook: look, ...look2 }), ...extra }, tags, description);
    d.metadata.category = 'Isometric';
    d.metadata.placement = 'tile';
    return d;
  };
  const solid = () => ({ Collider: c('Collider', { size: { x: 32, y: 32 } }), PhysicsBody: c('PhysicsBody', { bodyType: 'static' }) });
  const defs: ObjectDefinition[] = [
    ...FLOORS.map((n) => block(n, 'iso_floor', {}, ['floor'], `A floor block (${n.toLowerCase()}): its top is the ground.`)),
    ...WALLS.map((n) => block(n, 'iso_block', solid(), ['wall', 'solid'], `A wall block (${n.toLowerCase()}): one block high, in the way.`)),
    ...WATER.map((n) => block(n, 'iso_floor', solid(), ['water'], 'Water at floor height: nothing walks into it.')),
  ];
  // Lava: a floor that hurts, as the Hazard does.
  const hazard = project.definitions.find((d) => d.name === 'Hazard');
  const lava = block('Lava', 'iso_floor', { Collider: c('Collider', { size: { x: 28, y: 28 }, isTrigger: true, matchSprite: false }) }, ['hazard', 'lava'], 'Lava at floor height (the magma block): it hurts whatever walks on it.', 'Magma');
  if (hazard?.scripts) lava.scripts = structuredClone(hazard.scripts);
  defs.push(lava);
  for (const d of defs) m.addDefinition(project, d, registry);
  // The coin and the goal drawn in the blocks' pixel size (the top-down ones are a plain dot and steps seen from above).
  const coinArt = createPixelArtAsset('Coin', COIN);
  const flagArt = createPixelArtAsset('Goal Flag', FLAG);
  project.assets.push(coinArt, flagArt);
  for (const d of project.definitions) {
    if (d.name === 'Coin') {
      d.components.Sprite = { ...d.components.Sprite, width: 32, height: 32, assetId: coinArt.id };
      d.components.Collider = { ...d.components.Collider, size: { x: 16, y: 16 }, matchSprite: false };
    }
    if (d.name === 'Goal') d.components.Sprite = { ...d.components.Sprite, width: 32, height: 32, assetId: flagArt.id };
  }

  const level = project.scenes[0];
  level.name = 'Island';
  level.world.view = 'iso';
  level.world.backgroundColor = '#16213a';
  // (Closer in: the blocks are small pixel art.)
  level.camera = { ...(level.camera ?? defaultCamera(true)), zoom: 2, bounds: 'none' };
  const id = (n: string) => project.definitions.find((d) => d.name === n)!;
  const at = (n: string, i: number, j: number, lift = 0) => {
    const e = instantiateDefinition(id(n), { x: i * 32 + 16, y: j * 32 + 16 });
    if (lift) e.components = { ...e.components, Sprite: { ...(e.components.Sprite ?? {}), isoLift: lift } };
    m.addEntity(project, level.id, e);
  };
  const W = 16;
  const H = 12;
  const lavaPool = (i: number, j: number) => i >= 12 && i <= 13 && j >= 8 && j <= 9;
  // (The island's corners, the pond's shore and the road's bends are picked by the blocks themselves: isoAuto.)
  const pond = (i: number, j: number) => i >= 9 && i <= 10 && j >= 9 && j <= 10;
  const road = windingRoad([
    [1, 6],
    [3, 6],
    [3, 4],
    [6, 4],
    [6, 7],
    [9, 7],
    [9, 5],
    [13, 5],
    [13, 6],
    [14, 6],
  ]);
  for (let j = -1; j <= H; j++)
    for (let i = -1; i <= W; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) at('Water', i, j);
      else if (lavaPool(i, j)) at('Lava', i, j);
      else if (road.has(`${i},${j}`)) at('Dirt', i, j);
      else if (pond(i, j)) at('Water', i, j);
      else at('Grass', i, j);
    }
  // A hill: what walks steps up half a block at a time (a whole block up is a cliff). A step half a block up, a
  // terrace one block up, a step on it, and the top two blocks up.
  for (let i = 1; i <= 3; i++) at('Grass', i, 3, 8);
  for (let j = 0; j <= 2; j++) for (let i = 1; i <= 4; i++) at('Grass', i, j, 16);
  at('Grass', 3, 0, 24);
  at('Grass', 1, 0, 32);
  at('Grass', 2, 0, 32);
  // Ruins and crates (walls stand on the floor blocks).
  for (const [i, j] of [
    [8, 2],
    [9, 2],
    [10, 2],
    [11, 2],
    [8, 3],
    [11, 3],
  ])
    at('Cobblestone', i, j);
  at('Wood', 4, 3);
  at('Wood', 5, 3);
  at('Wood', 4, 9);
  at('Light Stone', 2, 10);
  // The player at the road's start, coins, an enemy and the goal at the road's end.
  at('Player', 1, 6);
  for (const [i, j] of [
    [6, 6],
    [9, 6],
    [10, 3],
    [6, 9],
  ])
    at('Coin', i, j);
  // A coin on the top of the hill.
  at('Coin', 2, 0, 32);
  at('Enemy', 8, 8);
  at('Goal', 14, 6);
  return project;
}
