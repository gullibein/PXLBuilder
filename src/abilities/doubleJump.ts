/**
 * Double jump, whole (docs/engine-architecture-proposal.md §24): its component, what it does in play, and its part
 * in the player's reach: more full jumps in the air, which the jump table counts (so it is judged as jumps are).
 * Registered once (index.ts).
 */
import type { MovementContext } from '../runtime/movement/types';
import type { AbilityDefinition } from './types';

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** The jumps its component allows in the air (as it is now: a script may change the setting in play). */
const extra = (e: MovementContext['e']) => num((e.base.components.DoubleJump as Record<string, unknown> | undefined)?.extraJumps, 1);
/** How many it has left (all of them to begin with); never more than its component allows now. */
function left(e: MovementContext['e']): { left: number } {
  const s = (e.ability.double_jump ??= { left: extra(e) }) as { left: number };
  if (s.left > extra(e)) s.left = extra(e);
  return s;
}

export const doubleJump: AbilityDefinition = {
  id: 'double_jump',
  describe: 'Extra jumps in the air',
  plural: 'double jumps',
  noun: 'a double jump',
  askedBy: /double|jump/i,
  component: {
    type: 'DoubleJump',
    label: 'Double Jump',
    description: 'A player-controlled character can jump again in the air.',
    category: 'Behavior',
    fields: {
      extraJumps: { kind: 'number', default: 1, min: 1, max: 5, step: 1, integer: true, description: 'Jumps allowed in the air before landing' },
    },
  },
  worksWith: ['arcade'],
  order: 30,
  runtime: {
    grounded({ e }) {
      left(e).left = extra(e);
    },
    airJump({ e }) {
      const s = left(e);
      if (s.left <= 0) return false;
      // Double jump: another full jump in the air.
      s.left--;
      e.vy = -e.controller!.jumpForce;
      e.launched = false;
      e.jumpBuffer = 0;
      return true;
    },
  },
  // Each extra jump adds about another full jump in height and air time: in the jump table.
  reach: { table: (c) => ({ airJumps: Number(c.DoubleJump?.extraJumps ?? 0) }) },
};
