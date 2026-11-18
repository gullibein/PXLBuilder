/**
 * Dash, whole (docs/engine-architecture-proposal.md §24): its component, what it does in play, what scripts read of
 * it, its part in the player's reach (the route solver's move rule, with the capability the level builder sizes its
 * patterns from) and how the route bot plays it. Registered once (index.ts); nothing else in the engine names it.
 */
import { onWall, standing, wallMode, type MoveRule } from '../core/levelGen/moves';
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

// ---------------------------------------------------------------- in the player's reach

/**
 * Dash (Dash): from the ground, a jump and then a dash at its top the way the keys point: sideways it carries the
 * jump `cells` further; up (with eight or four directions) it lifts it `upRows` higher. One per jump (its charge
 * refills on landing). Estimated in cells (confirmed by the route bot).
 */
function dashMove(cells: number, upRows: number): MoveRule {
  return {
    id: 'dash',
    mechanics: ['dash'],
    // (cells: how much further than a jump it carries across; up: rows higher.)
    capability: { id: 'dash', numbers: { cells, up: upRows } },
    successors(s, v) {
      if (!standing(s, v) || cells <= 0) return;
      const { c, r, kh, so, cr, id } = s;
      const lim = v.lim;
      const top = lim.maxRise + upRows;
      const gapOf = (rise: number) => (rise > lim.maxRise ? Math.max(0, Math.min(1, lim.gap(lim.maxRise))) : lim.gap(rise) + cells);
      const reach = Math.max(...Array.from({ length: lim.maxRise + 9 }, (_, i) => lim.gap(lim.maxRise - i))) + cells;
      for (let rise = top; rise >= -10; rise--)
        for (let dx = -(reach + 1); dx <= reach + 1; dx++) {
          if (dx === 0 && rise <= lim.maxRise) continue;
          // (Only what a plain jump can't: the dash's own reach.)
          if (rise <= lim.maxRise && Math.abs(dx) - 1 <= lim.gap(rise) && v.canJump(c, r, dx, rise, s.away, lim.gap)) continue;
          if (!v.canJump(c, r, dx, rise, s.away, gapOf)) continue;
          v.push(c + dx, r - rise, kh, so, cr, id, 'dash', 5 + 1.5 * Math.max(0, Math.abs(dx) - 1) + Math.max(0, rise));
          // (And onto a wall beside where it lands, to slide or kick off.)
        }
      for (const side of [-1, 1] as const)
        for (let rise = top; rise >= -4; rise--)
          for (let dx = -(reach + 1); dx <= reach + 1; dx++) {
            const land = (tc: number, tr: number, ww: World) => onWall(tc, tr, side, ww, v) && !v.supportAt(tc, tr + 1, ww);
            if (v.canJump(c, r, dx, rise, s.away, gapOf, land)) v.push(c + dx, r - rise, kh, so, cr, id, 'dash', 5 + Math.abs(dx) + Math.max(0, rise), wallMode(side));
          }
    },
  };
}

// ---------------------------------------------------------------- the definition

export const dash: AbilityDefinition = {
  id: 'dash',
  describe: 'A short fast dash the way the keys point, no gravity; refilled on landing',
  plural: 'dashes',
  component: {
    type: 'Dash',
    label: 'Dash',
    description: 'A player-controlled platformer character dashes the way the keys point when its key is pressed: fast, no gravity, a moment; charges refill on landing.',
    category: 'Behavior',
    fields: {
      speed: { kind: 'number', default: 520, min: 0, step: 20, description: 'px/s' },
      duration: { kind: 'number', default: 0.16, min: 0.02, step: 0.02, description: 'Seconds' },
      charges: { kind: 'number', default: 1, min: 1, step: 1, integer: true, description: 'Dashes before landing again' },
      directions: { kind: 'enum', options: ['eight', 'four', 'horizontal'], default: 'eight' },
      key: { kind: 'enum', options: ['fire', 'interact'], default: 'fire', description: 'fire: X; interact: E' },
      refillOnGround: { kind: 'boolean', default: true },
    },
  },
  worksWith: ['arcade'],
  order: 10,
  runtime: {
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
  },
  scriptNames: { dashing: { state: 'dashing', doc: 'mid-dash (Dash)' } },
  // Its speed for its duration; up too, unless it only goes sideways.
  reach: {
    move(c) {
      const d = c.Dash!;
      const cells = Math.floor((num(d.speed, 520) * num(d.duration, 0.16) * MARGIN) / CELL);
      return dashMove(cells, d.directions === 'horizontal' ? 0 : cells);
    },
    estimated: true,
  },
  bot: {
    moves: ['dash'],
    step({ p, input, from, to, here, fromX, toX, dir, t, hold, wallSide, mem }) {
      const m = mem as { jumped?: boolean; airborne?: boolean; dashed?: boolean; pressedAt?: number };
      // A jump (from the take-off cell, running on through it for a long one), a dash at its top the way the
      // target is (up when it is higher than a jump gets), then steering on (into the wall, if it ends on one).
      const jdir = Math.sign(to.col - from.col);
      const up = to.row < from.row - 1;
      const dashState = (p.ability.dash ?? null) as { left: number; t: number } | null;
      if (!m.jumped) {
        const long = Math.abs(to.col - from.col) >= 2 && !up;
        const edge = fromX + jdir * (long ? 11 : 0);
        const atTakeoff = here.col === from.col && (jdir === 0 || !long ? Math.abs(p.x - fromX) < 6 : jdir * (p.x - edge) >= -3);
        if (p.grounded && atTakeoff && !input.isDown('jump')) {
          hold('jump', true);
          m.jumped = true;
          m.pressedAt = t;
        } else {
          hold('jump', false);
          const back = here.col !== from.col || jdir === 0 || !long ? Math.sign(fromX - p.x) : jdir;
          hold('right', back > 0 && Math.abs(fromX - p.x) > 2);
          hold('left', back < 0 && Math.abs(fromX - p.x) > 2);
        }
      } else if (!m.airborne) {
        if (!p.grounded) m.airborne = true;
        // (Still on the ground a moment after Jump: it was held back (a ceiling's corner); let go, try again.)
        else if (t - (m.pressedAt ?? 0) > 0.1) {
          hold('jump', false);
          m.jumped = false;
        }
        hold('right', !up && jdir > 0);
        hold('left', !up && jdir < 0);
      } else if (!m.dashed) {
        if (p.vy > -60) {
          hold('up', up);
          hold('right', jdir > 0);
          hold('left', jdir < 0);
          input.press('fire');
          m.dashed = true;
        }
      } else {
        input.release('fire');
        hold('up', false);
        const toSide = wallSide(to.mode);
        const busy = !!dashState && dashState.t > 0;
        // (Onto a wall: pressing into it only once level with the cell to hold it in, not above the wall's top,
        // where it would go over; until then, steering to stay beside it.)
        const level = here.row >= to.row;
        const beside = dir !== 0 && Math.abs(toX - p.x) > 3;
        hold('right', !busy && (toSide > 0 ? level || (beside && dir > 0) : toSide === 0 && dir > 0 && Math.abs(toX - p.x) > 3));
        hold('left', !busy && (toSide < 0 ? level || (beside && dir < 0) : toSide === 0 && dir < 0 && Math.abs(toX - p.x) > 3));
      }
    },
  },
  topic: 'precision_moves',
};
