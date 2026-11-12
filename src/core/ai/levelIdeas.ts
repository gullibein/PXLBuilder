/**
 * Variety for levels the AI builds. Asked to "make a level", a model picks
 * the same safe layout every time (for platformers: start bottom left, climb
 * to the top right). So the app does the choosing: each request about a level
 * or the game comes with a layout drawn at random from a list (with a start
 * and a goal placement, sometimes mirrored), and the shapes of the game's
 * other levels, so a new level is something else. The AI follows the idea
 * unless the user asked for something specific.
 */
import type { ComponentRegistry } from '../components/registry';
import { getEntitySize } from '../model/geometry';
import { resolveEntity, type ResolvedEntity } from '../model/resolve';
import { isTopDownScene } from '../model/topDown';
import type { Project, Scene } from '../types';

export interface LevelDesignIdea {
  /** The layout to build this time, with how to build it. */
  layout: { name: string; how: string };
  /** Side levels: how big (in screens and cells). */
  size?: string;
  /** Side levels in a game that has no look of its own yet: the kind of platformer to make (with its rules). */
  style?: { name: string; rules: string };
  /** Side levels: the puzzles to build this level around (fitting the kind of platformer), each with how. */
  puzzles?: string[];
  /** Where things go this time. */
  start: string;
  goal: string;
  /** The shapes of the game's other levels (don't build the same again). */
  otherLevels: string[];
  /** For new levels made in the same answer (create_level): one different idea each, in order (side levels: with puzzles of their own). */
  forNewLevels: { layout: { name: string; how: string }; start: string; goal: string; puzzles?: string[] }[];
}

/** How many ideas for new levels each request carries. */
const NEW_LEVEL_IDEAS = 4;

/**
 * Side-view (platformer) layouts: compact levels that fill the screen, floors stacked on each other and a way
 * through that goes up, down, left and right (never one long flat run). Drawn with draw_map.
 */
const SIDE_LAYOUTS: { name: string; how: string }[] = [
  {
    name: 'Stacked floors',
    how: 'Three or four floors stacked right above each other in an enclosed room, the whole height of the level. The way zig-zags: along a floor, up (ladder, jump-through ledges, a ramp) at its far end, back the other way along the next, up again; side pockets with items; the goal on the top floor, above the start.',
  },
  {
    name: 'Descent',
    how: 'Start at the TOP and work DOWN through stacked floors: drop through gaps and jump-through platforms, slide down ramps, ladders down into a lower cave; hazards on the landings; the goal at the very bottom, under the start.',
  },
  {
    name: 'Hub',
    how: 'The player starts in the MIDDLE of the screen on a central floor; ways out in all directions: up a ladder to an upper room, down through a hole to a lower one, left and right into side rooms. The key in one room, the locked goal in another: out and back.',
  },
  {
    name: 'Loop',
    how: 'A circuit round a solid middle block: the start bottom left, up the left side (ladder or ledges) along the top to the right, down the right side to a switch or key at the bottom right, and back along the bottom (now open) to the goal. Every part of the screen is used.',
  },
  {
    name: 'Shaft',
    how: 'A tall level about one screen wide and two high: a shaft climbed by ledges on alternate sides, jump-through platforms across it and a ladder or two; side caves off it with items; the goal at the top.',
  },
  {
    name: 'Two ways',
    how: 'From the start the way splits into an UPPER route (jumps over gaps, jump-through platforms, coins, harder) and a LOWER route (a cave or water to swim through, enemies, slower), stacked one above the other across the screen; they meet again before the goal.',
  },
  {
    name: 'Pit and climb',
    how: 'Start high on one side, go DOWN into a deep pit (water or hazards at the bottom, ledges on its walls), across it, then climb back up the far side by ladders and ledges to the goal at about the start\'s height.',
  },
  {
    name: 'Locked up',
    how: 'The goal is close to the start, behind a door that needs the key (or a switch). The key is in the far corner of the screen, at the end of a winding way up, across and down through the floors; the way back is shorter (a drop, a jump-through floor).',
  },
  {
    name: 'Rooms',
    how: 'Four to six small rooms in a grid on the screen (two or three across, two high), joined by doorways, holes in their floors and ladders between them; one room has the key, one the goal, others enemies, crates or water.',
  },
];

