/**
 * Ready-made scripts for RPGs (the turn-based kit, runtime/turns.ts, and visits to other levels): put on an object
 * by name with set_script {"ready": "RPG hero", "settings": {...}}. Every number, word and color is a setting in
 * Details, and they are ordinary scripts afterwards (the AI or the user can change any line).
 *
 * - RPG encounter: on the map, a monster (or a patch of tall grass, a cave mouth) that starts a battle when the
 *   player touches it: the game goes to the battle level, and comes back to the map as it was. Won: it is gone.
 *   Fled: it leaves the player alone for a moment.
 * - RPG hero: a party member in the battle level. On its go: a menu (Fight, Magic, Potion, Run) and then which
 *   monster. Its health and magic carry over from battle to battle (the game's own variables); knocked out, it
 *   comes back with 1 health after the battle. When no monster is left: "Victory!" and back to the map.
 * - RPG monster: a monster in the battle level. On its go it strikes a hero at random. When no hero is left: the
 *   party has fallen, and the game starts again.
 */
type Step = Record<string, unknown>;
const set = (v: string, value: string): Step => ({ do: 'set', var: v, value });
const when = (cond: string, then: Step[], otherwise: Step[] = []): Step => ({ do: 'if', cond, then, else: otherwise });
const go = (state: string): Step => ({ do: 'state', name: state });
const on = (event: string, state: string | null, steps: Step[], cond: string | null = null) => ({ when: { on: 'event', event, with: null }, state, if: cond, do: steps });
const tick = (state: string | null, cond: string | null, steps: Step[]) => ({ when: { on: 'tick' }, state, if: cond, do: steps });
/** Its health over its head, while it is in the fight. */
const hpLabel = tick(null, 'show_hp', [{ do: 'draw', id: 'hp{self.x}_{self.y}', shape: 'text', anchor: 'world', x: 'self.x', y: 'self.y - self.height / 2 - 8', w: null, h: null, text: '{self.health}/{self.max_health}', size: '10', color: '{hp_color}', object: null, alpha: null }]);
/** Moving (walking up to strike) would leave the label behind: it is drawn anew each tick, and gone with it. */
const eraseLabel = on('died', null, [{ do: 'erase', id: null }]);

export const RPG_ENCOUNTER_SCRIPT = {
  name: 'RPG encounter',
  description: 'On the map: touching it starts a battle (the battle level), and the game comes back to the map as it was. Won: it is gone; fled: it leaves the player alone for a moment.',
  vars: [
    { name: 'battle', value: 'Battle', setting: true },
    { name: 'calm', value: 2, setting: true },
    { name: 'calm_left', value: 0 },
  ],
  states: [],
  handlers: [
    tick(null, 'calm_left > 0', [set('calm_left', 'calm_left - dt')]),
    { when: { on: 'contact' }, state: null, if: "has_tag(other, 'player') and calm_left <= 0", do: [set('calm_left', 'calm'), { do: 'visit_level', level: '{battle}' }] },
    on('level_returned', null, [when("visit_result == 'won'", [{ do: 'remove', target: null }], [set('calm_left', 'calm')])]),
  ],
};

