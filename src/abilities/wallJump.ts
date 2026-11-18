/**
 * Wall jump, whole (docs/engine-architecture-proposal.md §24): its component, what it does in play, what scripts
 * read of it, its part in the player's reach (the route solver's move rule, with the capability the level builder
 * sizes its patterns from) and how the route bot plays it. Registered once (index.ts); nothing else in the engine
 * names it.
 */
import { goalAt, onWall, standing, wallMode, type MoveRule } from '../core/levelGen/moves';
import type { World } from '../core/levelGen/solver';
import type { MovementContext } from '../runtime/movement/types';
import type { AbilityDefinition } from './types';

/** A component's number field (the component's default when missing). */
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const comp = (ctx: MovementContext, type: string) => (ctx.e.base.components[type] ?? {}) as Record<string, unknown>;
/** Kept under the estimate, as the jump table is: what a player can count on. */
const MARGIN = 0.92;
const CELL = 32;

// ---------------------------------------------------------------- in play

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

// ---------------------------------------------------------------- in the player's reach

/**
 * Wall slide and wall jump (WallJump): the player jumps or falls onto a wall it presses against and holds it,
 * sliding down; from a wall it jumps up and away, `riseRows` up at most and `awayCells` across, onto ground or onto
 * the other side of a shaft, and from there again. Estimated in cells (the real kick, slide and steering are the
 * runtime's: a route through wall jumps is confirmed by the route bot).
 */
function wallJumpMove(riseRows: number, awayCells: number): MoveRule {
  return {
    id: 'wall_jump',
    mechanics: ['wall_jump'],
    makes: ['wall_slide'],
    // (rise: rows a kick gains; away: cells it carries across, so how wide a shaft it climbs.)
    capability: { id: 'wall_jump', numbers: { rise: riseRows, away: awayCells } },
    successors(s, v) {
      const { c, r, kh, so, cr, mode, id, w } = s;
      const toWall = (side: -1 | 1) => (tc: number, tr: number, ww: World) => onWall(tc, tr, side, ww, v) && !v.supportAt(tc, tr + 1, ww);
      if (!mode) {
        // Onto a wall: jumping (or stepping off and falling) to a cell beside a wall, holding it.
        if (!standing(s, v)) return;
        for (const side of [-1, 1] as const)
          for (let rise = v.lim.maxRise; rise >= -4; rise--)
            for (let dx = -(v.maxGap + 1); dx <= v.maxGap + 1; dx++) {
              if (dx === 0 && rise <= 0) continue;
              if (v.canJump(c, r, dx, rise, s.away, v.lim.gap, toWall(side))) v.push(c + dx, r - rise, kh, so, cr, id, 'jump', 3 + Math.abs(dx) + Math.max(0, rise), wallMode(side));
            }
        return;
      }
      const side: -1 | 1 = mode === 1 ? -1 : 1;
      // Sliding down: still on the wall, or onto the floor under it.
      if (v.supportAt(c, r + 1, w)) v.push(c, r, kh, so, cr, id, 'wall_slide');
      else if (onWall(c, r + 1, side, w, v)) v.push(c, r + 1, kh, so, cr, id, 'wall_slide', 1, mode);
      // Kicking off: up and away from the wall (onto the other wall of a shaft, or onto ground).
      const away = -side as -1 | 1;
      for (let rise = riseRows; rise >= -2; rise--)
        for (let k = 1; k <= awayCells; k++) {
          const dx = away * k;
          if (v.canJump(c, r, dx, rise, w, () => awayCells, toWall(away))) v.push(c + dx, r - rise, kh, so, cr, id, 'wall_jump', 3 + k + Math.max(0, rise), wallMode(away));
          else if (v.canJump(c, r, dx, rise, w, () => awayCells, (tc, tr) => goalAt(tc, tr, v) && v.freeAt(tc, tr, w))) v.push(c + dx, r - rise, kh, so, cr, id, 'wall_jump', 3 + k + Math.max(0, rise), wallMode(away));
          if (v.canJump(c, r, dx, rise, w, () => awayCells)) v.push(c + dx, r - rise, kh, so, cr, id, 'wall_jump', 3 + k + Math.max(0, rise));
        }
    },
  };
}

// ---------------------------------------------------------------- the definition

export const wallJump: AbilityDefinition = {
  id: 'wall_jump',
  describe: 'Slide down walls and jump off them',
  plural: 'wall jumps',
  component: {
    type: 'WallJump',
    label: 'Wall Jump',
    description: 'A player-controlled platformer character slides down walls it presses against (slower), and Jump pushes it off the wall, up and away.',
    category: 'Behavior',
    fields: {
      slideSpeed: { kind: 'number', default: 90, min: 0, step: 10, description: 'Fastest slide down a wall (px/s)' },
      jumpX: { kind: 'number', default: 260, min: 0, step: 10, description: 'Push away from the wall (px/s)' },
      jumpY: { kind: 'number', default: 0, min: 0, step: 10, description: 'Jump speed up (px/s); 0: its own jump' },
      lockTime: { kind: 'number', default: 0.15, min: 0, step: 0.05, description: 'Seconds it can\'t steer back to the wall' },
    },
  },
  worksWith: ['arcade'],
  order: 20,
  runtime: {
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
  },
  scriptNames: { wall_sliding: { state: 'wallSliding', doc: 'sliding down a wall (WallJump)' } },
  // A kick off the wall: up as fast as its jumpY (0: the player's jump), away at jumpX until its top.
  reach: {
    move(c, base) {
      const w = c.WallJump!;
      const vy = num(w.jumpY, 0) || base.jumpForce;
      const rise = Math.floor(((vy * vy) / (2 * base.gravity)) * MARGIN / CELL);
      const away = Math.max(1, Math.floor((num(w.jumpX, 260) * (vy / base.gravity) * MARGIN) / CELL));
      return wallJumpMove(Math.max(1, rise), away);
    },
    estimated: true,
  },
  bot: {
    moves: ['wall_slide', 'wall_jump'],
    // (A step onto a wall: holding it, sliding.)
    settled: ({ rt, p, to }) => !!to.mode && !!rt.motion(p)?.states.includes('wallSliding'),
    step({ rt, p, from, to, toX, dir, t, began, dt, hold, tick, wallSide, mem }) {
      const m = mem as { jumped?: boolean };
      if (to.move === 'wall_slide') {
        // Down the wall it holds: pressing toward it, until the cell (or the floor) is reached.
        const side = wallSide(from.mode);
        hold('right', side > 0);
        hold('left', side < 0);
        return;
      }
      // Pressing toward the wall until it slides; Jump (pressed anew) kicks off it; then steering to the target,
      // and pressing into the wall there (when the step ends on one).
      const side = wallSide(from.mode);
      const sliding = !!rt.motion(p)?.states.includes('wallSliding');
      if (!m.jumped) {
        hold('jump', false);
        hold('right', side > 0);
        hold('left', side < 0);
        if (sliding && t - began > 2 * dt) {
          tick();
          hold('jump', true);
          m.jumped = true;
        }
      } else {
        const toSide = wallSide(to.mode);
        const near = Math.abs(toX - p.x) < CELL;
        hold('right', (toSide > 0 && near) || (dir > 0 && Math.abs(toX - p.x) > 3));
        hold('left', (toSide < 0 && near) || (dir < 0 && Math.abs(toX - p.x) > 3));
      }
    },
  },
  topic: 'precision_moves',
};
