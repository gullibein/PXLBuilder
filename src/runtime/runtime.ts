/**
 * The game runtime.
 *
 * Built from a snapshot of the project when Play starts and thrown away on
 * Stop: it never writes to the project. Everything it does comes from the
 * same data the editor shows (components, world settings); there is no
 * separate demo logic. Rendering uses the shared renderer.
 */
import type { ComponentRegistry } from '../core/components/registry';
import { getEntitySize } from '../core/model/geometry';
import { resolveEntity, type ResolvedEntity } from '../core/model/resolve';
import type { Id, Project, Scene, Vec2 } from '../core/types';
import type { Camera } from '../render/renderer';
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
  /** Resolved editor state at Play time (components, look). Runtime-only changes go in the fields below. */
  base: ResolvedEntity;
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
  /** How many times it fell out of the level and was put back. */
  respawns: number;
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

function buildEntity(project: Project, scene: Scene, index: number, registry: ComponentRegistry): RuntimeEntity {
  const r = resolveEntity(project, scene.entities[index], registry);
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
  return {
    id: r.id,
    name: r.name,
    base: r,
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
  };
}

export class Runtime {
  readonly entities: RuntimeEntity[];
  readonly gravity: Vec2;
  readonly camera: Camera;
  time = 0;
  private accumulator = 0;
  /** Static solids never move: computed once. */
  private readonly staticSolids: Box[];
  /** Tops of ladders: one-way platforms you can stand on and climb down from. */
  private readonly ladderTops: Box[];
  private readonly climbables: RuntimeEntity[];
  private readonly fallLimit: number;
  private readonly cameraTarget: RuntimeEntity | null;
  private readonly followStrength: number;

  constructor(project: Project, sceneId: Id, registry: ComponentRegistry, opts: { zoom?: number } = {}) {
    const scene = project.scenes.find((s) => s.id === sceneId) ?? project.scenes[0];
    this.entities = scene.entities.map((_, i) => buildEntity(project, scene, i, registry));
    this.gravity = { ...scene.world.gravity };

    const isSolid = (e: RuntimeEntity) => e.collider && !e.collider.trigger && (e.body === 'static' || e.body === 'none');
    this.staticSolids = this.entities.filter(isSolid).map((e) => boxOf(e)!);
    this.climbables = this.entities.filter((e) => e.climbable);
    // A ladder piece with no ladder piece directly above it has a walkable top.
    this.ladderTops = this.climbables
      .filter((l) => {
        const z = zoneOf(l);
        return !this.climbables.some((o) => o !== l && Math.abs(o.x - l.x) < 1 && Math.abs(zoneOf(o).y + zoneOf(o).hh - (z.y - z.hh)) < 1);
      })
      .map((l) => {
        const z = zoneOf(l);
        return { x: z.x, y: z.y - z.hh + 1, hw: z.hw, hh: 1 };
      });

    const bottoms = this.entities.map((e) => e.y + getEntitySize(e.base).y);
    this.fallLimit = (bottoms.length ? Math.max(...bottoms) : 0) + FALL_MARGIN;

    this.cameraTarget = this.entities.find((e) => e.base.components.CameraTarget) ?? this.entities.find((e) => e.controller) ?? null;
    const fs = this.cameraTarget?.base.components.CameraTarget?.followStrength;
    this.followStrength = typeof fs === 'number' ? fs : 0.15;
    this.camera = { x: this.cameraTarget?.x ?? 0, y: this.cameraTarget?.y ?? 0, zoom: opts.zoom ?? 1 };
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
    const kinematicSolids: Box[] = [];
    for (const e of this.entities) {
      if (e.body === 'kinematic') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        if (e.collider && !e.collider.trigger) kinematicSolids.push(boxOf(e)!);
      }
    }
    const solids = kinematicSolids.length ? [...this.staticSolids, ...kinematicSolids] : this.staticSolids;

    for (const e of this.entities) {
      if (e.body !== 'dynamic') continue;
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
  }

  /** Player-style movement for entities with a CharacterController. */
  private control(e: RuntimeEntity, input: InputState, dt: number): void {
    const c = e.controller!;
    const dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    const ladder = this.ladderAt(e);

    // Climbing: Up/Down on a ladder (at least half of you inside it), at running speed. Left/Right
    // moves you along it; once less than half of you is on the ladder you let go (walk off, or fall
    // if you're halfway up). Jumping lets go; reaching the floor ends the climb.
    if (ladder && !e.climbing && (input.isDown('up') || (input.isDown('down') && !this.isOnFloorBelowLadder(e)))) {
      e.climbing = true;
      e.vx = 0;
    }
    if (e.climbing && (!ladder || input.wasPressed('jump'))) e.climbing = false;
    if (e.climbing) {
      const vertical = (input.isDown('down') ? 1 : 0) - (input.isDown('up') ? 1 : 0);
      e.vy = vertical * c.speed;
      e.vx = dir * c.speed;
      // Climbing straight up or down eases you into the middle of the ladder; Left/Right overrides it.
      if (ladder && vertical !== 0 && dir === 0) e.x += (ladder.x - e.x) * Math.min(1, dt * LADDER_CENTERING);
      e.grounded = false;
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
   * The ladder a character can hold: at least half of the character (by width) inside the ladder
   * tile, and touching it vertically (reaching 2px below the feet, so you can climb down from a top).
   */
  private ladderAt(e: RuntimeEntity): RuntimeEntity | null {
    const me = zoneOf(e);
    const reach = { ...me, y: me.y + 1, hh: me.hh + 1 };
    let best: RuntimeEntity | null = null;
    let bestInside = -1;
    for (const l of this.climbables) {
      const z = zoneOf(l);
      const inside = Math.min(me.x + me.hw, z.x + z.hw) - Math.max(me.x - me.hw, z.x - z.hw);
      if (inside >= LADDER_GRIP * me.hw * 2 - 1e-6 && inside > bestInside && Math.abs(reach.y - z.y) < reach.hh + z.hh) {
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

  private respawn(e: RuntimeEntity): void {
    e.x = e.spawn.x;
    e.y = e.spawn.y;
    e.vx = 0;
    e.vy = 0;
    e.climbing = false;
    e.respawns++;
  }

  private followCamera(dt: number): void {
    const t = this.cameraTarget;
    if (!t) return;
    const k = 1 - Math.pow(1 - Math.min(0.999, Math.max(0.001, this.followStrength)), dt * 60);
    this.camera.x += (t.x - this.camera.x) * k;
    this.camera.y += (t.y - this.camera.y) * k;
  }

  /** Entities as the renderer expects them, at their current runtime positions. */
  renderList(): ResolvedEntity[] {
    return this.entities.map((e) => (e.x === e.base.transform.position.x && e.y === e.base.transform.position.y ? e.base : { ...e.base, transform: { ...e.base.transform, position: { x: e.x, y: e.y } } }));
  }

  find(name: string): RuntimeEntity | undefined {
    return this.entities.find((e) => e.name === name);
  }
}
