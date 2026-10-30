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
import type { Condition, EntityRef } from '../types';
import { ModelError } from './mutations';

/** The object a part's script is made for (what the script needs to know of it, e.g. the item it gives). */
export interface PartOwner {
  name: string;
  components: Record<string, Record<string, unknown>>;
  /** Its "requires" connections (a door and the key it needs): the item, whether opening uses it up, and the conditions. */
  requires?: { item: string; consume: boolean; conditions: Condition[] }[];
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
      { name: 'buffer_time', value: 0.12, setting: true },
      { name: 'coyote_time', value: 0.1, setting: true },
      { name: 'short_hop', value: 0.5, setting: true },
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
    vars: [{ name: 'heal', value: heal, setting: true }],
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


type Step = Record<string, unknown>;
const set = (v: string, value: string): Step => ({ do: 'set', var: v, value });
const when = (cond: string, then: Step[], otherwise: Step[] = []): Step => ({ do: 'if', cond, then, else: otherwise });
const vel = (x: string | null, y: string | null): Step => ({ do: 'velocity', x, y });

/**
 * Patrolling as the engine does it (Patrol's settings, read when play starts): walking back and forth, turning at
 * walls, at ledges and after "distance" from its start; with "ladders", deciding once at each ladder it passes
 * whether to climb it (half the time) and which way; with "range", chasing the nearest player it sees within range
 * (by ladder too), giving up 3 s after losing sight of it (or when it is twice the range away), slowing down for
 * "reaction" seconds before it turns while chasing, and stopping at walls and ledges instead of running off; things
 * with no gravity set to go up/down patrol up and down.
 */
function patrolScript(): BehaviorScript {
  const f = (name: string) => `field(self, 'Patrol.${name}')`;
  const player = 'nearest_player()';
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Patrol',
    description: 'Walks back and forth, turning at walls and ledges; climbs ladders it passes now and then; chases the player it sees, as the engine does it (the Patrol settings).',
    takesOver: 'patrolling',
    vars: [
      { name: 'speed', value: 60 },
      { name: 'distance', value: 0 },
      { name: 'ledges', value: true },
      { name: 'ladders', value: false },
      { name: 'range', value: 0 },
      { name: 'chase_speed', value: 0 },
      { name: 'reaction', value: 0 },
      { name: 'vertical', value: false },
      { name: 'lose_sight', value: 3, setting: true },
      { name: 'dir', value: 1 },
      { name: 'hunting', value: false },
      { name: 'lost', value: 0 },
      { name: 'turn_t', value: 0 },
      { name: 'cs', value: 0 },
      { name: 'want', value: 0 },
      { name: 'side', value: 0 },
      { name: 'ways', value: 0 },
      { name: 'k', value: 0 },
    ],
    handlers: [
      {
        when: { on: 'start' },
        do: [
          set('speed', f('speed')),
          set('distance', f('distance')),
          set('ledges', f('turnAtLedges')),
          set('ladders', f('climbLadders')),
          set('range', f('chaseRange')),
          set('chase_speed', f('chaseSpeed')),
          set('reaction', f('reaction')),
          set('dir', `${f('startDirection')} == 'left' or ${f('startDirection')} == 'up' ? -1 : 1`),
          set('vertical', `${f('startDirection')} == 'up' or ${f('startDirection')} == 'down'`),
        ],
      },
      {
        when: { on: 'tick' },
        // (Not while a "follows" connection steers it, nor while it blinks after a hit.)
        if: 'not self.following and not self.blinking',
        do: [
          // Sees the player (within range, no wall between): hunts it; out of sight: gives up after a while.
          when('range > 0', [
            when(
              `${player} and dist(${player}) <= range and can_see(${player})`,
              [set('hunting', 'true'), set('lost', '0')],
              [when('hunting', [set('lost', 'lost + dt'), when(`not ${player} or lost > lose_sight or dist(${player}) > range * 2`, [set('hunting', 'false')])])],
            ),
          ]),
          when(
            `range > 0 and hunting and ${player}`,
            [
              set('cs', '(chase_speed > 0 ? chase_speed : speed) * self.speed_factor'),
              { do: 'chase', target: player, speed: 'cs' },
              // On foot: slows down for "reaction" before turning; stops at walls and ledges.
              when('not self.floats and not self.climbing and self.climb_dir == 0', [
                set('want', 'sign(self.vx)'),
                when(
                  'want != 0 and want != dir',
                  [
                    when('reaction > 0', [set('turn_t', 'turn_t + dt')]),
                    when('reaction > 0 and turn_t < reaction', [vel('dir * cs * (1 - turn_t / reaction)', null), { do: 'face', dir: 'dir', on: null }], [set('dir', 'want'), set('turn_t', '0')]),
                  ],
                  [set('turn_t', '0')],
                ),
                set('side', 'sign(self.vx)'),
                when('side != 0 and (wall_ahead(side, 0) or (ledges and self.grounded and ledge_ahead(side)))', [vel('0', null)]),
              ]),
              { do: 'heading', x: 'self.facing', y: '0' },
            ],
            [
              when('range > 0', [set('turn_t', '0')]),
              when(
                'vertical and self.floats',
                [
                  // Up and down: turns at walls above and below, and after "distance".
                  when('(distance > 0 and (self.y - self.spawn_y) * dir >= distance) or wall_ahead(0, dir)', [set('dir', '-dir')]),
                  vel('0', 'dir * speed * self.speed_factor'),
                  { do: 'heading', x: '0', y: 'dir' },
                ],
                [
                  when(
                    'self.climbing',
                    // On a ladder: on to its end.
                    [when('self.climb_dir == 0', [{ do: 'climb', dir: '-1', speed: null, on: null }])],
                    [
                      set('ways', '0'),
                      when('ladders and not self.floats and self.grounded', [set('ways', 'ladder_choice(dir, speed * self.speed_factor * dt)')]),
                      when(
                        'ways > 0 and chance(0.5)',
                        [
                          set('k', 'randint(0, ways == 3 ? 1 : 0)'),
                          { do: 'climb', dir: 'ways == 3 ? (k == 0 ? -1 : 1) : (ways == 1 ? -1 : 1)', speed: 'speed', on: null },
                          vel('0', null),
                        ],
                        [
                          when(`self.bumped == dir or (distance > 0 and (self.x - self.spawn_x) * dir >= distance) or wall_ahead(dir, 0) or (ledges and not self.floats and self.grounded and ledge_ahead(dir))`, [set('dir', '-dir')]),
                          vel('dir * speed * self.speed_factor', null),
                          when('self.floats', [vel(null, '0')]),
                          { do: 'face', dir: 'dir', on: null },
                          { do: 'heading', x: 'dir', y: '0' },
                        ],
                      ),
                    ],
                  ),
                ],
              ),
            ],
          ),
        ],
      },
    ],
  }) as BehaviorScript;
}

