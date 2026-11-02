/**
 * Ready-made scripts for turn-based tactics (the turn-based kit, runtime/turns.ts), put on an object by name with
 * set_script {"ready": "Tactics unit", "settings": {...}}. Everything about them is a setting in Details, and they
 * are ordinary scripts afterwards (the AI or the user can change any line).
 *
 * - Tactics unit: a unit the player commands. The first one to start begins the turns (its team, picked by the
 *   player with the cursor, then the foes). On its go: a menu Move / Attack / Wait; Move shows where it can walk and
 *   a cursor to pick the square; Attack shows its range and a cursor to pick a foe; Esc goes back to the menu.
 * - Tactics enemy: a foe that plays by itself: on its go it walks toward the nearest unit of the other side (as far
 *   as it may), attacks it if it is within reach, and its go is over.
 */
type Step = Record<string, unknown>;
const set = (v: string, value: string): Step => ({ do: 'set', var: v, value });
const when = (cond: string, then: Step[], otherwise: Step[] = []): Step => ({ do: 'if', cond, then, else: otherwise });
const go = (state: string): Step => ({ do: 'state', name: state });
const on = (event: string, state: string | null, steps: Step[], cond: string | null = null) => ({ when: { on: 'event', event, with: null }, state, if: cond, do: steps });
/** Squares apart along the grid. */
const apart = (a: string) => `(abs(grid_cell(${a}.x) - grid_cell(self.x)) + abs(grid_cell(${a}.y) - grid_cell(self.y))) / 32`;

export const TACTICS_UNIT_SCRIPT = {
  name: 'Tactics unit',
  description: "A unit the player commands, on its side's turn: Move (where it can walk), Attack (a foe in range) or Wait.",
  vars: [
    { name: 'team', value: 'hero', setting: true },
    { name: 'foes', value: 'enemy', setting: true },
    { name: 'move', value: 4, setting: true },
    { name: 'reach', value: 1, setting: true },
    { name: 'power', value: 3, setting: true },
    { name: 'walk_speed', value: 160, setting: true },
    // What the menu says, and how the kit looks (for the whole game: the first unit to start sets it).
    { name: 'move_label', value: 'Move', setting: true },
    { name: 'attack_label', value: 'Attack', setting: true },
    { name: 'wait_label', value: 'Wait', setting: true },
    { name: 'move_color', value: '#4aa3ff', setting: true },
    { name: 'attack_color', value: '#ff5050', setting: true },
    { name: 'damage_color', value: '#ff5050', setting: true },
    { name: 'menu_color', value: '#1b2266', setting: true },
    { name: 'menu_border', value: '#e8ecff', setting: true },
    { name: 'menu_text', value: '#ffffff', setting: true },
    { name: 'menu_size', value: 14, setting: true },
    { name: 'pointer', value: '>', setting: true },
    { name: 'cursor_color', value: '#ffffff', setting: true },
    { name: 'cursor_style', value: 'square', setting: true },
    { name: 'popup_style', value: 'rise', setting: true },
    { name: 'banner', value: '{team} TURN', setting: true },
    { name: 'moved', value: 0 },
  ],
  states: ['idle', 'menu', 'pick_move', 'moving', 'pick_target'],
  handlers: [
    // (The first unit to start begins the turns; the others find them running.)
    {
      when: { on: 'start' },
      state: null,
      if: "turn_team == ''",
      do: [
        {
          do: 'kit_style',
          menu_color: '{menu_color}',
          menu_border: '{menu_border}',
          menu_text: '{menu_text}',
          menu_size: 'menu_size',
          pointer: '{pointer}',
          cursor_color: '{cursor_color}',
          cursor_style: '{cursor_style}',
          popup_style: '{popup_style}',
          banner: '{banner}',
        },
        { do: 'start_turns', teams: ['{team}', '{foes}'], pick: ['{team}'] },
      ],
    },
    on('unit_turn', null, [set('moved', '0'), go('menu')]),
    { when: { on: 'enter_state' }, state: 'menu', if: null, do: [{ do: 'menu', items: ["{moved == 1 ? '-' : ''}{move_label}", '{attack_label}', '{wait_label}'], title: null, cancel: false, at: 'bottom_left' }] },
    on('menu_chosen', 'menu', [
      when('menu_choice == move_label', [{ do: 'highlight', id: 'move', kind: 'reach', from: null, steps: 'move', min: '1', color: '{move_color}' }, { do: 'cursor', show: 'true', x: 'self.x', y: 'self.y' }, go('pick_move')]),
      when('menu_choice == attack_label', [{ do: 'highlight', id: 'attack', kind: 'range', from: null, steps: 'reach', min: '1', color: '{attack_color}' }, { do: 'cursor', show: 'true', x: 'self.x', y: 'self.y' }, go('pick_target')]),
      when('menu_choice == wait_label', [go('idle'), { do: 'done' }]),
    ]),
    on('cursor_chosen', 'pick_move', [
      when("highlighted('move', cursor_x, cursor_y)", [{ do: 'walk_to', x: 'cursor_x', y: 'cursor_y', steps: 'move', speed: 'walk_speed', on: null }, { do: 'clear_highlight', id: null }, { do: 'cursor', show: 'false', x: null, y: null }, go('moving')]),
    ]),
    on('arrived', 'moving', [set('moved', '1'), go('menu')]),
    on('cursor_chosen', 'pick_target', [
      when("highlighted('attack', cursor_x, cursor_y) and other != null and has_tag(other, foes)", [
        { do: 'set_health', target: 'other', value: 'other.health - power' },
        { do: 'popup', text: '-{power}', color: '{damage_color}', on: 'other' },
        go('idle'),
        { do: 'done' },
      ]),
    ]),
    // Esc while picking a square: back to the menu.
    on('cursor_cancelled', null, [{ do: 'clear_highlight', id: null }, { do: 'cursor', show: 'false', x: null, y: null }, go('menu')], "my_turn"),
  ],
};

export const TACTICS_ENEMY_SCRIPT = {
  name: 'Tactics enemy',
  description: 'A foe that plays by itself on its side\'s turn: walks toward the nearest unit of the other side and attacks it when in reach.',
  vars: [
    { name: 'foes', value: 'hero', setting: true },
    { name: 'move', value: 3, setting: true },
    { name: 'reach', value: 1, setting: true },
    { name: 'power', value: 2, setting: true },
    { name: 'pause', value: 0.35, setting: true },
    { name: 'walk_speed', value: 160, setting: true },
    { name: 'damage_color', value: '#ff5050', setting: true },
  ],
  states: ['idle', 'moving', 'striking'],
  handlers: [
    on('unit_turn', null, [
      when(
        'nearest(foes) == null',
        [{ do: 'done' }],
        [
          // Already in reach: no need to move.
          when(`${apart('nearest(foes)')} <= reach`, [go('striking')], [{ do: 'walk_to', x: 'nearest(foes).x', y: 'nearest(foes).y', steps: 'move', speed: 'walk_speed', on: null }, go('moving')]),
        ],
      ),
    ]),
    on('arrived', 'moving', [go('striking')]),
    // A moment to see it, then the blow (if a foe is in reach) and its go is over.
    {
      when: { on: 'tick' },
      state: 'striking',
      if: 'state_time >= pause',
      do: [
        when(`nearest(foes) != null and ${apart('nearest(foes)')} <= reach`, [{ do: 'set_health', target: 'nearest(foes)', value: 'nearest(foes).health - power' }, { do: 'popup', text: '-{power}', color: '{damage_color}', on: 'nearest(foes)' }]),
        go('idle'),
        { do: 'done' },
      ],
    },
  ],
};
