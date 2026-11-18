/**
 * The `arcade` locomotion model (Character Controller movement "platformer"): run to a top speed (by the
 * controller's acceleration, the ground's grip, air control in the air), jump (with coyote time, a jump buffer and
 * short hops), climb ladders, swim, drop through jump-through platforms, hang from ledges. The engine's platformer
 * movement as it always was, moved here (F2): its abilities (double jump, wall jump, dash, ledge grab…) hook in at
 * its points, and it asks the world only through the MovementHost.
 */
import { groundGrip } from './grip';
import type { Ability, LocomotionModel, MovementContext } from './types';

/** Seconds jump-through platforms let it through after Down + Jump. */
export const DROP_THROUGH = 0.25;
const COYOTE_TIME = 0.1;
const JUMP_BUFFER = 0.12;
/** How quickly a climbing character eases to the ladder's middle (per second, exponential). */
const LADDER_CENTERING = 10;

export const arcade: LocomotionModel = {
  id: 'arcade',
  answersTo: ['platformer'],
  floats: false,
  keys: { move: ['left', 'right', 'jump'], sometimes: ['up', 'down'] },
  states: (e) => [e.grounded ? 'grounded' : 'airborne', ...(e.climbing ? ['climbing'] : []), ...(e.hanging ? ['hanging'] : []), ...(e.inLiquid?.swim ? ['swimming'] : [])],
  step(ctx: MovementContext, abilities: readonly Ability[]): void {
    const { e, input, dt, host } = ctx;
    const c = e.controller!;
    // Running done by a script of its own instead (its "Running" script): the engine leaves its speed and which way
    // it faces to it.
    const ownRun = host.ownsPart(e, 'running');
    if (e.controlsDone) {
      e.controlsDone = false;
      return;
    }
    // (An ability taking the whole step: a dash in progress.)
    for (const a of abilities) if (a.override?.(ctx)) return;
    let dir = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    // Climbing and hanging from ledges done by scripts of its own instead ("Climbing", "Ledge grab"): while it
    // climbs or hangs, the engine leaves it to them (and doesn't run or jump it either, as when it does them itself).
    const ownClimb = host.ownsPart(e, 'climbing');
    const ownLedge = host.ownsPart(e, 'ledge_grab');
    if (ownClimb && e.climbing) return;
    const ladder = ownClimb ? null : host.ladderAt(e);

    // Climbing: Up/Down on a ladder (at least half of you inside it, by width), at running speed.
    // Left/Right moves you along it; once less than half of you is on it you let go. Up does nothing
    // when you already stand on the ladder's top; Down there climbs down. Jumping lets go; reaching
    // the floor ends the climb. A ladder above a gap is out of reach until you jump up to it.
    const me = host.zone(e);
    const atTop = ladder !== null && me.y + me.hh <= ladder.top + 0.5;
    if (ladder && !e.climbing && ((input.isDown('up') && !atTop) || (input.isDown('down') && !host.isOnFloorBelowLadder(e)))) {
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
      if (vertical < 0 && me.y + me.hh + e.vy * dt <= ladder.top) host.standOn(e, ladder);
      return;
    }

    // (Abilities may hold the steering back: just after a wall jump, not back toward the wall.)
    for (const a of abilities) if (a.steer) dir = a.steer(ctx, dir);
    if (dir !== 0 && !ownRun) e.facing = dir as 1 | -1;
    // Jumping done by a script of its own instead (its "Jumping" script, which took it over): the engine leaves it.
    const ownJump = host.ownsPart(e, 'jumping');
    if (e.grounded) for (const a of abilities) a.grounded?.(ctx);
    if (e.grabCooldown > 0) e.grabCooldown = Math.max(0, e.grabCooldown - dt);
    if (e.hanging && (ownLedge || host.hang(e, input, dir))) return;

    if (!ownRun) {
      // (The ready-made Running script does exactly this: engineParts.ts.)
      const target = dir * c.speed * e.speedFactor * (e.inLiquid ? e.inLiquid.slow : 1);
      // On the ground, as much as its grip there allows (its own friction and the floor's); in the air, its air control.
      const rate = c.acceleration * (e.grounded ? groundGrip(e.friction, e.groundFriction) : c.airControl);
      const diff = target - e.vx;
      e.vx += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
    }

    if (ownJump) {
      for (const a of abilities) a.after?.(ctx, dir);
      return;
    }
    // Swimming: each Jump is a stroke up (at the surface it takes it out of the water).
    if (e.inLiquid?.swim && input.wasPressed('jump')) {
      // (Its head out of the water: a whole jump, onto the bank.)
      const head = host.zone(e).y - host.zone(e).hh;
      e.vy = -c.jumpForce * (e.inLiquid.top !== undefined && head < e.inLiquid.top ? 1 : e.inLiquid.stroke);
      e.grounded = false;
      e.jumpBuffer = 0;
      return;
    }
    // Down + Jump on a jump-through platform: drops through it instead of jumping.
    if (e.grounded && input.isDown('down') && input.wasPressed('jump') && host.onJumpThrough(e)) {
      e.dropThrough = DROP_THROUGH;
      e.grounded = false;
      e.coyote = 0;
      e.jumpBuffer = 0;
      return;
    }
    // Forgiving jumps: a short buffer before landing and a short grace period after walking off a ledge.
    // Only the jump button jumps; Up is for climbing. (The ready-made Jumping script does exactly this: engineParts.ts.)
    if (e.grounded) e.launched = false;
    if (input.wasPressed('jump')) e.jumpBuffer = JUMP_BUFFER;
    else e.jumpBuffer = Math.max(0, e.jumpBuffer - dt);
    e.coyote = e.grounded ? COYOTE_TIME : Math.max(0, e.coyote - dt);
    if (e.jumpBuffer > 0 && e.coyote > 0) {
      e.vy = -c.jumpForce;
      e.jumpBuffer = 0;
      e.coyote = 0;
      e.grounded = false;
    } else if (input.wasPressed('jump') && !e.grounded && e.coyote <= 0) {
      // A jump in the air: an ability's own (wall jump, then double jump), the first that can.
      for (const a of abilities) if (a.airJump?.(ctx)) break;
    }
    for (const a of abilities) a.after?.(ctx, dir);
    // Releasing jump early makes a shorter hop (not a swim stroke).
    // (Not a bounce off a spring or a stomp: that rise is the bounce's own.)
    if (input.wasReleased('jump') && e.vy < 0 && !e.inLiquid?.swim && !e.launched) e.vy *= 0.5;
  },
};