/**
 * Wandering as the engine does it (Wander's settings): keeps going one way; when its time is up, or a wall is in
 * the way, it picks another way at random (not the same, not into a wall: four ways without gravity, left and right
 * with it), and with "pauses" now and then stands still for a moment. Things that also patrol don't wander.
 */
function wanderScript(): BehaviorScript {
  const ok = (wx: number, wy: number, floatsOnly: boolean) =>
    `${floatsOnly ? 'self.floats and ' : ''}not (wx == ${wx} and wy == ${wy}) and not wall_ahead(${wx}, ${wy})`;
  const take = (n: number, wx: number, wy: number): Step => when(`ok${n}`, [when('seen == k', [set('wx', String(wx)), set('wy', String(wy))]), set('seen', 'seen + 1')]);
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Wander',
    description: 'Walks around at random, turning at walls and now and then standing still, as the engine does it (the Wander settings).',
    takesOver: 'wandering',
    vars: [
      { name: 'speed', value: 50 },
      { name: 'interval', value: 2 },
      { name: 'pauses', value: true },
      { name: 'wx', value: 0 },
      { name: 'wy', value: 0 },
      { name: 't', value: 0 },
      { name: 'stop', value: false },
      { name: 'ok1', value: false },
      { name: 'ok2', value: false },
      { name: 'ok3', value: false },
      { name: 'ok4', value: false },
      { name: 'n', value: 0 },
      { name: 'k', value: 0 },
      { name: 'seen', value: 0 },
    ],
    handlers: [
      {
        when: { on: 'start' },
        do: [set('speed', "field(self, 'Wander.speed')"), set('interval', "max(0.2, field(self, 'Wander.interval'))"), set('pauses', "field(self, 'Wander.pauses')")],
      },
      {
        when: { on: 'tick' },
        if: "not self.following and not self.blinking and not has_component(self, 'Patrol')",
        do: [
          set('t', 't - dt'),
          when('t <= 0 or wall_ahead(wx, wy) or (self.bumped != 0 and self.bumped == wx)', [
            set('ok1', ok(1, 0, false)),
            set('ok2', ok(-1, 0, false)),
            set('ok3', ok(0, 1, true)),
            set('ok4', ok(0, -1, true)),
            set('n', '(ok1 ? 1 : 0) + (ok2 ? 1 : 0) + (ok3 ? 1 : 0) + (ok4 ? 1 : 0)'),
            set('stop', 'pauses and (wx != 0 or wy != 0) and chance(0.25)'),
            when(
              'stop or n == 0',
              [set('wx', '0'), set('wy', '0')],
              [set('k', 'randint(0, n - 1)'), set('seen', '0'), take(1, 1, 0), take(2, -1, 0), take(3, 0, 1), take(4, 0, -1)],
            ),
            // Stops are short; walks last about the interval.
            set('t', '(stop ? 0.4 : 0.5 + rand(0, 1)) * interval'),
          ]),
          vel('wx * speed * self.speed_factor', null),
          when('self.floats', [vel(null, 'wy * speed * self.speed_factor')]),
          when('wx != 0', [{ do: 'face', dir: 'wx', on: null }]),
          when('wx != 0 or wy != 0', [{ do: 'heading', x: 'wx', y: 'wy' }]),
        ],
      },
    ],
  }) as BehaviorScript;
}


