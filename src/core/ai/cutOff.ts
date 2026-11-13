/**
 * An answer cut off by the length limit is not thrown away: every operation in it that arrived complete is kept,
 * and the AI is asked for the rest (its answer continued), so minutes of work (a whole game's drawings) aren't lost
 * for the last few lines.
 */

/** What arrived complete of a cut-off answer: its fields, and the operations before the cut. */
export interface CutOffReply {
  reply: Record<string, unknown> & { operations: Record<string, unknown>[] };
}

/**
 * The cut-off answer read up to its last complete operation (null when not even one arrived, or it can't be read).
 * The answer is one JSON object with an "operations" list; it is closed after the last operation that came whole.
 */
export function readCutOff(text: string): CutOffReply | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  // Where an element of a list in the top object ended (the stack: the object, then the list).
  const cuts: number[] = [];
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      stack.pop();
      if (c === '}' && stack.length === 2 && stack[0] === '{' && stack[1] === '[') cuts.push(i + 1);
      if (!stack.length) return null; // (Not cut off after all.)
    }
  }
  // The last cut inside the operations list (other lists, "changes", hold strings, not objects), else an earlier one.
  for (let k = cuts.length - 1; k >= 0 && k >= cuts.length - 3; k--) {
    try {
      const v = JSON.parse(`${text.slice(start, cuts[k])}]}`) as Record<string, unknown>;
      if (!Array.isArray(v.operations) || !v.operations.length) continue;
      const ops = v.operations.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && typeof (o as { op?: unknown }).op === 'string');
      if (!ops.length) continue;
      return { reply: { kind: 'preview', message: '', changes: [], needCode: null, starter: null, ...v, operations: ops } };
    } catch {
      // an earlier one
    }
  }
  return null;
}

/** The operations so far, as the AI is shown them again: drawings' pixels left out (it drew them; they arrived). */
export function shortened(ops: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return ops.map((o) => {
    if (o.op !== 'draw_sprite' && o.op !== 'draw_autotile' && o.op !== 'paint_background') return o;
    const s: Record<string, unknown> = { ...o };
    if (Array.isArray(s.rows)) s.rows = ['(drawn: arrived in full)'];
    if (Array.isArray(s.frames)) s.frames = [['(drawn)']];
    if (Array.isArray(s.tiles)) s.tiles = (s.tiles as { index?: unknown }[]).map((t) => ({ index: t.index, rows: ['(drawn)'] }));
    return s;
  });
}

/** What the AI is told when its answer was cut off: send only the operations still to come. */
export function continueRequest(done: number, last: Record<string, unknown>): string {
  const what = [last.op, typeof last.name === 'string' ? `"${last.name}"` : null, typeof last.id === 'string' ? last.id : null].filter(Boolean).join(' ');
  return `Your answer above was cut off by the length limit. Its first ${done} operation${done === 1 ? '' : 's'} (up to and including ${what}) arrived complete and will be applied (drawings are shortened above only to save space; they arrived in full). Send ONLY THE REST, as one JSON object in the same reply format: the same kind, message "" and changes [] (the ones above are kept), and operations = the operations that were still to come after that one, in order, not repeating any. Refs and ids from the operations above can be used. Keep it compact: draw nothing again, and give animation frames only where they differ.`;
}
