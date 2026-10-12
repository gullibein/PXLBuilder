/**
 * The 8-pixel set: every built-in object drawn anew, by hand, for the 8×8
 * sprite size (not made from the other sizes' pictures). One shared 16-color
 * palette (the PICO-8 colors) so the whole set sits together.
 *
 * Keys: "<game type>:<object>" for the normal look, "<game type>:<object>:<situation>"
 * for a situation's (the top-down hero's walk cycles); "*" for both game types.
 * Most pictures are 8×8 for a one-tile object; odd-sized objects keep 8 pixels a
 * tile (the half-tile spikes are 8×4, the door two tiles tall 8×16), except the
 * small coin and key, which get a whole 8 pixels across so they read.
 */
import type { PixelArt } from './pixelArt';

const PALETTE: PixelArt['palette'] = [
  { key: '0', color: '#000000' },
  { key: '1', color: '#1d2b53' },
  { key: '2', color: '#7e2553' },
  { key: '3', color: '#008751' },
  { key: '4', color: '#ab5236' },
  { key: '5', color: '#5f574f' },
  { key: '6', color: '#c2c3c7' },
  { key: '7', color: '#fff1e8' },
  { key: '8', color: '#ff004d' },
  { key: '9', color: '#ffa300' },
  { key: 'a', color: '#ffec27' },
  { key: 'b', color: '#00e436' },
  { key: 'c', color: '#29adff' },
  { key: 'd', color: '#83769c' },
  { key: 'e', color: '#ff77a8' },
  { key: 'f', color: '#ffccaa' },
];

const DOOR_SIDE = '54244245';

