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
import { Gameplay, type LoggedEvent } from './gameplay';
import { instantiateScripts, ScriptSystem, type ScriptInstance } from './scripts';
import type { InputState } from './input';
import { moveAndCollide, overlaps, standingOn, type Box } from './physics';

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
  climbing: boolean;
  coyote: number;
  jumpBuffer: number;
  spawn: Vec2;
  /** How many times it was put back at its start (fell out of the level, or died). */
  respawns: number;
  /** Opened (doors…): it no longer blocks and is drawn faded. */
  open: boolean;
  switch: { activation: 'interact' | 'touch'; once: boolean; on: boolean; used: boolean } | null;
  health: { current: number; max: number } | null;
  receiver: { sources: string[]; invincibility: number; knockback: number } | null;
  /** Pushable: how it moves when pushed (step 0 = slides), who may push it, and when it was last pushed (a push after a pause is a new "pushed" event). */
  pushable: { step: number; pushers: string[]; speed: number; pushedAt: number } | null;
  /** Being knocked back by a hit: for how long, and the velocity it had before (it goes back to that after). */
  knock: { t: number; restore: { vx: number; vy: number } } | null;
  /** Damage dealt on contact (Damage.amount), or null. */
  damage: number | null;
  /** Seconds left without taking damage. */
  invincible: number;
  /** Item name -> count, or null without an Inventory. */
  inventory: Map<string, number> | null;
  collectible: { item: string; keep: boolean } | null;
  stompable: { stompers: string[]; bounce: number; damage: number } | null;
  /** Which way it faces (1 right, -1 left): set by running and patrolling; drawn mirrored when -1. */
  facing: 1 | -1;
  /** The way it last moved or looked, as a direction (x, y each -1, 0 or 1; diagonals too): where a top-down character shoots. */
  heading: { x: number; y: number };
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
  /** Play time it was last hurt / last fired a shot (for the hurt and shoot looks). */
  hurtAt: number;
  shotAt: number;
  /** Being steered by a "follows" relationship this step (so it isn't also patrolling). */
  chasing: boolean;
  /** Behaviors (from behavior components) and their running state. */
  beh: Behaviors;
  /** Hanging from a ledge (LedgeGrab): which side the wall is on, its top, and its face. */
  hanging: { side: 1 | -1; top: number; edgeX: number } | null;
  /** Seconds before it can grab a ledge again (after letting go). */
  grabCooldown: number;
  /** A shot (from a Shooter): who fired it, and how far it may still fly. */
  projectile: { owner: Id; left: number } | null;
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
/** Friction 1 takes this much speed away per second (px/s²); 0.2 takes a fifth of it. */
const FRICTION_DECEL = 1000;
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
function zoneOf(e: RuntimeEntity): Box {
  const size = getEntitySize(e.base);
  const scale = e.base.transform.scale;
  return { x: e.x, y: e.y, hw: (size.x * Math.abs(scale.x)) / 2, hh: (size.y * Math.abs(scale.y)) / 2 };
}

