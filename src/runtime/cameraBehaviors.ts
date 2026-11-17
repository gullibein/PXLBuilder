/**
 * Camera behaviours (docs/engine-architecture-proposal.md §20, F5): the camera in play is a short pipeline of them,
 * the ones the game's profile makes active (core/engine/camera.ts), in its order. Each step, every behaviour may
 * change the plan: where the camera wants to look (goal), the limits it keeps inside, and how it gets to a new
 * place (eased as ever, slid over a moment, or cut). The controller (camera.ts) then keeps the goal inside the
 * limits and moves; effects (shake, flash, zoom, a look at something) are its own, whatever the behaviours.
 *
 * follow is the engine's camera as it always was, moved here unchanged; velocity_look_ahead and rooms are new.
 */
import { type CameraBounds, type CameraSettings } from '../core/model/camera';
import type { Vec2 } from '../core/types';
import type { Camera } from '../render/renderer';
import type { RuntimeEntity } from './runtime';

/** A camera zone in the level: the view is held inside it while the target is in it. */
export interface CameraZone {
  id: string;
  rect: CameraBounds;
  /** How the camera gets into it from another zone. */
  transition: 'slide' | 'cut';
}

export interface CameraPlan {
  /** Where the camera wants to look; null: nowhere in particular (it stays on its still point). */
  goal: Vec2 | null;
  /** What it keeps inside (the level's edges, a zone); null: nothing. */
  limits: CameraBounds | null;
  /** How it gets there this step: eased (null), at once, or slid over so many seconds. */
  transition: null | 'cut' | { slide: number };
}

export interface CameraContext {
  settings: CameraSettings;
  /** The camera as it is (read only). */
  camera: Readonly<Camera>;
  view: { width: number; height: number };
  /** What it follows (alive or not), or null. */
  target: RuntimeEntity | null;
  /** How the target moves: its speed, and whether it moves freely up and down (seen from above; no gravity). */
  motion: { vx: number; vy: number; floats: boolean } | null;
  /** The level's camera zones, as they are now. */
  zones: readonly CameraZone[];
  dt: number;
  /** The share of the way the camera eases this step (from the target's follow strength). */
  k: number;
}

export interface CameraBehavior {
  id: string;
  /** At the start (and when the camera snaps): where to look and inside what, with no easing. */
  start?(plan: CameraPlan, ctx: CameraContext): void;
  /** Every step. */
  apply(plan: CameraPlan, ctx: CameraContext): void;
  /** What it follows changed (a script's camera_follow). */
  retarget?(): void;
}

// ---------------------------------------------------------------- follow (the camera as it always was)

/** Follows the target: a look-ahead the way it faces (eased), a dead zone; holds still when the target is gone. */
function follow(): CameraBehavior {
  /** Current look-ahead offset (eases toward facing × lookAhead). */
  let look = 0;
  /** Inside the dead zone the camera holds still; outside it, it keeps the target at the zone's edge. */
  const deadZone = (p: Vec2, ctx: CameraContext): Vec2 => {
    const dz = ctx.settings.deadZone;
    const axis = (want: number, at: number, half: number) => (want - at > half ? want - half : want - at < -half ? want + half : at);
    return { x: axis(p.x, ctx.camera.x, dz.x), y: axis(p.y, ctx.camera.y, dz.y) };
  };
  return {
    id: 'follow',
    start(plan, { target }) {
      if (target?.alive) plan.goal = { x: target.x, y: target.y };
    },
    apply(plan, ctx) {
      const t = ctx.target;
      if (t?.alive) {
        look += (t.facing * ctx.settings.lookAhead - look) * ctx.k;
        plan.goal = deadZone({ x: t.x + look, y: t.y }, ctx);
      } else if (t) {
        // What it followed is gone: hold still where it is.
        plan.goal = { x: ctx.camera.x, y: ctx.camera.y };
      }
    },
    retarget() {
      look = 0;
    },
  };
}

// ---------------------------------------------------------------- velocity look-ahead

/** The look-ahead at full speed (px) when the level's camera doesn't say (speedLookAhead), and the speed that is "full". */
export const SPEED_LOOK = { max: 160, fullSpeed: 480, ease: 0.06 };