/** How big a side level is: one screen is about 30 by 17 cells (at the normal zoom). */
const SIDE_SIZES = ['one screen (about 30 by 17 cells)', 'one screen (about 30 by 17 cells)', 'two screens tall (about 30 by 34 cells)', 'two screens wide (about 60 by 17 cells)', 'two by two screens (about 60 by 34 cells)'];

/**
 * Kinds of platformer, each with its own look and pieces: a game is one kind throughout (the user's words decide;
 * without any, the one suggested here), and each kind has its own rules (what is in it and what never is).
 */
/**
 * Puzzles a level is built around, with the pieces each needs (by the starter objects' names; a game's own look of
 * them, made with create_definition, is as good). Each kind of platformer has its own (PLATFORMER_STYLES[].puzzles).
 */
export const LEVEL_PUZZLES: Record<string, string> = {
  'crate step': 'A ledge one or two blocks higher than a jump, with a Crate on the floor below it a few cells away: the player pushes the crate under the ledge and climbs on it (there is no other way up).',
  'crate stack': 'Two Crates to push one beside the other into a step, or a crate pushed off a ledge into a pit to make a step out of it.',
  'teleporter shortcut': 'A pair of Teleporters (place_instance each with a ref, then teleports_to both ways): one in a sealed room (the key or a switch inside), the other on the main way; or a quick way back from the far end to the start.',
  'drop-through': 'A key or switch under a jump-through floor (Bridge): seen from above, reached by Down + Jump through it; and jump-through ledges up a shaft as the way up.',
  'bridge over the gap': 'A pit or a pool too wide to jump, crossed by a row of Bridge; enemies walking on it, or coins under it in the pit.',
  'swim for it': 'A pool (Water on top, Deep water under it) to dive into: the key or gems at the bottom, or an underwater tunnel through a wall to the next room.',
  'hill': 'A hill of ground with a Ramp up one side and Ramp left down the other (or ramps between two floors instead of a ladder); an enemy walking over it, coins on the top.',
  'spring up': 'A ledge too high for any jump (springRows rows over the floor, playerReach.cells), with a Spring (or the game\'s own bouncy thing) on the floor under it: holding Jump on the spring launches the player up there; the key or the way on is up top.',
  'switch and door': 'A Switch on one floor opens a Door (controls/opens connection) somewhere else: the player sees the shut door first, then finds the switch.',
  'key and door': 'The Goal behind a Door that requires the Key, the key at the far end of another branch.',
  'moving platform': 'A wide gap or shaft crossed on a moving platform (an object with MovingPlatform, made with create_definition; its path through points, back and forth or a loop), with coins along its path.',
  'hidden ladder': 'A ladder whose pieces start hidden (StartsHidden) and appear when every coin is collected (a rule), leading up to the goal.',
  'lava pit': 'A pit of lava (Liquid swim false with a Hurts on touch script, glowing) to jump over, with ledges or a moving platform across it: the lava fills the WHOLE pit in the map (every cell, the platform\'s too), the platform goes in after the map with place_instance, riding in the row ABOVE the lava\'s top (its top a cell above the lava: whoever rides it never touches the lava).',
};