interface Ladder {
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

export type Situation = 'idle' | 'run' | 'up' | 'down' | 'jump' | 'fall' | 'climb' | 'hang' | 'hurt' | 'shoot';
/** How long the hurt and shoot looks last (seconds). */
const HURT_LOOK = 0.4;
const SHOOT_LOOK = 0.25;

export interface Behaviors {
  /** dir: 1 right (or down when vertical), -1 left (or up). */
  patrol: { speed: number; distance: number; turnAtLedges: boolean; originX: number; originY: number; dir: 1 | -1; vertical: boolean } | null;
  jumper: { interval: number; jumpForce: number; t: number } | null;
  shooter: { trigger: 'auto' | 'key'; interval: number; direction: string; targetTag: string; speed: number; damage: number; range: number; projectile: string; t: number } | null;
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
    patrol: p ? { speed: num(p.speed, 60), distance: num(p.distance, 0), turnAtLedges: p.turnAtLedges !== false, originX: at.x, originY: at.y, dir: p.startDirection === 'left' || p.startDirection === 'up' ? -1 : 1, vertical: p.startDirection === 'up' || p.startDirection === 'down' } : null,
    jumper: j ? { interval: num(j.interval, 2), jumpForce: num(j.jumpForce, 300), t: 0 } : null,
    shooter: s
      ? {
          trigger: s.trigger === 'key' ? 'key' : 'auto',
          interval: num(s.interval, 2),
          direction: typeof s.direction === 'string' ? s.direction : 'facing',
          targetTag: typeof s.targetTag === 'string' ? s.targetTag : 'player',
          speed: num(s.speed, 240),
          damage: num(s.damage, 1),
          range: num(s.range, 480),
          projectile: typeof s.projectile === 'string' ? s.projectile : '',
          // Fired by a key: ready at once. Automatic: the first shot comes after one interval.
          t: s.trigger === 'key' ? num(s.interval, 2) : 0,
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
    baseGravity: typeof pb?.gravityScale === 'number' ? pb.gravityScale : 1,
    speedFactor: 1,
    collider,
    controller: cc ? { movement: cc.movement === 'topdown' ? 'topdown' : 'platformer', speed: Number(cc.speed), acceleration: Number(cc.acceleration), jumpForce: Number(cc.jumpForce), airControl: Number(cc.airControl) } : null,
    climbable: !!c.Climbable,
    grounded: false,
    climbing: false,
    coyote: 0,
    jumpBuffer: 0,
    spawn: { ...r.transform.position },
    respawns: 0,
    open: c.Openable?.startsOpen === true,
    switch: c.Switch ? { activation: c.Switch.activation === 'touch' ? 'touch' : 'interact', once: c.Switch.once === true, on: c.Switch.startsOn === true, used: false } : null,
    health: c.Health ? { current: Number(c.Health.currentHealth), max: Number(c.Health.maxHealth) } : null,
    receiver: c.DamageReceiver ? { sources: (c.DamageReceiver.damageSources as string[]) ?? [], invincibility: Number(c.DamageReceiver.invincibilityDuration), knockback: typeof c.DamageReceiver.knockback === 'number' ? c.DamageReceiver.knockback : 160 } : null,
    knock: null,
    pushable: c.Pushable ? { step: Number(c.Pushable.step) || 0, pushers: (c.Pushable.pushers as string[]) ?? ['player'], speed: Number(c.Pushable.speed) || 160, pushedAt: -Infinity } : null,
    damage: c.Damage ? Number(c.Damage.amount) : null,
    invincible: 0,
    inventory,
    collectible: c.Collectible && item ? { item, keep: c.Collectible.collectionBehavior !== 'consume' } : null,
    stompable: c.Stompable ? { stompers: (c.Stompable.stompers as string[]) ?? [], bounce: Number(c.Stompable.bounce), damage: Number(c.Stompable.damage) } : null,
    stompGrace: 0,
    facing: c.Patrol?.startDirection === 'left' ? -1 : 1,
    heading: c.Patrol?.startDirection === 'up' ? { x: 0, y: -1 } : c.Patrol?.startDirection === 'down' ? { x: 0, y: 1 } : { x: c.Patrol?.startDirection === 'left' ? -1 : 1, y: 0 },
    bumped: 0,
    hurtAt: -Infinity,
    shotAt: -Infinity,
    chasing: false,
    scripts: instantiateScripts(r.scripts),
    alpha: null,
    angle: 0,
    turn: null,
    spin: 0,
    beh: readBehaviors(c, r.transform.position),
    hanging: null,
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
  private readonly behaviors: BehaviorSystem;
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
  /** Parts of the built-in play display that scripts turned off. */
  readonly builtinHidden = new Set<'hearts' | 'items'>();
  /** Sounds to play (the play view plays and empties it every frame; the runtime itself makes no sound). */
  readonly soundQueue: { assetId: Id; volume: number; pitch: number }[] = [];
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
    if (this.completed !== null) return;
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
    this.time += dt;
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
      this.staticSolids = this.entities.filter((e) => this.isSolid(e) && !e.pushable && (e.body === 'static' || e.body === 'none')).map((e) => boxOf(e)!);
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
        if (this.isSolid(e)) kinematicSolids.push(boxOf(e)!);
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
      if (e.controller) this.control(e, input, dt);
      if (!e.climbing && !e.hanging && e.controller?.movement !== 'topdown') {
        e.vx += this.gravity.x * e.gravityScale * dt;
        e.vy = Math.min(MAX_FALL_SPEED, e.vy + this.gravity.y * e.gravityScale * dt);
      }
      const box = boxOf(e);
      if (!box) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      } else {
        if (pushables.length && !e.pushable) this.pushAlong(e, box, e.vx * dt, this.floats(e) ? e.vy * dt : 0, solids, pushables);
        // Ladder tops hold you up unless you are climbing (or already below them).
        const prevBottom = box.y + box.hh;
        const others = pushables.length ? pushables.filter((p) => p !== e).map((p) => boxOf(p)!) : [];
        const base = others.length ? [...solids, ...others] : solids;
        const surfaces = e.climbing ? base : [...base, ...this.ladderTops.filter((t) => prevBottom <= t.y - t.hh + 0.01)];
        const r = moveAndCollide(box, e.vx * dt, e.vy * dt, surfaces);
        e.x = r.x - e.collider!.ox;
        e.y = r.y - e.collider!.oy;
        e.bumped = r.hitX ? (e.vx > 0 ? 1 : e.vx < 0 ? -1 : 0) : 0;
        if (r.hitX) e.vx = 0;
        if (r.hitY) e.vy = 0;
        e.grounded = r.grounded || (e.vy >= 0 && standingOn(boxOf(e)!, surfaces));
        // Climbing down onto the floor (or standing on it) ends the climb.
        if (e.climbing && e.grounded && e.vy >= 0) e.climbing = false;
      }
      // Without gravity nothing falls out of the level (a top-down character can walk below it).
      if (e.y > this.fallLimit && !this.floats(e)) this.respawn(e, 'fell');
    }
    this.behaviors.after(dt);
    this.gameplay.update(dt, input);
  }

  /** Its collision box after its size, scale or rotation changed. */
  refreshCollider(e: RuntimeEntity): void {
    e.collider = colliderOf(e.base.components, e.base.transform, e.angle);
    if (e.body !== 'dynamic') this.solidsDirty = true;
  }

  private isSolid(e: RuntimeEntity): boolean {
    return e.alive && !e.open && !!e.collider && !e.collider.trigger;
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
    const loss = e.friction * FRICTION_DECEL * dt;
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

  /** Player-style movement for entities with a CharacterController. */
  private control(e: RuntimeEntity, input: InputState, dt: number): void {
    const c = e.controller!;
    if (c.movement === 'topdown') return this.walkTopDown(e, input, dt);
    const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    const ladder = this.ladderAt(e);

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
      if (vertical < 0 && me.y + me.hh + e.vy * dt <= ladder.top) {
        e.y = ladder.top - me.hh;
        e.vy = 0;
        e.climbing = false;
        e.grounded = true;
      }
      return;
    }

    if (dir !== 0) e.facing = dir as 1 | -1;
    if (e.grounded && e.beh.doubleJump) e.beh.doubleJump.left = e.beh.doubleJump.extra;
    if (e.grabCooldown > 0) e.grabCooldown = Math.max(0, e.grabCooldown - dt);
    if (e.hanging && this.hang(e, input, dir)) return;

    const target = dir * c.speed * e.speedFactor;
    const rate = c.acceleration * (e.grounded ? 1 : c.airControl);
    const diff = target - e.vx;
    e.vx += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);

    // Forgiving jumps: a short buffer before landing and a short grace period after walking off a ledge.
    // Only the jump button jumps; Up is for climbing.
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
    if (e.beh.ledgeGrab && !e.grounded && e.vy >= 0 && dir !== 0 && e.grabCooldown <= 0) this.tryGrabLedge(e, dir as 1 | -1);
    // Releasing jump early makes a shorter hop.
    if (input.wasReleased('jump') && e.vy < 0) e.vy *= 0.5;
  }

  /**
   * Top-down walking: the arrow keys (or WASD) move it in eight directions at
   * the same speed (diagonals aren't faster), speeding up and slowing down by
   * its acceleration. Walls stop it; nothing pulls it down.
   */
  private walkTopDown(e: RuntimeEntity, input: InputState, dt: number): void {
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
    e.grounded = false;
    e.climbing = false;
    e.hanging = null;
  }

  /**
   * Ledge grab: falling (or at the top of a jump) against a wall while
   * pressing toward it, with the wall's top edge at about hand height and room
   * to stand on top: hang there.
   */
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
  private hang(e: RuntimeEntity, input: InputState, dir: number): boolean {
    const h = e.hanging!;
    const box = boxOf(e)!;
    e.vx = 0;
    e.vy = 0;
    e.grounded = false;
    if (input.wasPressed('jump') || input.isDown('up')) {
      e.x = h.edgeX + h.side * (box.hw + 1) - (box.x - e.x);
      e.y = h.top - box.hh - (box.y - e.y);
      e.hanging = null;
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
   * starts gliding one step, if that spot is free.
   */
  private pushAlong(e: RuntimeEntity, box: Box, dx: number, dy: number, walls: readonly Box[], pushables: RuntimeEntity[]): void {
    const mine = pushables.filter((p) => p.alive && p.pushable!.pushers.some((t) => e.tags.includes(t)));
    if (!mine.length) return;
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
        if (s.step > 0) {
          if (p.moveTarget) continue;
          const to = ax === 'x' ? { x: p.x + dir * s.step, y: p.y } : { x: p.x, y: p.y + dir * s.step };
          const target: Box = { ...pb, x: pb.x + (to.x - p.x), y: pb.y + (to.y - p.y) };
          if (blockers(p).some((b) => overlaps(target, b))) continue;
          this.moveTo(p, to, s.speed);
        } else {
          // Shove it by as much as `e` would sink into it.
          const sink = ax === 'x' ? (d > 0 ? moved.x + moved.hw - (pb.x - pb.hw) : moved.x - moved.hw - (pb.x + pb.hw)) : d > 0 ? moved.y + moved.hh - (pb.y - pb.hh) : moved.y - moved.hh - (pb.y + pb.hh);
          const r = moveAndCollide(pb, ax === 'x' ? sink : 0, ax === 'y' ? sink : 0, blockers(p));
          p.x += r.x - pb.x;
          p.y += r.y - pb.y;
          if (r.x === pb.x && r.y === pb.y) continue;
        }
        if (this.time - s.pushedAt > 0.1) this.gameplay.emit('pushed', p, e);
        s.pushedAt = this.time;
      }
    }
  }

  /** Fires a shot from `from` in direction (dx, dy) (normalized), as a runtime-only entity. */
  shoot(from: RuntimeEntity, dx: number, dy: number, cfg: { projectile: string; speed: number; damage: number; range: number }): RuntimeEntity {
    const def = cfg.projectile ? this.project.definitions.find((d) => d.id === cfg.projectile) : undefined;
    const fromBox = boxOf(from);
    const reach = (fromBox ? Math.max(fromBox.hw, fromBox.hh) : 8) + 6;
    const at = { x: from.x + dx * reach, y: from.y + dy * reach };
    const instance = def
      ? instantiateDefinition(def, at)
      : createStandaloneEntity('Shot', at, {
          Sprite: this.registry.createDefault('Sprite', { width: 8, height: 8, color: '#ffd166' }),
          Collider: this.registry.createDefault('Collider', { shape: 'circle', size: { x: 8, y: 8 }, isTrigger: true }),
        });
    from.shotAt = this.time;
    const e = buildEntity(this.project, instance, this.registry);
    // A shot flies straight and is never solid, whatever the object says.
    e.body = 'kinematic';
    if (e.collider) e.collider.trigger = true;
    e.vx = dx * cfg.speed;
    e.vy = dy * cfg.speed;
    e.facing = dx < 0 ? -1 : 1;
    e.damage = e.damage ?? cfg.damage;
    // A shot carries its shooter's tags (an enemy's shot hurts like the enemy does), plus "projectile".
    e.tags = [...new Set([...e.tags, ...from.tags, 'projectile'])];
    e.projectile = { owner: from.id, left: cfg.range };
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

  /** Standing on solid ground with the ladder going up: pressing down shouldn't start a climb into the floor. */
  private isOnFloorBelowLadder(e: RuntimeEntity): boolean {
    return e.grounded && !this.ladderTops.some((t) => standingOn(boxOf(e)!, [t]));
  }

  /** Puts an entity back at its start with full health (after falling out of the level or dying). */
  respawn(e: RuntimeEntity, reason: 'fell' | 'died' | 'rule' | 'script' = 'rule'): void {
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
    e.speedFactor = 1;
    e.gravityScale = e.baseGravity;
    e.knock = null;
    if (e.health) e.health.current = e.health.max;
    if (!e.alive) {
      e.alive = true;
      this.solidsDirty = true;
    }
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
      if (!e.alive) continue;
      const t = e.base.transform;
      const mirrored = e.switch?.on === true || e.facing === -1;
      const moved = e.x !== t.position.x || e.y !== t.position.y;
      const turned = e.angle !== 0;
      let r: RenderEntity =
        moved || mirrored || turned
          ? { ...e.base, transform: { ...t, position: { x: e.x, y: e.y }, rotation: t.rotation + e.angle, scale: mirrored ? { x: -t.scale.x, y: t.scale.y } : t.scale } }
          : e.base;
      const look = this.lookOf(e);
      if (look.assetId && r.components.Sprite) r = { ...r, components: { ...r.components, Sprite: { ...r.components.Sprite, assetId: look.assetId, frame: 1 } } };
      const alpha = (e.open ? 0.3 : e.invincible > 0 && Math.floor(e.invincible * 12) % 2 === 0 ? 0.35 : 1) * (e.alpha ?? 1);
      if (alpha !== 1) r = { ...r, alpha };
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
    if (this.time - e.hurtAt < HURT_LOOK) situation = 'hurt';
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