/**
 * Shooting as the engine does it (Shooter's settings, kept in the script): "auto" fires every interval while
 * something tagged target_tag is within range (none needed without a tag), "key" when the player presses X, at most
 * once per interval; aimed left/right/up/down, at the target ("atTarget"), or the way it faces (a thing that stands
 * still turns to face its target; without gravity, the way it last went). At most 100 shots fly at once.
 */
function shootingScript(owner?: PartOwner): BehaviorScript {
  const c = owner?.components.Shooter ?? {};
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const tag = typeof c.targetTag === 'string' ? c.targetTag : 'player';
  const target = `nearest(target_tag)`;
  const found = `trigger == 'auto' and target_tag != '' and ${target}`;
  const shot = (x: string, y: string): Step => ({ do: 'shoot', dx: x, dy: y, speed: 'speed', damage: 'damage', range: 'range', object: typeof c.projectile === 'string' && c.projectile ? c.projectile : null });
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Shooting',
    description: 'Fires shots as the engine does it (the Shooter settings in Details).',
    takesOver: 'shooting',
    vars: [
      { name: 'trigger', value: c.trigger === 'key' ? 'key' : 'auto' },
      { name: 'interval', value: num(c.interval, 2) },
      { name: 'direction', value: typeof c.direction === 'string' ? c.direction : 'facing' },
      { name: 'target_tag', value: tag },
      { name: 'speed', value: num(c.speed, 240) },
      { name: 'damage', value: num(c.damage, 1) },
      { name: 'range', value: num(c.range, 480) },
      { name: 'wait', value: 0 },
      { name: 'aim', value: false },
    ],
    handlers: [
      {
        when: { on: 'start' },
        do: [
          set('trigger', "field(self, 'Shooter.trigger')"),
          set('interval', "field(self, 'Shooter.interval')"),
          set('direction', "field(self, 'Shooter.direction')"),
          set('target_tag', "field(self, 'Shooter.targetTag')"),
          set('speed', "field(self, 'Shooter.speed')"),
          set('damage', "field(self, 'Shooter.damage')"),
          set('range', "field(self, 'Shooter.range')"),
          // Fired by a key: ready at once; automatic: the first shot after one interval.
          set('wait', "trigger == 'key' ? interval : 0"),
        ],
      },
      {
        when: { on: 'tick' },
        do: [
          set('wait', 'wait + dt'),
          when(`(trigger == 'key' ? pressed('fire') : true) and wait >= interval and shots_in_air() < 100`, [
            // An "auto" shooter with a target tag fires only when one is within range.
            set('aim', `${found} and (range <= 0 or dist(${target}) <= range)`),
            when(`trigger != 'auto' or target_tag == '' or aim`, [
              when("direction == 'left'", [shot('-1', '0')]),
              when("direction == 'right'", [shot('1', '0')]),
              when("direction == 'up'", [shot('0', '-1')]),
              when("direction == 'down'", [shot('0', '1')]),
              when("direction == 'atTarget'", [
                // (shoot makes the direction one long, exactly as the engine does: not twice.)
                when('aim', [shot(`dx(${target})`, `dy(${target})`)], [shot('self.facing', '0')]),
              ]),
              when("direction != 'left' and direction != 'right' and direction != 'up' and direction != 'down' and direction != 'atTarget'", [
                // Facing: something standing still turns to its target first.
                when(`aim and not has_component(self, 'Patrol') and not has_component(self, 'CharacterController')`, [
                  { do: 'face', dir: `dx(${target}) < 0 ? -1 : 1`, on: null },
                  when(`abs(dy(${target})) > abs(dx(${target}))`, [{ do: 'heading', x: '0', y: `dy(${target})` }], [{ do: 'heading', x: 'self.facing', y: '0' }]),
                ]),
                when(
                  'self.floats',
                  [
                    when('self.heading_x != 0 or self.heading_y != 0', [shot('self.heading_x', 'self.heading_y')], [shot('self.facing', '0')]),
                  ],
                  [shot('self.facing', '0')],
                ),
              ]),
              set('wait', '0'),
            ]),
          ]),
        ],
      },
    ],
  }) as BehaviorScript;
}

