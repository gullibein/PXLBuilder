/**
 * Ready-made enemy behaviors for side-view games (platformers), one script each: the AI picks the one that fits the
 * game (a Goomba-like walker for a Mario-like game, a guard that hunts the player for a Lode Runner-like one…), puts
 * it on the enemy with set_script {"ready": name, "settings": {...}}, and changes the script itself where the game
 * wants something more. Every setting shows in Details (true/false ones as tick boxes). They only move the enemy:
 * hurting and being stomped stay the enemy's own scripts (Stomp, Hurts on touch). An enemy with one of these has no
 * Patrol or Wander component (they would both steer it).
 */
type Step = Record<string, unknown>;
const set = (v: string, value: string): Step => ({ do: 'set', var: v, value });
const when = (cond: string, then: Step[], otherwise: Step[] = []): Step => ({ do: 'if', cond, then, else: otherwise });
const vel = (x: string | null, y: string | null): Step => ({ do: 'velocity', x, y });
const face = (dir: string): Step => ({ do: 'face', dir, on: null });
const gravity = (scale: string): Step => ({ do: 'gravity', scale, on: null });
/** Not while a "follows" connection steers it, nor while it blinks after a hit. */
const FREE = 'not self.following and not self.blinking';
/** Another enemy right in front of it that way (they turn at each other, as Goombas do). */
const enemyAhead = (dir: string) => `thing_at(self.x + ${dir} * (self.width / 2 + 3), self.y, 'enemy')`;
const startDir = "start == 'left' ? -1 : 1";

/** Goomba-like: keeps walking one way until it hits something, then turns; walks off ledges unless told to turn there. */
export const WALKER_SCRIPT = {
  name: 'Walker',
  description:
    'Keeps walking the same way until it hits a wall or another enemy, then turns around (Goomba-like). With turn_at_ledges it turns at the end of a platform instead of walking off it.',
  vars: [
    { name: 'speed', value: 50, setting: true },
    { name: 'start', value: 'left', setting: true },
    { name: 'turn_at_ledges', value: false, setting: true },
    { name: 'turn_at_enemies', value: true, setting: true },
    { name: 'dir', value: -1 },
  ],
  handlers: [
    { when: { on: 'start' }, do: [set('dir', startDir)] },
    {
      when: { on: 'tick' },
      if: FREE,
      do: [
        when(`self.bumped == dir or wall_ahead(dir, 0) or (turn_at_enemies and ${enemyAhead('dir')}) or (turn_at_ledges and self.grounded and ledge_ahead(dir))`, [set('dir', '-dir')]),
        vel('dir * speed * self.speed_factor', null),
        face('dir'),
      ],
    },
  ],
};

/**
 * Lode Runner-like guard: always goes after the player (or only once it sees it, with sight), by ladders too;
 * otherwise walks back and forth. With drop_down it runs off ledges after the player, else it stops at them.
 */
export const CHASER_SCRIPT = {
  name: 'Chaser',
  description:
    'Goes after the player wherever it is, climbing ladders to get to its floor (Lode Runner-like guard). With sight > 0 only once it sees the player that near (no wall between); otherwise it walks back and forth. drop_down: runs off ledges after the player.',
  vars: [
    { name: 'speed', value: 70, setting: true },
    { name: 'sight', value: 0, setting: true },
    { name: 'drop_down', value: true, setting: true },
    { name: 'lose_sight', value: 3, setting: true },
    { name: 'dir', value: 1 },
    { name: 'hunting', value: false },
    { name: 'lost', value: 0 },
    { name: 'side', value: 0 },
  ],
  handlers: [
    {
      when: { on: 'tick' },
      if: FREE,
      do: [
        when(
          'sight <= 0',
          [set('hunting', 'nearest_player() != null')],
          [
            when(
              'nearest_player() and dist(nearest_player()) <= sight and can_see(nearest_player())',
              [set('hunting', 'true'), set('lost', '0')],
              [when('hunting', [set('lost', 'lost + dt'), when('not nearest_player() or lost > lose_sight', [set('hunting', 'false')])])],
            ),
          ],
        ),
        when(
          'hunting and nearest_player()',
          [
            { do: 'chase', target: 'nearest_player()', speed: 'speed * self.speed_factor' },
            set('side', 'sign(self.vx)'),
            when('not drop_down and side != 0 and self.grounded and not self.climbing and ledge_ahead(side)', [vel('0', null)]),
            when('side != 0', [set('dir', 'side')]),
          ],
          [
            when('not self.climbing', [
              when('self.bumped == dir or wall_ahead(dir, 0) or (self.grounded and ledge_ahead(dir))', [set('dir', '-dir')]),
              vel('dir * speed * 0.6 * self.speed_factor', null),
              face('dir'),
            ]),
          ],
        ),
      ],
    },
  ],
};

