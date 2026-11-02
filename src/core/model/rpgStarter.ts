/**
 * The RPG starter: a game seen from above with a map to walk around (the Overworld, its wandering slimes starting
 * battles) and a battle level (a knight and a mage against a slime and a bat), played with the turn-based kit and
 * the ready-made RPG scripts. Everything in it is ordinary: objects, levels and scripts the user and the AI can
 * change (their settings in Details).
 */
import type { ComponentRegistry } from '../components/registry';
import { checkScript } from '../script/language';
import { expandReadyScript } from '../script/ready';
import type { ObjectDefinition, Project } from '../types';
import { createDefinition, createLevelFor, createPixelArtAsset, createProject, instantiateDefinition } from './factory';
import type { PixelArt } from './pixelArt';
import * as m from './mutations';

const KNIGHT: PixelArt = {
  palette: [
    { key: 'o', color: '#1a1426' },
    { key: 'g', color: '#9aa4b8' },
    { key: 'G', color: '#d8dee9' },
    { key: 's', color: '#f2c39b' },
    { key: 'b', color: '#3a6fd8' },
    { key: 'B', color: '#6c9cff' },
    { key: 'y', color: '#ffd166' },
    { key: 'w', color: '#e8ecff' },
  ],
  rows: [
    '.....oooooo.....',
    '....oGGGGGGo....',
    '...oGggggggGo...',
    '...oGgooooggo...',
    '...ogossssogo...',
    '....osososso..w.',
    '.....oosssoo.ow.',
    '...oobBBBBbboow.',
    '..obbBByyBBbbow.',
    '..obbBByyBBbbow.',
    '..osobbbbbbosoy.',
    '...o.obbbbbo.oy.',
    '.....obbobbo....',
    '.....ogg.ggo....',
    '....oggo.oggo...',
    '....ooo..ooo....',
  ],
};

const MAGE: PixelArt = {
  palette: [
    { key: 'o', color: '#1a1426' },
    { key: 'p', color: '#7b4fd6' },
    { key: 'P', color: '#a97bff' },
    { key: 's', color: '#f2c39b' },
    { key: 'w', color: '#e8e2d0' },
    { key: 'y', color: '#ffd166' },
    { key: 'c', color: '#5ef2ff' },
    { key: 'n', color: '#8a5a34' },
  ],
  rows: [
    '.......oo....c..',
    '......oPPo..ccc.',
    '.....oPPPPo..n..',
    '....oPPyPPPo.n..',
    '...oppppppppon..',
    '.....osssso..n..',
    '.....osoos.o.n..',
    '.....owwwwo.on..',
    '....opwwwwpooo..',
    '...oppPwwPppo...',
    '...oppPPPPppo...',
    '....opPPPPpo....',
    '....opPPPPpo....',
    '...oppPPPPppo...',
    '...oppppppppo...',
    '....oooooooo....',
  ],
};

const BAT: PixelArt = {
  palette: [
    { key: 'o', color: '#140c1e' },
    { key: 'v', color: '#5a2d7a' },
    { key: 'V', color: '#8a4fb8' },
    { key: 'r', color: '#ff4f6a' },
    { key: 'w', color: '#ffffff' },
  ],
  rows: [
    '................',
    '................',
    'o..............o',
    'vo....o..o....ov',
    'vVo...oooo...oVv',
    'vVVo.oVVVVo.oVVv',
    'vVVVooVrrVooVVVv',
    'vVVVVoVVVVoVVVVv',
    '.vVVVVowwoVVVVv.',
    '.vvVVVVooVVVVvv.',
    '..vvoVVVVVVovv..',
    '...o.ovVVvo.o...',
    '......oVVo......',
    '.......oo.......',
    '................',
    '................',
  ],
};

const SLIME: PixelArt = {
  palette: [
    { key: 'o', color: '#102418' },
    { key: 'g', color: '#3fbf5f' },
    { key: 'G', color: '#7fe89a' },
    { key: 'd', color: '#2a8a44' },
    { key: 'w', color: '#ffffff' },
  ],
  rows: [
    '................',
    '................',
    '................',
    '................',
    '.......oo.......',
    '.....ooGGoo.....',
    '....oGGGggGo....',
    '...oGGgggggGo...',
    '..oGgwogggwogo..',
    '..ogggoogggoogo.',
    '.ogggggggggggggo',
    '.ogdgggggggggdgo',
    '.oddgggddggggddo',
    '..odddddddddddo.',
    '...ooooooooooo..',
    '................',
  ],
};

