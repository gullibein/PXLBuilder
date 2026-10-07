/**
 * The game-logic vocabulary: which events happen during play, which
 * relationship types exist, and the shape of conditions and actions.
 *
 * Events and relationship types live in registries, so new ones are added by
 * registering them, not by editing the engine. The same descriptions feed the
 * editor, validation and the AI's capability list.
 */
import { z } from 'zod';
import { cloneDefault, validateField, type FieldSchema } from '../components/schema';

// ---------------------------------------------------------------- events

export interface EventType {
  type: string;
  description: string;
  /** What `subject` and `other` mean for this event (null: not used). */
  subject: string | null;
  other: string | null;
  /** Sentence for "When ...": {subject} and {other} are replaced by the rule's filters. */
  phrase: string;
}

export const BUILTIN_EVENTS: EventType[] = [
  { type: 'level_started', description: 'The level starts (also after a restart).', subject: null, other: null, phrase: 'the level starts' },
  { type: 'touch_started', description: 'Something starts touching something else (overlapping it, standing on it or bumping into it).', subject: 'the moving entity that touched', other: 'what it touched', phrase: '{subject} touches {other}' },
  { type: 'touch_ended', description: 'Two things stop touching.', subject: 'the moving entity', other: 'what it was touching', phrase: '{subject} stops touching {other}' },
  { type: 'collected', description: 'An item is picked up.', subject: 'who picked it up', other: 'the item', phrase: '{subject} picks up {other}' },
  { type: 'damaged', description: 'Something loses health.', subject: 'who was hurt', other: 'what hurt it', phrase: '{subject} is hurt by {other}' },
  { type: 'died', description: 'Something runs out of health.', subject: 'who died', other: 'what dealt the last hit', phrase: '{subject} dies' },
  { type: 'respawned', description: 'Something is put back at its start (after dying or falling out of the level).', subject: 'who respawned', other: null, phrase: '{subject} respawns' },
  { type: 'stomped', description: 'Something Stompable is jumped on from above.', subject: 'what was stomped', other: 'who jumped on it', phrase: '{other} stomps on {subject}' },
  { type: 'switch_activated', description: 'A switch is used (touched, or E pressed next to it, depending on the switch). It flips between on and off.', subject: 'the switch', other: 'who used it', phrase: '{other} uses {subject}' },
  { type: 'opened', description: 'Something (usually a door) opens.', subject: 'what opened', other: 'what opened it, if anything', phrase: '{subject} opens' },
  { type: 'locked', description: 'A player touches something that requires an item (a "requires" door) without carrying it, so it stays shut (detail.needs is the item).', subject: 'what stayed shut', other: 'who touched it', phrase: '{other} touches {subject}, which stays locked' },
  { type: 'level_completed', description: 'The level is won (a Goal was reached or a rule completed it).', subject: 'who reached the goal, if anyone', other: null, phrase: 'the level is completed' },
  { type: 'closed', description: 'Something closes.', subject: 'what closed', other: 'what closed it, if anything', phrase: '{subject} closes' },
  { type: 'teleported', description: 'Something is moved to another place (by a teleporter or a teleport action).', subject: 'who was moved', other: 'where it arrived', phrase: '{subject} is teleported to {other}' },
  { type: 'timer', description: 'A Timer component goes off (every `interval` seconds, or once).', subject: 'what has the Timer', other: null, phrase: "{subject}'s timer goes off" },
  { type: 'shot', description: 'A Shooter fires a shot.', subject: 'the shooter', other: 'the shot', phrase: '{subject} shoots' },
  { type: 'ledge_grabbed', description: 'A character with LedgeGrab grabs a ledge.', subject: 'who grabbed it', other: null, phrase: '{subject} grabs a ledge' },
  { type: 'signal', description: 'A behavior script sent a signal (detail.name).', subject: 'the sender', other: null, phrase: '{subject} sends a signal' },
  { type: 'script_error', description: 'A behavior script had a problem while running (detail.message); it was stopped there.', subject: 'whose script', other: null, phrase: "{subject}'s script has a problem" },
  { type: 'spawned', description: 'A new entity appears (by a spawn action).', subject: 'the new entity', other: null, phrase: '{subject} appears' },
];

export class EventRegistry {
  private readonly types = new Map<string, EventType>();
  constructor(types: EventType[] = BUILTIN_EVENTS) {
    for (const t of types) this.register(t);
  }
  register(t: EventType): void {
    this.types.set(t.type, t);
  }
  get(type: string): EventType | undefined {
    return this.types.get(type);
  }
  has(type: string): boolean {
    return this.types.has(type);
  }
  list(): EventType[] {
    return [...this.types.values()];
  }
}

export const eventRegistry = new EventRegistry();

// ---------------------------------------------------------------- relationship types

export interface RelationshipType {
  type: string;
  /** Verb phrase for sentences: "Switch controls Door". */
  verb: string;
  description: string;
  /** True when Play acts on it; false when it only records the design (for now). */
  simulated: boolean;
  params: Record<string, FieldSchema>;
}