export const PLATFORMER_STYLES: { name: string; rules: string; puzzles: string[] }[] = [
  {
    name: 'Classic blocks',
    rules: 'Bright sky, chunky solid blocks and bricks, floating block rows, pipes, pits; a block-built ground with a grassy top. Every platform is solid (no jump-through platforms, no ramps); coins in the air; walking enemies (Walker).',
    puzzles: ['crate step', 'teleporter shortcut', 'switch and door', 'moving platform', 'hidden ladder', 'spring up'],
  },
  {
    name: 'Cave explorer',
    rules: 'An enclosed cave: thick rock all round (autotiled), floors stacked inside it, a dark back wall, stalactites and vines hanging from the ceilings, glowing mushrooms; ladders, thin jump-through ledges and bridges, ramps where floors meet; pools of water (or acid); gems to collect; crates and barrels.',
    puzzles: ['crate step', 'drop-through', 'bridge over the gap', 'swim for it', 'hill', 'teleporter shortcut', 'crate stack', 'spring up'],
  },
  {
    name: 'Hills and islands',
    rules: 'Outdoors: grassy hills of earth with 45 degree ramps up and down, floating islands, mushroom caps or clouds as jump-through platforms (on stems or nothing), vines to climb, trees, flowers and rocks as decoration, water below; a cottage or sign by the start.',
    puzzles: ['hill', 'bridge over the gap', 'swim for it', 'drop-through', 'crate step', 'teleporter shortcut', 'spring up'],
  },
  {
    name: 'Indoor rooms',
    rules: 'A building or lab: rooms with solid walls and floors, a patterned back wall, thin metal bars and plank shelves as jump-through platforms, crates and hazard boxes stacked, buttons and doors between rooms, elevators (moving platforms); no ramps.',
    puzzles: ['crate step', 'crate stack', 'switch and door', 'drop-through', 'teleporter shortcut', 'moving platform', 'spring up'],
  },
  {
    name: 'Ruined temple',
    rules: 'Ancient stone blocks with cracks, overgrown with moss and grass, spikes on floors and ceilings, fire or lava pits, moving platforms on chains, stone ledges; a timer or a score in the corner; few ramps, no water.',
    puzzles: ['lava pit', 'moving platform', 'crate step', 'switch and door', 'hidden ladder', 'teleporter shortcut', 'spring up'],
  },
];

/** Top-down layouts (rooms and corridors). */
const TOPDOWN_LAYOUTS: { name: string; how: string }[] = [
  { name: 'Dungeon rooms', how: 'Four to six rooms of different sizes joined by 1-2 cell corridors; the key in a far room, the goal behind a locked door in another; enemies in the bigger rooms.' },
  { name: 'Maze', how: 'A maze of 1-cell corridors with dead ends (coins or hazards in some), the start and goal far apart.' },
  { name: 'Hub and spokes', how: 'A big central room where the player starts, with corridors out to smaller rooms on every side: switches or keys in the side rooms open the way to the goal.' },
  { name: 'Ring', how: 'Rooms arranged in a loop around a solid middle; two ways round, one guarded, one with hazards; the goal opposite the start.' },
  { name: 'Long hall', how: 'One long hall broken by pillars, side alcoves (items, enemies) and locked gates part way along; the goal at the far end.' },
  { name: 'Courtyard', how: 'An open outdoor area (floor, few walls) with small buildings to enter, one holding the key; enemies wander outside.' },
];

const SIDE_STARTS = ['on the left', 'in the middle', 'on the right', 'up high', 'down low'];
const SIDE_GOALS = ['far from the start, at the other end', 'high up', 'down low', 'close to the start but locked or behind a switch', 'in the middle'];
const TD_STARTS = ['in a corner room', 'in the middle', 'at one edge', 'at the bottom', 'at the top'];
const TD_GOALS = ['in the room farthest from the start', 'behind a locked door', 'in the middle, reached the long way round', 'near the start but locked'];

