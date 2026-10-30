/**
 * Parts of the engine's own code that an object can have done by a script instead: the user asks for something a
 * setting can't do ("the jump floats at the top"), the AI asks first ("this turns the Player's jumping into a
 * script"), and on yes the object gets the part's ready-made script: it does exactly what the engine did (the same
 * timings, the same settings read from the object), and from then on it can be changed like any other script.
 * Removing or switching off the script gives the part back to the engine.
 */
import { generateId } from '../ids';
import { itemNameOf } from '../graph/graph';
import { scriptSchema, type BehaviorScript, type EnginePart } from '../script/language';

/** The object a part's script is made for (what the script needs to know of it, e.g. the item it gives). */
export interface PartOwner {
  name: string;
  components: Record<string, Record<string, unknown>>;
}

export interface EnginePartInfo {
  /** What it is, in a few words ("jumping"). */
  label: string;
  /** What the engine does for it (for the AI and the confirmation). */
  covers: string;
  /** The component it belongs to (an object without it has nothing to take over). */
  component: string;
  /** The ready-made script that does what the engine does, for this object (its name and components). */
  script(owner?: PartOwner): BehaviorScript;
}

/**
 * Jumping as the engine does it, step by step (runs just before the engine moves the character, as its controls
 * do): a press is remembered for a moment (buffer_time) so a jump pressed just before landing still happens; for a
 * moment after walking off a ledge (coyote_time) a jump still works; DoubleJump's extra jumps in the air; letting go
 * of Jump while still going up cuts the jump short (short_hop). The jump speed is the Character Controller's
 * jumpForce, read every step, so its setting still works.
 */
function jumpingScript(): BehaviorScript {
  const force = "field(self, 'CharacterController.jumpForce')";
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Jumping',
    description: "Jumping (Space, or a controller's A), as the engine does it: a press just before landing still jumps, so does one just after walking off a ledge; DoubleJump gives jumps in the air; letting go early makes a shorter hop.",
    takesOver: 'jumping',
    vars: [
      { name: 'buffer_time', value: 0.12 },
      { name: 'coyote_time', value: 0.1 },
      { name: 'short_hop', value: 0.5 },
      { name: 'buffer', value: 0 },
      { name: 'coyote', value: 0 },
      { name: 'air_jumps', value: 0 },
    ],
    handlers: [
      {
        when: { on: 'tick' },
        // (Not seen from above, not while hanging from a ledge, nor on a ladder unless jumping off it.)
        if: "field(self, 'CharacterController.movement') != 'topdown' and not self.hanging and (not self.climbing or pressed('jump'))",
        do: [
          { do: 'if', cond: "self.grounded and has_component(self, 'DoubleJump')", then: [{ do: 'set', var: 'air_jumps', value: "field(self, 'DoubleJump.extraJumps')" }], else: [] },
          { do: 'set', var: 'buffer', value: "pressed('jump') ? buffer_time : max(0, buffer - dt)" },
          { do: 'set', var: 'coyote', value: 'self.grounded ? coyote_time : max(0, coyote - dt)' },
          {
            do: 'if',
            cond: 'buffer > 0 and coyote > 0',
            then: [
              { do: 'jump', force },
              { do: 'set', var: 'buffer', value: '0' },
              { do: 'set', var: 'coyote', value: '0' },
            ],
            else: [
              {
                do: 'if',
                cond: "pressed('jump') and not self.grounded and coyote <= 0 and air_jumps > 0",
                then: [
                  { do: 'set', var: 'air_jumps', value: 'air_jumps - 1' },
                  { do: 'jump', force },
                  { do: 'set', var: 'buffer', value: '0' },
                ],
                else: [],
              },
            ],
          },
          { do: 'if', cond: "released('jump') and self.vy < 0", then: [{ do: 'velocity', x: null, y: 'self.vy * short_hop' }], else: [] },
        ],
      },
    ],
  }) as BehaviorScript;
}

/**
 * Being picked up as the engine does it: when something that may pick it up touches it (an Inventory, or a
 * "collects" connection), it leaves the level, the collector gets the item (unless it is used up at once) and the
 * health it gives back (up to its most), and "collected" is announced (the collector as its subject).
 */
function pickedUpScript(owner?: PartOwner): BehaviorScript {
  const c = owner?.components.Collectible ?? {};
  const item = (owner && itemNameOf(owner.components, owner.name)) || 'item';
  const keep = c.collectionBehavior !== 'consume';
  const heal = Math.max(0, Number(c.heal) || 0);
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Picked up',
    description: `Picked up when something that collects things touches it: it ${keep ? `gives one "${item}"` : 'is used up at once'}${heal ? ` and ${heal} health back` : ''}.`,
    takesOver: 'picking_up',
    vars: [{ name: 'heal', value: heal }],
    handlers: [
      {
        when: { on: 'contact' },
        if: 'collects(other)',
        do: [
          { do: 'remove', target: null },
          ...(keep ? [{ do: 'give_item', target: 'other', item, count: '1' }] : []),
          { do: 'if', cond: 'heal > 0', then: [{ do: 'heal', target: 'other', amount: 'heal' }], else: [] },
          { do: 'emit', event: 'collected', subject: 'other', other: 'self' },
        ],
      },
    ],
  }) as BehaviorScript;
}

export const ENGINE_PART_INFO: Record<EnginePart, EnginePartInfo> = {
  jumping: {
    label: 'jumping',
    covers: 'the jump key, how high (jumpForce), a press just before landing or just after leaving a ledge still jumping, double jumps (DoubleJump), and the shorter hop when the key is let go early',
    component: 'CharacterController',
    script: jumpingScript,
  },
  picking_up: {
    label: 'picking up',
    covers: 'being picked up: when something with an Inventory (or a "collects" connection) touches it, it leaves the level, the collector gets the item (Collectible.itemId; none when collectionBehavior is "consume") and its heal back, and "collected" happens',
    component: 'Collectible',
    script: pickedUpScript,
  },
};

/** Whether these scripts do `part` instead of the engine (one taking it over is there and switched on). */
export function scriptedPart(scripts: readonly BehaviorScript[] | undefined, part: EnginePart): boolean {
  return !!scripts?.some((s) => s.enabled && s.takesOver === part);
}