/**
 * A moving platform as the engine does it (MovingPlatform's settings, kept in the script): glides to its start +
 * offset and back at speed, waiting "pause" seconds at each end, carrying what stands on it.
 */
function movingScript(owner?: PartOwner): BehaviorScript {
  const c = owner?.components.MovingPlatform ?? {};
  const off = (c.offset as { x?: number; y?: number } | undefined) ?? { x: 96, y: 0 };
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Moving',
    description: 'Glides to its start + offset and back, waiting at each end, carrying what stands on it (the Moving Platform settings in Details).',
    takesOver: 'moving',
    vars: [
      { name: 'offset_x', value: num(off.x, 96) },
      { name: 'offset_y', value: num(off.y, 0) },
      { name: 'speed', value: num(c.speed, 64) },
      { name: 'pause', value: num(c.pause, 0.5) },
      { name: 'to_end', value: true },
      { name: 'wait', value: 0 },
      { name: 'gx', value: 0 },
      { name: 'gy', value: 0 },
      { name: 'gd', value: 0 },
      { name: 'mx', value: 0 },
      { name: 'my', value: 0 },
    ],
    handlers: [
      {
        when: { on: 'start' },
        do: [
          set('offset_x', "field(self, 'MovingPlatform.offset.x')"),
          set('offset_y', "field(self, 'MovingPlatform.offset.y')"),
          set('speed', "field(self, 'MovingPlatform.speed')"),
          set('pause', "field(self, 'MovingPlatform.pause')"),
        ],
      },
      {
        when: { on: 'tick' },
        do: [
          vel('0', '0'),
          when(
            'wait > 0',
            [set('wait', 'wait - dt')],
            [
              set('gx', 'self.spawn_x + (to_end ? offset_x : 0) - self.x'),
              set('gy', 'self.spawn_y + (to_end ? offset_y : 0) - self.y'),
              set('gd', 'sqrt(gx * gx + gy * gy)'),
              when(
                'gd <= speed * dt or speed <= 0',
                [set('mx', 'gx'), set('my', 'gy'), set('to_end', 'not to_end'), set('wait', 'pause')],
                [set('mx', 'gx / gd * speed * dt'), set('my', 'gy / gd * speed * dt')],
              ),
              vel('mx / dt', 'my / dt'),
              { do: 'carry', x: 'mx', y: 'my' },
            ],
          ),
        ],
      },
    ],
  }) as BehaviorScript;
}

/** Hopping as the engine does it (Jumper's settings): a jump every interval while standing on something. */
function hoppingScript(): BehaviorScript {
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Hopping',
    description: 'Jumps every few seconds while standing on something, as the engine does it (the Jumper settings).',
    takesOver: 'hopping',
    vars: [
      { name: 'interval', value: 2 },
      { name: 'force', value: 300 },
      { name: 'wait', value: 0 },
    ],
    handlers: [
      { when: { on: 'start' }, do: [set('interval', "field(self, 'Jumper.interval')"), set('force', "field(self, 'Jumper.jumpForce')")] },
      {
        when: { on: 'tick' },
        if: 'not self.floats',
        do: [set('wait', 'wait + dt'), when('self.grounded and wait >= interval', [set('wait', '0'), { do: 'jump', force: 'force', on: null }])],
      },
    ],
  }) as BehaviorScript;
}