/** "starts bottom left, goal top right; about 40 by 12 cells". Null for an empty level. */
export function levelShape(project: Project, scene: Scene, registry: ComponentRegistry): string | null {
  if (!scene.entities.length) return null;
  const all = scene.entities.map((e) => resolveEntity(project, e, registry));
  const boxes = all.map((r) => {
    const s = getEntitySize(r);
    return { r, x: r.transform.position.x, y: r.transform.position.y, w: s.x, h: s.y };
  });
  const left = Math.min(...boxes.map((b) => b.x - b.w / 2));
  const right = Math.max(...boxes.map((b) => b.x + b.w / 2));
  const top = Math.min(...boxes.map((b) => b.y - b.h / 2));
  const bottom = Math.max(...boxes.map((b) => b.y + b.h / 2));
  const where = (x: number, y: number) => {
    const fx = (x - left) / Math.max(1, right - left);
    const fy = (y - top) / Math.max(1, bottom - top);
    const v = fy < 0.34 ? 'top' : fy > 0.66 ? 'bottom' : 'middle';
    const h = fx < 0.34 ? 'left' : fx > 0.66 ? 'right' : 'middle';
    return v === h ? 'middle' : `${v} ${h}`;
  };
  const player = boxes.find((b) => b.r.components.CharacterController);
  const goal = boxes.find((b) => b.r.components.Goal) ?? boxes.find((b) => b.r.components.Openable);
  const size = `about ${Math.round((right - left) / 32)} by ${Math.round((bottom - top) / 32)} cells`;
  return [player ? `starts ${where(player.x, player.y)}` : 'no player', goal ? `goal ${where(goal.x, goal.y)}` : 'no goal', size].join(', ');
}

/** What a level is made of, counted: to compare a new level with the others ("harder than level 2"). */
export interface LevelStats {
  /** Its size in cells (across, down). */
  w: number;
  h: number;
  /** Rows with ground to stand on (2+ cells wide). */
  floors: number;
  enemies: number;
  hazards: number;
  /** The kinds of puzzle pieces in it (ramps, water, crates…). */
  pieces: string[];
}

export function levelStats(project: Project, scene: Scene, registry: ComponentRegistry): LevelStats | null {
  if (!scene.entities.length) return null;
  const all = scene.entities.map((e) => resolveEntity(project, e, registry));
  const C = 32;
  const box = all.map((r) => {
    const sz = getEntitySize(r);
    return { r, l: r.transform.position.x - sz.x / 2, t: r.transform.position.y - sz.y / 2, w: sz.x, h: sz.y };
  });
  const left = Math.min(...box.map((b) => b.l));
  const right = Math.max(...box.map((b) => b.l + b.w));
  const top = Math.min(...box.map((b) => b.t));
  const bottom = Math.max(...box.map((b) => b.t + b.h));
  // Standable rows: solid cells with an empty cell above, in runs of 2+ in a row.
  const solidAt = new Set<string>();
  for (const b of box) {
    const col = b.r.components.Collider;
    if (!col || col.isTrigger === true || b.r.components.PhysicsBody?.bodyType === 'dynamic' || b.r.components.CharacterController) continue;
    for (let x = Math.floor((b.l + 1) / C); x <= Math.floor((b.l + b.w - 1) / C); x++) for (let y = Math.floor((b.t + 1) / C); y <= Math.floor((b.t + b.h - 1) / C); y++) solidAt.add(`${x},${y}`);
  }
  const floorRows = new Set<number>();
  for (const k of solidAt) {
    const [x, y] = k.split(',').map(Number);
    if (!solidAt.has(`${x},${y - 1}`) && solidAt.has(`${x + 1},${y}`) && !solidAt.has(`${x + 1},${y - 1}`)) floorRows.add(y);
  }
  const has = (f: (r: ResolvedEntity) => unknown) => all.some(f);
  const hurts = (r: ResolvedEntity) => r.scripts.some((sc) => JSON.stringify(sc.handlers).includes('"damage"') && sc.handlers.some((h) => h.when.on === 'contact'));
  const pieces: [string, boolean][] = [
    ['ladders', has((r) => r.components.Climbable)],
    ['ramps', has((r) => r.components.Collider?.shape === 'slopeRight' || r.components.Collider?.shape === 'slopeLeft')],
    ['jump-through platforms', has((r) => r.components.Collider?.oneWay === true)],
    ['water to swim', has((r) => r.components.Liquid && r.components.Liquid.swim !== false)],
    ['lava', has((r) => r.components.Liquid && r.components.Liquid.swim === false)],
    ['crates', has((r) => r.components.Pushable)],
    ['springs', has((r) => r.scripts.some((sc) => sc.name === 'Spring'))],
    ['moving platforms', has((r) => r.components.MovingPlatform)],
    ['teleporters', scene.relationships.some((rel) => rel.type === 'teleports_to')],
    ['switches', has((r) => r.components.Switch)],
    ['locked doors', scene.relationships.some((rel) => rel.type === 'requires')],
    ['hidden things', has((r) => r.components.StartsHidden)],
  ];
  return {
    w: Math.round((right - left) / C),
    h: Math.round((bottom - top) / C),
    floors: floorRows.size,
    enemies: all.filter((r) => r.tags.some((t) => /^enem/i.test(t)) || r.components.Patrol).length,
    hazards: all.filter((r) => !r.tags.some((t) => /^enem/i.test(t)) && !r.components.Patrol && !r.components.CharacterController && hurts(r)).length,
    pieces: pieces.filter(([, y]) => y).map(([n]) => n),
  };
}

