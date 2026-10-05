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
import { instantiateDefinition } from '../core/model/factory';
import { getEntitySize } from '../core/model/geometry';
import { resolveEntity, type ResolvedEntity } from '../core/model/resolve';
import type { EntityInstance, Id, Project, Scene, Vec2 } from '../core/types';
import type { Camera, RenderEntity } from '../render/renderer';
import { Gameplay } from './gameplay';
import type { InputState } from './input';
import { moveAndCollide, standingOn, type Box } from './physics';

export type BodyKind = 'static' | 'dynamic' | 'kinematic' | 'none';

export interface Controller {
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
  receiver: { sources: string[]; invincibility: number } | null;
  /** Damage dealt on contact (Damage.amount), or null. */
  damage: number | null;
  /** Seconds left without taking damage. */
  invincible: number;
  /** Item name -> count, or null without an Inventory. */
  inventory: Map<string, number> | null;
  collectible: { item: string; keep: boolean } | null;
  stompable: { stompers: string[]; bounce: number; damage: number } | null;
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

function buildEntity(project: Project, instance: EntityInstance, registry: ComponentRegistry): RuntimeEntity {
  const r = resolveEntity(project, instance, registry);
  const c = r.components;
  const pb = c.PhysicsBody;
  const col = c.Collider;
  const scale = r.transform.scale;
  let collider: RuntimeEntity['collider'] = null;
  if (col) {
    const size = col.size as Vec2;
    const off = col.offset as Vec2;
    const w = (col.shape === 'circle' ? size.x : size.x) * Math.abs(scale.x);
    const h = (col.shape === 'circle' ? size.x : size.y) * Math.abs(scale.y);
    collider = { ox: off.x * scale.x, oy: off.y * scale.y, hw: w / 2, hh: h / 2, trigger: col.isTrigger === true };
  }
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
    collider,
    controller: cc ? { speed: Number(cc.speed), acceleration: Number(cc.acceleration), jumpForce: Number(cc.jumpForce), airControl: Number(cc.airControl) } : null,
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
    receiver: c.DamageReceiver ? { sources: (c.DamageReceiver.damageSources as string[]) ?? [], invincibility: Number(c.DamageReceiver.invincibilityDuration) } : null,
    damage: c.Damage ? Number(c.Damage.amount) : null,
    invincible: 0,
    inventory,
    collectible: c.Collectible && item ? { item, keep: c.Collectible.collectionBehavior !== 'consume' } : null,
    stompable: c.Stompable ? { stompers: (c.Stompable.stompers as string[]) ?? [], bounce: Number(c.Stompable.bounce), damage: Number(c.Stompable.damage) } : null,
    stompGrace: 0,
    hiddenBySwitch: false,
    moveTarget: null,
    prevY: r.transform.position.y,
    touching: new Set(),
  };
}

export class Runtime {
  entities: RuntimeEntity[] = [];
  readonly gravity: Vec2;
  readonly camera: Camera;
  /** Events, rules and gameplay systems. */
  readonly gameplay: Gameplay;
  time = 0;
  private accumulator = 0;
  /** Solids that never move: recomputed only when something opens, closes, appears or goes away. */
  private staticSolids: Box[] = [];
  private solidsDirty = true;
  /** Tops of ladders: one-way platforms. */
  private ladderTops: Box[] = [];
  /** Ladders: unbroken vertical stacks of climbable pieces. A gap starts a new ladder. */
  private ladders: Ladder[] = [];
  private fallLimit = 0;
  private cameraTarget: RuntimeEntity | null = null;
  private followStrength = 0.15;
  private readonly scene: Scene;

  constructor(
    private readonly project: Project,
    sceneId: Id,
    private readonly registry: ComponentRegistry,
    opts: { zoom?: number } = {},
  ) {
    this.scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
    this.gravity = { ...this.scene.world.gravity };
    this.camera = { x: 0, y: 0, zoom: opts.zoom ?? 1 };
    this.gameplay = new Gameplay(this, project, this.scene);
    this.load();
  }

  /** (Re)builds the level from the project: everything back at its start. */
  private load(): void {
    this.entities = this.scene.entities.map((e) => buildEntity(this.project, e, this.registry));
    this.solidsDirty = true;
    this.ladders = ladderColumns(this.entities.filter((e) => e.climbable));
    // The top of each ladder is a one-way platform you can stand on and climb down from.
    this.ladderTops = this.ladders.map((l) => ({ x: l.x, y: l.top + 1, hw: l.hw, hh: 1 }));

    const bottoms = this.entities.map((e) => e.y + getEntitySize(e.base).y);
    this.fallLimit = (bottoms.length ? Math.max(...bottoms) : 0) + FALL_MARGIN;

    this.cameraTarget = this.entities.find((e) => e.base.components.CameraTarget) ?? this.entities.find((e) => e.controller) ?? null;
    const fs = this.cameraTarget?.base.components.CameraTarget?.followStrength;
    this.followStrength = typeof fs === 'number' ? fs : 0.15;
    this.camera.x = this.cameraTarget?.x ?? 0;
    this.camera.y = this.cameraTarget?.y ?? 0;
    this.gameplay.reset();
  }