export const RPG_HERO_SCRIPT = {
  name: 'RPG hero',
  description: 'A party member in a battle: Fight, Magic, Potion or Run on its go, then which monster. Health and magic carry over between battles; a win goes back to the map.',
  vars: [
    { name: 'team', value: 'hero', setting: true },
    { name: 'foes', value: 'monster', setting: true },
    { name: 'power', value: 4, setting: true },
    { name: 'magic', value: 7, setting: true },
    { name: 'max_mp', value: 10, setting: true },
    { name: 'mp_cost', value: 3, setting: true },
    { name: 'heal', value: 8, setting: true },
    { name: 'potions', value: 3, setting: true },
    { name: 'run_chance', value: 0.5, setting: true },
    { name: 'fight_label', value: 'Fight', setting: true },
    { name: 'magic_label', value: 'Magic', setting: true },
    { name: 'item_label', value: 'Potion', setting: true },
    { name: 'run_label', value: 'Run', setting: true },
    { name: 'damage_color', value: '#ff5050', setting: true },
    { name: 'magic_color', value: '#b58cff', setting: true },
    { name: 'heal_color', value: '#5fe08a', setting: true },
    { name: 'hp_color', value: '#ffffff', setting: true },
    { name: 'show_hp', value: true, setting: true },
    { name: 'victory_text', value: 'Victory!', setting: true },
    // Experience: a level needs level x xp_step points (10, then 20, 30…); each level adds these.
    { name: 'xp_step', value: 10, setting: true },
    { name: 'hp_up', value: 4, setting: true },
    { name: 'power_up', value: 1, setting: true },
    { name: 'magic_up', value: 2, setting: true },
    { name: 'mp_up', value: 2, setting: true },
    { name: 'level_text', value: 'Level up!', setting: true },
    { name: 'level_color', value: '#ffd166', setting: true },
    { name: 'mp', value: 0 },
    { name: 'action', value: '' },
    { name: 'level', value: 1 },
    { name: 'xp', value: 0 },
  ],
  states: ['idle', 'menu', 'target', 'won'],
  handlers: [
    {
      when: { on: 'start' },
      state: null,
      if: null,
      do: [
        // How far it has grown (its level and what came with it), kept in the game's own variables.
        set('level', "game_value(self.name + '_level', 1)"),
        set('xp', "game_value(self.name + '_xp', 0)"),
        set('power', "game_value(self.name + '_power', power)"),
        set('magic', "game_value(self.name + '_magic', magic)"),
        set('max_mp', "game_value(self.name + '_max_mp', max_mp)"),
        when("game_value(self.name + '_max_hp', 0) > 0", [{ do: 'set_field', component: 'Health', field: 'maxHealth', value: "game_value(self.name + '_max_hp', 0)", on: null }]),
        // What it had after the last battle, else full.
        set('mp', "game_value(self.name + '_mp', max_mp)"),
        when("game_value(self.name + '_hp', 0) > 0", [{ do: 'set_health', target: 'self', value: "game_value(self.name + '_hp', 0)" }]),
        // The party's potions, once for the whole game.
        when("game_value('potions', -1) < 0", [{ do: 'set_game', var: 'potions', value: 'potions' }]),
        // (The first hero: the battle's spoils start at nothing, and turns begin.)
        when("turn_team == ''", [{ do: 'set_game', var: 'battle_xp', value: '0' }, { do: 'set_game', var: 'battle_gold', value: '0' }, { do: 'start_turns', teams: ['{team}', '{foes}'], pick: [] }]),
      ],
    },
    hpLabel,
    eraseLabel,
    on('unit_turn', null, [go('menu')]),
    {
      when: { on: 'enter_state' },
      state: 'menu',
      if: null,
      do: [
        {
          do: 'menu',
          title: '{self.name}  Lv {level}   HP {self.health}/{self.max_health}   MP {mp}/{max_mp}',
          items: ['{fight_label}', "{mp >= mp_cost ? '' : '-'}{magic_label}", "{game_value('potions', 0) > 0 ? '' : '-'}{item_label} x{game_value('potions', 0)}", '{run_label}'],
          cancel: false,
          at: 'bottom',
        },
      ],
    },
    // (The choice of a monster comes first: a handler that moves on to another state would otherwise have the
    // same choice taken again by the next one.)
    // Which monster: their names, in a menu (Esc goes back).
    {
      when: { on: 'enter_state' },
      state: 'target',
      if: null,
      do: [{ do: 'menu', title: "{action == 'magic' ? magic_label : fight_label}: which one?", items: ['{nth(foes, 1).name}', '{nth(foes, 2).name}', '{nth(foes, 3).name}', '{nth(foes, 4).name}', '{nth(foes, 5).name}'], cancel: true, at: 'bottom' }],
    },
    on('menu_cancelled', 'target', [go('menu')]),
    on('menu_chosen', 'target', [
      when(
        "action == 'magic'",
        [
          { do: 'set_health', target: 'nth(foes, menu_choice_number)', value: 'nth(foes, menu_choice_number).health - magic' },
          { do: 'popup', text: '-{magic}', color: '{magic_color}', on: 'nth(foes, menu_choice_number)' },
          set('mp', 'mp - mp_cost'),
        ],
        [
          { do: 'set_health', target: 'nth(foes, menu_choice_number)', value: 'nth(foes, menu_choice_number).health - power' },
          { do: 'popup', text: '-{power}', color: '{damage_color}', on: 'nth(foes, menu_choice_number)' },
        ],
      ),
      go('idle'),
      { do: 'done' },
    ]),
    on('menu_chosen', 'menu', [
      when('menu_choice_number == 1', [set('action', "'fight'"), go('target')]),
      when('menu_choice_number == 2', [set('action', "'magic'"), go('target')]),
      when('menu_choice_number == 3', [
        { do: 'heal', target: 'self', amount: 'heal' },
        { do: 'set_game', var: 'potions', value: "game_value('potions', 0) - 1" },
        { do: 'popup', text: '+{heal}', color: '{heal_color}', on: null },
        go('idle'),
        { do: 'done' },
      ]),
      when('menu_choice_number == 4', [
        when(
          'chance(run_chance)',
          [{ do: 'signal', name: 'battle_over' }, { do: 'return_level', result: "'fled'" }],
          [{ do: 'popup', text: "Can't escape!", color: '#ffffff', on: null }, go('idle'), { do: 'done' }],
        ),
      ]),
    ]),
    // Saved for the next battle (also when the party runs away).
    { when: { on: 'signal', name: 'battle_over' }, state: null, if: null, do: [{ do: 'set_game', var: '{self.name}_hp', value: 'self.health' }, { do: 'set_game', var: '{self.name}_mp', value: 'mp' }] },
    // Knocked out: back with 1 health after the battle.
    on('died', null, [{ do: 'set_game', var: '{self.name}_hp', value: '1' }]),
    // No monster left: the first hero says so, and after a moment the game goes back to the map.
    // The spoils: the gold to the party, the experience to every hero still standing (signal battle_won).
    tick('idle', 'count(foes) == 0 and nth(team, 1) == self', [
      { do: 'message', text: "{victory_text}  +{game_value('battle_xp', 0)} XP  +{game_value('battle_gold', 0)} gold", seconds: 2 },
      { do: 'set_game', var: 'gold', value: "game_value('gold', 0) + game_value('battle_gold', 0)" },
      { do: 'signal', name: 'battle_won' },
      go('won'),
    ]),
    tick('won', 'state_time > 2', [{ do: 'signal', name: 'battle_over' }, { do: 'return_level', result: "'won'" }, go('idle')]),
    {
      when: { on: 'signal', name: 'battle_won' },
      state: null,
      if: null,
      do: [
        set('xp', "xp + game_value('battle_xp', 0)"),
        // Enough for the next level (maybe several): stronger, and it says so.
        {
          do: 'repeat',
          times: '10',
          then: [
            when('xp >= level * xp_step', [
              set('xp', 'xp - level * xp_step'),
              set('level', 'level + 1'),
              { do: 'set_field', component: 'Health', field: 'maxHealth', value: 'self.max_health + hp_up', on: null },
              { do: 'heal', target: 'self', amount: 'hp_up' },
              set('power', 'power + power_up'),
              set('magic', 'magic + magic_up'),
              set('max_mp', 'max_mp + mp_up'),
              set('mp', 'max_mp'),
              { do: 'popup', text: '{level_text}', color: '{level_color}', on: null },
            ]),
          ],
        },
        { do: 'set_game', var: '{self.name}_level', value: 'level' },
        { do: 'set_game', var: '{self.name}_xp', value: 'xp' },
        { do: 'set_game', var: '{self.name}_power', value: 'power' },
        { do: 'set_game', var: '{self.name}_magic', value: 'magic' },
        { do: 'set_game', var: '{self.name}_max_mp', value: 'max_mp' },
        { do: 'set_game', var: '{self.name}_max_hp', value: 'self.max_health' },
      ],
    },
  ],
};

