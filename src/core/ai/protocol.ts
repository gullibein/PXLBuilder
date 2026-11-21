/**
 * Wire protocol between the editor and the AI service (a server-side proxy,
 * so API keys never reach the browser).
 */
import { z } from 'zod';
import { operationSchema } from '../commands/operations';
import type { AIPayload } from './context';

export interface AIExchange {
  request: string;
  reply: string;
}

/** best: the most capable setting; fast: answers sooner, may handle hard requests less well. */
export type AISpeed = 'best' | 'fast';

/** A picture the user attached to a request (an example of the game they want, a sprite sheet…), ready to send. */
export interface AIPicture {
  /** Its file name, or "pasted picture". */
  name: string;
  mediaType: 'image/png' | 'image/jpeg';
  /** Base64, without a data: prefix. */
  data: string;
  /** As sent. */
  width: number;
  height: number;
  /** As the user's file was (what pixel sizes in it are counted in). */
  sourceWidth: number;
  sourceHeight: number;
}

/** At most this many pictures go with one request. */
export const MAX_PICTURES = 4;

export interface AIRequestBody {
  context: AIPayload;
  request: string;
  /** Default 'best'. */
  speed?: AISpeed;
  /** Recent requests in the same context (conversational memory; not authoritative). */
  history: AIExchange[];
  /**
   * Fixed reference text the app adds to the instructions (the editor's settings and what they mean): the same on
   * every request, so it is cached with the instructions instead of being sent as new input each time.
   */
  reference?: string;
  /** Guidance only some requests need (topics.ts): attached by what the request is about, or asked for (need_code "topic:<name>"). */
  topics?: string[];
  /** Other objects' code the AI asked for (kind "need_code"), sent with the request asked again. */
  code?: { id: string; name: string; scripts: unknown[]; look?: unknown }[];
  /** Pictures attached to this request (only this one: later requests get a line saying they were there). */
  images?: AIPicture[];
  /** The same pictures as text grids, for an AI that can't be sent pictures (claude.ai in the Claude app). */
  pictureGrids?: string[];
}

export const aiResponseSchema = z.object({
  kind: z
    .enum(['apply', 'preview', 'confirm', 'clarify', 'answer', 'unsupported', 'need_code', 'switch_starter'])
    .describe(
      'apply: small, explicit change. preview: larger or interpretive change. Both are applied at once as one undoable step. confirm: the operations wait for the user to say yes: message is the question (what will change and why it needs asking, e.g. turning code built into the engine into a script); on yes they are applied as they are. clarify: request too ambiguous - ask one short question, no operations. answer: a question about the game - answer it, no operations. unsupported: the engine cannot do this yet. need_code: you need the code of other objects (not sent) to answer well: list their library ids in needCode, no operations; the same request comes back at once with that code. switch_starter: only for a new game (context.newGame) whose starter does not fit the request: name the better one in starter, no operations; the same request comes back at once on that starter.',
    ),
  message: z.string().describe('One or two short sentences for the user (an explanation of why something happened may take up to four). Plain language, no engine jargon, no ids.'),
  changes: z.array(z.string()).describe('One short line per change, in plain language, e.g. "Player: 3 hearts". Empty when there are no operations.'),
  operations: z.array(operationSchema),
  needCode: z.array(z.string()).nullable().describe('need_code only: the library ids of the objects whose scripts you need (or "engine:<part>:<object id>" for a ready-made engine-part script, "look:<object id>" for an object\'s pictures with their pixels); null otherwise'),
  starter: z.enum(['platformer', 'topdown', 'rpg', 'roguelike', 'isometric']).nullable().describe('switch_starter only: the starter to build the new game on; null otherwise'),
});

export type AIResponse = z.infer<typeof aiResponseSchema>;

/** Each operation's fields, by its "op" name. */
const OPERATION_SHAPES = new Map<string, Record<string, z.ZodType>>(
  (operationSchema.options as unknown as { shape: Record<string, z.ZodType> & { op: { value: string } } }[]).map((o) => [o.shape.op.value, o.shape]),
);

/**
 * A reply written as text (not with a strict format) may leave out fields
 * that can be null: a model that skips the ones it doesn't use, or a field
 * newer than its habits (an animation's frames). Those count as null, so the
 * reply isn't thrown away over them. Anything else missing is still an error.
 */
