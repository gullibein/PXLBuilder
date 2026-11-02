/**
 * Ready-made scripts for roguelikes (random levels, model/dungeon.ts): put on an object by name with set_script
 * {"ready": "Roguelike hero", "settings": {...}}. Every number and word is a setting in Details; they are ordinary
 * scripts afterwards.
 *
 * - Roguelike hero: steps square by square with the arrow keys; stepping into a monster attacks it; every step or
 *   blow is a turn of the world (the signal "world_turn": the monsters act once); E waits a turn. Its health and
 *   the floor carry on down the stairs; dying ends the run (the game starts again: a new dungeon).
 * - Roguelike monster: on each turn of the world, strikes the hero if it is beside it, else steps toward it when
 *   it is within sight, else now and then wanders a step.
 * - Stairs down: touched by the hero, the next floor (deeper: more monsters, other kinds): the level is built anew.
 * - Gold pickup / Healing pickup: touched by the hero, gold for the run / health back, and gone.
 */
type Step = Record<string, unknown>;
const set = (v: string, value: string): Step => ({ do: 'set', var: v, value });
const when = (cond: string, then: Step[], otherwise: Step[] = []): Step => ({ do: 'if', cond, then, else: otherwise });
const tick = (cond: string | null, steps: Step[]) => ({ when: { on: 'tick' }, state: null, if: cond, do: steps });
const turn = (steps: Step[]) => ({ when: { on: 'signal', name: 'world_turn' }, state: null, if: null, do: steps });
const touched = (steps: Step[]) => ({ when: { on: 'contact' }, state: null, if: "has_tag(other, 'player')", do: steps });
/** Squares apart along the grid. */
const apart = (a: string) => `(abs(grid_cell(${a}.x) - grid_cell(self.x)) + abs(grid_cell(${a}.y) - grid_cell(self.y))) / 32`;
const AT = 'thing_at(tx, ty, foes)';
const DOOR = 'thing_at(tx, ty, door_tag)';

export const ROGUELIKE_HERO_SCRIPT = {
  name: 'Roguelike hero',
  description: 'Steps square by square; stepping into a monster attacks it, into a shut door opens it with a key; each step or blow is a turn of the world (the monsters act); E waits a turn. Health and the floor carry on down the stairs; dying starts a new run.',
  vars: [
    { name: 'foes', value: 'monster', setting: true },
    { name: 'power', value: 2, setting: true },
    { name: 'step_speed', value: 240, setting: true },
    { name: 'step_time', value: 0.12, setting: true },
    { name: 'damage_color', value: '#ff5050', setting: true },
    { name: 'door_tag', value: 'door', setting: true },
    { name: 'key_item', value: 'key', setting: true },
    { name: 'locked_text', value: 'Locked', setting: true },
    { name: 'step_x', value: 0 },
    { name: 'step_y', value: 0 },
    { name: 'tx', value: 0 },
    { name: 'ty', value: 0 },
    { name: 'wait', value: 0 },
  ],
  states: [],
  handlers: [
    // Health kept from the floor above.
    { when: { on: 'start' }, state: null, if: "game_value('hp', 0) > 0", do: [{ do: 'set_health', target: 'self', value: "game_value('hp', 0)" }] },
    tick('wait > 0', [set('wait', 'wait - dt')]),
    tick('not walking_path and wait <= 0', [
      set('step_x', "pick(key('right'), 1, 0) - pick(key('left'), 1, 0)"),
      set('step_y', "step_x != 0 ? 0 : pick(key('down'), 1, 0) - pick(key('up'), 1, 0)"),
      when('step_x != 0 or step_y != 0', [
        set('tx', 'grid_cell(self.x) + step_x * 32'),
        set('ty', 'grid_cell(self.y) + step_y * 32'),
        when(
          `${AT} != null`,
          [
            { do: 'set_health', target: AT, value: `${AT}.health - power` },
            { do: 'popup', text: '-{power}', color: '{damage_color}', on: AT },
            set('wait', 'step_time * 2'),
            { do: 'signal', name: 'world_turn' },
          ],
          [
            when(
              'not solid_at(tx, ty)',
              [{ do: 'walk_to', x: 'tx', y: 'ty', steps: '1', speed: 'step_speed', on: null }, set('wait', 'step_time'), { do: 'signal', name: 'world_turn' }],
              // A shut door: its key opens it (used up), a turn of the world; without one it stays shut.
              [
                when(
                  `${DOOR} != null and items(self, key_item) > 0`,
                  [{ do: 'take_item', target: 'self', item: '{key_item}', count: '1' }, { do: 'set_open', target: DOOR, open: 'true', by: 'self' }, set('wait', 'step_time'), { do: 'signal', name: 'world_turn' }],
                  [when(`${DOOR} != null`, [{ do: 'popup', text: '{locked_text}', color: '#ffffff', on: DOOR }, set('wait', 'step_time * 3')])],
                ),
              ],
            ),
          ],
        ),
      ]),
    ]),
    // Waiting a turn.
    { when: { on: 'key', key: 'interact', edge: 'pressed' }, state: null, if: 'not walking_path and wait <= 0', do: [set('wait', 'step_time'), { do: 'signal', name: 'world_turn' }] },
    // The run is over: a new one, from the top.
    { when: { on: 'event', event: 'died', with: null }, state: null, if: null, do: [{ do: 'restart_game' }] },
  ],
};

