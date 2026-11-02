/**
 * A game's controls: which keys do what, for each of the game's actions (left, right, up, down, jump, action,
 * fire, menu). The game's own setting (project.settings.controls) replaces the keys of the actions it names; the
 * others keep the engine's. Used by Play, by exported games, by the key hints, and by everything the keys steer
 * (characters, scripts' key handlers, menus and the grid cursor). Game controllers and touch buttons are unchanged.
 */
export const CONTROL_ACTIONS = ['left', 'right', 'up', 'down', 'jump', 'interact', 'fire', 'menu'] as const;
export type ControlAction = (typeof CONTROL_ACTIONS)[number];
export type Controls = Partial<Record<ControlAction, string[]>>;

/** What each action is called for people ("interact" is the E key's "use" / "action"). */
export const ACTION_LABELS: Record<ControlAction, string> = {
  left: 'Left',
  right: 'Right',
  up: 'Up',
  down: 'Down',
  jump: 'Jump',
  interact: 'Action (use, talk, choose)',
  fire: 'Fire',
  menu: 'Menu / back',
};

/** The engine's own keys (KeyboardEvent.code). */
export const DEFAULT_CONTROLS: Record<ControlAction, string[]> = {
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  up: ['ArrowUp', 'KeyW'],
  down: ['ArrowDown', 'KeyS'],
  jump: ['Space', 'KeyZ'],
  interact: ['KeyE'],
  fire: ['KeyX'],
  menu: ['Escape', 'KeyP'],
};

/** Keys a game may use (everything on a usual keyboard but those the browser or the editor keep). */
const VALID = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Tab|Backspace|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Comma|Period|Slash|Semicolon|Quote|Bracket(Left|Right)|Minus|Equal|Backquote|Backslash|NumpadEnter|NumpadAdd|NumpadSubtract)$/;

const NAMES: Record<string, string> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  space: 'Space',
  spacebar: 'Space',
  ' ': 'Space',
  enter: 'Enter',
  return: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  tab: 'Tab',
  backspace: 'Backspace',
  shift: 'ShiftLeft',
  lshift: 'ShiftLeft',
  rshift: 'ShiftRight',
  ctrl: 'ControlLeft',
  control: 'ControlLeft',
  alt: 'AltLeft',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '-': 'Minus',
  '=': 'Equal',
  '`': 'Backquote',
  '\\': 'Backslash',
};

/** A key as the browser names it (KeyboardEvent.code), from that or a plain name ("W", "Space", "Up", "Esc", "5"). */
export function keyCode(name: string): string | null {
  const t = name.trim();
  if (VALID.test(t)) return t;
  const low = t.toLowerCase();
  if (NAMES[low]) return NAMES[low];
  if (/^[a-z]$/i.test(t)) return `Key${t.toUpperCase()}`;
  if (/^[0-9]$/.test(t)) return `Digit${t}`;
  // ("keyw", "digit5", "numpad2": the browser's names in other cases.)
  const m = /^(key|digit|numpad)(\w)$/i.exec(t);
  if (m) {
    const code = `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}${m[2].toUpperCase()}`;
    return VALID.test(code) ? code : null;
  }
  return null;
}

/** A key as people say it: "W", "Space", "↑", "Esc", "Left Shift". */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
  if (arrows[code]) return arrows[code];
  const words: Record<string, string> = { Escape: 'Esc', ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl', AltLeft: 'Left Alt', AltRight: 'Right Alt', Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`', Backslash: '\\' };
  return words[code] ?? code;
}

/** Every action's keys for this game (its own where it has them). */
export function controlsOf(controls: Controls | undefined): Record<ControlAction, string[]> {
  const out = { ...DEFAULT_CONTROLS };
  for (const a of CONTROL_ACTIONS) if (controls?.[a]?.length) out[a] = [...controls[a]!];
  return out;
}

/** Key → action, for reading the keyboard in play. */
export function keyMap(controls: Controls | undefined): Record<string, ControlAction> {
  const all = controlsOf(controls);
  const map: Record<string, ControlAction> = {};
  // The game's own keys first: one it gives an action is no longer the engine's key for another.
  for (const a of CONTROL_ACTIONS) if (controls?.[a]?.length) for (const k of all[a]) map[k] = a;
  for (const a of CONTROL_ACTIONS) for (const k of all[a]) map[k] ??= a;
  return map;
}

/**
 * Checks and tidies a game's controls (from the AI or the Controls window): known actions, keys a game may use (plain
 * names are read: "W", "Space", "Up"), 1-4 keys an action, no key for two actions. Returns them, or why not.
 */
export function readControls(raw: unknown): { controls: Controls } | { error: string } {
  if (raw === null || raw === undefined) return { controls: {} };
  if (typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Controls: expected an object of actions and their keys, e.g. {"jump":["W","Up"]}' };
  const out: Controls = {};
  const taken = new Map<string, string>();
  for (const [action, keys] of Object.entries(raw as Record<string, unknown>)) {
    const a = (action === 'action' || action === 'use' ? 'interact' : action) as ControlAction;
    if (!CONTROL_ACTIONS.includes(a)) return { error: `Controls: there is no action "${action}" (they are: ${CONTROL_ACTIONS.join(', ')})` };
    const list = (Array.isArray(keys) ? keys : [keys]).filter((k) => k !== null && k !== '');
    if (!list.length) continue;
    if (list.length > 4) return { error: `Controls: ${a} has more than 4 keys` };
    const codes: string[] = [];
    for (const k of list) {
      const code = typeof k === 'string' ? keyCode(k) : null;
      if (!code) return { error: `Controls: "${String(k)}" (for ${a}) is not a key a game can use` };
      const other = taken.get(code);
      if (other && other !== a) return { error: `Controls: ${keyLabel(code)} is set for both ${other} and ${a}` };
      taken.set(code, a);
      if (!codes.includes(code)) codes.push(code);
    }
    out[a] = codes;
  }
  return { controls: out };
}
