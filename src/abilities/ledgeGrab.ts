/**
 * Ledge grab, whole (docs/engine-architecture-proposal.md §24): its component, when it catches a ledge in play (the
 * hanging and climbing themselves are the arcade model's, through its host), and its part in the player's reach: a
 * wall top a bit above the jump's peak is still caught, which the jump table counts. Registered once (index.ts).
 */
import type { AbilityDefinition } from './types';

export const ledgeGrab: AbilityDefinition = {
  id: 'ledge_grab',
  describe: 'Catch ledges and climb up',
  plural: 'ledge grabs',
  noun: 'the ability to grab ledges',
  askedBy: /ledge|grab|hang/i,
  component: {
    type: 'LedgeGrab',
    label: 'Ledge Grab',
    description: 'A player-controlled character catches the top edge of a wall it jumps or falls against while pressing toward it, and hangs there; Up or Jump climbs onto the ledge, Down or away lets go.',
    category: 'Behavior',
    fields: {},
  },
  worksWith: ['arcade'],
  order: 40,
  runtime: {
    // Falling (or at the top of a jump) against a wall while pressing toward it: catch its top edge.
    after({ e, host }, dir) {
      if (!host.ownsPart(e, 'ledge_grab') && !e.grounded && e.vy >= 0 && dir !== 0 && e.grabCooldown <= 0) host.tryGrabLedge(e, dir as 1 | -1);
    },
  },
  // A wall top up to 0.6 of its height above the jump's peak can still be caught and climbed: in the jump table.
  reach: { table: (_c, body) => ({ grab: body.height * 0.6 }) },
};
