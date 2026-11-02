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
const FLOORS = ['Grass', 'Dark Grass', 'Dirt', 'Dark Dirt', 'Snow', 'Magma', 'Grassy Dirt', 'Grassy Dirt 2', 'Grassy Dirt 3', 'Grassy Dirt 4'];
const WALLS = ['Cobblestone', 'Wood', 'Dark Stone', 'Light Stone', 'Ice'];
const WATER = ['Water', 'Water Shore 1', 'Water Shore 2', 'Water Shore 3', 'Water Shore 4'];

export function createIsometricProject(registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const project = createProject(registry, name, 'topdown');
  const c = (type: string, props: Record<string, unknown> = {}) => registry.createDefault(type, props);
  const block = (n: string, look: 'iso_floor' | 'iso_block', extra: Record<string, Record<string, unknown>>, tags: string[], description: string): ObjectDefinition => {
    const asset = createPixelArtAsset(n, ISO_TILES[n]);
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
  const lava = block('Lava', 'iso_floor', { Collider: c('Collider', { size: { x: 28, y: 28 }, isTrigger: true, matchSprite: false }) }, ['hazard', 'lava'], 'Lava at floor height: it hurts whatever walks on it.');
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
  const at = (n: string, i: number, j: number) => m.addEntity(project, level.id, instantiateDefinition(id(n), { x: i * 32 + 16, y: j * 32 + 16 }));
  const W = 16;
  const H = 12;
  const lavaPool = (i: number, j: number) => i >= 12 && i <= 13 && j >= 8 && j <= 9;
  const magma = (i: number, j: number) => !lavaPool(i, j) && i >= 11 && i <= 14 && j >= 7 && j <= 10;
  for (let j = -1; j <= H; j++)
    for (let i = -1; i <= W; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) at('Water', i, j);
      else if (lavaPool(i, j)) at('Lava', i, j);
      else if (magma(i, j)) at('Magma', i, j);
      else if (j === 6 && i >= 1 && i <= 14) at('Dirt', i, j);
      else at((i * 7 + j * 3) % 11 === 0 ? 'Dark Grass' : 'Grass', i, j);
    }
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
  // The player, coins, an enemy and the goal at the path's end.
  at('Player', 1, 6);
  for (const [i, j] of [
    [5, 6],
    [9, 4],
    [10, 3],
    [6, 9],
  ])
    at('Coin', i, j);
  at('Enemy', 8, 8);
  at('Goal', 14, 6);
  return project;
}
