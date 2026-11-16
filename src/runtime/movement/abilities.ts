/**
 * Abilities: what a character can do on top of how it moves, each given by a component and composable with the
 * others. Double jump and ledge grab are the engine's as they always were (moved here, F2); wall jump and dash are
 * new. Each keeps its own state on the entity (e.ability[id]) and hooks into the model at its points.
 */
import type { Ability, MovementContext } from './types';

/** A component's number field (the component's default when missing). */
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const comp = (ctx: MovementContext, type: string) => (ctx.e.base.components[type] ?? {}) as Record<string, unknown>;

/** DoubleJump: extra jumps in the air (refilled on landing). */
export const doubleJump: Ability = {
  id: 'double_jump',
  component: 'DoubleJump',
  worksWith: ['arcade'],
  grounded({ e }) {
    if (e.beh.doubleJump) e.beh.doubleJump.left = e.beh.doubleJump.extra;
  },
  airJump({ e }) {
    if (!e.beh.doubleJump || e.beh.doubleJump.left <= 0) return false;
    // Double jump: another full jump in the air.
    e.beh.doubleJump.left--;
    e.vy = -e.controller!.jumpForce;
    e.launched = false;
    e.jumpBuffer = 0;
    return true;
  },
};

/** LedgeGrab: falling (or at the top of a jump) against a wall while pressing toward it, catch its top edge. */
export const ledgeGrab: Ability = {
  id: 'ledge_grab',
  component: 'LedgeGrab',
  worksWith: ['arcade'],
  after({ e, host }, dir) {
    if (e.beh.ledgeGrab && !host.ownsPart(e, 'ledge_grab') && !e.grounded && e.vy >= 0 && dir !== 0 && e.grabCooldown <= 0) host.tryGrabLedge(e, dir as 1 | -1);
  },
};

interface WallState {
  sliding: boolean;
  /** The side of the wall it last touched, and how long that still counts (a jump just after letting go). */
  side: number;
  grace: number;
  /** Steering back toward the wall held off for this long after a wall jump. */
  lock: number;
  lockSide: number;
}
const wallState = (e: MovementContext['e']): WallState => (e.ability.wall_jump ??= { sliding: false, side: 0, grace: 0, lock: 0, lockSide: 0 }) as WallState;
/** Seconds after leaving a wall that a jump still pushes off it. */
const WALL_GRACE = 0.1;

/**
 * WallJump: sliding down a wall while pressing toward it, slower (slideSpeed); Jump pushes off it, up and away
 * (jumpX, jumpY: 0 = the player's own jump), steering back toward the wall held off for lockTime.
 */
export const wallJump: Ability = {
  id: 'wall_jump',
  component: 'WallJump',
  worksWith: ['arcade'],
  grounded({ e }) {
    const s = wallState(e);
    s.sliding = false;
    s.grace = 0;
  },
  steer(ctx, dir) {
    const s = wallState(ctx.e);
    s.grace = Math.max(0, s.grace - ctx.dt);
    if (s.lock > 0) {
      s.lock = Math.max(0, s.lock - ctx.dt);
      if (dir === s.lockSide) return 0;
    }
    return dir;
  },
  airJump(ctx) {
    const { e, host } = ctx;
    const s = wallState(e);
    const side = host.wallBeside(e, 1) ? 1 : host.wallBeside(e, -1) ? -1 : s.grace > 0 ? s.side : 0;
    if (side === 0 || e.climbing || e.hanging) return false;
    const w = comp(ctx, 'WallJump');
    e.vy = -(num(w.jumpY, 0) || e.controller!.jumpForce);
    e.vx = -side * num(w.jumpX, 260);
    e.facing = -side as 1 | -1;
    s.lock = num(w.lockTime, 0.15);
    s.lockSide = side;
    s.sliding = false;
    s.grace = 0;
    e.launched = false;
    e.jumpBuffer = 0;
    return true;
  },
  after(ctx, dir) {
    const { e, host } = ctx;
    const s = wallState(e);
    s.sliding = false;
    if (e.grounded || e.climbing || e.hanging) return;
    for (const d of [1, -1] as const)
      if (host.wallBeside(e, d)) {
        s.side = d;
        s.grace = WALL_GRACE;
      }
    // Pressing toward the wall while falling: the slide.
    if (dir !== 0 && host.wallBeside(e, dir as 1 | -1) && e.vy > 0) {
      const slide = num(comp(ctx, 'WallJump').slideSpeed, 90);
      if (e.vy > slide) e.vy = slide;
      s.sliding = true;
    }
  },
  states: (e) => ((e.ability.wall_jump as WallState | undefined)?.sliding ? ['wallSliding'] : []),
};

interface DashState {
  left: number;
  t: number;
  dx: number;
  dy: number;
}
const dashState = (ctx: MovementContext): DashState => (ctx.e.ability.dash ??= { left: num(comp(ctx, 'Dash').charges, 1), t: 0, dx: 0, dy: 0 }) as DashState;

/**
 * Dash: a press of its key (Dash.key: the fire or the action key) shoots the player in the held direction (8, 4 or
 * only sideways) at `speed` for `duration` seconds, gravity off meanwhile; `charges` dashes before it lands again
 * (refilled on the ground). Then the step is the model's again, with some of the speed kept.
 */
export const dash: Ability = {
  id: 'dash',
  component: 'Dash',
  worksWith: ['arcade'],
  override(ctx) {
    const { e, input, dt } = ctx;
    const d = comp(ctx, 'Dash');
    const s = dashState(ctx);
    const speed = num(d.speed, 520);
    if (s.t > 0) {
      s.t -= dt;
      e.vx = s.dx * speed;
      e.vy = s.dy * speed;
      if (s.t <= 0) {
        // (Out of the dash: running speed kept that way; an upward dash keeps a little of its rise.)
        e.vx = s.dx * e.controller!.speed;
        e.vy = s.dy < 0 ? s.dy * speed * 0.4 : s.dy * e.controller!.speed;
      }
      return true;
    }
    const key = d.key === 'interact' ? 'interact' : 'fire';
    if (!input.wasPressed(key) || s.left <= 0 || e.climbing || e.hanging) return false;
    const ways = d.directions === 'horizontal' ? 'horizontal' : d.directions === 'four' ? 'four' : 'eight';
    let x = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    let y = ways === 'horizontal' ? 0 : (input.isDown('down') ? 1 : 0) - (input.isDown('up') ? 1 : 0);
    if (ways === 'four' && x !== 0 && y !== 0) y = 0;
    if (x === 0 && y === 0) x = e.facing;
    const len = Math.hypot(x, y);
    s.dx = x / len;
    s.dy = y / len;
    s.t = num(d.duration, 0.16);
    s.left--;
    if (x !== 0) e.facing = Math.sign(x) as 1 | -1;
    e.vx = s.dx * speed;
    e.vy = s.dy * speed;
    e.grounded = false;
    e.jumpBuffer = 0;
    e.coyote = 0;
    return true;
  },
  grounded(ctx) {
    const s = dashState(ctx);
    if (s.t <= 0 && comp(ctx, 'Dash').refillOnGround !== false) s.left = num(comp(ctx, 'Dash').charges, 1);
  },
  gravity: (e) => !(((e.ability.dash as DashState | undefined)?.t ?? 0) > 0),
  states: (e) => (((e.ability.dash as DashState | undefined)?.t ?? 0) > 0 ? ['dashing'] : []),
};
