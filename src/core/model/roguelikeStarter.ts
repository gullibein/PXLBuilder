/**
 * The Roguelike starter: a game seen from above whose one level is random (a new dungeon every play, deeper floors
 * after the stairs), played square by square: the hero steps, the monsters answer; fog of war; gold and potions;
 * dying starts a new run. Everything in it is ordinary: the level's recipe (Random level panel), objects and
 * ready-made scripts (their settings in Details).
 */
import type { ComponentRegistry } from '../components/registry';
import { checkScript } from '../script/language';
import { expandReadyScript } from '../script/ready';
import type { ObjectDefinition, Project } from '../types';
import { defaultGenerator } from './dungeon';
import { createDefinition, createPixelArtAsset, createProject, instantiateDefinition } from './factory';
import * as m from './mutations';
import type { PixelArt } from './pixelArt';

const art = (palette: Record<string, string>, rows: string[]): PixelArt => ({ palette: Object.entries(palette).map(([key, color]) => ({ key, color })), rows });

const RAT = art({ o: '#160f14', g: '#8a7a6a', G: '#b8a690', p: '#ff9aa8', r: '#ff3b3b' }, [
  '................',
  '................',
  '................',
  '................',
  '................',
  '...oo...........',
  '..oGGo..........',
  '..oGrGooooo.....',
  '.ooGGGGGGGGoo...',
  'opGGGGGGGGGGGo..',
  '.ooGGgGGGGgGGo..',
  '...ogo.ooo.ogoo.',
  '...oo..o.o..oo.p',
  '..............pp',
  '................',
  '................',
]);
const SKELETON = art({ o: '#141018', w: '#ece6d6', g: '#a8a090', r: '#ff4f4f' }, [
  '.....oooooo.....',
  '....owwwwwwo....',
  '...owwwwwwwwo...',
  '...owrowworwo...',
  '...owwwoowwwo...',
  '....owowowwo....',
  '.....oowwoo.....',
  '...ooowggwooo...',
  '..owwowwwwowwo..',
  '..ow.owggwo.wo..',
  '..ow.owwwwo.wo..',
  '.....owggwo.....',
  '.....ow..wo.....',
  '.....ow..wo.....',
  '....oww..wwo....',
  '....ooo..ooo....',
]);
const OGRE = art({ o: '#13170f', g: '#5f8a3a', G: '#87b85a', w: '#f0ead8', b: '#6a4a2a', r: '#ff5040' }, [
  '....oooooooo....',
  '...oGGGGGGGGo...',
  '..oGGrGGGGrGGo..',
  '..oGGGGGGGGGGo..',
  '..oGGwGGGGwGGo..',
  '...oGGGGGGGGo...',
  '.ooogggggggggooo',
  'oGGobbbbbbbbbbGo',
  'oGGobbbbbbbbbbGo',
  'oGGobbbbbbbbbbGo',
  '.oooggggggggoooo',
  '...oggggggggo...',
  '...ogggoogggo...',
  '...oggo..oggo...',
  '..oggGo..oGggo..',
  '..ooooo..ooooo..',
]);
const GOLD = art({ o: '#3a2a08', y: '#ffd166', Y: '#fff2a8', d: '#c8902a' }, [
  '................',
  '................',
  '................',
  '................',
  '......oooo......',
  '.....oyYYyo.....',
  '....oyYyyyyo....',
  '....oydyydyo....',
  '..oooyyyyyyooo..',
  '.oyYYoyddyoyYyo.',
  '.oydyyoooooydyo.',
  '..oooooooooooo..',
  '................',
  '................',
  '................',
  '................',
]);
const POTION = art({ o: '#160c14', w: '#d8f0ff', r: '#ff3b6a', R: '#ff8aa8', b: '#8a5a34' }, [
  '................',
  '................',
  '......oooo......',
  '......obbo......',
  '.......ww.......',
  '......owwo......',
  '.....owwwwo.....',
  '....owwwwwwo....',
  '...orrRRrrrro...',
  '...orRRrrrrro...',
  '...orrrrrrrro...',
  '...orrrrrrrro...',
  '....orrrrrro....',
  '.....oooooo.....',
  '................',
  '................',
]);
const STAIRS = art({ o: '#0c0a10', a: '#5a566a', b: '#7a7690', c: '#3a3648', d: '#1e1b28' }, [
  'oooooooooooooooo',
  'obbbbbbbbbbbbbbo',
  'oaaaaaaaaaaaaaao',
  'occcccccccccccco',
  'oddbbbbbbbbbbbbo',
  'oddaaaaaaaaaaaao',
  'oddcccccccccccco',
  'oddddddbbbbbbbbo',
  'oddddddaaaaaaaao',
  'oddddddcccccccco',
  'oddddddddddbbbbo',
  'oddddddddddaaaao',
  'oddddddddddcccco',
  'oddddddddddddddo',
  'oddddddddddddddo',
  'oooooooooooooooo',
]);

