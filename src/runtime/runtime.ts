/**
 * The game runtime.
 *
 * Built from a snapshot of the project when Play starts and thrown away on
 * Stop: it never writes to the project. Everything it does comes from the
 * same data the editor shows (components, world settings); there is no
 * separate demo logic. Rendering uses the shared renderer.
 */
import type { ComponentRegistry } from '../core/components/registry';
import { itemNameOf } from '../core/graph/graph';
import { createStandaloneEntity, instantiateDefinition } from '../core/model/factory';
import { getEntitySize } from '../core/model/geometry';
import { resolveEntity, type ResolvedEntity } from '../core/model/resolve';
import type { EntityInstance, Id, Project, Scene, Vec2 } from '../core/types';
import type { DrawAnchor, DrawShape } from '../core/script/language';
import type { Camera, RenderEntity } from '../render/renderer';
import { boundsOf, defaultCamera } from '../core/model/camera';
import { BehaviorSystem } from './behaviors';
import { CameraController } from './camera';
import { DEFEATED_LOOK, Gameplay, ownPart, type LoggedEvent } from './gameplay';
import { instantiateScripts, ScriptSystem, type ScriptInstance } from './scripts';
import { ALL_ACTIONS, type Action, type InputState, type InputView } from './input';
import { groundUnder, moveAndCollide, overlaps, standingOn, type Box } from './physics';

export type BodyKind = 'static' | 'dynamic' | 'kinematic' | 'none';

export interface Controller {
  /** platformer: run, jump and climb with gravity; topdown: walk in every direction, seen from above. */
  movement: 'platformer' | 'topdown';
  speed: number;
  acceleration: number;
  jumpForce: number;
  airControl: number;
}

export interface RuntimeEntity {
  id: Id;
  name: string;
  definitionId: Id | null;
  tags: string[];
  /** Resolved editor state at Play time (components, look). Runtime-only changes go in the fields below. */
  base: ResolvedEntity;
  /** False once collected, killed or removed: it no longer moves, collides or draws. */
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  body: BodyKind;
  gravityScale: number;
  /** PhysicsBody.friction: slowing down while sliding on the ground (0..1). */
  friction: number;
  /** PhysicsBody.mass (1 without one): how much hits and pushes move it, and how hard it is to push. */
  mass: number;
  /** The gravity it starts with (respawning restores it). */
  baseGravity: number;
  /** Scales how fast it walks, climbs and patrols (1: normal; scripts set it, e.g. water). */
  speedFactor: number;
  /** Collision box relative to the position (null: no collider). */
  collider: { ox: number; oy: number; hw: number; hh: number; trigger: boolean } | null;
  controller: Controller | null;
  /** Ladders, vines…: things a character can climb. */
  climbable: boolean;
  grounded: boolean;
  /** The friction of what it stands on (as of the last step it was on the ground). */
  groundFriction: number;
  climbing: boolean;
  /**
   * Characters without a controller (enemies): which way it climbs a ladder (-1 up, 1 down, 0 holds still or
   * isn't climbing), set by a script ("climb") or by chasing; it keeps going until the ladder's end or another
   * order. `climbSpeed` in px/s.
   */
  climbDir: -1 | 0 | 1;
  climbSpeed: number;
  coyote: number;
  jumpBuffer: number;
  spawn: Vec2;
  /** How many times it was put back at its start (fell out of the level, or died). */
  respawns: number;
  /**
   * Died and waiting to come back (Health.respawnDelay): seconds left (0: alive as usual). Meanwhile its controls
   * do nothing and it can't hurt, be hurt, stomp or pick things up: its death animation (a script on "died") plays.
   */
  dying: number;
  /**
   * Defeated (stomped, out of health) and gone from play, but still shown in its defeated look (SpriteStates.defeated)
   * where it was, fading out: seconds left (0: not shown). It touches, blocks and hurts nothing meanwhile.
   */
  vanishing: number;
  /** Its shooter's own random rhythm (a stream of its own, so scripts and the engine draw the same waits). */
  shotSeed: number;
  /** Keys held when it respawned: ignored until they are let go (a key held through a death doesn't walk it off). */
  heldBlock: Set<Action> | null;
  /** Opened (doors…): it no longer blocks and is drawn faded. */
  open: boolean;
  switch: { activation: 'interact' | 'touch'; once: boolean; on: boolean; used: boolean } | null;
  health: { current: number; max: number; respawnDelay: number } | null;
  /** How it takes hits (DamageReceiver): blinking time after one and how hard it is shoved. What hurts it is up to the scripts that hurt. */
  receiver: { invincibility: number; knockback: number } | null;
  /** Pushable: how it moves when pushed (step 0 = slides), who may push it, and when it was last pushed (a push after a pause is a new "pushed" event). */
  pushable: { step: number; pushers: string[]; speed: number; pushedAt: number } | null;
  /** Being knocked back by a hit: for how long, and the velocity it had before (it goes back to that after). */
  knock: { t: number; restore: { vx: number; vy: number } } | null;
  /** A shot's damage (on what it hits), or null. */
  damage: number | null;
  /** Seconds left without taking damage. */
  invincible: number;
  /** Item name -> count, or null without an Inventory. */
  inventory: Map<string, number> | null;
  collectible: { item: string; keep: boolean; heal: number } | null;
  /** Which way it faces (1 right, -1 left): set by running and patrolling; drawn mirrored when -1. */
  facing: 1 | -1;
  /** The way it last moved or looked, as a direction (x, y each -1, 0 or 1; diagonals too): where a top-down character shoots. */
  heading: { x: number; y: number };
  /** The ladder a script's patrol last decided about (ladderChoice: once per ladder it passes). */
  ladderSeen: string | null;
  /** The side it bumped into a wall on in the last step (-1 left, 1 right, 0 none). */
  bumped: -1 | 0 | 1;
  /** Behavior scripts this entity runs (its own copy: variables, state). */
  scripts: ScriptInstance[];
  /** See-through amount set by a script (null: normal). */
  alpha: number | null;
  /** Turn set by scripts, in degrees clockwise on top of its placed rotation (only drawn: collisions stay upright boxes). */
  angle: number;
  /** A turn in progress (rotate over seconds): the angle to reach and how fast (degrees/s). */
  turn: { to: number; speed: number } | null;
  /** Keeps turning at this many degrees/s (spin; 0 = not spinning). */
  spin: number;
  /** Drawn mirrored by a level flip (-1) or not (1), per axis; flipT: during a flip, how far its own turn is (0-1). */
  mirror: { x: 1 | -1; y: 1 | -1 };
  flipT: number | null;
  /** Trail: where it was lately (play time t), and how long the tail lasts. */
  trail: { length: number; points: { x: number; y: number; t: number }[] } | null;
  /** Play time it was last hurt / last fired a shot (for the hurt and shoot looks). */
  hurtAt: number;
  shotAt: number;
  /** Being steered by a "follows" relationship this step (so it isn't also patrolling). */
  chasing: boolean;
  /** Behaviors (from behavior components) and their running state. */
  beh: Behaviors;
  /** Hanging from a ledge (LedgeGrab): which side the wall is on, its top, and its face. */
  hanging: { side: 1 | -1; top: number; edgeX: number } | null;
  /** A script moved it itself this step (onto a ladder's top, up onto a ledge): its controls do nothing more until the next step. */
  controlsDone: boolean;
  /** Seconds before it can grab a ledge again (after letting go). */
  grabCooldown: number;
  /** A shot: who fired it, the tags of its side (it never hurts them), and how far it may still fly. */
  projectile: { owner: Id; team: string[]; left: number } | null;
  /** Removed by a switch ("disappear"), so switching back brings it back. */
  hiddenBySwitch: boolean;
  /** Where a switch is moving it, and how fast (px/s; 0 = at once). */
  moveTarget: { x: number; y: number; speed: number } | null;
  /** Seconds after a stomp during which what it stomped can't hurt it. */
  stompGrace: number;
  /** Position at the start of the step (to tell landing on top from bumping into the side). */
  prevY: number;
  /** Ids of the entities it touches right now (moving entities only). */
  touching: Set<Id>;
}

/** Fixed simulation step: stable physics regardless of display refresh rate. */
export const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 12;
const MAX_FALL_SPEED = 1400;
const MIN_MASS = 0.01;
/** A Pushable this many times heavier than its pusher can't be moved by it. */
export const TOO_HEAVY = 10;
/** Friction 1 takes this much speed away per second (px/s²); 0.2 takes a fifth of it. */
const FRICTION_DECEL = 1000;
/** PhysicsBody.friction when none is set: on such ground, grip is exactly as without friction at all. */
const DEFAULT_FRICTION = 0.2;
/**
 * How much grip a character has on the ground, from its own friction and the surface's, each relative to the
 * default (both at the default: 1, as it always was). Its acceleration on the ground (speeding up, stopping,
 * turning) is scaled by this: an icy floor (0.05) or icy shoes make it slow to start and stop; a sticky floor
 * makes it snappier. Never quite nothing (it can still get going on ice) and at most 4 times.
 */
export function groundGrip(own: number, surface: number): number {
  return Math.min(4, Math.max(0.15, (own / DEFAULT_FRICTION) * (surface / DEFAULT_FRICTION)));
}
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
/** How much of a character must be inside a ladder (horizontally) to climb it. */
const LADDER_GRIP = 0.5;
/** How quickly a climbing character eases to the ladder's middle (per second, exponential). */
const LADDER_CENTERING = 10;
/** How far below the lowest object counts as "fell out of the level". */
const FALL_MARGIN = 800;

function boxOf(e: RuntimeEntity): Box | null {
  return e.collider ? { x: e.x + e.collider.ox, y: e.y + e.collider.oy, hw: e.collider.hw, hh: e.collider.hh } : null;
}