/** The Timer as the engine does it: the "timer" event every interval (or once). */
function timerScript(): BehaviorScript {
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Timer',
    description: 'Sets off the "timer" event every interval seconds (or once), as the engine does it (the Timer settings).',
    takesOver: 'timer',
    vars: [
      { name: 'interval', value: 2 },
      { name: 'again', value: true },
      { name: 'wait', value: 0 },
      { name: 'done', value: false },
    ],
    handlers: [
      { when: { on: 'start' }, do: [set('interval', "field(self, 'Timer.interval')"), set('again', "field(self, 'Timer.repeat')")] },
      {
        when: { on: 'tick' },
        if: 'not done',
        do: [
          set('wait', 'wait + dt'),
          when('wait >= interval', [{ do: 'emit', event: 'timer', other: null }, when('again', [set('wait', 'wait - interval')], [set('done', 'true')])]),
        ],
      },
    ],
  }) as BehaviorScript;
}

/**
 * Running as the engine does it (runs just before the engine moves the character, as its controls do): Left/Right
 * speed it up toward its running speed (CharacterController.speed, times its speed factor) by its acceleration, as
 * much as its grip on the floor allows (ice: slippery), in the air by its air control; it faces the way it runs.
 * Seen from above it walks in eight directions instead (diagonals no faster), turning smoothly. Its settings are
 * read every step, so the Character Controller's still work. (Climbing ladders and hanging from ledges stay the
 * engine's.)
 */
function runningScript(): BehaviorScript {
  const cc = (name: string) => `field(self, 'CharacterController.${name}')`;
  const dirOf = (plus: string, minus: string) => `(key('${plus}') ? 1 : 0) - (key('${minus}') ? 1 : 0)`;
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Running',
    description: 'Running with Left/Right (seen from above: walking with the arrow keys), as the engine does it: speeding up by its acceleration, slipping on ice, steering less in the air; it faces the way it runs.',
    takesOver: 'running',
    vars: [
      { name: 'mx', value: 0 },
      { name: 'my', value: 0 },
      { name: 'target', value: 0 },
      { name: 'rate', value: 0 },
      { name: 'tx', value: 0 },
      { name: 'ty', value: 0 },
      { name: 'off', value: 0 },
      { name: 'step', value: 0 },
    ],
    handlers: [
      {
        when: { on: 'tick' },
        // (Not while hanging from a ledge, nor on a ladder unless jumping off it: those are the engine's.)
        if: "field(self, 'CharacterController.movement') == 'topdown' or (not self.hanging and (not self.climbing or pressed('jump')))",
        do: [
          set('mx', dirOf('right', 'left')),
          when('mx != 0', [{ do: 'face', dir: 'mx', on: null }]),
          when(
            `${cc('movement')} == 'topdown'`,
            [
              // Eight ways, diagonals no faster; toward that velocity by at most "acceleration" a second, as one turn.
              set('my', dirOf('down', 'up')),
              when('mx != 0 or my != 0', [{ do: 'heading', x: 'mx', y: 'my' }]),
              set('off', 'mx != 0 or my != 0 ? sqrt(mx * mx + my * my) : 1'),
              set('tx', `mx / off * ${cc('speed')} * self.speed_factor`),
              set('ty', `my / off * ${cc('speed')} * self.speed_factor`),
              set('off', 'sqrt((tx - self.vx) * (tx - self.vx) + (ty - self.vy) * (ty - self.vy))'),
              set('step', `${cc('acceleration')} * dt`),
              when('off <= step', [vel('tx', 'ty')], [vel('self.vx + (tx - self.vx) / off * step', 'self.vy + (ty - self.vy) / off * step')]),
            ],
            [
              // On the ground as much as its grip allows (its friction and the floor's); in the air, its air control.
              set('target', `mx * ${cc('speed')} * self.speed_factor`),
              set('rate', `${cc('acceleration')} * (self.grounded ? self.grip : ${cc('airControl')})`),
              vel('self.vx + sign(target - self.vx) * min(abs(target - self.vx), rate * dt)', null),
            ],
          ),
        ],
      },
    ],
  }) as BehaviorScript;
}

