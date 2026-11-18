/**
 * Dodge roll, whole (docs/engine-architecture-proposal.md §24): an ability for characters seen from above (and at
 * an angle). Its component and what it does in play; nothing more: levels seen from above have no jump table and no
 * route solver, so it has no part in a reach and no bot part, and nothing is judged by it. Registered once
 * (index.ts).
 */
import type { MovementContext } from '../runtime/movement/types';
import type { AbilityDefinition } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const comp = (ctx: MovementContext) => (ctx.e.base.components.DodgeRoll ?? {}) as Record<string, unknown>;

interface RollState {
  /** Seconds of the roll left (0: not rolling), and of the wait before the next. */
  t: number;
  wait: number;
  dx: number;
  dy: number;
}
/** Its key: Shift (the special move's own) unless its component names another. */
const keyOf = (d: Record<string, unknown>): 'special' | 'jump' | 'fire' | 'interact' => (d.key === 'jump' || d.key === 'fire' || d.key === 'interact' ? d.key : 'special');
const rollState = (e: MovementContext['e']): RollState => (e.ability.dodge_roll ??= { t: 0, wait: 0, dx: 0, dy: 0 }) as RollState;

/**
 * DodgeRoll: a press of its key (Shift by default: the special move's own key, which nothing else listens to) rolls
 * the character the way the keys point (the way it is heading, when none is
 * held) at `speed` for `duration` seconds; it can't be steered meanwhile and (with `dodges`) can't be hurt. Then it
 * walks on, and waits `cooldown` before it can roll again. Walls stop it as they stop walking.
 */
export const dodgeRoll: AbilityDefinition = {
  id: 'dodge_roll',
  describe: 'A quick roll the way it is heading, seen from above; it can\'t be hurt meanwhile',
  plural: 'dodge rolls',
  noun: 'a dodge roll',
  askedBy: /roll|dodge|evade/i,
  component: {
    type: 'DodgeRoll',
    label: 'Dodge Roll',
    description: 'A player-controlled character seen from above rolls the way the keys point when its key is pressed: fast, for a moment, and it can\'t be hurt meanwhile; then a short wait before the next roll.',
    category: 'Behavior',
    fields: {
      speed: { kind: 'number', default: 420, min: 0, step: 20, description: 'px/s' },
      duration: { kind: 'number', default: 0.22, min: 0.05, step: 0.02, description: 'Seconds' },
      cooldown: { kind: 'number', default: 0.5, min: 0, step: 0.1, description: 'Seconds before the next roll' },
      key: { kind: 'enum', options: ['special', 'jump', 'fire', 'interact'], default: 'special', description: 'special: Shift, a key of its own (no other action shares it); jump: Space; fire: X; interact: E' },
      dodges: { kind: 'boolean', default: true, description: 'It can\'t be hurt while rolling' },
    },
  },
  worksWith: ['topdown'],
  order: 10,
  runtime: {
    override(ctx) {
      const { e, input, dt, host } = ctx;
      const d = comp(ctx);
      const s = rollState(e);
      const speed = num(d.speed, 420);
      if (s.t > 0) {
        s.t -= dt;
        e.vx = s.dx * speed;
        e.vy = s.dy * speed;
        if (d.dodges !== false) e.invincible = Math.max(e.invincible, Math.max(0, s.t));
        if (s.t <= 0) {
          // (Out of the roll: walking on that way, and a wait before the next.)
          s.t = 0;
          s.wait = num(d.cooldown, 0.5);
          e.vx = s.dx * e.controller!.speed;
          e.vy = s.dy * e.controller!.speed;
        }
        return true;
      }
      if (s.wait > 0) s.wait = Math.max(0, s.wait - dt);
      if (!input.wasPressed(keyOf(d)) || s.wait > 0) return false;
      // The way the keys point, as walking reads them (seen at an angle: the way they point on the screen); none
      // held: the way it is heading.
      const sx = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
      const sy = (input.isDown('down') ? 1 : 0) - (input.isDown('up') ? 1 : 0);
      const iso = host.isoView();
      let x = iso ? Math.sign(sx + sy) : sx;
      let y = iso ? Math.sign(sy - sx) : sy;
      if (x === 0 && y === 0) {
        x = e.heading.x;
        y = e.heading.y;
      }
      if (x === 0 && y === 0) x = e.facing;
      const len = Math.hypot(x, y);
      s.dx = x / len;
      s.dy = y / len;
      s.t = num(d.duration, 0.22);
      e.heading = { x: Math.sign(x), y: Math.sign(y) };
      if (sx !== 0) e.facing = sx as 1 | -1;
      e.vx = s.dx * speed;
      e.vy = s.dy * speed;
      if (d.dodges !== false) e.invincible = Math.max(e.invincible, s.t);
      return true;
    },
    states: (e) => (((e.ability.dodge_roll as RollState | undefined)?.t ?? 0) > 0 ? ['rolling'] : []),
  },
  keys: (c) => [{ action: keyOf(c.DodgeRoll ?? {}), does: 'rolls' }],
  scriptNames: { rolling: { state: 'rolling', doc: 'mid-roll (DodgeRoll)' } },
  topic: 'topdown',
};
