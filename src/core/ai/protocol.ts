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

export class AIUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}