/** The area an entity covers on screen (its sprite), used for ladders: you climb the tile you see. */
/** The y of the bottom of its body (what ladder tops are compared with). */
export function feetOf(e: RuntimeEntity): number {
  const z = zoneOf(e);
  return z.y + z.hh;
}

function zoneOf(e: RuntimeEntity): Box {
  const size = getEntitySize(e.base);
  const scale = e.base.transform.scale;
  return { x: e.x, y: e.y, hw: (size.x * Math.abs(scale.x)) / 2, hh: (size.y * Math.abs(scale.y)) / 2 };
}

export interface Ladder {
  x: number;
  hw: number;
  top: number;
  bottom: number;
}

/** Joins ladder pieces stacked directly on top of each other (same column) into ladders. */
function ladderColumns(pieces: RuntimeEntity[]): Ladder[] {
  const zones = pieces.map(zoneOf).sort((a, b) => a.x - b.x || a.y - b.y);
  const ladders: Ladder[] = [];
  for (const z of zones) {
    const above = ladders.find((l) => Math.abs(l.x - z.x) < 1 && Math.abs(l.hw - z.hw) < 1 && z.y - z.hh <= l.bottom + 1 && z.y + z.hh > l.bottom);
    if (above) above.bottom = Math.max(above.bottom, z.y + z.hh);
    else ladders.push({ x: z.x, hw: z.hw, top: z.y - z.hh, bottom: z.y + z.hh });
  }
  return ladders;
}

/** Something a script drew on the screen (values already worked out). */
export interface ScreenDrawing {
  /** Id of the entity that drew it (erase with id null removes its drawings). */
  owner: Id;
  shape: DrawShape;
  anchor: DrawAnchor;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  size: number;
  color: string;
  /** Library object whose look is drawn (shape "sprite"). */
  object: Id | null;
  alpha: number;
  /** Drawing order: later on top. */
  order: number;
}

export type Situation = 'idle' | 'run' | 'up' | 'down' | 'jump' | 'fall' | 'climb' | 'hang' | 'hurt' | 'shoot' | 'defeated';
/** How long the hurt and shoot looks last (seconds). */
const HURT_LOOK = 0.4;
const SHOOT_LOOK = 0.25;

export interface Behaviors {
  /** dir: 1 right (or down when vertical), -1 left (or up). */
  patrol: {
    speed: number;
    distance: number;
    turnAtLedges: boolean;
    originX: number;
    originY: number;
    dir: 1 | -1;
    vertical: boolean;
    climbLadders: boolean;
    chaseRange: number;
    /** The ladder it last decided about (so it decides once per ladder it passes). */
    lastLadder: string | null;
    /** Chasing the player it saw, and for how long it has been out of sight. */
    hunting: boolean;
    lost: number;
    chaseSpeed: number;
    /** Seconds to turn while chasing; turnT is how long it has been slowing down to turn. */
    reaction: number;
    turnT: number;
  } | null;
  jumper: { interval: number; jumpForce: number; t: number } | null;
  /** need: the wait before the next shot (drawn from the shooter's own random rhythm; -1 until it first ticks). */
  shooter: { trigger: 'auto' | 'key'; interval: number; variation: number; direction: string; targetTag: string; speed: number; damage: number; range: number; projectile: string; shotColor: string; shotSize: number; turnShots: boolean; t: number; need: number } | null;
  mover: { offset: Vec2; speed: number; pause: number; originX: number; originY: number; toEnd: boolean; wait: number } | null;
  timer: { interval: number; repeat: boolean; t: number; done: boolean } | null;
  doubleJump: { extra: number; left: number } | null;
  ledgeGrab: boolean;
  /** Wander: its way now (dx, dy each -1, 0 or 1; 0,0 = standing) and when it next picks another. */
  wander: { speed: number; interval: number; pauses: boolean; dx: number; dy: number; t: number } | null;
}

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export function readBehaviors(c: Record<string, Record<string, unknown>>, at: Vec2): Behaviors {
  const p = c.Patrol;
  const j = c.Jumper;
  const s = c.Shooter;
  const mv = c.MovingPlatform;
  const t = c.Timer;
  return {
    patrol: p
      ? {
          speed: num(p.speed, 60),
          distance: num(p.distance, 0),
          turnAtLedges: p.turnAtLedges !== false,
          originX: at.x,
          originY: at.y,
          dir: p.startDirection === 'left' || p.startDirection === 'up' ? -1 : 1,
          vertical: p.startDirection === 'up' || p.startDirection === 'down',
          climbLadders: p.climbLadders === true,
          chaseRange: num(p.chaseRange, 0),
          lastLadder: null,
          hunting: false,
          lost: 0,
          chaseSpeed: num(p.chaseSpeed, 0),
          reaction: num(p.reaction, 0),
          turnT: 0,
        }
      : null,
    jumper: j ? { interval: num(j.interval, 2), jumpForce: num(j.jumpForce, 300), t: 0 } : null,
    shooter: s
      ? {
          trigger: s.trigger === 'key' ? 'key' : 'auto',
          interval: num(s.interval, 2),
          variation: Math.min(1, Math.max(0, num(s.variation, 0.5))),
          direction: typeof s.direction === 'string' ? s.direction : 'facing',
          targetTag: typeof s.targetTag === 'string' ? s.targetTag : 'player',
          speed: num(s.speed, 240),
          damage: num(s.damage, 1),
          range: num(s.range, 480),
          projectile: typeof s.projectile === 'string' ? s.projectile : '',
          shotColor: typeof s.shotColor === 'string' ? s.shotColor : '#ffd166',
          shotSize: Math.max(2, num(s.shotSize, 8)),
          turnShots: s.turnShots !== false,
          // Fired by a key: ready at once. Automatic: the first shot comes after one interval.
          t: s.trigger === 'key' ? num(s.interval, 2) : 0,
          need: -1,
        }
      : null,
    mover: mv ? { offset: (mv.offset as Vec2) ?? { x: 96, y: 0 }, speed: num(mv.speed, 64), pause: num(mv.pause, 0.5), originX: at.x, originY: at.y, toEnd: true, wait: 0 } : null,
    timer: t ? { interval: num(t.interval, 2), repeat: t.repeat !== false, t: 0, done: false } : null,
    doubleJump: c.DoubleJump ? { extra: num(c.DoubleJump.extraJumps, 1), left: num(c.DoubleJump.extraJumps, 1) } : null,
    ledgeGrab: !!c.LedgeGrab,
    // Starts by standing still; the first pick comes at once.
    wander: c.Wander ? { speed: num(c.Wander.speed, 50), interval: Math.max(0.2, num(c.Wander.interval, 2)), pauses: c.Wander.pauses !== false, dx: 0, dy: 0, t: 0 } : null,
  };
}

/**
 * The collision box for its Collider, scale and rotation. A turned box
 * collides as the upright box around it (exact for quarter turns), except
 * for things that move by physics (characters): they keep an upright box, so
 * a flip or a spin can't push them into walls or floors.
 */
export function colliderOf(c: ResolvedEntity['components'], transform: ResolvedEntity['transform'], extraTurn = 0): RuntimeEntity['collider'] {
  const col = c.Collider;
  if (!col) return null;
  const scale = transform.scale;
  const size = col.size as Vec2;
  const off = col.offset as Vec2;
  let w = size.x * Math.abs(scale.x);
  let h = (col.shape === 'circle' ? size.x : size.y) * Math.abs(scale.y);
  let ox = off.x * scale.x;
  let oy = off.y * scale.y;
  const dynamic = c.PhysicsBody?.bodyType === 'dynamic';
  const turn = (((transform.rotation + extraTurn) % 360) + 360) % 360;
  if (turn !== 0 && !dynamic && col.shape !== 'circle') {
    const a = (turn * Math.PI) / 180;
    const cos = Math.abs(Math.cos(a)) < 1e-9 ? 0 : Math.cos(a);
    const sin = Math.abs(Math.sin(a)) < 1e-9 ? 0 : Math.sin(a);
    [w, h] = [Math.abs(w * cos) + Math.abs(h * sin), Math.abs(w * sin) + Math.abs(h * cos)];
    [ox, oy] = [ox * cos - oy * sin, ox * sin + oy * cos];
  }
  return { ox, oy, hw: w / 2, hh: h / 2, trigger: col.isTrigger === true };
}

function buildEntity(project: Project, instance: EntityInstance, registry: ComponentRegistry): RuntimeEntity {
  return entityFrom(project, resolveEntity(project, instance, registry));
}

