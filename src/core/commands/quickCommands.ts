/**
 * Plain editing commands typed into a prompt card: "delete", "duplicate 3
 * times to the right", "move left 2", "copy", "paste", "rename to Boss",
 * "select all coins", "undo"… The app does these itself, at once and without
 * an AI (also when none is connected). Only a prompt that is nothing but such
 * a command counts: "delete the spikes and make the platform bigger" goes to
 * the AI.
 */

export type Direction = 'left' | 'right' | 'up' | 'down';

export type QuickCommand =
  | { kind: 'delete' }
  | { kind: 'duplicate'; count: number; direction: Direction | null }
  | { kind: 'copy' }
  | { kind: 'cut' }
  | { kind: 'paste' }
  | { kind: 'move'; direction: Direction; cells: number }
  | { kind: 'rename'; name: string }
  | { kind: 'select_all'; name: string | null }
  | { kind: 'deselect' }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'help' }
  /** The built-in objects' pictures in another size: 8, 16, 32 or 64 art pixels per tile. */
  | { kind: 'sprite_resolution'; resolution: 8 | 16 | 32 | 64 };

/** For messages: what can be typed without an AI. */
export const QUICK_COMMAND_HELP =
  'delete (or erase, remove), duplicate (also "duplicate 3 times to the right"), copy, cut, paste, move left/right/up/down (also "move up 3"), rename to …, select all (also "select all coins"), deselect, undo, redo, and "make the sprites 8x8" (16x16, 32x32 or 64x64)';