/**
 * Climbing ladders as the engine does it (runs just before the engine moves the character, as its controls do):
 * at a ladder, Up (unless it already stands on the ladder's top) or Down (unless it stands on the floor) starts
 * a climb; Up/Down climb and Left/Right move along it at its running speed, easing into the ladder's middle when
 * going straight up or down; Jump lets go, so does moving off it; at the top it stands on it. Its speed is the
 * Character Controller's, read every step. (Reaching the floor ends a climb in the engine's physics, as before.)
 */
function climbingScript(): BehaviorScript {
  const speed = "field(self, 'CharacterController.speed') * self.speed_factor";
  const key = (k: string) => `(key('${k}') ? 1 : 0)`;
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Climbing',
    description: 'Climbing ladders with Up/Down (Left/Right moves along it, Jump lets go), as the engine does it: at running speed, easing into the middle, standing on the top when it gets there.',
    takesOver: 'climbing',
    vars: [
      { name: 'centering', value: 10, setting: true },
      { name: 'mx', value: 0 },
      { name: 'vert', value: 0 },
      { name: 'here', value: false },
    ],
    handlers: [
      {
        when: { on: 'tick' },
        if: "field(self, 'CharacterController.movement') != 'topdown'",
        do: [
          set('mx', `${key('right')} - ${key('left')}`),
          set('here', 'ladder_here()'),
          // Starting: Up below its top, or Down anywhere but on the floor.
          when("here and not self.climbing and ((key('up') and self.feet > ladder_top() + 0.5) or (key('down') and not floor_below_ladder()))", [
            { do: 'climbing', value: 'true' },
            vel('0', null),
          ]),
          when("self.climbing and pressed('jump')", [{ do: 'climbing', value: 'false' }], [
            // Moved off the side, or climbed down off its bottom: lets go (no climbing speed kept).
            when('self.climbing and not here', [{ do: 'climbing', value: 'false' }, vel(null, '0')]),
          ]),
          when('self.climbing and here', [
            set('vert', `${key('down')} - ${key('up')}`),
            vel(`mx * ${speed}`, `vert * ${speed}`),
            // Straight up or down eases it into the ladder's middle (Left/Right overrides it).
            when('vert != 0 and mx == 0', [{ do: 'position', x: 'self.x + (ladder_x() - self.x) * min(1, dt * centering)', y: 'self.y', on: null }]),
            when('vert < 0 and self.feet + self.vy * dt <= ladder_top()', [{ do: 'stand_on_ladder' }]),
          ]),
        ],
      },
    ],
  }) as BehaviorScript;
}

/**
 * Ledge grabs as the engine does it (LedgeGrab): falling (or at the top of a jump) against a wall while pressing
 * toward it, with the wall's top at hand height and room to stand on it, it hangs there ("ledge_grabbed"); Up or
 * Jump climbs up onto it, Down or pressing away lets go; for a moment after (climb_wait, drop_wait) it grabs nothing.
 */
function ledgeGrabScript(): BehaviorScript {
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Ledge grab',
    description: 'Grabbing ledges while falling against a wall and pressing toward it; Up or Jump climbs up, Down or pressing away lets go: as the engine does it.',
    takesOver: 'ledge_grab',
    vars: [
      { name: 'climb_wait', value: 0.2, setting: true },
      { name: 'drop_wait', value: 0.3, setting: true },
      { name: 'cooldown', value: 0 },
      { name: 'mx', value: 0 },
    ],
    handlers: [
      {
        when: { on: 'tick' },
        if: "field(self, 'CharacterController.movement') != 'topdown' and not self.climbing",
        do: [
          set('mx', "(key('right') ? 1 : 0) - (key('left') ? 1 : 0)"),
          set('cooldown', 'max(0, cooldown - dt)'),
          when(
            'self.hanging',
            [
              vel('0', '0'),
              when("pressed('jump') or key('up')", [{ do: 'climb_ledge' }, set('cooldown', 'climb_wait')], [
                when("key('down') or mx == -self.hang_side", [{ do: 'let_go' }, set('cooldown', 'drop_wait')]),
              ]),
            ],
            [when("has_component(self, 'LedgeGrab') and not self.grounded and self.vy >= 0 and mx != 0 and cooldown <= 0", [{ do: 'grab_ledge', dir: 'mx' }])],
          ),
        ],
      },
    ],
  }) as BehaviorScript;
}

