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

export interface AIRequestBody {
  context: AIPayload;
  request: string;
  /** Default 'best'. */
  speed?: AISpeed;
  /** Recent requests in the same context (conversational memory; not authoritative). */
  history: AIExchange[];
}

export const aiResponseSchema = z.object({
  kind: z
    .enum(['apply', 'preview', 'clarify', 'answer', 'unsupported'])
    .describe(
      'apply: small, explicit change. preview: larger or interpretive change. Both are applied at once as one undoable step. clarify: request too ambiguous - ask one short question, no operations. answer: a question about the game - answer it, no operations. unsupported: the engine cannot do this yet.',
    ),
  message: z.string().describe('One or two short sentences for the user (an explanation of why something happened may take up to four). Plain language, no engine jargon, no ids.'),
  changes: z.array(z.string()).describe('One short line per change, in plain language, e.g. "Player: 3 hearts". Empty when there are no operations.'),
  operations: z.array(operationSchema),
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
  const ops = (raw as { operations?: unknown }).operations;
  if (!Array.isArray(ops)) return raw;
  return {
    ...raw,
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

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}