/** Frog-like: sits a moment, then hops forward (toward the player, with toward_player). */
export const HOPPER_SCRIPT = {
  name: 'Hopper',
  description: 'Sits still for a moment, then hops forward, again and again (frog-like); with toward_player it hops toward the player. Turns when it hops into a wall.',
  vars: [
    { name: 'jump', value: 300, setting: true },
    { name: 'speed', value: 70, setting: true },
    { name: 'rest', value: 1, setting: true },
    { name: 'toward_player', value: true, setting: true },
    { name: 'start', value: 'left', setting: true },
    { name: 'dir', value: -1 },
    { name: 't', value: 0 },
  ],
  handlers: [
    { when: { on: 'start' }, do: [set('dir', startDir)] },
    {
      when: { on: 'tick' },
      if: FREE,
      do: [
        when(
          'self.grounded and self.vy >= 0',
          [
            vel('0', null),
            set('t', 't + dt'),
            when('t >= rest', [
              when('toward_player and nearest_player() and dx(nearest_player()) != 0', [set('dir', 'sign(dx(nearest_player()))')]),
              when('wall_ahead(dir, 0)', [set('dir', '-dir')]),
              face('dir'),
              { do: 'jump', force: 'jump' },
              vel('dir * speed * self.speed_factor', null),
              set('t', '0'),
            ]),
          ],
          [when('self.bumped == dir', [set('dir', '-dir'), face('dir')]), vel('dir * speed * self.speed_factor', null)],
        ),
      ],
    },
  ],
};

/** Medusa-head-like: flies one way in a wave, up and down; turns at walls (and after distance). */
export const WAVE_FLYER_SCRIPT = {
  name: 'Wave flyer',
  description: 'Flies one way, bobbing up and down in a wave (a bat, a flying fish); turns at walls and after distance pixels from where it started (0 = only at walls). Nothing pulls it down.',
  vars: [
    { name: 'speed', value: 60, setting: true },
    { name: 'height', value: 24, setting: true },
    { name: 'wave_time', value: 2, setting: true },
    { name: 'distance', value: 0, setting: true },
    { name: 'start', value: 'left', setting: true },
    { name: 'dir', value: -1 },
    { name: 'phase', value: 0 },
  ],
  handlers: [
    { when: { on: 'start' }, do: [set('dir', startDir), gravity('0')] },
    {
      when: { on: 'tick' },
      if: FREE,
      do: [
        when('self.bumped == dir or wall_ahead(dir, 0) or (distance > 0 and (self.x - self.spawn_x) * dir >= distance)', [set('dir', '-dir')]),
        set('phase', 'phase + dt * 2 * pi / max(0.2, wave_time)'),
        vel('dir * speed * self.speed_factor', 'height * 2 * pi / max(0.2, wave_time) * cos(phase)'),
        face('dir'),
      ],
    },
  ],
};

/** Thwomp-like: waits up high, crashes down when the player is below, rests, rises back, again. */
export const DROPPER_SCRIPT = {
  name: 'Dropper',
  description:
    'Hangs where it was put until the player comes underneath (within reach pixels sideways), then crashes straight down, rests on the floor a moment and rises slowly back up, ready again (Thwomp-like). Nothing pulls it down otherwise.',
  vars: [
    { name: 'reach', value: 40, setting: true },
    { name: 'fall_speed', value: 420, setting: true },
    { name: 'rise_speed', value: 60, setting: true },
    { name: 'rest', value: 1, setting: true },
    { name: 'phase', value: 'wait' },
    { name: 't', value: 0 },
  ],
  handlers: [
    { when: { on: 'start' }, do: [gravity('0')] },
    {
      when: { on: 'tick' },
      if: 'not self.following',
      do: [
        when("phase == 'wait'", [
          vel('0', '0'),
          when('nearest_player() and abs(dx(nearest_player())) <= reach + self.width / 2 and dy(nearest_player()) > 0 and can_see(nearest_player())', [set('phase', "'fall'")]),
        ]),
        when("phase == 'fall'", [vel('0', 'fall_speed'), when('wall_ahead(0, 1) or self.grounded', [vel('0', '0'), set('phase', "'rest'"), set('t', '0'), { do: 'camera_shake', strength: '3', seconds: '0.2' }])]),
        when("phase == 'rest'", [set('t', 't + dt'), when('t >= rest', [set('phase', "'rise'")])]),
        when("phase == 'rise'", [vel('0', '-rise_speed'), when('self.y <= self.spawn_y or wall_ahead(0, -1)', [vel('0', '0'), { do: 'position', x: 'self.x', y: 'max(self.y, self.spawn_y)', on: null }, set('phase', "'wait'")])]),
      ],
    },
  ],
};

