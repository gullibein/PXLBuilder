/**
 * The `topdown` locomotion model (Character Controller movement "topdown"): the arrow keys (or WASD) move it in
 * eight directions at the same speed (diagonals aren't faster), speeding up and slowing down by its acceleration.
 * Walls stop it; nothing pulls it down. Seen at an angle (isometric), the keys go the way they point on the screen.
 * The engine's top-down walking as it always was, moved here (F2).
 */
import type { LocomotionModel } from './types';

export const topdown: LocomotionModel = {
  id: 'topdown',
  answersTo: ['topdown'],
  floats: true,
  states: (e) => [Math.abs(e.vx) > 1 || Math.abs(e.vy) > 1 ? 'walking' : 'standing'],
  step({ e, input, dt, host }, abilities): void {
    e.grounded = false;
    e.climbing = false;
    e.hanging = null;
    // (Walking done by a script of its own instead: its "Running" script.)
    if (host.ownsPart(e, 'running')) return;
    for (const a of abilities) if (a.override?.({ e, input, dt, host })) return;
    const c = e.controller!;
    const sx = (input.isDown('right') ? 1 : 0) - (input.isDown('left') ? 1 : 0);
    const sy = (input.isDown('down') ? 1 : 0) - (input.isDown('up') ? 1 : 0);
    // Seen at an angle (isometric), the keys go the way they point on the screen: up is up the screen (north-west
    // and north-east of the level's grid at once), right is right across it.
    const iso = host.isoView();
    const dx = iso ? Math.sign(sx + sy) : sx;
    const dy = iso ? Math.sign(sy - sx) : sy;
    if (sx !== 0) e.facing = sx as 1 | -1;
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
  },
};