export const RPG_MONSTER_SCRIPT = {
  name: 'RPG monster',
  description: 'A monster in a battle: on its go it strikes a hero at random. When no hero is left, the party has fallen and the game starts again.',
  vars: [
    { name: 'team', value: 'monster', setting: true },
    { name: 'foes', value: 'hero', setting: true },
    { name: 'power', value: 3, setting: true },
    { name: 'pause', value: 0.6, setting: true },
    { name: 'damage_color', value: '#ff5050', setting: true },
    { name: 'hp_color', value: '#ffd0d0', setting: true },
    { name: 'show_hp', value: true, setting: true },
    { name: 'defeat_text', value: 'Your party has fallen...', setting: true },
    // What beating it brings the party.
    { name: 'xp', value: 5, setting: true },
    { name: 'gold', value: 3, setting: true },
    { name: 'k', value: 1 },
  ],
  states: ['idle', 'striking', 'lost'],
  handlers: [
    hpLabel,
    eraseLabel,
    on('died', null, [
      { do: 'set_game', var: 'battle_xp', value: "game_value('battle_xp', 0) + xp" },
      { do: 'set_game', var: 'battle_gold', value: "game_value('battle_gold', 0) + gold" },
    ]),
    on('unit_turn', null, [go('striking')]),
    tick('striking', 'state_time >= pause', [
      when('count(foes) > 0', [
        set('k', 'randint(1, count(foes))'),
        { do: 'set_health', target: 'nth(foes, k)', value: 'nth(foes, k).health - power' },
        { do: 'popup', text: '-{power}', color: '{damage_color}', on: 'nth(foes, k)' },
      ]),
      go('idle'),
      { do: 'done' },
    ]),
    tick('idle', 'count(foes) == 0 and nth(team, 1) == self', [{ do: 'message', text: '{defeat_text}', seconds: 2.5 }, go('lost')]),
    tick('lost', 'state_time > 2.5', [{ do: 'restart_game' }]),
  ],
};