const MERCHANT: PixelArt = {
  palette: [
    { key: 'o', color: '#1a1426' },
    { key: 'h', color: '#b5562c' },
    { key: 'H', color: '#e07a3c' },
    { key: 's', color: '#f2c39b' },
    { key: 'g', color: '#3f8f5a' },
    { key: 'G', color: '#6fcf8a' },
    { key: 'y', color: '#ffd166' },
    { key: 'n', color: '#7a4a2a' },
  ],
  rows: [
    '.....oooooo.....',
    '....oHHHHHHo....',
    '...ohhhhhhhho...',
    '..oooooooooooo..',
    '....osssssso....',
    '....osossoso....',
    '.....ossnso.....',
    '....oGGyyGGo....',
    '...oGGGyyGGGo...',
    '..osgGGGGGGgso..',
    '..os.oGGGGo.so..',
    '.....ogggggo.oo.',
    '.....oggogg.oyyo',
    '.....onn.nno.oo.',
    '....onno.onno...',
    '....ooo...ooo...',
  ],
};

/** A ready-made script on an object, checked (the starter's own scripts always check out). */
function withScript(project: Project, def: ObjectDefinition, ready: string, settings: Record<string, unknown> = {}): void {
  const checked = checkScript({ ...expandReadyScript({ ready, settings }), id: `scr_${ready.replace(/\W+/g, '_').toLowerCase()}` }, project);
  if ('error' in checked) throw new Error(`RPG starter: ${checked.error}`);
  def.scripts = [...(def.scripts ?? []), checked.script];
}

/** The starter's pictures (the New game window shows them). */
export const RPG_ARTS = { knight: KNIGHT, mage: MAGE, bat: BAT, slime: SLIME };