export const BUILTIN_RELATIONSHIP_TYPES: RelationshipType[] = [
  {
    type: 'controls',
    verb: 'controls',
    description:
      'When the source (a switch) is used, something happens to the target. open/close/toggle: it opens (stops blocking, drawn faded) or closes. disappear: switching on removes it, switching off brings it back. move: switching on moves it by offset at speed, switching off moves it back.',
    simulated: true,
    params: {
      action: { kind: 'enum', options: ['open', 'close', 'toggle', 'disappear', 'move'], default: 'toggle', description: 'What using the switch does to the target' },
      offset: { kind: 'vec2', default: { x: 0, y: -96 }, description: 'For move: how far it moves, in pixels (one tile = 32; negative y is up)' },
      speed: { kind: 'number', default: 96, min: 0, step: 8, description: 'For move: pixels per second (0 = there at once)' },
    },
  },
  {
    type: 'requires',
    verb: 'requires',
    description: 'The source (e.g. a door) opens when something carrying the target item touches it. The target is the item (usually a collectible object like a key).',
    simulated: true,
    params: { consume: { kind: 'boolean', default: false, description: 'Use up the item when opening' } },
  },
  {
    type: 'damages',
    verb: 'damages',
    description: 'Touching the source hurts the target (whatever its Damage Receiver says).',
    simulated: true,
    params: { amount: { kind: 'number', default: 1, min: 0, step: 1, description: 'Health lost per hit' } },
  },
  {
    type: 'collects',
    verb: 'collects',
    description: 'The source picks up the target (a collectible) when touching it, even without an Inventory component.',
    simulated: true,
    params: {},
  },
  {
    type: 'teleports_to',
    verb: 'teleports to',
    description: 'Touching the source (a teleporter) moves whoever touched it to the target (another teleporter, or any spot). For a two-way pair, add one in each direction.',
    simulated: true,
    params: {},
  },
  { type: 'targets', verb: 'targets', description: 'The source is after the target (e.g. an enemy targeting the player).', simulated: false, params: {} },
  {
    type: 'follows',
    verb: 'follows',
    description:
      'The source moves toward the target during play (an enemy chasing the player). Walkers (with gravity) move left/right along the ground and stop at walls; things without gravity (gravityScale 0) fly straight at it. They only follow while the target is within range.',
    simulated: true,
    params: {
      speed: { kind: 'number', default: 80, min: 0, step: 10, description: 'Pixels per second (the player runs at 200)' },
      range: { kind: 'number', default: 320, min: 0, step: 32, description: 'Starts following when the target is this close, in pixels (0 = always)' },
    },
  },
  { type: 'protects', verb: 'protects', description: 'The source protects the target.', simulated: false, params: {} },
  { type: 'contains', verb: 'contains', description: 'The source holds the target (e.g. a chest containing a key).', simulated: false, params: {} },
];

export class RelationshipRegistry {
  private readonly types = new Map<string, RelationshipType>();
  constructor(types: RelationshipType[] = BUILTIN_RELATIONSHIP_TYPES) {
    for (const t of types) this.register(t);
  }
  register(t: RelationshipType): void {
    this.types.set(t.type, t);
  }
  get(type: string): RelationshipType | undefined {
    return this.types.get(type);
  }
  has(type: string): boolean {
    return this.types.has(type);
  }
  list(): RelationshipType[] {
    return [...this.types.values()];
  }
  /** Fills in defaults and checks every parameter; returns the full params or an error message. */
  normalizeParams(type: string, params: Record<string, unknown>): { params: Record<string, unknown> } | { error: string } {
    const t = this.types.get(type);
    if (!t) return { error: `Unknown relationship type "${type}"` };
    const out: Record<string, unknown> = {};
    for (const [name, field] of Object.entries(t.params)) {
      const value = name in params ? params[name] : cloneDefault(field);
      const err = validateField(field, value);
      if (err) return { error: `${type}.${name} ${err}` };
      out[name] = value;
    }
    const unknown = Object.keys(params).find((k) => !(k in t.params));
    if (unknown) return { error: `Relationship "${type}" has no parameter "${unknown}"` };
    return { params: out };
  }
}

export const relationshipRegistry = new RelationshipRegistry();

// ---------------------------------------------------------------- shapes

const id = z.string().min(1);

export const entityRefSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity'), id }),
  z.object({ kind: z.literal('object'), id }),
  z.object({ kind: z.literal('tag'), tag: z.string().min(1) }),
  z.object({ kind: z.literal('subject') }),
  z.object({ kind: z.literal('other') }),
  z.object({ kind: z.literal('any') }),
]);

const not = z.boolean().default(false);

export const conditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('has_item'), entity: entityRefSchema, item: z.string().min(1), count: z.number().int().min(1).default(1), not }),
  z.object({ type: z.literal('health'), entity: entityRefSchema, compare: z.enum(['<', '<=', '==', '>=', '>']), value: z.number().finite(), not }),
  z.object({ type: z.literal('is_open'), entity: entityRefSchema, not }),
  z.object({ type: z.literal('switch_on'), entity: entityRefSchema, not }),
  z.object({ type: z.literal('none_left'), entity: entityRefSchema, not }),
]);