  /** Starts the level again from the beginning (a rule action, or R in play). */
  restart(): void {
    this.load();
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
    this.followCamera(frameDt);
  }

  step(dt: number, input: InputState): void {
    this.time += dt;
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
      this.staticSolids = this.entities.filter((e) => this.isSolid(e) && (e.body === 'static' || e.body === 'none')).map((e) => boxOf(e)!);
      this.solidsDirty = false;
    }
    this.gameplay.steer();
    const kinematicSolids: Box[] = [];
    for (const e of this.entities) {
      if (e.body === 'kinematic' && e.alive) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (this.isSolid(e)) kinematicSolids.push(boxOf(e)!);
      }
    }
    const solids = kinematicSolids.length ? [...this.staticSolids, ...kinematicSolids] : this.staticSolids;

    for (const e of this.entities) {
      if (e.body !== 'dynamic' || !e.alive) continue;
      e.prevY = e.y;
      if (e.controller) this.control(e, input, dt);
      if (!e.climbing) {
        e.vx += this.gravity.x * e.gravityScale * dt;
        e.vy = Math.min(MAX_FALL_SPEED, e.vy + this.gravity.y * e.gravityScale * dt);
      }
      const box = boxOf(e);
      if (!box) {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
      } else {
        // Ladder tops hold you up unless you are climbing (or already below them).
        const prevBottom = box.y + box.hh;
        const surfaces = e.climbing ? solids : [...solids, ...this.ladderTops.filter((t) => prevBottom <= t.y - t.hh + 0.01)];
        const r = moveAndCollide(box, e.vx * dt, e.vy * dt, surfaces);
        e.x = r.x - e.collider!.ox;
        e.y = r.y - e.collider!.oy;
        if (r.hitX) e.vx = 0;
        if (r.hitY) e.vy = 0;
        e.grounded = r.grounded || (e.vy >= 0 && standingOn(boxOf(e)!, surfaces));
        // Climbing down onto the floor (or standing on it) ends the climb.
        if (e.climbing && e.grounded && e.vy >= 0) e.climbing = false;
      }
      if (e.y > this.fallLimit) this.respawn(e);
    }
    this.gameplay.update(dt, input);
  }

  private isSolid(e: RuntimeEntity): boolean {
    return e.alive && !e.open && !!e.collider && !e.collider.trigger;
  }

  /** Something opened, closed, appeared or went away. */
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

  /** Player-style movement for entities with a CharacterController. */
  private control(e: RuntimeEntity, input: InputState, dt: number): void {
    const c = e.controller!;
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
      e.vy = vertical * c.speed;
      e.vx = dir * c.speed;
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

    const target = dir * c.speed;
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
    }
    // Releasing jump early makes a shorter hop.
    if (input.wasReleased('jump') && e.vy < 0) e.vy *= 0.5;
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
  respawn(e: RuntimeEntity): void {
    e.x = e.spawn.x;
    e.y = e.spawn.y;
    e.vx = 0;
    e.vy = 0;
    e.climbing = false;
    e.touching = new Set();
    if (e.health) e.health.current = e.health.max;
    if (!e.alive) {
      e.alive = true;
      this.solidsDirty = true;
    }
    e.respawns++;
    this.gameplay.emit('respawned', e);
  }

  private followCamera(dt: number): void {
    const t = this.cameraTarget;
    if (!t) return;
    const k = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, this.followStrength)), dt * 60);
    this.camera.x += (t.x - this.camera.x) * k;
    this.camera.y += (t.y - this.camera.y) * k;
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
      const mirrored = e.switch?.on === true;
      const moved = e.x !== t.position.x || e.y !== t.position.y;
      let r: RenderEntity = moved || mirrored ? { ...e.base, transform: { ...t, position: { x: e.x, y: e.y }, scale: mirrored ? { x: -t.scale.x, y: t.scale.y } : t.scale } } : e.base;
      const alpha = e.open ? 0.3 : e.invincible > 0 && Math.floor(e.invincible * 12) % 2 === 0 ? 0.35 : 1;
      if (alpha !== 1) r = { ...r, alpha };
      out.push(r);
    }
    return out;
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
