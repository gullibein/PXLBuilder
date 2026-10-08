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
import { resolveEntity } from '../model/resolve';
import { isTopDownScene } from '../model/topDown';
import type { Project, Scene } from '../types';

export interface LevelDesignIdea {
  /** The layout to build this time, with how to build it. */
  layout: { name: string; how: string };
  /** Where things go this time. */
  start: string;
  goal: string;
  /** The shapes of the game's other levels (don't build the same again). */
  otherLevels: string[];
}

/** Side-view (platformer) layouts, each with how to build it with build_path. */
const SIDE_LAYOUTS: { name: string; how: string }[] = [
  {
    name: 'Tower',
    how: 'Mostly UP, in layers stacked right above each other, the level about as tall as it is wide: a ground floor, then climbs with back true (or turn + jumps) so each floor runs back over the one below; 3 to 5 floors; side rooms off the floors (a key at the end of one); the goal on the top floor.',
  },
  {
    name: 'Descent',
    how: 'Start HIGH and go DOWN: the player starts on a top ledge; drops (jump with negative rise), step downs, ladders going down (build the lower part as its own route from a "_" cell and connect with a climb up), hazards on the landings; the goal at the very bottom.',
  },
  {
    name: 'Hub',
    how: 'The player starts in the MIDDLE on a central platform; two or three branches go out from it (one left, one right, maybe one up a ladder): one branch hides the key, another ends at the locked goal (a Door that requires the key, or a Goal behind a switch). The player has to go out and come back.',
  },
  {
    name: 'Valley',
    how: 'Start high on one side, go down into a deep valley or pit in the middle (hazards and enemies at the bottom), then climb back up the far side to the goal, which is at about the starting height.',
  },
  {
    name: 'Mountain',
    how: 'Start low, climb to a peak in the MIDDLE of the level (the highest point, with the key or a switch), then go down the other side to the goal at the bottom of the far slope.',
  },
  {
    name: 'Switchback',
    how: 'Zig-zag UP: long runs that alternate direction (turn, then jump up onto a ledge beyond the end of the floor below, or climb with back true), each layer above the last, enemies patrolling the long runs; the goal at the top, above the start.',
  },
  {
    name: 'Two paths',
    how: 'From the start the level splits into an UPPER path (jumps, more coins, harder) and a LOWER path (a cave or ground route, enemies, slower); they join again before the goal. Build each as its own route from the fork.',
  },
  {
    name: 'Out and back',
    how: 'The goal is right next to the start but locked (a Door that requires the key). The key is far away at the end of a long route (out along the ground, or up and over); the way back is different from the way out (a drop, a teleporter, a lower path).',
  },
  {
    name: 'Islands',
    how: 'A long horizontal stretch of small floating platforms (1-3 cells) at mixed heights over a bottomless gap: no ladders, all jumps, a few coins in the air between them; moving or enemy-guarded islands near the end.',
  },
  {
    name: 'Shaft',
    how: 'A narrow vertical climb, only about 6-10 cells wide: short ledges alternating left and right (turn after each), a ladder in places, hazards on some ledges; the goal at the top. Then, if the user wants more, a short run at the top.',
  },
  {
    name: 'Basement',
    how: 'The player starts on the surface; the way on is DOWN into an underground level (a drop or ladder down), a winding route through it to a switch or key, then a ladder back up to the goal on the surface further along.',
  },
  {
    name: 'Long run',
    how: 'Mostly flat and long, but busy: runs broken by gaps, spikes and enemies, small steps up and down (rise ±1), a stretch where the floor drops and rises again, the goal far along; not every level has to climb.',
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

/** This request's idea for a level (`random` in [0,1), e.g. Math.random). */
export function levelDesignIdea(project: Project, scene: Scene, registry: ComponentRegistry, random: () => number): LevelDesignIdea {
  const topDown = isTopDownScene(project, scene, registry);
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length) % list.length];
  const layout = pick(topDown ? TOPDOWN_LAYOUTS : SIDE_LAYOUTS);
  const mirrored = random() < 0.5;
  return {
    layout: { name: layout.name, how: topDown ? layout.how : `${layout.how}${mirrored ? ' Build it mirrored: the main direction is LEFT (direction "left").' : ''}` },
    start: pick(topDown ? TD_STARTS : SIDE_STARTS),
    goal: pick(topDown ? TD_GOALS : SIDE_GOALS),
    otherLevels: project.scenes.filter((s) => s.id !== scene.id).flatMap((s) => {
      const shape = levelShape(project, s, registry);
      return shape ? [`${s.name}: ${shape}`] : [];
    }),
  };
}