/**
 * Being used as the engine does it (Switch): a player touching it presses Interact (activation "interact"), or a
 * player walks into it ("touch"); it flips on/off (only the first time with "once") and "switch_activated"
 * happens, the player as the other party: what it "controls" opens, closes, disappears or moves (the connections
 * do that, as before), and rules and scripts can react.
 */
function switchScript(): BehaviorScript {
  const use: Step[] = [
    when("not (field(self, 'Switch.once') and used)", [
      set('used', 'true'),
      { do: 'set_switch', target: 'self', value: 'not self.on' },
      { do: 'emit', event: 'switch_activated', other: 'other' },
    ]),
  ];
  const player = "has_component(other, 'CharacterController')";
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Switch',
    description: 'Used by a player pressing Interact (E) while touching it, or by walking into it (Switch.activation): flips on/off (once only with Switch.once) and "switch_activated" happens, so what it controls reacts.',
    takesOver: 'switching',
    vars: [{ name: 'used', value: false }],
    handlers: [
      { when: { on: 'contact' }, if: `field(self, 'Switch.activation') == 'interact' and pressed('interact') and ${player}`, do: use },
      { when: { on: 'event', event: 'touch_started', with: null }, if: `field(self, 'Switch.activation') == 'touch' and ${player}`, do: use },
    ],
  }) as BehaviorScript;
}

/** A connection's condition as a script expression, from the door's side ("subject" is whoever touched it). */
function conditionExpr(c: Condition): string {
  const who = (ref: EntityRef): string => {
    if (ref.kind === 'subject') return 'other';
    if (ref.kind === 'other') return 'self';
    throw new ModelError('its key connection has a condition about something other than the door or who touches it; change that condition first');
  };
  const q = (t: string) => `'${t.replace(/'/g, '')}'`;
  let e: string;
  switch (c.type) {
    case 'has_item':
      e = `items(${who(c.entity)}, ${q(c.item)}) >= ${c.count}`;
      break;
    case 'health':
      e = `${who(c.entity)}.health ${c.compare} ${c.value}`;
      break;
    case 'is_open':
      e = `${who(c.entity)}.open`;
      break;
    case 'switch_on':
      e = `${who(c.entity)}.on`;
      break;
    case 'none_left':
      throw new ModelError('its key connection has a "none left" condition; change that condition first');
  }
  return c.not ? `not (${e})` : e;
}

/**
 * Opening for its key as the engine does it (a "requires" connection: Door requires Key): when something touches
 * it while it is closed, carrying the item, it opens (using the item up when the connection says so), the toucher
 * as the other party of "opened"; a player without it gets "locked". Made from its connections when taken over.
 */
function lockScript(owner?: PartOwner): BehaviorScript {
  const requires = owner?.requires ?? [];
  if (!requires.length) throw new ModelError(`${owner?.name ?? 'It'} has no key connection ("requires"), so there is no unlocking to take over`);
  const q = (t: string) => `'${t.replace(/'/g, '')}'`;
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Lock',
    description: `Opens when touched by something carrying ${requires.map((r) => `a "${r.item}"`).join(' or ')}${requires.some((r) => r.consume) ? ' (using it up)' : ''}; a player without it gets "locked".`,
    takesOver: 'unlocking',
    vars: [],
    handlers: [
      {
        when: { on: 'event', event: 'touch_started', with: null },
        do: requires.map((r) =>
          when('not self.open', [
            when(
              `items(other, ${q(r.item)}) < 1`,
              [when("has_component(other, 'CharacterController')", [{ do: 'emit', event: 'locked', other: 'other', detail: { needs: q(r.item) } }])],
              [
                when(r.conditions.length ? r.conditions.map(conditionExpr).join(' and ') : 'true', [
                  ...(r.consume ? [{ do: 'take_item', target: 'other', item: r.item, count: '1' }] : []),
                  { do: 'set_open', target: 'self', open: 'true', by: 'other' },
                ]),
              ],
            ),
          ]),
        ),
      },
    ],
  }) as BehaviorScript;
}

/**
 * Being reached as the engine does it (Goal): a player walking into it wins the level; seen from above (or for a
 * player with no gravity) the player has to stand on it, its middle inside the goal, not just brush its edge.
 * The player who reached it wins ("level_completed", with it as the subject). (A goal never blocks the way.)
 */