/**
 * Looks further ahead the faster the target moves: an offset the way it moves, growing with its speed up to the
 * level's speedLookAhead, eased so it doesn't jerk when the target turns. Sideways always; up and down only for a
 * target that moves freely that way (seen from above), so jumps don't bob the view.
 */
function velocityLookAhead(): CameraBehavior {
  const lead = { x: 0, y: 0 };
  return {
    id: 'velocity_look_ahead',
    apply(plan, ctx) {
      const t = ctx.target;
      if (!plan.goal || !t?.alive || !ctx.motion) return;
      const max = ctx.settings.speedLookAhead ?? SPEED_LOOK.max;
      const want = (v: number) => Math.max(-1, Math.min(1, v / SPEED_LOOK.fullSpeed)) * max;
      const e = 1 - Math.pow(1 - SPEED_LOOK.ease, ctx.dt * 60);
      lead.x += (want(ctx.motion.vx) - lead.x) * e;
      lead.y += ((ctx.motion.floats ? want(ctx.motion.vy) : 0) - lead.y) * e;
      plan.goal = { x: plan.goal.x + lead.x, y: plan.goal.y + lead.y };
    },
    retarget() {
      lead.x = 0;
      lead.y = 0;
    },
  };
}

// ---------------------------------------------------------------- rooms (camera zones)

/** Seconds a slide into another zone takes. */
export const ROOM_SLIDE = 0.5;

/** The zone a point is in (the smallest, when zones overlap: a room inside a bigger area), or null. */
export function zoneAt(zones: readonly CameraZone[], p: Vec2): CameraZone | null {
  let best: CameraZone | null = null;
  const area = (z: CameraZone) => (z.rect.maxX - z.rect.minX) * (z.rect.maxY - z.rect.minY);
  for (const z of zones) if (p.x >= z.rect.minX && p.x <= z.rect.maxX && p.y >= z.rect.minY && p.y <= z.rect.maxY && (!best || area(z) < area(best))) best = z;
  return best;
}

/**
 * Rooms: while the target is in a camera zone, the view is held inside that zone (a zone smaller than the screen is
 * centred); going into another zone, the camera slides there (or cuts, as the zone says). Outside every zone the
 * camera is as it is without rooms. Without a target there are no rooms.
 */
function rooms(): CameraBehavior {
  /** The zone the target was last in (null: none; undefined: not looked yet). */
  let last: string | null | undefined;
  const zoneOf = (ctx: CameraContext) => (ctx.target?.alive ? zoneAt(ctx.zones, ctx.target) : null);
  return {
    id: 'rooms',
    start(plan, ctx) {
      const z = zoneOf(ctx);
      last = z?.id ?? null;
      if (z) plan.limits = z.rect;
    },
    apply(plan, ctx) {
      // (A target that is gone for a moment, dying: the view stays in its room.)
      if (ctx.target && !ctx.target.alive) {
        const held = ctx.zones.find((z) => z.id === last);
        if (held) plan.limits = held.rect;
        return;
      }
      const z = zoneOf(ctx);
      const id = z?.id ?? null;
      if (z) plan.limits = z.rect;
      if (last !== undefined && id !== last && z) plan.transition = z.transition === 'cut' ? 'cut' : { slide: ROOM_SLIDE };
      last = id;
    },
    retarget() {
      last = undefined;
    },
  };
}

const MAKE: Record<string, () => CameraBehavior> = { follow, velocity_look_ahead: velocityLookAhead, rooms };

/** The camera behaviours there are (a new one is registered here and declared in core/engine/camera.ts). */
export function registerCameraBehavior(id: string, make: () => CameraBehavior): void {
  MAKE[id] = make;
}
export const cameraBehaviorIds = (): string[] => Object.keys(MAKE);

/** A fresh pipeline of these behaviours, in order (ids with no behaviour are left out). */
export function makePipeline(ids: readonly string[]): CameraBehavior[] {
  return ids.filter((id) => MAKE[id]).map((id) => MAKE[id]());
}