/** The runtime entity for a resolved entity (also used to re-read one component's values during play). */
export function entityFrom(project: Project, r: ResolvedEntity): RuntimeEntity {
  const c = r.components;
  const pb = c.PhysicsBody;
  const collider = colliderOf(c, r.transform);
  const cc = c.CharacterController;
  const vel = (pb?.velocity as Vec2 | undefined) ?? { x: 0, y: 0 };
  const objectName = project.definitions.find((d) => d.id === r.definitionId)?.name ?? r.name;
  const item = itemNameOf(c, objectName);
  let inventory: Map<string, number> | null = null;
  if (c.Inventory) {
    inventory = new Map();
    for (const name of (c.Inventory.items as string[]) ?? []) inventory.set(name, (inventory.get(name) ?? 0) + 1);
  }
  return {
    id: r.id,
    name: r.name,
    definitionId: r.definitionId,
    tags: r.tags,
    base: r,
    alive: true,
    x: r.transform.position.x,
    y: r.transform.position.y,
    vx: vel.x,
    vy: vel.y,
    body: pb ? (pb.bodyType as BodyKind) : 'none',
    gravityScale: typeof pb?.gravityScale === 'number' ? pb.gravityScale : 1,
    friction: typeof pb?.friction === 'number' ? Math.min(1, Math.max(0, pb.friction)) : 0.2,
    mass: typeof pb?.mass === 'number' && pb.mass > 0 ? Math.max(MIN_MASS, pb.mass) : 1,
    baseGravity: typeof pb?.gravityScale === 'number' ? pb.gravityScale : 1,
    speedFactor: 1,
    collider,
    controller: cc ? { movement: cc.movement === 'topdown' ? 'topdown' : 'platformer', speed: Number(cc.speed), acceleration: Number(cc.acceleration), jumpForce: Number(cc.jumpForce), airControl: Number(cc.airControl) } : null,
    climbable: !!c.Climbable,
    grounded: false,
    groundFriction: DEFAULT_FRICTION,
    climbing: false,
    climbDir: 0,
    climbSpeed: 80,
    coyote: 0,
    jumpBuffer: 0,
    spawn: { ...r.transform.position },
    respawns: 0,
    dying: 0,
    vanishing: 0,
    // (From what it is and where it starts: the same every time the level is played.)
    shotSeed: [...`${r.name}@${Math.round(r.transform.position.x)},${Math.round(r.transform.position.y)}`].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 2166136261) % 4294967296,
    heldBlock: null,
    open: c.Openable?.startsOpen === true,
    switch: c.Switch ? { activation: c.Switch.activation === 'touch' ? 'touch' : 'interact', once: c.Switch.once === true, on: c.Switch.startsOn === true, used: false } : null,
    health: c.Health ? { current: Number(c.Health.currentHealth), max: Number(c.Health.maxHealth), respawnDelay: Math.max(0, Number(c.Health.respawnDelay) || 0) } : null,
    receiver: c.DamageReceiver ? { invincibility: Number(c.DamageReceiver.invincibilityDuration), knockback: typeof c.DamageReceiver.knockback === 'number' ? c.DamageReceiver.knockback : 160 } : null,
    knock: null,
    pushable: c.Pushable ? { step: Number(c.Pushable.step) || 0, pushers: (c.Pushable.pushers as string[]) ?? ['player'], speed: Number(c.Pushable.speed) || 160, pushedAt: -Infinity } : null,
    damage: null,
    invincible: 0,
    inventory,
    collectible: c.Collectible && item ? { item, keep: c.Collectible.collectionBehavior !== 'consume', heal: Math.max(0, Number(c.Collectible.heal) || 0) } : null,
    stompGrace: 0,
    facing: c.Patrol?.startDirection === 'left' ? -1 : 1,
    heading: c.Patrol?.startDirection === 'up' ? { x: 0, y: -1 } : c.Patrol?.startDirection === 'down' ? { x: 0, y: 1 } : { x: c.Patrol?.startDirection === 'left' ? -1 : 1, y: 0 },
    bumped: 0,
    ladderSeen: null,
    hurtAt: -Infinity,
    shotAt: -Infinity,
    chasing: false,
    scripts: instantiateScripts(r.scripts),
    alpha: null,
    angle: 0,
    turn: null,
    spin: 0,
    mirror: { x: 1, y: 1 },
    flipT: null,
    trail: c.Trail ? { length: Math.min(2, Math.max(0.02, num(c.Trail.length, 0.15))), points: [] } : null,
    beh: readBehaviors(c, r.transform.position),
    hanging: null,
    controlsDone: false,
    grabCooldown: 0,
    projectile: null,
    hiddenBySwitch: false,
    moveTarget: null,
    prevY: r.transform.position.y,
    touching: new Set(),
  };
}

export class Runtime {
  entities: RuntimeEntity[] = [];
  readonly gravity: Vec2;
  /** Chance for Wander and the like (replaceable, so tests can be repeated exactly). */
  random: () => number = Math.random;
  /** The camera: following, limits and effects (shake, flash, zoom…). */
  readonly cam = new CameraController();
  /** Events, rules and gameplay systems. */
  readonly gameplay: Gameplay;
  /** What things do on their own (patrol, shoot, move…). */
  readonly behaviors: BehaviorSystem;
  /** Behavior scripts. */
  readonly scripts: ScriptSystem;
  time = 0;
  /** When the level was won (play time), or null. PlayView goes on to the next level. */
  completed: number | null = null;
  /** Called for every logged event (the play recorder listens here; it survives restarts). */
  onLog: ((ev: LoggedEvent) => void) | null = null;
  private accumulator = 0;
  /** Solids that never move: recomputed only when something opens, closes, appears or goes away. */
  private staticSolids: Box[] = [];
  private solidsDirty = true;
  /** Tops of ladders: one-way platforms. */
  private ladderTops: Box[] = [];
  /** Ladders: unbroken vertical stacks of climbable pieces. A gap starts a new ladder. */
  private ladders: Ladder[] = [];
  private fallLimit = 0;
  readonly scene: Scene;
  /** What scripts drew on the screen, by id (kept until erased or the level restarts). */
  readonly drawings = new Map<string, ScreenDrawing>();
  /**
   * Parts of the built-in play display (hearts, items) that are off. A game starts bare: both are off until a script
   * shows them (builtin_display), and scores, hearts, lives and the like are the game's own drawings.
   */
  readonly builtinHidden = new Set<'hearts' | 'items'>(['hearts', 'items']);
  /** Paused by a script (a pause menu): the world stands still; only "key" handlers run. */
  paused = false;
  /**
   * A level flip in progress (flip_level): everything glides to its mirrored place, the outer ones (farthest from
   * the line) fastest, each turning over on the way; the world stands still meanwhile (nothing collides).
   */
  flip: { way: 'upside_down' | 'left_right'; t: number; items: { e: RuntimeEntity; fx: number; fy: number; tx: number; ty: number; dur: number; turns: boolean }[] } | null = null;
  /** How many level flips are in effect now, per way (an odd number: the level is mirrored). */
  flips = { upside_down: 0, left_right: 0 };
  /** Sound effects and music on (scripts switch them for the whole game: the play view keeps them across levels). */
  soundOn = true;
  musicOn = true;
  /** A script asked to start the whole game again (the play view goes back to the first level). */
  restartGameRequested = false;
  /** The input of the step being run (what is held when something respawns). */
  private lastInput: InputState | null = null;
  /** Sounds to play (the play view plays and empties it every frame; the runtime itself makes no sound). */
  readonly soundQueue: { assetId: Id; volume: number; pitch: number }[] = [];
  /** A song a script asked for (null = stop the music); the play view takes it. */
  musicRequest: { assetId: Id | null } | null = null;
  /** How many sounds were played since the level started (for tests and the play log). */
  soundsPlayed = 0;
  /** The play screen's size in px (set by the play view; scripts read screen_w / screen_h). */
  screen = { w: 960, h: 600 };

  constructor(
    readonly project: Project,
    sceneId: Id,
    readonly registry: ComponentRegistry,
  ) {
    this.scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
    this.gravity = { ...this.scene.world.gravity };
    this.gameplay = new Gameplay(this, project, this.scene);
    this.behaviors = new BehaviorSystem(this);
    this.scripts = new ScriptSystem(this, project);
    this.load();
  }

  /** (Re)builds the level from the project: everything back at its start. */
  private load(): void {
    this.entities = this.scene.entities.map((e) => buildEntity(this.project, e, this.registry));
    // Starts Hidden: out of play until a rule or switch shows it.
    for (const e of this.entities) {
      if (!e.base.components.StartsHidden) continue;
      e.alive = false;
      e.hiddenBySwitch = true;
    }
    this.completed = null;
    this.drawings.clear();
    this.soundQueue.length = 0;
    this.soundsPlayed = 0;
    this.builtinHidden.clear();
    this.builtinHidden.add('hearts').add('items');
    this.paused = false;
    this.solidsDirty = true;
    this.rebuildLadders();

    const bottoms = this.entities.map((e) => e.y + getEntitySize(e.base).y);
    this.fallLimit = (bottoms.length ? Math.max(...bottoms) : 0) + FALL_MARGIN;

    // Only what the project says: the camera follows the entity with a CameraTarget. Without one it
    // stays still, on the middle of the level (there is no hidden fallback to the player).
    const target = this.entities.find((e) => e.base.components.CameraTarget) ?? null;
    const fs = target?.base.components.CameraTarget?.followStrength;
    const level = boundsOf(
      this.entities.map((e) => {
        const s = getEntitySize(e.base);
        return { x: e.x, y: e.y, w: s.x, h: s.y };
      }),
    );
    this.cam.reset(this.scene.camera ?? defaultCamera(false), target, typeof fs === 'number' ? fs : 0.15, level);
    this.scripts.reset();
    this.gameplay.reset();
  }

  /** Starts the level again from the beginning (a rule action, or R in play). */
  restart(): void {
    this.load();
  }

  /** The level is won (a Goal reached, or a rule). Only once. */
  completeLevel(by: RuntimeEntity | null): void {
    if (this.completed !== null) {
      this.gameplay.frozen();
      return;
    }
    this.completed = this.time;
    this.gameplay.emit('level_completed', by);
  }

  /** Advances by a frame's worth of real time using fixed steps. */
  update(frameDt: number, input: InputState): void {
    this.accumulator += Math.min(frameDt, STEP * MAX_STEPS_PER_FRAME);
    let first = true;
    while (this.accumulator >= STEP) {
      this.step(STEP, input);
      this.accumulator -= STEP;
      if (first) {
        // Presses/releases are seen by exactly one step.
        input.endStep();
        first = false;
      }
    }
    this.cam.update(frameDt);
  }