/** The drawings: frames of rows (most have one frame). */
const SET: Record<string, { frames: string[][]; fps?: number }> = {
  // A small hero in a blue cap, facing right (mirrored going left).
  'platformer:Player': { frames: [['..ccc..', '.ccccc.', '.cff0f.', '.cffff.', '..ccc..', '.cc1cc.', '..c.c..', '.11.11.']] },
  // Grass on earth with a few pebbles.
  '*:Platform': { frames: [['bbbbbbbb', '3b33b3b3', '44444444', '44494444', '44444454', '45444444', '44444944', '44544444']] },
  // Grey bricks.
  '*:Stone': { frames: [['66656666', 'ddd5dddd', 'ddd5dddd', '55555555', '66666566', 'ddddd5dd', 'ddddd5dd', '55555555']] },
  // Two rails, two rungs.
  '*:Ladder': { frames: [['.4....4.', '.499994.', '.4....4.', '.4....4.', '.4....4.', '.499994.', '.4....4.', '.4....4.']] },
  // A purple horned beetle.
  'platformer:Enemy': { frames: [['.e....e.', '..2222..', '.222222.', '27022702', '22222222', '2e2222e2', '.222222.', '.2.22.2.']] },
  // A gold coin with a shine.
  '*:Coin': { frames: [['..9999..', '.9aaaa9.', '9a7aaaa9', '9a7aa9a9', '9aaaa9a9', '9aaaaaa9', '.9aaaa9.', '..9999..']] },
  // A key: ring, shaft, two teeth.
  '*:Key': { frames: [['.aaa....', 'a...a...', 'a...aaaa', 'a...a.a.', '.aaa..a.']] },
  // A wooden door in a stone frame, two tiles tall.
  'platformer:Door': {
    frames: [['..5555..', '.544445.', '54444445', DOOR_SIDE, DOOR_SIDE, DOOR_SIDE, DOOR_SIDE, DOOR_SIDE, '542442a5', DOOR_SIDE, DOOR_SIDE, DOOR_SIDE, DOOR_SIDE, DOOR_SIDE, '54444445', '55555555']],
  },
  // A lever with a red knob on a base (drawn mirrored while on).
  '*:Switch': { frames: [['......8.', '.....88.', '....5...', '...5....', '..5.....', '.666666.', '65555556', '66666666']] },
  // Two spikes on a strip (half a tile tall).
  'platformer:Hazard': { frames: [['.7...7..', '.67..67.', '66676667', '55555555']] },
  // A glowing pad.
  'platformer:Teleporter': { frames: [['.c.c7.c.', 'cc7777cc', 'dddddddd']] },
  // A chequered finish flag.
  'platformer:Goal': { frames: [['.6700770', '.6077007', '.6700770', '.6......', '.6......', '.6......', '.6......', '555.....']] },
  // A crate of planks.
  'platformer:Crate': { frames: [['22222222', '29999992', '24444442', '29999992', '24444442', '29999992', '24444442', '22222222']] },

  // Top-down: the hero seen from above, facing down; walking right, up and down in two steps each.
  'topdown:Player': { frames: [['..4444..', '.4ffff4.', '.f0ff0f.', '.ffffff.', '..bbbb..', '.fbbbbf.', '..b..b..', '..1..1..']] },
  'topdown:Player:run': {
    frames: [
      ['..4444..', '..4fff..', '..ff0f..', '...ff...', '..bbbb..', '..bbbbf.', '..b..b..', '.1....1.'],
      ['..4444..', '..4fff..', '..ff0f..', '...ff...', '..bbbb..', '..bbbbf.', '...bb...', '...11...'],
    ],
    fps: 6,
  },
  'topdown:Player:up': {
    frames: [
      ['..4444..', '.444444.', '.444444.', '..4444..', '..bbbb..', '.fbbbbf.', '..b..b..', '..1.....'],
      ['..4444..', '.444444.', '.444444.', '..4444..', '..bbbb..', '.fbbbbf.', '..b..b..', '.....1..'],
    ],
    fps: 6,
  },
  'topdown:Player:down': {
    frames: [
      ['..4444..', '.4ffff4.', '.f0ff0f.', '.ffffff.', '..bbbb..', '.fbbbbf.', '..b..b..', '..1.....'],
      ['..4444..', '.4ffff4.', '.f0ff0f.', '.ffffff.', '..bbbb..', '.fbbbbf.', '..b..b..', '.....1..'],
    ],
    fps: 6,
  },
  // A stone wall seen from above.
  'topdown:Wall': { frames: [['66656665', 'ddd5ddd5', '55555555', '65666566', 'd5ddd5dd', '55555555', '66656665', 'ddd5ddd5']] },
  // Dark floor tiles.
  'topdown:Floor': { frames: [['11111111', '1d111111', '11111111', '111111d1', '11111111', '11111111', '111d1111', '11111111']] },
  // An orange ghost.
  'topdown:Enemy': { frames: [['..9999..', '.999999.', '97099709', '99999999', '99988999', '99999999', '99999999', '9.99.99.']] },
  // A door seen from above.
  'topdown:Door': { frames: [['55555555', '54444445', '54244245', '54244245', '54244a45', '54244245', '54444445', '55555555']] },
  // Spikes poking up from the floor.
  'topdown:Hazard': { frames: [['11111111', '17117117', '16116116', '11111111', '71171171', '61161161', '11111111', '11111111']] },
  // A ring-shaped pad.
  'topdown:Teleporter': { frames: [['..dddd..', '.dccccd.', 'dcc77ccd', 'dc7..7cd', 'dc7..7cd', 'dcc77ccd', '.dccccd.', '..dddd..']] },
  // Stairs going down into the dark.
  'topdown:Goal': { frames: [['66666666', 'dddddddd', 'dddddd11', '55551111', '55551111', '11110000', '11000000', '00000000']] },
  // A barrel seen from above.
  'topdown:Barrel': { frames: [['..2222..', '.244442.', '24999942', '24944942', '24944942', '24999942', '.244442.', '..2222..']] },
};

/** The 8-pixel drawing for a starter look, or null if the set has none. */
export function eightBitArt(gameType: string, object: string, situation: string | null): { palette: PixelArt['palette']; frames: string[][]; fps?: number } | null {
  const suffix = situation ? `:${situation}` : '';
  const entry = SET[`${gameType}:${object}${suffix}`] ?? SET[`*:${object}${suffix}`];
  if (!entry) return null;
  const used = new Set(entry.frames.flatMap((f) => [...f.join('')]));
  return { palette: PALETTE.filter((p) => used.has(p.key)), frames: entry.frames.map((f) => [...f]), fps: entry.fps };
}

/** Every drawing's key (for tests). */
export const EIGHT_BIT_KEYS = Object.keys(SET);