export const ROGUELIKE_MONSTER_SCRIPT = {
  name: 'Roguelike monster',
  description: 'On each turn of the world: strikes the hero beside it, else steps toward it when it is in sight, else now and then wanders a step.',
  vars: [
    { name: 'foe', value: 'player', setting: true },
    { name: 'power', value: 1, setting: true },
    { name: 'sight', value: 6, setting: true },
    { name: 'wander', value: 0.3, setting: true },
    { name: 'step_speed', value: 240, setting: true },
    { name: 'damage_color', value: '#ff5050', setting: true },
    { name: 'k', value: 0 },
  ],
  states: [],
  handlers: [
    turn([
      when(
        `nearest(foe) != null and ${apart('nearest(foe)')} <= 1`,
        [
          { do: 'set_health', target: 'nearest(foe)', value: 'nearest(foe).health - power' },
          { do: 'popup', text: '-{power}', color: '{damage_color}', on: 'nearest(foe)' },
        ],
        [
          when(
            `nearest(foe) != null and ${apart('nearest(foe)')} <= sight`,
            [{ do: 'walk_to', x: 'nearest(foe).x', y: 'nearest(foe).y', steps: '1', speed: 'step_speed', on: null }],
            [
              when('chance(wander)', [
                set('k', 'randint(0, 3)'),
                { do: 'walk_to', x: 'self.x + pick(k == 0, 32, pick(k == 1, -32, 0))', y: 'self.y + pick(k == 2, 32, pick(k == 3, -32, 0))', steps: '1', speed: 'step_speed', on: null },
              ]),
            ],
          ),
        ],
      ),
    ]),
  ],
};

export const STAIRS_DOWN_SCRIPT = {
  name: 'Stairs down',
  description: "Touched by the hero: the next floor, deeper (the level is built anew: more monsters, other kinds); the hero's health goes along.",
  vars: [],
  states: [],
  handlers: [
    touched([
      { do: 'set_game', var: 'floor', value: "game_value('floor', 1) + 1" },
      { do: 'set_game', var: 'hp', value: 'other.health' },
      { do: 'restart_level' },
    ]),
  ],
};

export const GOLD_PICKUP_SCRIPT = {
  name: 'Gold pickup',
  description: "Touched by the hero: gold for the run (the game's variable gold), and gone.",
  vars: [
    { name: 'amount', value: 5, setting: true },
    { name: 'color', value: '#ffd166', setting: true },
  ],
  states: [],
  handlers: [touched([{ do: 'set_game', var: 'gold', value: "game_value('gold', 0) + amount" }, { do: 'popup', text: '+{amount} gold', color: '{color}', on: 'other' }, { do: 'remove', target: null }])],
};

export const HEALING_PICKUP_SCRIPT = {
  name: 'Healing pickup',
  description: 'Touched by the hero: health back, and gone.',
  vars: [
    { name: 'amount', value: 3, setting: true },
    { name: 'color', value: '#5fe08a', setting: true },
  ],
  states: [],
  handlers: [touched([{ do: 'heal', target: 'other', amount: 'amount' }, { do: 'popup', text: '+{amount}', color: '{color}', on: 'other' }, { do: 'remove', target: null }])],
};