export function createRpgProject(registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const project = createProject(registry, name, 'topdown');
  const c = (type: string, props: Record<string, unknown> = {}) => registry.createDefault(type, props);
  const art = (n: string, a: PixelArt) => {
    const asset = createPixelArtAsset(n, a);
    project.assets.push(asset);
    return asset.id;
  };
  const unit = (n: string, tags: string[], hp: number, picture: string, description: string) =>
    createDefinition(n, { Sprite: c('Sprite', { width: 32, height: 32, assetId: picture }), Collider: c('Collider', { size: { x: 28, y: 28 }, isTrigger: true }), Health: c('Health', { maxHealth: hp, currentHealth: hp }) }, tags, description);

  // The battle's side: the party, and the monsters they meet.
  const slimeArt = art('Slime', SLIME);
  const knight = unit('Knight', ['hero'], 24, art('Knight', KNIGHT), 'A party member: strong blows, a little magic.');
  const mage = unit('Mage', ['hero'], 16, art('Mage', MAGE), 'A party member: weak blows, strong magic.');
  const slime = unit('Slime', ['monster'], 10, slimeArt, 'A monster in battles.');
  const bat = unit('Bat', ['monster'], 7, art('Bat', BAT), 'A monster in battles: quick to strike.');
  // On the map: a slime wandering about; touching it starts a battle.
  const wild = createDefinition(
    'Wild Slime',
    { Sprite: c('Sprite', { width: 32, height: 32, assetId: slimeArt }), Collider: c('Collider', { size: { x: 26, y: 26 }, isTrigger: true }), PhysicsBody: c('PhysicsBody', { gravityScale: 0 }), Wander: c('Wander', { speed: 40, interval: 2 }) },
    ['encounter'],
    'Wanders the map; touching it starts a battle (the Battle level). Won, it is gone.',
  );
  withScript(project, knight, 'RPG hero', { power: 6, magic: 5, max_mp: 6, mp_cost: 3 });
  withScript(project, mage, 'RPG hero', { power: 2, magic: 9, max_mp: 15, mp_cost: 3 });
  withScript(project, slime, 'RPG monster', { power: 3, xp: 6, gold: 4 });
  withScript(project, bat, 'RPG monster', { power: 2, pause: 0.4, xp: 4, gold: 3 });
  // A shop on the map: potions for gold.
  const merchant = createDefinition(
    'Merchant',
    { Sprite: c('Sprite', { width: 32, height: 32, assetId: art('Merchant', MERCHANT) }), Collider: c('Collider', { size: { x: 28, y: 28 }, isTrigger: true }) },
    ['shop'],
    'Sells potions for gold: touching him opens his shop.',
  );
  withScript(project, merchant, 'RPG shop', { title: 'Merchant', price: 5 });
  withScript(project, wild, 'RPG encounter', { battle: 'Battle' });
  // (Added once complete: the project keeps its own copy.)
  for (const def of [knight, mage, slime, bat, wild, merchant]) {
    def.metadata.category = def === wild ? 'Enemies' : def === merchant ? 'People' : 'Battle';
    m.addDefinition(project, def, registry);
  }

  // The map: a field walled round, rocks here and there, the hero, and slimes about.
  const map = project.scenes[0];
  map.name = 'Overworld';
  map.world.backgroundColor = '#3f7a3a';
  const def = (n: string) => project.definitions.find((d) => d.name === n)!;
  const wall = def('Wall');
  const W = 24;
  const H = 16;
  const cells: [number, number][] = [];
  for (let i = 0; i < W; i++) cells.push([i, 0], [i, H - 1]);
  for (let j = 1; j < H - 1; j++) cells.push([0, j], [W - 1, j]);
  for (const [i, j] of [
    [6, 4],
    [7, 4],
    [6, 5],
    [12, 9],
    [13, 9],
    [13, 10],
    [18, 3],
    [18, 4],
    [5, 11],
    [17, 12],
    [18, 12],
  ])
    cells.push([i, j]);
  for (const [i, j] of cells) m.addEntity(project, map.id, instantiateDefinition(wall, { x: i * 32 + 16, y: j * 32 + 16 }));
  const player = def('Player');
  // The party on the map: who has how much health left, and the potions.
  const party = checkScript(
    {
      id: 'scr_party',
      name: 'Party',
      description: "Shows the party's health and potions (kept from battle to battle) at the top of the screen.",
      vars: [],
      states: [],
      handlers: [
        {
          when: { on: 'tick' },
          state: null,
          if: null,
          do: [
            { do: 'draw', id: 'party', shape: 'text', anchor: 'top_left', x: '12', y: '10', w: null, h: null, text: "Knight Lv{game_value('Knight_level', 1)} {game_value('Knight_hp', 24)}/{game_value('Knight_max_hp', 24)}   Mage Lv{game_value('Mage_level', 1)} {game_value('Mage_hp', 16)}/{game_value('Mage_max_hp', 16)}   Gold {game_value('gold', 0)}   Potions {game_value('potions', 3)}", size: '14', color: '#ffffff', object: null, alpha: null },
          ],
        },
      ],
    },
    project,
  );
  if ('error' in party) throw new Error(party.error);
  player.scripts = [...(player.scripts ?? []), party.script];
  m.addEntity(project, map.id, instantiateDefinition(player, { x: 80, y: 240 }));
  m.addEntity(project, map.id, instantiateDefinition(def('Merchant'), { x: 80, y: 112 }));
  for (const [x, y] of [
    [336, 176],
    [528, 336],
    [624, 144],
  ])
    m.addEntity(project, map.id, instantiateDefinition(wild, { x, y }));

  // The battle: the party on the right, the monsters on the left, a still camera on them.
  const battle = createLevelFor(project, 'Battle', map);
  battle.world.backgroundColor = '#1d1530';
  battle.camera = { ...battle.camera, bounds: 'none', fixedAt: { x: 256, y: 176 }, zoom: 1.5 };
  m.addScene(project, battle);
  for (const [d, x, y] of [
    [knight, 400, 144],
    [mage, 400, 208],
    [slime, 112, 144],
    [bat, 112, 208],
  ] as const)
    m.addEntity(project, battle.id, instantiateDefinition(d, { x, y }));
  return project;
}