const KEY = art({ o: '#2a1c04', y: '#ffd166', Y: '#fff2a8', d: '#c8902a' }, [
  '................',
  '................',
  '................',
  '...oooo.........',
  '..oyYYyo........',
  '.oyYooYyo.......',
  '.oyo..oyo.......',
  '.oyYooYyoooooooo',
  '..oyyyyyyyyyyyyo',
  '...oooodyyooyydo',
  '........oddo.odo',
  '.........oo...o.',
  '................',
  '................',
  '................',
  '................',
]);
const DOOR = art({ o: '#140c06', b: '#7a4a24', B: '#a0683a', d: '#4a2a12', y: '#ffd166', g: '#5a566a' }, [
  'gggggggggggggggg',
  'goooooooooooooog',
  'gobBbdbBbdbBbbog',
  'gobBbdbBbdbBbbog',
  'gobBbdbBbdbBbbog',
  'gobBbdbBbdbBbbog',
  'goooooooooooooog',
  'gobBbdbBbdbyybog',
  'gobBbdbBbdbyobog',
  'gobBbdbBbdbyybog',
  'goooooooooooooog',
  'gobBbdbBbdbBbbog',
  'gobBbdbBbdbBbbog',
  'gobBbdbBbdbBbbog',
  'goooooooooooooog',
  'gggggggggggggggg',
]);

function withScript(project: Project, def: ObjectDefinition, ready: string, settings: Record<string, unknown> = {}): void {
  const checked = checkScript({ ...expandReadyScript({ ready, settings }), id: `scr_${ready.replace(/\W+/g, '_').toLowerCase()}` }, project);
  if ('error' in checked) throw new Error(`Roguelike starter: ${checked.error}`);
  def.scripts = [...(def.scripts ?? []), checked.script];
}

export const ROGUELIKE_ARTS = { rat: RAT, skeleton: SKELETON, ogre: OGRE, gold: GOLD, potion: POTION, stairs: STAIRS, key: KEY, door: DOOR };

