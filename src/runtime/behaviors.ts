/**
 * Behaviors: what things do on their own during play, set up by behavior
 * components (Patrol, Jumper, Shooter, MovingPlatform, Timer). Double jump and
 * ledge grab are part of character control (runtime.ts).
 *
 * `before` runs ahead of physics and sets velocities; `after` runs once things
 * have moved (shots flying into walls and targets).
 */
import type { InputState } from './input';
import { moveAndCollide, overlaps, type Box } from './physics';
import type { Runtime, RuntimeEntity } from './runtime';

/** At most this many shots in the air at once (oldest shots aren't removed; new ones just aren't fired). */
const MAX_SHOTS = 100;

export class BehaviorSystem {
  constructor(private readonly rt: Runtime) {}

  before(dt: number, input: InputState): void {
    // Spawned shots are appended while we loop; only look at what existed at the start.
    const list = this.rt.entities.slice();
    for (const e of list) {
      if (!e.alive) continue;
      const b = e.beh;
      if (b.mover) this.moveOnPath(e, dt);
      if (b.patrol && !e.chasing && e.invincible <= 0) this.patrol(e);
      if (b.jumper && e.body === 'dynamic') {
        b.jumper.t += dt;
        if (e.grounded && b.jumper.t >= b.jumper.interval) {
          b.jumper.t = 0;
          e.vy = -b.jumper.jumpForce;
          e.grounded = false;
        }
      }
      if (b.shooter) {
        const s = b.shooter;
        s.t += dt;
        const wants = s.trigger === 'key' ? input.wasPressed('fire') : true;
        if (wants && s.t >= s.interval) this.fire(e) && (s.t = 0);
      }
      if (b.timer && !b.timer.done) {
        b.timer.t += dt;
        if (b.timer.t >= b.timer.interval) {
          this.rt.gameplay.emit('timer', e);
          if (b.timer.repeat) b.timer.t -= b.timer.interval;
          else b.timer.done = true;
        }
      }
    }
  }

  after(dt: number): void {
    let removed = false;
    for (const shot of this.rt.entities) {
      if (!shot.alive || !shot.projectile) continue;
      shot.projectile.left -= Math.hypot(shot.vx, shot.vy) * dt;
      const box = this.rt.boxOf(shot);
      if (shot.projectile.left <= 0 || (box && this.rt.solids.some((s) => overlaps(box, s)))) {
        shot.alive = false;
        removed = true;
        continue;
      }
      if (!box) continue;
      for (const v of this.rt.entities) {
        if (v === shot || !v.alive || v.projectile || v.id === shot.projectile.owner || !v.health) continue;
        const vb = this.rt.boxOf(v);
        if (vb && overlaps(box, vb) && this.rt.gameplay.tryHurt(shot, v)) {
          shot.alive = false;
          removed = true;
          break;
        }
      }
    }
    // Spent shots are dropped, so a long game doesn't pile them up.
    if (removed) this.rt.entities = this.rt.entities.filter((e) => e.alive || !e.projectile);
  }

  /** Walks (or flies) back and forth: turns at walls, at ledges and after `distance`. */
  private patrol(e: RuntimeEntity): void {
    const p = e.beh.patrol!;
    if (e.body === 'static' || e.body === 'none') {
      // Something that never moved on its own now does: it moves without gravity.
      e.body = 'kinematic';
      this.rt.markSolidsDirty();
    }
    const box = this.rt.boxOf(e);
    let turn = e.bumped === p.dir;
    if (p.distance > 0 && (e.x - p.originX) * p.dir >= p.distance) turn = true;
    if (box && !turn) {
      // A wall right in front.
      const front: Box = { x: box.x + p.dir * (box.hw + 1), y: box.y, hw: 1, hh: box.hh - 1 };
      if (this.rt.solids.some((s) => overlaps(front, s))) turn = true;
      // No floor ahead (walkers only, and only while on the ground).
      else if (p.turnAtLedges && e.body === 'dynamic' && e.gravityScale !== 0 && e.grounded) {
        const below: Box = { x: box.x + p.dir * (box.hw + 2), y: box.y + box.hh + 4, hw: 1, hh: 3 };
        if (!this.rt.solids.some((s) => overlaps(below, s))) turn = true;
      }
    }
    if (turn) p.dir = p.dir === 1 ? -1 : 1;
    e.vx = p.dir * p.speed * e.speedFactor;
    if (e.gravityScale === 0 || e.body !== 'dynamic') e.vy = 0;
    e.facing = p.dir;
  }