export function fillMissingNulls(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  // Small slips that change nothing about the answer (a list written as one text, a missing empty list): read as
  // meant, rather than throwing away a whole (maybe long) answer.
  const r = raw as Record<string, unknown>;
  if (typeof r.changes === 'string') raw = { ...r, changes: r.changes.split(/\n+/).map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean) };
  else if (r.changes === undefined || r.changes === null) raw = { ...r, changes: [] };
  if ((raw as Record<string, unknown>).operations === undefined || (raw as Record<string, unknown>).operations === null) raw = { ...(raw as object), operations: [] };
  // (The whole list written as one text, the JSON of it: read as the list it is. A game's worth of work, three
  // minutes of it, was once thrown away for this: "operations: expected array, received string".)
  const listed = (raw as Record<string, unknown>).operations;
  if (typeof listed === 'string') {
    try {
      const read: unknown = JSON.parse(listed);
      if (Array.isArray(read)) raw = { ...(raw as object), operations: read };
    } catch {
      // Not a list after all: said as it is, below.
    }
  }
  if (typeof (raw as Record<string, unknown>).needCode === 'string') raw = { ...(raw as object), needCode: [(raw as Record<string, unknown>).needCode] };
  if (!('needCode' in (raw as object))) raw = { ...(raw as object), needCode: null };
  if (!('starter' in (raw as object))) raw = { ...(raw as object), starter: null };
  const ops = (raw as { operations?: unknown }).operations;
  if (!Array.isArray(ops)) return raw;
  return {
    ...(raw as object),
    operations: ops.map((op) => {
      if (!op || typeof op !== 'object') return op;
      const shape = OPERATION_SHAPES.get(String((op as { op?: unknown }).op));
      if (!shape) return op;
      const out: Record<string, unknown> = { ...op };
      for (const [k, s] of Object.entries(shape)) if (!(k in out) && s.safeParse(null).success) out[k] = null;
      return out;
    }),
  };
}

/**
 * Reads an answer into the reply format. An operation that isn't in the format (a misspelt field, a value it
 * doesn't take) is left out, and said in the answer's changes, rather than throwing away the whole answer (maybe a
 * long one: a new game's art and levels) over one line of it. Anything else wrong with the answer still fails.
 */
/**
 * The change lines of an answer as they are shown: without the ones that say nothing (empty, or the word "null",
 * "none" or "n/a" where the AI meant "no lines": a result once began with the line "null").
 */
export function tidyChanges(changes: readonly string[]): string[] {
  return changes.filter((c) => typeof c === 'string' && c.trim() !== '' && !/^\s*["'`]?(null|none|n\/a|undefined)["'`]?\.?\s*$/i.test(c));
}

export function readReply(raw: unknown): { ok: true; response: AIResponse; dropped: string[] } | { ok: false; issues: string } {
  const filled = fillMissingNulls(raw);
  const first = aiResponseSchema.safeParse(filled);
  if (first.success) return { ok: true, response: first.data, dropped: [] };
  const says = (issues: z.core.$ZodIssue[]) => issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  const ops = (filled as { operations?: unknown }).operations;
  const bad = new Set<number>();
  for (const i of first.error.issues) {
    if (i.path[0] !== 'operations' || typeof i.path[1] !== 'number' || !Array.isArray(ops)) return { ok: false, issues: says(first.error.issues) };
    bad.add(i.path[1]);
  }
  const list = ops as unknown[];
  // (Too much of it unreadable: something is wrong with the whole answer, not a line of it.)
  if (bad.size > Math.max(2, list.length / 4)) return { ok: false, issues: says(first.error.issues) };
  const dropped = [...bad].sort((a, b) => a - b).map((n) => {
    const op = list[n] as { op?: unknown; name?: unknown } | null;
    const name = String(op?.op ?? '?');
    const shape = OPERATION_SHAPES.get(name);
    const why = shape ? z.object(shape).safeParse(op) : null;
    const detail = why && !why.success ? why.error.issues.slice(0, 2).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : shape ? 'not readable' : 'no such operation';
    return `${name}${typeof op?.name === 'string' ? ` "${op.name}"` : ''} (${detail})`;
  });
  const second = aiResponseSchema.safeParse({ ...(filled as object), operations: list.filter((_, n) => !bad.has(n)) });
  if (!second.success) return { ok: false, issues: says(first.error.issues) };
  const response = second.data;
  response.changes = [...response.changes, `Not done (the app couldn't read it): ${dropped.join('; ')}`];
  return { ok: true, response, dropped };
}

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}