/** A level's stats in a few words. */
export function statsLine(s: LevelStats, size = true): string {
  return `${size ? `${s.w}x${s.h} cells, ` : ''}${s.floors} floor rows, ${s.enemies} enemies, ${s.hazards} hazards; pieces: ${s.pieces.join(', ') || 'none'}`;
}

/** The kind of platformer, and two or three of its puzzles (at random) for this level. */
function styleAndPuzzles(style: (typeof PLATFORMER_STYLES)[number], random: () => number): { style: { name: string; rules: string }; puzzles: string[] } {
  const order = style.puzzles.map((p) => ({ p, k: random() })).sort((a, b) => a.k - b.k).map((x) => x.p);
  const n = 2 + (random() < 0.5 ? 1 : 0);
  return { style: { name: style.name, rules: style.rules }, puzzles: order.slice(0, n).map((p) => `${p}: ${LEVEL_PUZZLES[p]}`) };
}

/** This request's idea for a level (`random` in [0,1), e.g. Math.random). */
export function levelDesignIdea(project: Project, scene: Scene, registry: ComponentRegistry, random: () => number): LevelDesignIdea {
  const topDown = isTopDownScene(project, scene, registry);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length) % list.length];
  const layouts = topDown ? TOPDOWN_LAYOUTS : SIDE_LAYOUTS;
  // Different layouts for this level and each new one (in a random order; repeats only past the list's end).
  const order = layouts.map((l) => ({ l, k: random() })).sort((a, b) => a.k - b.k).map((x) => x.l);
  const idea = (i: number) => {
    const layout = order[i % order.length];
    const mirrored = random() < 0.5;
    return {
      layout: { name: layout.name, how: topDown ? layout.how : `${layout.how}${mirrored ? ' Mirrored: left and right swapped.' : ''}` },
      start: pick(topDown ? TD_STARTS : SIDE_STARTS),
      goal: pick(topDown ? TD_GOALS : SIDE_GOALS),
      ...(topDown ? {} : { size: pick(SIDE_SIZES) }),
    };
  };
  const first = idea(0);
  const gameStyle = pick(PLATFORMER_STYLES);
  return {
    ...first,
    ...(topDown ? {} : styleAndPuzzles(gameStyle, random)),
    // (New levels: puzzles of their own, from the kind of platformer the game is; the AI keeps to its game's kind.)
    forNewLevels: Array.from({ length: NEW_LEVEL_IDEAS }, (_, i) => ({ ...idea(i + 1), ...(topDown ? {} : { puzzles: styleAndPuzzles(gameStyle, random).puzzles }) })),
    otherLevels: project.scenes.filter((s) => s.id !== scene.id).flatMap((s) => {
      const shape = levelShape(project, s, registry);
      const stats = levelStats(project, s, registry);
      return shape ? [`${s.name}: ${shape}${stats ? `; ${statsLine(stats, false)}` : ''}`] : [];
    }),
  };
}