  /** Moving platform: glides to origin + offset and back, waiting `pause` at each end, carrying what stands on it. */
  private moveOnPath(e: RuntimeEntity, dt: number): void {
    const m = e.beh.mover!;
    if (e.body !== 'kinematic') {
      // It moves itself; whatever the object says, nothing pushes it around.
      e.body = 'kinematic';
      this.rt.markSolidsDirty();
    }
    e.vx = 0;
    e.vy = 0;
    if (m.wait > 0) {
      m.wait -= dt;
      return;
    }
    const tx = m.originX + (m.toEnd ? m.offset.x : 0);
    const ty = m.originY + (m.toEnd ? m.offset.y : 0);
    const dx = tx - e.x;
    const dy = ty - e.y;
    const dist = Math.hypot(dx, dy);
    const stepLen = m.speed * dt;
    let mx: number;
    let my: number;
    if (dist <= stepLen || m.speed <= 0) {
      mx = dx;
      my = dy;
      m.toEnd = !m.toEnd;
      m.wait = m.pause;
    } else {
      mx = (dx / dist) * stepLen;
      my = (dy / dist) * stepLen;
    }
    // Moved by the kinematic step this frame: velocity × dt = (mx, my).
    e.vx = mx / dt;
    e.vy = my / dt;
    this.carryRiders(e, mx, my);
  }

  /** Things standing on top of a moving platform move with it. */
  private carryRiders(platform: RuntimeEntity, mx: number, my: number): void {
    const pb = this.rt.boxOf(platform);
    if (!pb || platform.collider?.trigger || (mx === 0 && my === 0)) return;
    const top = pb.y - pb.hh;
    for (const r of this.rt.entities) {
      if (r === platform || !r.alive || r.body !== 'dynamic' || r.climbing || r.hanging) continue;
      const rb = this.rt.boxOf(r);
      if (!rb || Math.abs(rb.y + rb.hh - top) > 1 || Math.abs(rb.x - pb.x) >= rb.hw + pb.hw || r.vy < 0) continue;
      // Sideways it can bump into walls; up and down it stays on the platform.
      const res = moveAndCollide(rb, mx, 0, this.rt.solids);
      r.x += res.x - rb.x;
      r.y += my;
    }
  }

  /** Fires one shot if there is something to shoot at (or no target is needed). Returns true when it fired. */
  private fire(e: RuntimeEntity): boolean {
    const s = e.beh.shooter!;
    if (this.rt.entities.filter((o) => o.alive && o.projectile).length >= MAX_SHOTS) return false;
    let target: RuntimeEntity | null = null;
    if (s.trigger === 'auto' && s.targetTag) {
      let best = Infinity;
      for (const o of this.rt.entities) {
        if (o === e || !o.alive || o.projectile || !o.tags.includes(s.targetTag)) continue;
        const d = Math.hypot(o.x - e.x, o.y - e.y);
        if (d < best && (s.range <= 0 || d <= s.range)) {
          best = d;
          target = o;
        }
      }
      // Auto shooters only fire when a target is in range.
      if (!target) return false;
    }
    let dx = 0;
    let dy = 0;
    switch (s.direction) {
      case 'left': dx = -1; break;
      case 'right': dx = 1; break;
      case 'up': dy = -1; break;
      case 'down': dy = 1; break;
      case 'atTarget': {
        if (!target) dx = e.facing;
        else {
          const d = Math.hypot(target.x - e.x, target.y - e.y) || 1;
          dx = (target.x - e.x) / d;
          dy = (target.y - e.y) / d;
        }
        break;
      }
      default: {
        // Facing: patrollers and characters face where they go; still things face the target.
        if (target && !e.beh.patrol && !e.controller) e.facing = target.x < e.x ? -1 : 1;
        dx = e.facing;
      }
    }
    const shot = this.rt.shoot(e, dx, dy, s);
    this.rt.gameplay.emit('shot', e, shot);
    return true;
  }
}
