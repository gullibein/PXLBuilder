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
      { name: 'lose_sight', value: 3 },
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
    description: 'Fires shots as the engine does it; its settings are this script\'s variables (trigger "auto" or "key", interval, direction, target_tag, speed, damage, range).',
    takesOver: 'shooting',
    vars: [
      { name: 'trigger', value: c.trigger === 'key' ? 'key' : 'auto' },
      { name: 'interval', value: num(c.interval, 2) },
      { name: 'direction', value: typeof c.direction === 'string' ? c.direction : 'facing' },
      { name: 'target_tag', value: tag },
      { name: 'speed', value: num(c.speed, 240) },
      { name: 'damage', value: num(c.damage, 1) },
      { name: 'range', value: num(c.range, 480) },
      // Fired by a key: ready at once; automatic: the first shot after one interval.
      { name: 'wait', value: c.trigger === 'key' ? num(c.interval, 2) : 0 },
      { name: 'aim', value: false },
    ],
    handlers: [
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
    description: 'Glides to its start + offset and back, waiting at each end, carrying what stands on it; its settings are this script\'s variables.',
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