export const RPG_SHOP_SCRIPT = {
  name: 'RPG shop',
  description: "A shopkeeper on the map: touching it opens the shop's menu (what is sold, for how much gold); a purchase takes the gold and adds the item to the party's.",
  vars: [
    { name: 'title', value: 'Shop', setting: true },
    { name: 'item_label', value: 'Potion', setting: true },
    { name: 'item', value: 'potions', setting: true },
    { name: 'price', value: 5, setting: true },
    { name: 'leave_label', value: 'Leave', setting: true },
    { name: 'thanks_text', value: 'Thank you!', setting: true },
    { name: 'calm', value: 1.5, setting: true },
    { name: 'calm_left', value: 0 },
  ],
  states: ['idle', 'open'],
  handlers: [
    tick(null, 'calm_left > 0', [set('calm_left', 'calm_left - dt')]),
    { when: { on: 'contact' }, state: 'idle', if: "has_tag(other, 'player') and calm_left <= 0", do: [go('open')] },
    {
      when: { on: 'enter_state' },
      state: 'open',
      if: null,
      do: [
        {
          do: 'menu',
          title: "{title}: you have {game_value('gold', 0)} gold",
          items: ["{game_value('gold', 0) >= price ? '' : '-'}{item_label} ({price} gold)", '{leave_label}'],
          cancel: true,
          at: 'bottom',
        },
      ],
    },
    on('menu_chosen', 'open', [
      when(
        'menu_choice_number == 1',
        [
          { do: 'set_game', var: 'gold', value: "game_value('gold', 0) - price" },
          { do: 'set_game', var: '{item}', value: 'game_value(item, 0) + 1' },
          { do: 'popup', text: '{thanks_text}', color: '#ffd166', on: null },
          // (The menu again, with the gold left.)
          go('idle'),
          go('open'),
        ],
        [set('calm_left', 'calm'), go('idle')],
      ),
    ]),
    on('menu_cancelled', 'open', [set('calm_left', 'calm'), go('idle')]),
  ],
};