function goalScript(): BehaviorScript {
  const player = "has_component(other, 'CharacterController')";
  const above = "(field(other, 'CharacterController.movement') == 'topdown' or other.floats)";
  return scriptSchema.parse({
    id: generateId('scr'),
    name: 'Goal',
    description: 'Reaching it wins the level: a player walking into it, or (seen from above) standing on it.',
    takesOver: 'goal',
    vars: [],
    handlers: [
      { when: { on: 'event', event: 'touch_started', with: null }, if: `${player} and not ${above}`, do: [{ do: 'complete_level', by: 'other' }] },
      { when: { on: 'contact' }, if: `${player} and ${above} and inside(other)`, do: [{ do: 'complete_level', by: 'other' }] },
    ],
  }) as BehaviorScript;
}

export const ENGINE_PART_INFO: Record<EnginePart, EnginePartInfo> = {
  goal: {
    label: 'reaching the goal',
    covers: 'winning the level when a player reaches it: walking into it, or seen from above standing on it (its middle inside the goal); the player who reached it is who won',
    component: 'Goal',
    script: goalScript,
  },
  switching: {
    label: 'switching',
    covers: 'a switch being used: a player pressing Interact (E) while touching it, or walking into it (Switch.activation), flipping it on/off (Switch.once: only the first time), and "switch_activated" (what it "controls" still reacts through its connections)',
    component: 'Switch',
    script: switchScript,
  },
  unlocking: {
    label: 'unlocking',
    covers: 'a door opening for its key (its "requires" connection): touched by something carrying the item it opens (using it up when the connection says consume), a player without it gets "locked"',
    component: 'Openable',
    script: lockScript,
  },
  climbing: {
    label: 'climbing',
    covers: "the player climbing ladders: Up/Down to start and climb (not Up on the ladder's top, not Down on the floor), Left/Right along it, at its running speed, easing into the middle, Jump or moving off to let go, standing on the top when it gets there; not enemies climbing (that is their Patrol)",
    component: 'CharacterController',
    script: climbingScript,
  },
  ledge_grab: {
    label: 'ledge grab',
    covers: 'hanging from a ledge (LedgeGrab): grabbing it while falling against a wall and pressing toward it, Up or Jump to climb up, Down or pressing away to let go, a moment after when it grabs nothing',
    component: 'LedgeGrab',
    script: ledgeGrabScript,
  },
  running: {
    label: 'running',
    covers: 'Left/Right running (seen from above: walking in eight directions): how fast (speed, times its speed factor), speeding up and slowing down (acceleration, as much as the floor\'s grip allows: slippery on ice), steering in the air (airControl), and facing the way it runs; not climbing ladders or hanging from ledges',
    component: 'CharacterController',
    script: runningScript,
  },
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
  patrolling: {
    label: 'patrolling',
    covers: 'walking back and forth (turning at walls, ledges and after its distance), climbing ladders it passes, chasing the player it sees (by ladder too), giving up after losing sight of it, slowing down before turning while chasing',
    component: 'Patrol',
    script: patrolScript,
  },
  wandering: {
    label: 'wandering',
    covers: 'walking around at random: a new way now and then and at walls, sometimes standing still',
    component: 'Wander',
    script: wanderScript,
  },
  shooting: {
    label: 'shooting',
    covers: 'firing shots: every interval at a target in range (or with the fire key), which way (facing, at the target, left/right/up/down), how fast, how far, how much damage, at most 100 shots at once',
    component: 'Shooter',
    script: shootingScript,
  },
  moving: {
    label: 'moving',
    covers: 'a moving platform gliding to its offset and back, waiting at each end, carrying what stands on it',
    component: 'MovingPlatform',
    script: movingScript,
  },
  hopping: {
    label: 'hopping',
    covers: 'jumping on its own every few seconds while on the ground (Jumper)',
    component: 'Jumper',
    script: hoppingScript,
  },
  timer: {
    label: 'timer',
    covers: 'the "timer" event every interval seconds, or once',
    component: 'Timer',
    script: timerScript,
  },
};

/** Whether these scripts do `part` instead of the engine (one taking it over is there and switched on). */
export function scriptedPart(scripts: readonly BehaviorScript[] | undefined, part: EnginePart): boolean {
  return !!scripts?.some((s) => s.enabled && s.takesOver === part);
}
