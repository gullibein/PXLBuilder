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

/** The request as two parts: the game's data (the same while the game doesn't change: cacheable) and the rest. */
export function userMessageParts(body: AIRequestBody): { context: string; rest: string } {
  const history = body.history.length
    ? `Recent requests in this same context (oldest first; the project data above reflects their results):\n${body.history
        .map((h) => `- User: ${h.request}\n  You: ${h.reply}`)
        .join('\n')}\n\n`
    : '';
  // Code the AI asked for comes after the (cached) game data, so asking again reuses the cache.
  const code = body.code?.length
    ? `FULL CODE (the full scripts of these library objects: the ones this request names, the player's, and any you asked for; use their ids and script ids as given):\n${JSON.stringify(body.code)}\n\n`
    : '';
  return { context: `CONTEXT\n${JSON.stringify(body.context)}\n\n`, rest: `${code}${history}REQUEST\n${body.request}` };
}

export function userMessage(body: AIRequestBody): string {
  const { context, rest } = userMessageParts(body);
  return context + rest;
}

/** The JSON object in a plain-JSON reply (tolerates a ```json fence around it). */
export function parseJsonReply(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let first: unknown;
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    first = e;
  }
  // Words around the JSON ("Here is the change: {…}"), several objects, or a trailing comma:
  // try each complete {…} in the text, the longest first, as it is and without trailing commas.
  const candidates = jsonObjects(trimmed).sort((a, b) => b.length - a.length);
  for (const c of candidates) {
    for (const attempt of [c, c.replace(/,(\s*[}\]])/g, '$1')]) {
      try {
        const v = JSON.parse(attempt);
        if (v && typeof v === 'object') return v;
      } catch {
        // next
      }
    }
  }
  throw first;
}

/** Every complete top-level {…} in the text (braces inside strings don't count). */
function jsonObjects(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = depth > 0;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0) out.push(text.slice(start, i + 1));
    }
  }
  return out;
}
