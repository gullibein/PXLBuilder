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
const FLOORS = ['Grass', 'Dark Grass', 'Dirt', 'Dark Dirt', 'Snow', 'Road Turn SE-SW', 'Road Turn SE-NE', 'Road Turn NW-NE', 'Road Turn NW-SW', 'Island Corner North', 'Island Corner East', 'Island Corner South', 'Island Corner West'];
const WALLS = ['Cobblestone', 'Wood', 'Dark Stone', 'Light Stone', 'Ice'];
const WATER = ['Water', 'Water Corner West', 'Water Corner North', 'Water Corner South', 'Water Corner East'];

/**
 * A road through these corners (squares; each leg straight along the level's x or y): plain dirt where it runs
 * straight, the road-turn blocks where it bends. On the screen the level's +x runs down-right (south-east), -x
 * up-left (north-west), +y down-left (south-west), -y up-right (north-east).
 */
function windingRoad(corners: [number, number][]): Map<string, string> {
  const cells: [number, number][] = [corners[0]];
  for (let n = 1; n < corners.length; n++) {
    const [x1, y1] = corners[n];
    let [x, y] = cells[cells.length - 1];
    while (x !== x1 || y !== y1) {
      x += Math.sign(x1 - x);
      if (x === x1) y += Math.sign(y1 - y);
      cells.push([x, y]);
    }
  }
  const side = (dx: number, dy: number) => (dx > 0 ? 'SE' : dx < 0 ? 'NW' : dy > 0 ? 'SW' : 'NE');
  const turns: Record<string, string> = { 'SE+SW': 'Road Turn SE-SW', 'NE+SE': 'Road Turn SE-NE', 'NE+NW': 'Road Turn NW-NE', 'NW+SW': 'Road Turn NW-SW' };
  const out = new Map<string, string>();
  cells.forEach(([x, y], n) => {
    const prev = cells[n - 1];
    const next = cells[n + 1];
    let block = 'Dirt';
    if (prev && next && prev[0] !== next[0] && prev[1] !== next[1]) {
      const a = side(prev[0] - x, prev[1] - y);
      const b = side(next[0] - x, next[1] - y);
      block = turns[[a, b].sort().join('+')] ?? 'Dirt';
    }
    out.set(`${x},${y}`, block);
  });
  return out;
}

export function createIsometricProject(registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const project = createProject(registry, name, 'topdown');
  const c = (type: string, props: Record<string, unknown> = {}) => registry.createDefault(type, props);
  const block = (n: string, look: 'iso_floor' | 'iso_block', extra: Record<string, Record<string, unknown>>, tags: string[], description: string, picture = n): ObjectDefinition => {
    const asset = createPixelArtAsset(picture, ISO_TILES[picture]);
    project.assets.push(asset);
    const d = createDefinition(n, { Sprite: c('Sprite', { width: 32, height: 32, assetId: asset.id, isoLook: look }), ...extra }, tags, description);
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
  const magma = (i: number, j: number) => !lavaPool(i, j) && i >= 11 && i <= 14 && j >= 7 && j <= 10;
  // The island's own four corner squares: grass rounding off into the water (on the screen north is at the top,
  // east at the right, south at the bottom, west at the left).
  const corner: Record<string, string> = { '0,0': 'Island Corner North', [`${W - 1},0`]: 'Island Corner East', [`${W - 1},${H - 1}`]: 'Island Corner South', [`0,${H - 1}`]: 'Island Corner West' };
  // A pond: the same corner blocks the other way round, each with its land on the outside.
  const pond: Record<string, string> = { '9,9': 'Water Corner North', '10,9': 'Water Corner East', '9,10': 'Water Corner West', '10,10': 'Water Corner South' };
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
      else if (corner[`${i},${j}`]) at(corner[`${i},${j}`], i, j);
      else if (lavaPool(i, j)) at('Lava', i, j);
      else if (magma(i, j)) at('Dark Dirt', i, j);
      else if (road.has(`${i},${j}`)) at(road.get(`${i},${j}`)!, i, j);
      else if (pond[`${i},${j}`]) at(pond[`${i},${j}`], i, j);
      else at((i * 7 + j * 3) % 11 === 0 ? 'Dark Grass' : 'Grass', i, j);
    }
  // A hill: a terrace one block up, and a smaller one on top of it (the player steps up one block at a time).
  for (let j = 0; j <= 2; j++) for (let i = 1; i <= 4; i++) at('Grass', i, j, 16);
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