const amount = z.number().finite().min(0);
const count = z.number().int().min(1).default(1);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('open'), target: entityRefSchema }),
  z.object({ type: z.literal('close'), target: entityRefSchema }),
  z.object({ type: z.literal('toggle'), target: entityRefSchema }),
  z.object({ type: z.literal('remove'), target: entityRefSchema }),
  z.object({ type: z.literal('spawn'), object: id, at: entityRefSchema.nullable().default(null), x: z.number().finite().default(0), y: z.number().finite().default(0) }),
  z.object({ type: z.literal('damage'), target: entityRefSchema, amount: amount.default(1) }),
  z.object({ type: z.literal('heal'), target: entityRefSchema, amount: amount.default(1) }),
  z.object({ type: z.literal('give_item'), target: entityRefSchema, item: z.string().min(1), count }),
  z.object({ type: z.literal('take_item'), target: entityRefSchema, item: z.string().min(1), count }),
  z.object({ type: z.literal('respawn'), target: entityRefSchema }),
  z.object({ type: z.literal('teleport'), target: entityRefSchema, to: entityRefSchema }),
  z.object({ type: z.literal('restart_level') }),
  z.object({ type: z.literal('complete_level') }),
  z.object({ type: z.literal('show'), target: entityRefSchema }),
  z.object({ type: z.literal('hide'), target: entityRefSchema }),
  z.object({ type: z.literal('show_message'), text: z.string().min(1).max(200), seconds: z.number().positive().max(60).default(3) }),
  z.object({ type: z.literal('play_sound'), sound: z.string().min(1), volume: z.number().min(0).max(1).default(1) }),
  z.object({ type: z.literal('camera_shake'), strength: z.number().positive().max(64).default(6), seconds: z.number().positive().max(10).default(0.4) }),
  z.object({ type: z.literal('camera_flash'), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'), seconds: z.number().positive().max(10).default(0.3) }),
  z.object({ type: z.literal('camera_zoom'), zoom: z.number().min(0.25).max(4), seconds: z.number().min(0).max(30).default(0.5) }),
  z.object({ type: z.literal('camera_focus'), target: entityRefSchema, seconds: z.number().positive().max(30).default(2) }),
  z.object({ type: z.literal('camera_follow'), target: entityRefSchema.nullable() }),
]);

export const ruleSchema = z.object({
  id,
  name: z.string().default(''),
  enabled: z.boolean().default(true),
  when: z.object({
    event: z.string().min(1),
    subject: entityRefSchema.default({ kind: 'any' }),
    other: entityRefSchema.default({ kind: 'any' }),
  }),
  conditions: z.array(conditionSchema).default([]),
  actions: z.array(actionSchema).min(1),
});

export const relationshipSchema = z.object({
  id,
  type: z.string().min(1),
  source: entityRefSchema,
  target: entityRefSchema,
  params: z.record(z.string(), z.unknown()).default({}),
  conditions: z.array(conditionSchema).default([]),
});

/** Plain descriptions of conditions and actions, for the editor and the AI. */
export const CONDITION_HELP: Record<string, string> = {
  has_item: 'entity carries at least `count` of `item` (an item name, as in Collectible.itemId)',
  health: 'entity health compared with `value`',
  is_open: 'entity (e.g. a door) is open',
  switch_on: 'entity (a switch) is on',
  none_left: 'nothing matching `entity` is left in play (e.g. {"kind":"tag","tag":"coin"}: every coin collected; {"kind":"tag","tag":"enemy"}: every enemy defeated)',
};

export const ACTION_HELP: Record<string, string> = {
  open: 'open target (it stops blocking and fades)',
  close: 'close target',
  toggle: 'open target if closed, close it if open',
  remove: 'take target out of play',
  spawn: 'create an instance of `object` (a library object id) at the position of `at`, or at x,y when `at` is null',
  damage: 'take `amount` health from target',
  heal: 'give `amount` health to target (up to its maximum)',
  give_item: 'add `count` of `item` to target',
  take_item: 'remove `count` of `item` from target',
  respawn: 'put target back at its start with full health',
  teleport: 'move target to where `to` is (standing on the same floor); it does not bounce straight back',
  restart_level: 'start the level again from the beginning',
  complete_level: 'the level is won: play goes on to the next level, or the game is finished after the last one',
  show: 'bring target into play (something that Starts Hidden, or was hidden): a ladder that appears, a bridge, a secret door',
  hide: 'take target out of play until shown again',
  show_message: 'show `text` on screen for `seconds`',
  play_sound: 'play the sound `sound` (its name or id, from the sound list) at `volume` 0..1',
  camera_shake: 'shake the screen (`strength` px, fading out over `seconds`)',
  camera_flash: 'flash the screen in `color` ("#rrggbb"), fading over `seconds`',
  camera_zoom: 'change the zoom to `zoom` over `seconds` (0 = at once); stays until changed again or the level restarts',
  camera_focus: 'the camera looks at `target` for `seconds`, then goes back',
  camera_follow: 'the camera follows `target` from now on (null: stays where it is) until the level restarts',
};