  step(dt: number, input: InputState): void {
    this.lastInput = input;
    // Paused (a pause menu): nothing moves and no time passes; only "key" handlers run (the menu).
    if (this.paused) {
      this.scripts.whilePaused(input);
      return;
    }
    this.time += dt;
    // A won level stands still while "Level complete!" shows: nothing moves, the player can't be steered.
    if (this.completed !== null) return;
    // A level flip plays out: nothing else happens meanwhile.
    if (this.flip) {
      this.stepFlip(dt);
      return;
    }

    // Trails: where each one with a tail was, for the last moments.
    for (const e of this.entities) {
      if (!e.trail) continue;
      const pts = e.trail.points;
      if (e.alive) pts.push({ x: e.x, y: e.y, t: this.time });
      while (pts.length && this.time - pts[0].t > e.trail.length) pts.shift();
    }
    // Turning (scripts' rotate over time, and spin).
    for (const e of this.entities) {
      const before = e.angle;
      if (e.spin) e.angle = (e.angle + e.spin * dt) % 360;
      else if (e.turn) {
        const left = e.turn.to - e.angle;
        const stepDeg = e.turn.speed * dt;
        if (Math.abs(left) <= stepDeg) {
          e.angle = e.turn.to;
          e.turn = null;
        } else e.angle += Math.sign(left) * stepDeg;
      }
      if (e.angle !== before) this.refreshCollider(e);
    }
    // Things a switch is moving glide toward their target (solids move with them).
    for (const e of this.entities) {
      const t = e.moveTarget;
      if (!t) continue;
      const dx = t.x - e.x;
      const dy = t.y - e.y;
      const dist = Math.hypot(dx, dy);
      const stepLen = t.speed > 0 ? t.speed * dt : Infinity;
      if (dist <= stepLen) {
        e.x = t.x;
        e.y = t.y;
        e.moveTarget = null;
      } else {
        e.x += (dx / dist) * stepLen;
        e.y += (dy / dist) * stepLen;
      }
      if (e.collider && e.body !== 'dynamic') this.solidsDirty = true;
    }
    if (this.solidsDirty) {
      // Pushable things move, so they are looked up where they are each step instead (pushBoxes).
      this.staticSolids = this.entities.filter((e) => this.isSolid(e) && !e.pushable && (e.body === 'static' || e.body === 'none')).map((e) => ({ ...boxOf(e)!, friction: e.friction }));
      this.rebuildLadders();
      this.solidsDirty = false;
    }
    // Friction first: whatever sets a speed this step (behaviors, scripts, chasing) then moves exactly that fast.
    for (const e of this.entities) if (e.body === 'dynamic' && e.alive && !e.moveTarget) this.applyFriction(e, dt);
    this.gameplay.steer();
    this.behaviors.before(dt, input);
    this.scripts.before(dt, input);
    const kinematicSolids: Box[] = [];
    for (const e of this.entities) {
      if (e.body === 'kinematic' && e.alive) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (this.isSolid(e)) kinematicSolids.push({ ...boxOf(e)!, friction: e.friction });
      }
    }
    const solids = kinematicSolids.length ? [...this.staticSolids, ...kinematicSolids] : this.staticSolids;
    const pushables = this.entities.filter((e) => e.pushable && this.isSolid(e));