/** Bull-like: ambles about; when it sees the player on its floor it stops, then charges until it hits something. */
export const CHARGER_SCRIPT = {
  name: 'Charger',
  description:
    'Walks slowly back and forth (speed 0: stands still); when it sees the player ahead on its own floor (within sight pixels) it stops for a moment (windup: the warning), then charges at charge_speed until it hits a wall or gets to a ledge, rests, and walks on.',
  vars: [
    { name: 'speed', value: 30, setting: true },
    { name: 'sight', value: 200, setting: true },
    { name: 'windup', value: 0.5, setting: true },
    { name: 'charge_speed', value: 240, setting: true },
    { name: 'rest', value: 1, setting: true },
    { name: 'start', value: 'left', setting: true },
    { name: 'dir', value: -1 },
    { name: 'phase', value: 'walk' },
    { name: 't', value: 0 },
  ],
  handlers: [
    { when: { on: 'start' }, do: [set('dir', startDir)] },
    {
      when: { on: 'tick' },
      if: FREE,
      do: [
        when("phase == 'walk'", [
          when('self.bumped == dir or wall_ahead(dir, 0) or (self.grounded and ledge_ahead(dir))', [set('dir', '-dir')]),
          vel('dir * speed * self.speed_factor', null),
          face('dir'),
          when('nearest_player() and abs(dx(nearest_player())) <= sight and abs(dy(nearest_player())) < self.height and can_see(nearest_player())', [
            set('dir', 'sign(dx(nearest_player())) != 0 ? sign(dx(nearest_player())) : dir'),
            face('dir'),
            vel('0', null),
            set('phase', "'windup'"),
            set('t', '0'),
          ]),
        ]),
        when("phase == 'windup'", [vel('0', null), set('t', 't + dt'), when('t >= windup', [set('phase', "'charge'")])]),
        when("phase == 'charge'", [
          vel('dir * charge_speed * self.speed_factor', null),
          when('self.bumped == dir or wall_ahead(dir, 0) or (self.grounded and ledge_ahead(dir))', [vel('0', null), set('phase', "'rest'"), set('t', '0')]),
        ]),
        when("phase == 'rest'", [vel('0', null), set('t', 't + dt'), when('t >= rest', [set('dir', '-dir'), set('phase', "'walk'")])]),
      ],
    },
  ],
};

/** Boo-like: floats toward the player while it looks away; stops (and waits) while the player faces it. */
export const SHY_GHOST_SCRIPT = {
  name: 'Shy ghost',
  description: 'Floats toward the player through the air while the player looks the other way, and stops still while the player faces it (Boo-like). Only within range pixels (0 = anywhere). Nothing pulls it down.',
  vars: [
    { name: 'speed', value: 40, setting: true },
    { name: 'range', value: 0, setting: true },
  ],
  handlers: [
    { when: { on: 'start' }, do: [gravity('0')] },
    {
      when: { on: 'tick' },
      if: 'not self.following',
      do: [
        when(
          'nearest_player() and (range <= 0 or dist(nearest_player()) <= range) and nearest_player().facing != sign(self.x - nearest_player().x)',
          [{ do: 'move_toward', target: 'nearest_player()', speed: 'speed * self.speed_factor' }],
          [vel('0', '0'), when('nearest_player()', [face('sign(dx(nearest_player())) != 0 ? sign(dx(nearest_player())) : self.facing')])],
        ),
      ],
    },
  ],
};

/**
 * Slime: crawls over floors, walls, ceilings and ladders to the player, by a way it plans again now and then, with a
 * bit of chance so it isn't always the shortest; drops from a ceiling when that is the way, or onto the player
 * right below. Touching hurts through the enemy's own Hurts on touch script.
 */
export const SLIME_SCRIPT = {
  name: 'Slime',
  description:
    'Crawls over floors, walls, ceilings and ladders toward the player, finding its way again every replan seconds, not always the shortest (wander 0-1); drops from a ceiling when that is the way, and onto the player right below (drop_on); ambush: the chance it crawls the ceiling to above the player to drop on it. With sight > 0 it waits stuck where it is until it sees the player that near.',
  vars: [
    { name: 'speed', value: 45, setting: true },
    { name: 'wander', value: 0.6, setting: true },
    { name: 'replan', value: 1.5, setting: true },
    { name: 'drop_on', value: true, setting: true },
    { name: 'ambush', value: 0.5, setting: true },
    { name: 'sight', value: 0, setting: true },
    { name: 'hunting', value: false },
  ],
  handlers: [
    { when: { on: 'start' }, do: [gravity('0')] },
    {
      when: { on: 'tick' },
      if: FREE,
      do: [
        when('not hunting and nearest_player() and (sight <= 0 or (dist(nearest_player()) <= sight and can_see(nearest_player())))', [set('hunting', 'true')]),
        when(
          'hunting and nearest_player()',
          [{ do: 'crawl', target: 'nearest_player()', speed: 'speed * self.speed_factor', wander: 'wander', replan: 'replan', drop_on: 'drop_on', ambush: 'ambush' }],
          [vel('0', '0')],
        ),
      ],
    },
  ],
};

/** The enemy behaviors by name (the names the AI asks for with "ready"). */
export const ENEMY_SCRIPTS = {
  Walker: WALKER_SCRIPT,
  Chaser: CHASER_SCRIPT,
  Hopper: HOPPER_SCRIPT,
  'Wave flyer': WAVE_FLYER_SCRIPT,
  Dropper: DROPPER_SCRIPT,
  Charger: CHARGER_SCRIPT,
  'Shy ghost': SHY_GHOST_SCRIPT,
  Slime: SLIME_SCRIPT,
};
