/** The request text sent to the model (shared by every way of reaching the AI). */
import { z } from 'zod';
import { componentRegistry } from '../components/builtin';
import { buildSystemPrompt } from './capabilities';
import { aiResponseSchema, type AIRequestBody } from './protocol';

let jsonInstructions: string | null = null;

/**
 * The system prompt plus the reply format spelled out as a JSON Schema, for
 * AI connections that return plain JSON (claude.ai's sample, Gemini) rather
 * than enforcing the schema themselves. The answer is checked against the
 * same schema before anything is applied.
 */
export function systemPromptWithReplyFormat(): string {
  jsonInstructions ??= `${buildSystemPrompt(componentRegistry)}

REPLY FORMAT
Reply with only one JSON object matching this JSON Schema (no other text). Every operation must have all of its fields; use null where a field allows it.
${JSON.stringify(z.toJSONSchema(aiResponseSchema))}`;
  return jsonInstructions;
}

export function userMessage(body: AIRequestBody): string {
  const history = body.history.length
    ? `Recent requests in this same context (oldest first; the project data above reflects their results):\n${body.history
        .map((h) => `- User: ${h.request}\n  You: ${h.reply}`)
        .join('\n')}\n\n`
    : '';
  return `CONTEXT\n${JSON.stringify(body.context)}\n\n${history}REQUEST\n${body.request}`;
}

/** The JSON object in a plain-JSON reply (tolerates a ```json fence around it). */
export function parseJsonReply(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    // A sentence before or after the JSON ("Here is the change: {…}"): read the object itself.
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start < 0 || end <= start || (start === 0 && end === trimmed.length - 1)) throw e;
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}