    for (const e of this.entities) {
      if (e.body !== 'dynamic' || !e.alive) continue;
      e.prevY = e.y;
      if (e.moveTarget) {
        // Gliding (a script or a switch moves it): no falling meanwhile.
        e.vx = 0;
        e.vy = 0;
        continue;
      }
      if (e.knock) {
        // A knock back lasts a moment (and, with gravity, until it lands); then it moves as it did before the hit.
        e.knock.t -= dt;
        if (e.knock.t <= 0 && (this.floats(e) || e.grounded)) {
          if (!e.controller) {
            e.vx = e.knock.restore.vx;
            if (this.floats(e)) e.vy = e.knock.restore.vy;
          }
          e.knock = null;
        }
      }
      if (e.controller && !e.dying) this.control(e, this.inputFor(e, input), dt);
      else if ((e.climbing || e.climbDir !== 0) && !this.floats(e)) this.climbAlong(e, dt);
      if (!e.climbing && !e.hanging && e.controller?.movement !== 'topdown') {
        e.vx += this.gravity.x * e.gravityScale * dt;
        e.vy = Math.min(MAX_FALL_SPEED, e.vy + this.gravity.y * e.gravityScale * dt);
      }
      const box = boxOf(e);
      if (!box) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      } else {
        // Pushing something heavier slows the pusher's steps (not its speed, which its controls keep up).
        const ease = pushables.length && !e.pushable ? this.pushAlong(e, box, e.vx * dt, this.floats(e) ? e.vy * dt : 0, solids, pushables) : { x: 1, y: 1 };
        // Ladder tops hold you up unless you are climbing (or already below them).
        const prevBottom = box.y + box.hh;
        const others = pushables.length ? pushables.filter((p) => p !== e).map((p) => ({ ...boxOf(p)!, friction: p.friction })) : [];
        const base = others.length ? [...solids, ...others] : solids;
        const surfaces = e.climbing ? base : [...base, ...this.ladderTops.filter((t) => prevBottom <= t.y - t.hh + 0.01)];
        const goingDown = e.vy > 0;
        const r = moveAndCollide(box, e.vx * dt * ease.x, e.vy * dt * ease.y, surfaces);
        e.x = r.x - e.collider!.ox;
        e.y = r.y - e.collider!.oy;
        e.bumped = r.hitX ? (e.vx > 0 ? 1 : e.vx < 0 ? -1 : 0) : 0;
        if (r.hitX) e.vx = 0;
        if (r.hitY) e.vy = 0;
        e.grounded = r.grounded || (e.vy >= 0 && standingOn(boxOf(e)!, surfaces));
        // What it stands on decides its grip (only looked for when something uses it: characters, things sliding).
        if (e.grounded && (e.controller || (e.vx !== 0 && e.friction > 0))) e.groundFriction = groundUnder(boxOf(e)!, surfaces)?.friction ?? DEFAULT_FRICTION;
        // Climbing down onto the floor (or standing on it) ends the climb.
        // (An enemy lining up with a ladder on the floor hasn't started down or up yet.)
        if (e.climbing && e.grounded && e.vy >= 0 && (e.controller || goingDown || e.climbDir === 0)) {
          e.climbing = false;
          e.climbDir = 0;
        }
      }
      // Without gravity nothing falls out of the level (a top-down character can walk below it).
      if (e.y > this.fallLimit && !this.floats(e)) this.respawn(e, 'fell');
    }
    this.keepOnScreen();
    this.behaviors.after(dt);
    this.gameplay.update(dt, input);
    // Characters that died wait out their Health.respawnDelay (their death animation), then come back: counted
    // after this step's events were handled, so a "died" handler always runs before the respawn, never after it.
    for (const e of this.entities) if (e.vanishing > 0) e.vanishing = Math.max(0, e.vanishing - dt);
    for (const e of this.entities) {
      if (e.dying <= 0) continue;
      e.dying -= dt;
      if (e.dying <= 0) this.respawn(e, 'died');
    }
  }

  /** Its collision box after its size, scale or rotation changed. */
  refreshCollider(e: RuntimeEntity): void {
    e.collider = colliderOf(e.base.components, e.base.transform, e.angle);
    if (e.body !== 'dynamic') this.solidsDirty = true;
  }

  /** Whether it blocks movement (a wall, floor, closed door…), for scripts' group checks. */
  solidFor(e: RuntimeEntity): boolean {
    return this.isSolid(e);
  }

  private isSolid(e: RuntimeEntity): boolean {
    // A goal is reached, never bumped into: it never blocks (a top-down exit is won by standing on it).
    return e.alive && !e.open && !!e.collider && !e.collider.trigger && !e.base.components.Goal;
  }

  /** Something opened, closed, appeared or went away. */
  /** Ladders in play (a hidden ladder can't be climbed or stood on until it appears). */
  private rebuildLadders(): void {
    this.ladders = ladderColumns(this.entities.filter((e) => e.climbable && e.alive));
    // The top of each ladder is a one-way platform you can stand on and climb down from.
    this.ladderTops = this.ladders.map((l) => ({ x: l.x, y: l.top + 1, hw: l.hw, hh: 1 }));
  }

  markSolidsDirty(): void {
    this.solidsDirty = true;
  }

  /**
   * Mirrors the whole level around a line (flip_level): upside down around a level row (y = at), or left to right
   * around a column (x = at); `at` null: the middle of everything in the level. Everything glides to its mirrored
   * place over `seconds`, the farthest from the line fastest and first (wave 0: all together; 1: the nearest take
   * the whole time and the farthest none of it); things turn over on the way and stay mirrored (a second flip turns
   * them back). Characters (things that fall or are steered) are carried along upright and fall from there.
   */
  flipLevel(way: 'upside_down' | 'left_right', at: number | null, seconds: number, wave: number): boolean {
    if (this.flip) return false;
    const up = way === 'upside_down';
    const things = this.entities.filter((e) => e.alive);
    if (!things.length) return false;
    let line = at;
    if (line === null || !Number.isFinite(line)) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const e of things) {
        if (e.projectile) continue;
        const b = boxOf(e);
        const c = up ? e.y : e.x;
        const h = b ? (up ? b.hh : b.hw) : 0;
        lo = Math.min(lo, c - h);
        hi = Math.max(hi, c + h);
      }
      line = Number.isFinite(lo) ? (lo + hi) / 2 : 0;
    }
    const w = Math.min(1, Math.max(0, wave));
    const time = Math.max(0, seconds);
    let far = 1;
    for (const e of things) far = Math.max(far, Math.abs((up ? e.y : e.x) - line));
    const items = things.map((e) => {
      const d = Math.abs((up ? e.y : e.x) - line!);
      const tx = up ? e.x : 2 * line! - e.x;
      const ty = up ? 2 * line! - e.y : e.y;
      // (Characters stay upright: they are carried, and fall or walk on from where they land.)
      const turns = !(e.controller || (e.body === 'dynamic' && e.gravityScale !== 0));
      return { e, fx: e.x, fy: e.y, tx, ty, dur: time * (1 - w * (d / far)), turns };
    });
    this.flips[way]++;
    if (time <= 0) {
      this.flip = { way, t: 0, items };
      this.endFlip();
      return true;
    }
    for (const it of items) it.e.flipT = 0;
    this.flip = { way, t: 0, items };
    return true;
  }

  private stepFlip(dt: number): void {
    const f = this.flip!;
    f.t += dt;
    let done = true;
    for (const it of f.items) {
      const p = it.dur <= 0 ? 1 : Math.min(1, f.t / it.dur);
      if (p < 1) done = false;
      // (Eased in and out: a flip, not a slide.)
      const k = p * p * (3 - 2 * p);
      it.e.x = it.fx + (it.tx - it.fx) * k;
      it.e.y = it.fy + (it.ty - it.fy) * k;
      it.e.flipT = it.turns ? k : null;
    }
    if (done) this.endFlip();
  }

  private endFlip(): void {
    const f = this.flip!;
    const up = f.way === 'upside_down';
    for (const it of f.items) {
      const e = it.e;
      e.x = it.tx;
      e.y = it.ty;
      e.flipT = null;
      if (it.turns) e.mirror = up ? { ...e.mirror, y: (e.mirror.y * -1) as 1 | -1 } : { ...e.mirror, x: (e.mirror.x * -1) as 1 | -1 };
      // Where it starts again (falling out, respawning) and where it moves between are mirrored too.
      // (The line is halfway between where it was and where it is now.)
      e.spawn = up ? { x: e.spawn.x, y: it.fy + it.ty - e.spawn.y } : { x: it.fx + it.tx - e.spawn.x, y: e.spawn.y };
      const mv = e.beh.mover;
      if (mv) {
        if (up) mv.originY = it.fy + it.ty - mv.originY;
        else mv.originX = it.fx + it.tx - mv.originX;
        mv.offset = up ? { x: mv.offset.x, y: -mv.offset.y } : { x: -mv.offset.x, y: mv.offset.y };
      }
      e.vx = up ? e.vx : 0;
      e.vy = 0;
      e.grounded = false;
      e.prevY = e.y;
      e.moveTarget = null;
    }
    this.flip = null;
    this.solidsDirty = true;
  }

  boxOf(e: RuntimeEntity): Box | null {
    return boxOf(e);
  }

  byId(id: Id): RuntimeEntity | undefined {
    return this.entities.find((e) => e.id === id);
  }

  /** Moves an entity to a point over time (a switch's "move"). */
  moveTo(e: RuntimeEntity, to: Vec2, speed: number): void {
    e.moveTarget = { x: to.x, y: to.y, speed };
  }

  /** Adds a new instance of a library object during play. */
  spawn(definitionId: Id, at: Vec2): RuntimeEntity | null {
    const def = this.project.definitions.find((d) => d.id === definitionId);
    if (!def) return null;
    const e = buildEntity(this.project, instantiateDefinition(def, at), this.registry);
    this.entities.push(e);
    this.solidsDirty = true;
    return e;
  }

  /**
   * Friction: something sliding slows down by friction × FRICTION_DECEL px/s
   * each second, on the ground (horizontally), or, in a level seen from above,
   * on the floor (in every direction). Applied at the start of the step, so
   * whatever sets its speed every step (patrols, wanderers, chasers, scripts
   * on tick) moves exactly as fast as it says; only speed nothing renews (a
   * shove, a speed set once) runs down. "On the ground" is as of the last step. Characters' own controls, shots,
   * knock backs and things in the air are left alone.
   */
  private applyFriction(e: RuntimeEntity, dt: number): void {
    if (e.friction <= 0 || e.controller || e.projectile || e.knock || e.climbing) return;
    // On the ground, the surface counts too: on ice (friction near 0) a shoved crate keeps sliding.
    const surface = this.gravity.x === 0 && this.gravity.y === 0 ? 1 : e.groundFriction / DEFAULT_FRICTION;
    const loss = e.friction * surface * FRICTION_DECEL * dt;
    if (this.gravity.x === 0 && this.gravity.y === 0) {
      const v = Math.hypot(e.vx, e.vy);
      if (v === 0) return;
      const k = Math.max(0, v - loss) / v;
      e.vx *= k;
      e.vy *= k;
    } else if (e.grounded && e.vx !== 0) {
      e.vx = Math.sign(e.vx) * Math.max(0, Math.abs(e.vx) - loss);
    }
  }

  /**
   * Nothing pulls it down: a top-down character, something with no gravity of
   * its own, or anything in a level without gravity. It can't stand, jump,
   * fall or land on things; it moves in every direction.
   */
  floats(e: RuntimeEntity): boolean {
    return e.controller?.movement === 'topdown' || e.gravityScale === 0 || (this.gravity.x === 0 && this.gravity.y === 0);
  }

  /** The input as this entity hears it: keys held since it respawned count as up until they are let go. */
  inputFor(e: RuntimeEntity, input: InputView): InputView {
    const block = e.heldBlock;
    if (!block) return input;
    for (const a of [...block]) if (!input.isDown(a)) block.delete(a);
    if (!block.size) {
      e.heldBlock = null;
      return input;
    }
    return { isDown: (a) => !block.has(a) && input.isDown(a), wasPressed: (a) => !block.has(a) && input.wasPressed(a), wasReleased: (a) => input.wasReleased(a) };
  }

  /** Player-style movement for entities with a CharacterController. */
  private control(e: RuntimeEntity, input: InputView, dt: number): void {
    const c = e.controller!;
    // Running (and walking, seen from above) done by a script of its own instead (its "Running" script): the engine
    // leaves its speed and which way it faces to it.
    const ownRun = ownPart(e, 'running');
    if (c.movement === 'topdown') return this.walkTopDown(e, input, dt, ownRun);
    if (e.controlsDone) {
      e.controlsDone = false;
      return;
    }
    const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    // Climbing and hanging from ledges done by scripts of its own instead ("Climbing", "Ledge grab"): while it
    // climbs or hangs, the engine leaves it to them (and doesn't run or jump it either, as when it does them itself).
    const ownClimb = ownPart(e, 'climbing');
    const ownLedge = ownPart(e, 'ledge_grab');
    if (ownClimb && e.climbing) return;
    const ladder = ownClimb ? null : this.ladderAt(e);

    // Climbing: Up/Down on a ladder (at least half of you inside it, by width), at running speed.
    // Left/Right moves you along it; once less than half of you is on it you let go. Up does nothing
    // when you already stand on the ladder's top; Down there climbs down. Jumping lets go; reaching
    // the floor ends the climb. A ladder above a gap is out of reach until you jump up to it.
    const me = zoneOf(e);
    const atTop = ladder !== null && me.y + me.hh <= ladder.top + 0.5;
    if (ladder && !e.climbing && ((input.isDown('up') && !atTop) || (input.isDown('down') && !this.isOnFloorBelowLadder(e)))) {
      e.climbing = true;
      e.vx = 0;
    }
    if (e.climbing && input.wasPressed('jump')) e.climbing = false;
    else if (e.climbing && !ladder) {
      // Let go (moved off the side, or climbed down off its bottom): no climbing speed is kept.
      e.climbing = false;
      e.vy = 0;
    }
    if (e.climbing && ladder) {
      const vertical = (input.isDown('down') ? 1 : 0) - (input.isDown('up') ? 1 : 0);
      e.vy = vertical * c.speed * e.speedFactor;
      e.vx = dir * c.speed * e.speedFactor;
      // Climbing straight up or down eases you into the middle of the ladder; Left/Right overrides it.
      if (vertical !== 0 && dir === 0) e.x += (ladder.x - e.x) * Math.min(1, dt * LADDER_CENTERING);
      e.grounded = false;
      // Reaching the top: stop there, standing on it.
      if (vertical < 0 && me.y + me.hh + e.vy * dt <= ladder.top) this.standOn(e, ladder);
      return;
    }

    if (dir !== 0 && !ownRun) e.facing = dir as 1 | -1;
    // Jumping done by a script of its own instead (its "Jumping" script, which took it over): the engine leaves it.
    const ownJump = ownPart(e, 'jumping');
    if (e.grounded && e.beh.doubleJump) e.beh.doubleJump.left = e.beh.doubleJump.extra;
    if (e.grabCooldown > 0) e.grabCooldown = Math.max(0, e.grabCooldown - dt);
    if (e.hanging && (ownLedge || this.hang(e, input, dir))) return;

    if (!ownRun) {
      // (The ready-made Running script does exactly this: engineParts.ts.)
      const target = dir * c.speed * e.speedFactor;
      // On the ground, as much as its grip there allows (its own friction and the floor's); in the air, its air control.
      const rate = c.acceleration * (e.grounded ? groundGrip(e.friction, e.groundFriction) : c.airControl);
      const diff = target - e.vx;
      e.vx += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    }

    if (ownJump) {
      if (e.beh.ledgeGrab && !ownLedge && !e.grounded && e.vy >= 0 && dir !== 0 && e.grabCooldown <= 0) this.tryGrabLedge(e, dir as 1 | -1);
      return;
    }
    // Forgiving jumps: a short buffer before landing and a short grace period after walking off a ledge.
    // Only the jump button jumps; Up is for climbing. (The ready-made Jumping script does exactly this: engineParts.ts.)
    if (input.wasPressed('jump')) e.jumpBuffer = JUMP_BUFFER;
    else e.jumpBuffer = Math.max(0, e.jumpBuffer - dt);
    e.coyote = e.grounded ? COYOTE_TIME : Math.max(0, e.coyote - dt);
    if (e.jumpBuffer > 0 && e.coyote > 0) {
      e.vy = -c.jumpForce;
      e.jumpBuffer = 0;
      e.coyote = 0;
      e.grounded = false;
    } else if (input.wasPressed('jump') && !e.grounded && e.coyote <= 0 && e.beh.doubleJump && e.beh.doubleJump.left > 0) {
      // Double jump: another full jump in the air.
      e.beh.doubleJump.left--;
      e.vy = -c.jumpForce;
      e.jumpBuffer = 0;
    }
    if (e.beh.ledgeGrab && !ownLedge && !e.grounded && e.vy >= 0 && dir !== 0 && e.grabCooldown <= 0) this.tryGrabLedge(e, dir as 1 | -1);
    // Releasing jump early makes a shorter hop.
    if (input.wasReleased('jump') && e.vy < 0) e.vy *= 0.5;
  }

  /**
   * Top-down walking: the arrow keys (or WASD) move it in eight directions at
   * the same speed (diagonals aren't faster), speeding up and slowing down by
   * its acceleration. Walls stop it; nothing pulls it down.
   */
  private walkTopDown(e: RuntimeEntity, input: InputView, dt: number, scripted = false): void {
    e.grounded = false;
    e.climbing = false;
    e.hanging = null;
    if (scripted) return;
    const c = e.controller!;
    const dx = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    const dy = (input.isDown('down') ? 1 : 0) - (input.isDown('up') ? 1 : 0);
    if (dx !== 0) e.facing = dx as 1 | -1;
    if (dx !== 0 || dy !== 0) e.heading = { x: dx, y: dy };
    const len = Math.hypot(dx, dy) || 1;
    const tx = (dx / len) * c.speed * e.speedFactor;
    const ty = (dy / len) * c.speed * e.speedFactor;
    // Toward the wanted velocity, at most `acceleration` per second (as one vector, so turning is smooth).
    const ex = tx - e.vx;
    const ey = ty - e.vy;
    const off = Math.hypot(ex, ey);
    const step = c.acceleration * dt;
    if (off <= step) {
      e.vx = tx;
      e.vy = ty;
    } else {
      e.vx += (ex / off) * step;
      e.vy += (ey / off) * step;
    }
  }

  /**
   * Ledge grab: falling (or at the top of a jump) against a wall while
   * pressing toward it, with the wall's top edge at about hand height and room
   * to stand on top: hang there.
   */
  /** A script's grab_ledge: the same test and grab as the engine's. */
  grabLedge(e: RuntimeEntity, dir: 1 | -1): void {
    this.tryGrabLedge(e, dir);
  }

  /** Standing on a ladder's top after climbing up to it (the engine's, or a script's stand_on_ladder). */
  private standOn(e: RuntimeEntity, ladder: Ladder): void {
    const me = zoneOf(e);
    e.y = ladder.top - me.hh;
    e.vy = 0;
    e.climbing = false;
    e.grounded = true;
  }

  /** A script's stand_on_ladder: on the top of the ladder it is at; its controls rest for the rest of this step. */
  standOnLadder(e: RuntimeEntity): void {
    const l = this.ladderAt(e);
    if (!l) return;
    this.standOn(e, l);
    e.controlsDone = true;
  }

  /** Standing on the ledge it hangs from (the engine's climb up, or a script's climb_ledge). */
  climbLedge(e: RuntimeEntity, script = true): void {
    const h = e.hanging;
    const box = boxOf(e);
    if (!h || !box) return;
    e.x = h.edgeX + h.side * (box.hw + 1) - (box.x - e.x);
    e.y = h.top - box.hh - (box.y - e.y);
    e.hanging = null;
    if (script) e.controlsDone = true;
  }

  /** It stands on the floor (not on a ladder's top): Down there doesn't climb. */
  floorBelowLadder(e: RuntimeEntity): boolean {
    return this.isOnFloorBelowLadder(e);
  }

  private tryGrabLedge(e: RuntimeEntity, dir: 1 | -1): void {
    const box = boxOf(e);
    if (!box) return;
    const face = box.x + dir * box.hw;
    const myTop = box.y - box.hh;
    for (const s of this.staticSolids) {
      const wallFace = dir > 0 ? s.x - s.hw : s.x + s.hw;
      if (Math.abs(face - wallFace) > 2) continue;
      const top = s.y - s.hh;
      if (top < myTop - 4 || top > myTop + 14) continue;
      // Room to stand on top of the ledge (also rules out the seam between two stacked tiles).
      const above: Box = { x: wallFace + dir * (box.hw + 1), y: top - box.hh - 0.5, hw: box.hw, hh: box.hh - 0.5 };
      if (this.staticSolids.some((o) => overlaps(above, o))) continue;
      e.hanging = { side: dir, top, edgeX: wallFace };
      e.y += top - 2 - myTop;
      e.vx = 0;
      e.vy = 0;
      e.climbing = false;
      this.gameplay.emit('ledge_grabbed', e);
      return;
    }
  }

  /** While hanging: Up or Jump climbs onto the ledge, Down or pressing away lets go. Returns true while still hanging. */
  private hang(e: RuntimeEntity, input: InputView, dir: number): boolean {
    const h = e.hanging!;
    e.vx = 0;
    e.vy = 0;
    e.grounded = false;
    if (input.wasPressed('jump') || input.isDown('up')) {
      this.climbLedge(e, false);
      e.grabCooldown = 0.2;
      return true;
    }
    if (input.isDown('down') || dir === -h.side) {
      e.hanging = null;
      e.grabCooldown = 0.3;
      return false;
    }
    return true;
  }

  /** Solids (walls, floors, and pushable things where they are now), for behaviors and shots looking at what is in the way. */
  get solids(): readonly Box[] {
    const pushed = this.entities.filter((e) => e.pushable && this.isSolid(e));
    return pushed.length ? [...this.staticSolids, ...pushed.map((e) => boxOf(e)!)] : this.staticSolids;
  }

  /**
   * `e` is about to move by (dx, dy): whatever Pushable it would walk into
   * (and may push) is shoved ahead of it first, as far as walls and other
   * things allow, so `e` then follows right behind it. A step Pushable instead
   * starts gliding one step, if that spot is free. Something heavier than
   * `e` moves by only (e's mass ÷ its mass) of that; returns, per axis, the
   * share of its step `e` itself may then take (to stay right behind it).
   */
  private pushAlong(e: RuntimeEntity, box: Box, dx: number, dy: number, walls: readonly Box[], pushables: RuntimeEntity[]): { x: number; y: number } {
    const share = { x: 1, y: 1 };
    const mine = pushables.filter((p) => p.alive && p.pushable!.pushers.some((t) => e.tags.includes(t)));
    if (!mine.length) return share;
    const blockers = (p: RuntimeEntity) => [
      ...walls,
      ...pushables.filter((o) => o !== p).map((o) => boxOf(o)!),
      // Other moving solid things (characters, enemies) are in the way too, but not the pusher.
      ...this.entities.filter((o) => o !== p && o !== e && o.alive && o.body === 'dynamic' && !o.pushable && o.collider && !o.collider.trigger).map((o) => boxOf(o)!),
    ];
    for (const [ax, d] of [['x', dx], ['y', dy]] as const) {
      if (Math.abs(d) < 1e-9) continue;
      const moved: Box = ax === 'x' ? { ...box, x: box.x + d } : { ...box, y: box.y + d };
      for (const p of mine) {
        const pb = boxOf(p)!;
        if (!overlaps(moved, pb)) continue;
        const s = p.pushable!;
        const dir = Math.sign(d);
        // Heavier than the pusher: slower (by the ratio of their masses); far too heavy: it doesn't move.
        if (p.mass >= e.mass * TOO_HEAVY) continue;
        const ease = Math.min(1, e.mass / p.mass);
        if (s.step > 0) {
          if (p.moveTarget) continue;
          const to = ax === 'x' ? { x: p.x + dir * s.step, y: p.y } : { x: p.x, y: p.y + dir * s.step };
          const target: Box = { ...pb, x: pb.x + (to.x - p.x), y: pb.y + (to.y - p.y) };
          if (blockers(p).some((b) => overlaps(target, b))) continue;
          this.moveTo(p, to, s.speed * ease);
        } else {
          // Shove it by as much as `e` would sink into it (less when it is heavier; `e` then follows only that far).
          share[ax] = Math.min(share[ax], ease);
          const sink = ease * (ax === 'x' ? (d > 0 ? moved.x + moved.hw - (pb.x - pb.hw) : moved.x - moved.hw - (pb.x + pb.hw)) : d > 0 ? moved.y + moved.hh - (pb.y - pb.hh) : moved.y - moved.hh - (pb.y + pb.hh));
          const r = moveAndCollide(pb, ax === 'x' ? sink : 0, ax === 'y' ? sink : 0, blockers(p));
          p.x += r.x - pb.x;
          p.y += r.y - pb.y;
          if (r.x === pb.x && r.y === pb.y) continue;
        }
        if (this.time - s.pushedAt > 0.1) this.gameplay.emit('pushed', p, e);
        s.pushedAt = this.time;
      }
    }
    return share;
  }

  /** Fires a shot from `from` in direction (dx, dy) (normalized), as a runtime-only entity. */
  shoot(from: RuntimeEntity, dx: number, dy: number, cfg: { projectile: string; speed: number; damage: number; range: number; shotColor?: string; shotSize?: number; turnShots?: boolean }): RuntimeEntity {
    // (By id, or by name: "Laser Bolt".)
    const want = cfg.projectile.trim().toLowerCase();
    const def = want ? (this.project.definitions.find((d) => d.id === cfg.projectile) ?? this.project.definitions.find((d) => d.name.toLowerCase() === want)) : undefined;
    // (In whole art pixels: a 1-pixel shot is exactly one of the game's picture pixels.)
    const art = 32 / (this.project.settings.spriteResolution ?? 32);
    const size = Math.max(art, Math.round((cfg.shotSize ?? 8) / art) * art);
    const fromBox = boxOf(from);
    const reach = (fromBox ? Math.max(fromBox.hw, fromBox.hh) : 8) + 6;
    const at = { x: from.x + dx * reach, y: from.y + dy * reach };
    const instance = def
      ? instantiateDefinition(def, at)
      : createStandaloneEntity('Shot', at, {
          Sprite: this.registry.createDefault('Sprite', { width: size, height: size, color: cfg.shotColor ?? '#ffd166' }),
          Collider: this.registry.createDefault('Collider', { shape: 'circle', size: { x: size, y: size }, isTrigger: true }),
        });
    from.shotAt = this.time;
    const e = buildEntity(this.project, instance, this.registry);
    // A shot flies straight and is never solid, whatever the object says.
    e.body = 'kinematic';
    if (e.collider) e.collider.trigger = true;
    e.vx = dx * cfg.speed;
    e.vy = dy * cfg.speed;
    // Drawn pointing right, it is turned the way it flies (not mirrored: a turned shot would be upside down).
    if (cfg.turnShots !== false && def) {
      e.facing = 1;
      e.angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      this.refreshCollider(e);
    } else e.facing = dx < 0 ? -1 : 1;
    e.damage = e.damage ?? cfg.damage;
    // A shot carries its shooter's tags (an enemy's shot hurts like the enemy does), plus "projectile".
    e.tags = [...new Set([...e.tags, ...from.tags, 'projectile'])];
    e.projectile = { owner: from.id, team: [...from.tags], left: cfg.range };
    this.entities.push(e);
    return e;
  }

  /**
   * The ladder a character can hold: at least half of the character (by width) inside it, the feet
   * no higher than its top (standing on the top counts, so you can climb down), and the middle of
   * the body no lower than its bottom.
   */
  private ladderAt(e: RuntimeEntity): Ladder | null {
    const me = zoneOf(e);
    const feet = me.y + me.hh;
    let best: Ladder | null = null;
    let bestInside = -1;
    for (const l of this.ladders) {
      const inside = Math.min(me.x + me.hw, l.x + l.hw) - Math.max(me.x - me.hw, l.x - l.hw);
      if (inside >= LADDER_GRIP * me.hw * 2 - 1e-6 && inside > bestInside && feet >= l.top - 1 && me.y <= l.bottom) {
        best = l;
        bestInside = inside;
      }
    }
    return best;
  }

  /**
   * An enemy (no controller) climbing a ladder: it first lines up with the ladder's middle (so the edge of a
   * platform beside the ladder can't catch it), then climbs, and stops standing on the top. With no direction it
   * holds still on the ladder. Off a ladder the order is dropped.
   */
  private climbAlong(e: RuntimeEntity, dt: number): void {
    const ladder = this.ladderAt(e);
    const me = zoneOf(e);
    if (!e.climbing) {
      const atTop = ladder !== null && me.y + me.hh <= ladder.top + 0.5;
      if (!ladder || (e.climbDir < 0 && atTop) || (e.climbDir > 0 && this.isOnFloorBelowLadder(e))) {
        e.climbDir = 0;
        return;
      }
      e.climbing = true;
    }
    if (!ladder) {
      e.climbing = false;
      e.climbDir = 0;
      return;
    }
    const speed = e.climbSpeed * e.speedFactor;
    e.grounded = false;
    if (e.climbDir === 0) {
      // Holding on: no falling; moving sideways (its own speed) steps off onto a floor beside the ladder.
      e.vy = 0;
      return;
    }
    const off = ladder.x - e.x;
    if (Math.abs(off) > 0.5) {
      e.vx = Math.max(-speed, Math.min(speed, off / dt));
      e.vy = 0;
      return;
    }
    e.x = ladder.x;
    e.vx = 0;
    e.vy = e.climbDir * speed;
    if (e.climbDir < 0 && me.y + me.hh + e.vy * dt <= ladder.top) {
      e.y = ladder.top - me.hh;
      e.vy = 0;
      e.climbing = false;
      e.climbDir = 0;
      e.grounded = true;
    }
  }

  /** No wall between the middles of a and b. */
  canSee(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.min(200, Math.ceil(d / 8));
    for (let i = 1; i < steps; i++) {
      const x = a.x + ((b.x - a.x) * i) / steps;
      const y = a.y + ((b.y - a.y) * i) / steps;
      if (this.solids.some((s) => Math.abs(x - s.x) < s.hw && Math.abs(y - s.y) < s.hh)) return false;
    }
    return true;
  }

  /**
   * One step of chasing `target` at `speed`: flyers go straight at it; walkers go sideways, and up or down by
   * ladder when it is higher or lower (walk to a ladder going that way, line up, climb, step off level with it).
   */
  chase(f: RuntimeEntity, target: RuntimeEntity, speed: number): void {
    const dx = target.x - f.x;
    const dy = target.y - f.y;
    if (this.floats(f)) {
      const d = Math.hypot(dx, dy);
      f.vx = d > 2 ? (dx / d) * speed : 0;
      f.vy = d > 2 ? (dy / d) * speed : 0;
      if (d > 2) f.heading = Math.abs(dy) > Math.abs(dx) ? { x: 0, y: Math.sign(dy) } : { x: Math.sign(dx), y: 0 };
    } else {
      const way = this.ladderWay(f, target);
      f.climbSpeed = speed;
      if (way && 'climb' in way) {
        f.climbDir = way.climb;
        f.vx = 0;
      } else {
        // Level with it on a ladder: hold on and step off sideways toward it.
        if (f.climbing) f.climbDir = 0;
        const goal = way ? way.walkTo - f.x : dx;
        f.vx = Math.abs(goal) > 1 ? Math.sign(goal) * Math.min(speed, Math.abs(goal) * 60) : 0;
      }
    }
    if (Math.abs(dx) > 2) f.facing = dx < 0 ? -1 : 1;
  }

  /** A wall right in front of it that way (sideways, or up/down): the box a patroller turns at. */
  wallAhead(e: RuntimeEntity, dx: number, dy: number): boolean {
    const box = boxOf(e);
    if (!box || (dx === 0 && dy === 0)) return false;
    const front: Box = dx !== 0 ? { x: box.x + dx * (box.hw + 1), y: box.y, hw: 1, hh: box.hh - 1 } : { x: box.x, y: box.y + dy * (box.hh + 1), hw: box.hw - 1, hh: 1 };
    return this.solids.some((s) => overlaps(front, s));
  }

  /** No floor just ahead of its feet that way (a ladder's top is floor). */
  ledgeAhead(e: RuntimeEntity, dir: number): boolean {
    const box = boxOf(e);
    if (!box || dir === 0) return false;
    return !this.floorIn({ x: box.x + dir * (box.hw + 2), y: box.y + box.hh + 4, hw: 1, hh: 3 });
  }

  /**
   * Walking `dir` and reaching a ladder's middle within `reach`: the ways it could climb it (1 up, 2 down, 3 both,
   * 0 none), once per ladder it passes (asked again at the same ladder: 0; off any ladder it forgets).
   */
  ladderChoice(e: RuntimeEntity, dir: number, reach: number): number {
    const l = this.ladderAt(e);
    if (!l) {
      e.ladderSeen = null;
      return 0;
    }
    const key = `${l.x},${l.top}`;
    if (e.ladderSeen === key || (l.x - e.x) * dir > reach + 1) return 0;
    e.ladderSeen = key;
    const ways = this.ladderWays(e, l);
    return (ways.up ? 1 : 0) + (ways.down ? 2 : 0);
  }

  /** The nearest living player-controlled character (what a patroller chases). */
  nearestPlayer(e: RuntimeEntity): RuntimeEntity | null {
    let best: RuntimeEntity | null = null;
    let bestD = Infinity;
    for (const o of this.entities) {
      if (o === e || !o.alive || !o.controller) continue;
      const d = Math.hypot(o.x - e.x, o.y - e.y);
      if (d < bestD) {
        best = o;
        bestD = d;
      }
    }
    return best;
  }

  /** The ladder a character could climb where it is (public for behaviors). */
  ladderHere(e: RuntimeEntity): Ladder | null {
    return this.ladderAt(e);
  }

  /** Which ways a character standing at a ladder could climb it from here. */
  ladderWays(e: RuntimeEntity, l: Ladder): { up: boolean; down: boolean } {
    const me = zoneOf(e);
    const feet = me.y + me.hh;
    return { up: feet > l.top + 0.5, down: feet < l.bottom - 0.5 && !this.isOnFloorBelowLadder(e) };
  }

  /** Floor under this box: something solid, or the top of a ladder. */
  floorIn(box: Box): boolean {
    return this.solids.some((s) => overlaps(box, s)) || this.ladderTops.some((t) => overlaps(box, t));
  }

  /** Whether a character is on a ladder it could climb (or is climbing one). */
  onLadder(e: RuntimeEntity): boolean {
    return e.climbing || this.ladderAt(e) !== null;
  }

  /**
   * For an enemy chasing something higher or lower (with gravity): which way to climb now, or where to walk to
   * reach a ladder that goes that way (the nearest one from this floor); null when no ladder helps.
   */
  ladderWay(e: RuntimeEntity, target: RuntimeEntity): { climb: -1 | 1 } | { walkTo: number } | null {
    const me = zoneOf(e);
    const feet = me.y + me.hh;
    const them = zoneOf(target);
    // Where its feet are compared with the target's: on a ladder it climbs until level with them (then steps
    // off); on the ground it looks for a ladder only when the target is clearly higher or lower.
    const diff = them.y + them.hh - feet;
    const near = e.climbing ? 2 : me.hh;
    const want: -1 | 1 | 0 = diff < -near ? -1 : diff > near ? 1 : 0;
    if (!want) {
      // Level with a target standing on a floor, on a ladder: exactly level, so it steps off onto that floor.
      if (e.climbing && target.grounded) e.y += diff;
      return null;
    }
    const here = this.ladderAt(e);
    if (here && (want < 0 ? feet > here.top + 0.5 : !this.isOnFloorBelowLadder(e) && feet < here.bottom - 0.5)) return { climb: want };
    let best: Ladder | null = null;
    for (const l of this.ladders) {
      // Up: a ladder reaching this floor and going higher. Down: one whose top is this floor.
      const ok = want < 0 ? l.top < feet - 1 && l.bottom >= feet - 1 : l.top <= feet + 2 && l.bottom > feet + 1;
      if (ok && (!best || Math.abs(l.x - e.x) < Math.abs(best.x - e.x))) best = l;
    }
    return best ? { walkTo: best.x } : null;
  }

  /** Standing on solid ground with the ladder going up: pressing down shouldn't start a climb into the floor. */
  private isOnFloorBelowLadder(e: RuntimeEntity): boolean {
    return e.grounded && !this.ladderTops.some((t) => standingOn(boxOf(e)!, [t]));
  }

  /**
   * The wait before a shooter's next automatic shot: `interval`, varied at random by up to `variation` of it either
   * way, from the shooter's own stream (the engine's shooting and a Shooting script draw the same waits).
   */
  shotWait(e: RuntimeEntity, interval: number, variation: number): number {
    const v = Math.min(1, Math.max(0, variation));
    if (v <= 0) return interval;
    e.shotSeed = (e.shotSeed * 1664525 + 1013904223) % 4294967296;
    return Math.max(0.05, interval * (1 + v * ((2 * e.shotSeed) / 4294967296 - 1)));
  }

  /** A player's fire key: X, or Space too for one that can't jump (seen from above, or without gravity). */
  fireHeld(e: RuntimeEntity, input: InputView): boolean {
    return input.isDown('fire') || ((e.controller?.movement === 'topdown' || this.floats(e)) && input.isDown('jump'));
  }

  /** Things with Stay On Screen never leave what the camera shows: its edges stop them as walls do. */
  private keepOnScreen(): void {
    let view: ReturnType<CameraController['visible']> | null = null;
    for (const e of this.entities) {
      const keep = e.alive ? e.base.components.StayOnScreen : undefined;
      if (!keep) continue;
      view ??= this.cam.visible();
      const m = Math.max(0, Number(keep.margin) || 0);
      const box = boxOf(e) ?? { x: e.x, y: e.y, hw: 0, hh: 0 };
      const minX = view.minX + m + box.hw;
      const maxX = view.maxX - m - box.hw;
      const minY = view.minY + m + box.hh;
      const maxY = view.maxY - m - box.hh;
      const nx = minX > maxX ? (view.minX + view.maxX) / 2 : Math.min(maxX, Math.max(minX, box.x));
      const ny = minY > maxY ? (view.minY + view.maxY) / 2 : Math.min(maxY, Math.max(minY, box.y));
      if (nx !== box.x) {
        e.x += nx - box.x;
        e.vx = 0;
      }
      if (ny !== box.y) {
        e.y += ny - box.y;
        e.vy = 0;
      }
    }
  }

  /** Puts an entity back at its start with full health (after falling out of the level or dying). */
  respawn(e: RuntimeEntity, reason: 'fell' | 'died' | 'rule' | 'script' = 'rule'): void {
    e.dying = 0;
    // Keys held now don't move it until they are let go: it comes back standing still.
    const held = this.lastInput ? ALL_ACTIONS.filter((a) => this.lastInput!.isDown(a)) : [];
    e.heldBlock = held.length ? new Set(held) : null;
    e.hanging = null;
    e.controlsDone = false;
    e.coyote = 0;
    e.jumpBuffer = 0;
    // What scripts did to how it looks, and the states they put it in (dying…), start over; their variables stay.
    e.alpha = null;
    e.hurtAt = -Infinity;
    this.scripts.resetForRespawn(e);
    e.x = e.spawn.x;
    e.y = e.spawn.y;
    e.vx = 0;
    e.vy = 0;
    e.climbing = false;
    e.touching = new Set();
    // Whatever slowed it or changed its gravity (water, a power-up) does not follow it back; nor does a turn.
    if (e.angle !== 0) {
      e.angle = 0;
      this.refreshCollider(e);
    }
    e.turn = null;
    e.spin = 0;
    // A glide it was on when it died ends here: it would otherwise carry on from the start point, through walls.
    e.moveTarget = null;
    e.speedFactor = 1;
    e.gravityScale = e.baseGravity;
    e.knock = null;
    if (e.health) e.health.current = e.health.max;
    if (!e.alive) {
      e.alive = true;
      this.solidsDirty = true;
    }
    e.vanishing = 0;
    e.respawns++;
    this.gameplay.emit('respawned', e, null, { reason });
  }

  /** Where the camera is (without shake). */
  get camera(): Camera {
    return this.cam.camera;
  }

  /**
   * Entities as the renderer expects them, at their current runtime positions.
   * Open things are faded, a switch that is on is drawn mirrored, and a
   * character that was just hurt blinks.
   */
  renderList(): RenderEntity[] {
    const out: RenderEntity[] = [];
    for (const e of this.entities) {
      if (!e.alive && !(e.vanishing > 0)) continue;
      const t = e.base.transform;
      const mirrored = e.switch?.on === true || e.facing === -1;
      const moved = e.x !== t.position.x || e.y !== t.position.y;
      const turned = e.angle !== 0;
      // A level flip: mirrored afterwards; during it, turning over (its height, or width, through nothing to the other side).
      const over = e.flipT === null ? 1 : Math.cos(Math.PI * e.flipT);
      const upside = this.flip?.way === 'upside_down';
      const sx = (mirrored ? -1 : 1) * e.mirror.x * (e.flipT !== null && !upside ? over : 1);
      const sy = e.mirror.y * (e.flipT !== null && upside ? over : 1);
      let r: RenderEntity =
        moved || mirrored || turned || sx !== 1 || sy !== 1
          ? { ...e.base, transform: { ...t, position: { x: e.x, y: e.y }, rotation: t.rotation + e.angle, scale: sx !== 1 || sy !== 1 ? { x: t.scale.x * sx, y: t.scale.y * sy } : t.scale } }
          : e.base;
      const look = this.lookOf(e);
      if (look.assetId && r.components.Sprite) r = { ...r, components: { ...r.components, Sprite: { ...r.components.Sprite, assetId: look.assetId, frame: 1 } } };
      const fade = e.alive ? 1 : Math.min(1, e.vanishing / (DEFEATED_LOOK / 2));
      const alpha = (e.open ? 0.3 : e.invincible > 0 && Math.floor(e.invincible * 12) % 2 === 0 ? 0.35 : 1) * (e.alpha ?? 1) * fade;
      if (alpha !== 1) r = { ...r, alpha };
      if (e.trail && e.trail.points.length > 1) r = { ...r, trail: e.trail.points.map((p) => ({ x: p.x, y: p.y })) };
      out.push(r);
    }
    return out;
  }

  /**
   * What the entity is doing right now (for "Sprites by situation"), and the
   * image to show for it, if it has one.
   */
  lookOf(e: RuntimeEntity): { situation: Situation; assetId: string | null } {
    let situation: Situation = 'idle';
    if (!e.alive && e.vanishing > 0) situation = 'defeated';
    else if (this.time - e.hurtAt < HURT_LOOK) situation = 'hurt';
    else if (this.time - e.shotAt < SHOOT_LOOK) situation = 'shoot';
    else if (e.hanging) situation = 'hang';
    else if (e.climbing) situation = 'climb';
    else if (this.floats(e)) {
      // Seen from above (or flying): moving up or down the screen, else sideways.
      if (Math.abs(e.vy) > 5 && Math.abs(e.vy) > Math.abs(e.vx)) situation = e.vy < 0 ? 'up' : 'down';
      else if (Math.abs(e.vx) > 5) situation = 'run';
    } else if (e.body === 'dynamic' && !e.grounded) situation = e.vy < 0 ? 'jump' : 'fall';
    else if (Math.abs(e.vx) > 5) situation = 'run';
    const states = e.base.components.SpriteStates as Record<string, unknown> | undefined;
    if (!states || situation === 'idle') return { situation, assetId: null };
    const pick = (k: string) => (typeof states[k] === 'string' && states[k] ? (states[k] as string) : null);
    return { situation, assetId: pick(situation) ?? (situation === 'fall' ? pick('jump') : situation === 'up' || situation === 'down' ? pick('run') : null) };
  }

  /** On-screen messages from rules ("You win!"). */
  get messages(): string[] {
    return this.gameplay.messages.map((m) => m.text);
  }

  /** What happened so far (most recent last). */
  get eventLog() {
    return this.gameplay.log;
  }

  find(name: string): RuntimeEntity | undefined {
    return this.entities.find((e) => e.name === name && e.alive) ?? this.entities.find((e) => e.name === name);
  }
}