export function createRoguelikeProject(registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const project = createProject(registry, name, 'topdown');
  const c = (type: string, props: Record<string, unknown> = {}) => registry.createDefault(type, props);
  const picture = (n: string, a: PixelArt) => {
    const asset = createPixelArtAsset(n, a);
    project.assets.push(asset);
    return asset.id;
  };
  const thing = (n: string, tags: string[], a: PixelArt, extra: Record<string, Record<string, unknown>>, description: string, category: string) => {
    const d = createDefinition(n, { Sprite: c('Sprite', { width: 32, height: 32, assetId: picture(n, a) }), Collider: c('Collider', { size: { x: 26, y: 26 }, isTrigger: true }), ...extra }, tags, description);
    d.metadata.category = category;
    return d;
  };
  const monster = (n: string, a: PixelArt, hp: number) => thing(n, ['monster'], a, { Health: c('Health', { maxHealth: hp, currentHealth: hp }) }, 'A monster of the dungeon: it answers each of the hero\'s steps.', 'Enemies');
  const rat = monster('Rat', RAT, 3);
  const skeleton = monster('Skeleton', SKELETON, 6);
  const ogre = monster('Ogre', OGRE, 12);
  withScript(project, rat, 'Roguelike monster', { power: 1, sight: 5, wander: 0.5 });
  withScript(project, skeleton, 'Roguelike monster', { power: 2, sight: 7 });
  withScript(project, ogre, 'Roguelike monster', { power: 4, sight: 6, wander: 0.1 });
  const gold = thing('Gold', ['loot'], GOLD, {}, 'Gold for the run.', 'Items');
  withScript(project, gold, 'Gold pickup', { amount: 5 });
  const potion = thing('Potion', ['loot'], POTION, {}, 'Health back.', 'Items');
  withScript(project, potion, 'Healing pickup', { amount: 4 });
  const stairs = thing('Stairs', ['stairs'], STAIRS, {}, 'The way down: the next floor, deeper.', 'Environment');
  stairs.metadata.placement = 'tile';
  withScript(project, stairs, 'Stairs down');
  // A key (picked up: carried) and the locked door on the way down that it opens.
  const key = thing('Key', ['key', 'loot'], KEY, { Collectible: c('Collectible', { collectionBehavior: 'addToInventory', itemId: 'key' }) }, 'The key to the locked door on the way down.', 'Items');
  const door = createDefinition('Locked Door', { Sprite: c('Sprite', { width: 32, height: 32, assetId: picture('Locked Door', DOOR) }), Collider: c('Collider', { size: { x: 32, y: 32 } }), PhysicsBody: c('PhysicsBody', { bodyType: 'static' }), Openable: c('Openable') }, ['door'], 'A locked door: the hero opens it with a key.');
  door.metadata.category = 'Environment';
  door.metadata.placement = 'tile';
  for (const d of [rat, skeleton, ogre, gold, potion, stairs, key, door]) m.addDefinition(project, d, registry);

  // The hero: steps square by square (its controller doesn't walk it), sees through the fog, shows the run.
  const hero = project.definitions.find((d) => d.name === 'Player')!;
  hero.components.CharacterController = { ...hero.components.CharacterController, speed: 0 };
  hero.components.Health = c('Health', { maxHealth: 12, currentHealth: 12 });
  hero.components.FogOfWar = c('FogOfWar', { radius: 6 });
  withScript(project, hero, 'Roguelike hero', { power: 2 });
  const hud = checkScript(
    {
      id: 'scr_run',
      name: 'Run',
      description: 'Shows the floor, health and gold at the top of the screen.',
      vars: [],
      states: [],
      handlers: [
        {
          when: { on: 'tick' },
          state: null,
          if: null,
          do: [{ do: 'draw', id: 'run', shape: 'text', anchor: 'top_left', x: '12', y: '10', w: null, h: null, text: "Floor {game_value('floor', 1)}   HP {self.health}/{self.max_health}   Gold {game_value('gold', 0)}   Keys {items(self, 'key')}", size: '14', color: '#ffffff', object: null, alpha: null }],
        },
      ],
    },
    project,
  );
  if ('error' in hud) throw new Error(hud.error);
  hero.scripts = [...(hero.scripts ?? []), hud.script];

  // The level: only the hero is placed; the rest is the recipe.
  const level = project.scenes[0];
  level.name = 'Dungeon';
  level.world.backgroundColor = '#0d0b12';
  m.addEntity(project, level.id, instantiateDefinition(hero, { x: 48, y: 48 }));
  const id = (n: string) => project.definitions.find((d) => d.name === n)!.id;
  m.setGenerator(project, level.id, {
    ...defaultGenerator(project),
    wall: id('Wall'),
    floor: id('Floor'),
    stairs: id('Stairs'),
    door: id('Locked Door'),
    key: id('Key'),
    lockFromFloor: 1,
    monsters: [
      { object: id('Rat'), weight: 3, fromFloor: 1 },
      { object: id('Skeleton'), weight: 2, fromFloor: 2 },
      { object: id('Ogre'), weight: 1, fromFloor: 4 },
    ],
    loot: [
      { object: id('Gold'), weight: 3, fromFloor: 1 },
      { object: id('Potion'), weight: 1, fromFloor: 1 },
    ],
    monsterCount: 4,
    monstersPerFloor: 2,
    lootCount: 4,
    lootPerFloor: 1,
    width: 36,
    height: 26,
    rooms: 7,
  } as unknown as Record<string, unknown>);
  return project;
}
