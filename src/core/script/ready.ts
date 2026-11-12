/**
 * Ready-made scripts the AI (or anyone) can put on an object by name, with only the settings that differ:
 * set_script with {"ready": "Swooper", "settings": {"entry": "right"}}. The app writes out the whole script, so the
 * AI doesn't spend minutes writing (and possibly mistyping) one it would copy anyway. It is an ordinary script
 * afterwards: every line can be read and changed.
 */
import { ModelError } from '../model/mutations';
import { SWOOPER_SCRIPT } from './swooper';
import { ENEMY_SCRIPTS } from './enemies';
import { SPRING_SCRIPT } from './spring';
import { hurtsScript, stompScript } from '../model/ruleScripts';

/** A rule script as a ready-made one (no id of its own: each use gets one). */
const ready = (s: { id?: string } & Record<string, unknown>) => {
  const { id: _id, ...rest } = s;
  return rest;
};
import { TACTICS_ENEMY_SCRIPT, TACTICS_UNIT_SCRIPT } from './tactics';
import { GOLD_PICKUP_SCRIPT, HEALING_PICKUP_SCRIPT, ROGUELIKE_HERO_SCRIPT, ROGUELIKE_MONSTER_SCRIPT, STAIRS_DOWN_SCRIPT } from './roguelike';
import { RPG_ENCOUNTER_SCRIPT, RPG_HERO_SCRIPT, RPG_MONSTER_SCRIPT, RPG_SHOP_SCRIPT } from './rpg';

type Script = { name: string; vars: { name: string; value: unknown; setting?: boolean }[] } & Record<string, unknown>;

export const READY_SCRIPTS: Record<string, Script> = { Swooper: SWOOPER_SCRIPT as Script, 'Tactics unit': TACTICS_UNIT_SCRIPT as Script, 'Tactics enemy': TACTICS_ENEMY_SCRIPT as Script,
  'RPG encounter': RPG_ENCOUNTER_SCRIPT as Script,
  'RPG hero': RPG_HERO_SCRIPT as Script,
  'RPG monster': RPG_MONSTER_SCRIPT as Script,
  'RPG shop': RPG_SHOP_SCRIPT as Script,
  'Roguelike hero': ROGUELIKE_HERO_SCRIPT as Script,
  'Roguelike monster': ROGUELIKE_MONSTER_SCRIPT as Script,
  'Stairs down': STAIRS_DOWN_SCRIPT as Script,
  'Gold pickup': GOLD_PICKUP_SCRIPT as Script,
  'Healing pickup': HEALING_PICKUP_SCRIPT as Script,
  ...(ENEMY_SCRIPTS as Record<string, Script>),
  Spring: SPRING_SCRIPT as Script,
  // The side-view rules: landing on it defeats it (or takes hits), touching it hurts the player.
  Stomp: ready(stompScript({ by: ['player'], bounce: 320, hits: 0 }) as never) as Script,
  'Hurts on touch': ready(hurtsScript({ amount: 1, who: ['player'] }) as never) as Script,
};

/** The script a set_script stands for: a ready-made one by name (its settings given), or the script as written. */
export function expandReadyScript(value: Record<string, unknown>): Record<string, unknown> {
  if (typeof value.ready !== 'string') return value;
  const base = READY_SCRIPTS[value.ready];
  if (!base) throw new ModelError(`There is no ready-made script "${value.ready}" (there are: ${Object.keys(READY_SCRIPTS).join(', ')})`);
  const settings = (value.settings ?? {}) as Record<string, unknown>;
  if (typeof settings !== 'object' || Array.isArray(settings)) throw new ModelError(`Ready-made script "${value.ready}": settings must be an object of setting names and values`);
  const names = base.vars.filter((v) => v.setting).map((v) => v.name);
  for (const k of Object.keys(settings)) if (!names.includes(k)) throw new ModelError(`Ready-made script "${value.ready}" has no setting "${k}" (its settings: ${names.join(', ')})`);
  const script = structuredClone(base);
  script.vars = script.vars.map((v) => (v.name in settings ? { ...v, value: settings[v.name] } : v));
  if (typeof value.id === 'string') script.id = value.id;
  if (typeof value.name === 'string' && value.name) script.name = value.name;
  return script;
}