const WORDS: Record<string, number> = { one: 1, once: 1, a: 1, two: 2, twice: 2, three: 3, thrice: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const number = (w: string | undefined): number | null => {
  if (!w) return null;
  if (/^\d+$/.test(w)) return Number(w);
  return WORDS[w] ?? null;
};
const DIRECTIONS: Record<string, Direction> = { left: 'left', right: 'right', up: 'up', down: 'down', above: 'up', below: 'down', upwards: 'up', downwards: 'down', higher: 'up', lower: 'down' };

// What the command is about: the selection, said in many ways (left out, it is the selection too).
const OBJECT = String.raw`(?:(?:it|this|that|them|these|those|the selection|selection|the selected(?: ones?| objects?| things?)?|selected(?: ones?| objects?| things?)?|(?:this|that|the) (?:one|object|thing)|(?:these|those|the) (?:ones|objects|things)|everything selected|all of (?:them|these|those)|both(?: of them)?)\s*)?`;
const POLITE = /^(?:(?:please|pls|can you|could you|would you|just|now|ok|okay)\s+)+|(?:\s+(?:please|pls|now|thanks|thank you))+$/g;

/** The command this prompt is, or null (then it is for the AI). */
export function parseQuickCommand(text: string): QuickCommand | null {
  const raw = text.trim().replace(/\s+/g, ' ');
  // Renaming keeps the name as typed.
  const rename =
    /^(?:please\s+)?rename(?:\s+(?:it|this|that|this one|that one|the object|the selected one))?\s+(?:to|as)\s+(.+)$/i.exec(raw) ??
    /^(?:please\s+)?rename\s+(?!it$|this$|that$)(.+)$/i.exec(raw) ??
    /^(?:please\s+)?(?:call|name)\s+(?:it|this|that|this one|that one|the object)\s+(.+)$/i.exec(raw);
  if (rename) {
    const name = rename[1].replace(/^["“'‘]|["”'’]?[.!]?$/g, '').replace(/["”'’]$/, '').trim();
    if (name && name.length <= 60) return { kind: 'rename', name };
  }
  const t = raw
    .toLowerCase()
    .replace(/[.!?,]+$/g, '')
    .replace(POLITE, '')
    .trim();
  if (!t) return null;
  const whole = (re: string) => new RegExp(`^${re}$`).exec(t);

  if (whole(String.raw`(?:help|commands|what can i (?:type|say|do)|\?)`)) return { kind: 'help' };
  // "make the sprites 8x8 pixels", "16x16 sprites", "sprite size 64"
  const size = whole(String.raw`(?:(?:make|set|change|switch|turn|use)\s+)?(?:(?:the|all|all the)\s+)?(?:(?:sprites?|pictures?|graphics)(?:\s+(?:size|resolution))?\s*(?:to\s+|be\s+|into\s+|at\s+)?(\d+)(?:\s*(?:x|×|by)\s*(\d+))?|(\d+)\s*(?:x|×|by)\s*(\d+)\s+(?:sprites?|pictures?|graphics))(?:\s*(?:pixels?|px))?(?:\s+sprites?)?`);
  if (size) {
    const a = Number(size[1] ?? size[3]);
    const b = Number(size[2] ?? size[4] ?? a);
    if (a === b && (a === 8 || a === 16 || a === 32 || a === 64)) return { kind: 'sprite_resolution', resolution: a };
    return null;
  }
  if (whole(String.raw`(?:undo|undo (?:that|it|this|the last (?:change|step|thing))|go back|take (?:that|it) back)`)) return { kind: 'undo' };
  if (whole(String.raw`(?:redo|redo (?:that|it|this))`)) return { kind: 'redo' };
  if (whole(String.raw`(?:delete|erase|remove|del|trash|bin|destroy|get rid of|throw away|throw out)\s*${OBJECT}(?:from (?:the|this) level)?`)) return { kind: 'delete' };
  if (whole(String.raw`(?:cut)\s*${OBJECT}`)) return { kind: 'cut' };
  if (whole(String.raw`(?:copy)\s*${OBJECT}`)) return { kind: 'copy' };
  if (whole(String.raw`(?:paste)(?:\s+(?:it|them|that|here|it here|them here|the copy|the copies|again))?`)) return { kind: 'paste' };
  if (whole(String.raw`(?:deselect|unselect|select none|clear (?:the )?selection|deselect all)`)) return { kind: 'deselect' };
  const all = whole(String.raw`select (?:all|everything)(?: (?:the |of the )?(.+?))?`);
  if (all) {
    const name = all[1]?.replace(/^(?:objects|things)$/, '').trim() ?? '';
    return { kind: 'select_all', name: name || null };
  }

  const dup = whole(String.raw`(?:duplicate|clone|copy and paste|make (?:a )?cop(?:y|ies)(?: of)?|make (\w+) cop(?:y|ies)(?: of)?|make (?:a|an|one|another|\w+) more(?: of)?|add (?:another|one more|a copy(?: of)?))\s*${OBJECT}(?:(\w+) times?|x\s*(\d+)|(\w+) cop(?:y|ies))?\s*(?:(?:to the|toward the|towards the|going|on the|the)?\s*(left|right|up|down|above|below|upwards|downwards))?`);
  if (dup) {
    const count = number(dup[1]) ?? number(dup[2]) ?? number(dup[3]) ?? number(dup[4]) ?? 1;
    if (count < 1 || count > 50) return null;
    return { kind: 'duplicate', count, direction: dup[5] ? DIRECTIONS[dup[5]] : null };
  }

  const move = whole(String.raw`(?:move|nudge|shift|push|put)\s*${OBJECT}(?:(\w+) (?:squares?|cells?|tiles?|blocks?|steps?|spaces?)?\s*)?(?:to the |toward the |towards the |further |more )?(left|right|up|down|above|below|upwards|downwards|higher|lower)(?:\s+(?:by )?(\w+)(?: (?:squares?|cells?|tiles?|blocks?|steps?|spaces?))?)?`);
  if (move) {
    const cells = number(move[1]) ?? number(move[3]) ?? 1;
    if ((move[1] && number(move[1]) === null) || (move[3] && number(move[3]) === null) || cells < 1 || cells > 200) return null;
    return { kind: 'move', direction: DIRECTIONS[move[2]], cells };
  }
  return null;
}

/** One grid step in a direction. */
export function stepOf(direction: Direction, grid: number): { x: number; y: number } {
  return { left: { x: -grid, y: 0 }, right: { x: grid, y: 0 }, up: { x: 0, y: -grid }, down: { x: 0, y: grid } }[direction];
}
