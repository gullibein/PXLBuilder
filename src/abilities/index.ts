/**
 * The engine's own abilities, each registered once (docs/engine-architecture-proposal.md §24). Importing this is
 * what makes them there; another ability is one more definition and one more line here (or one call from outside:
 * registerAbility).
 */
import { dash } from './dash';
import { dodgeRoll } from './dodgeRoll';
import { doubleJump } from './doubleJump';
import { ledgeGrab } from './ledgeGrab';
import { registerAbility } from './registry';
import { wallJump } from './wallJump';

// (In the order the profile lists them and the route solver tries their moves.)
registerAbility(doubleJump);
registerAbility(ledgeGrab);
registerAbility(wallJump);
registerAbility(dash);
registerAbility(dodgeRoll);

export * from './registry';
export type * from './types';
