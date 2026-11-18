/**
 * Double jump and ledge grab, as they always were (F2). (Wall jump and dash are declared whole in src/abilities,
 * each in one definition; these two move there next: V1.2.) Each keeps its own state on the entity and hooks into
 * the model at its points.
 */
import type { Ability } from './types';


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
