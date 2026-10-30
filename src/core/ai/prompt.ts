/** The request text sent to the model (shared by every way of reaching the AI). */
import { TOPICS } from './topics';
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
Reply with only one JSON object matching this JSON Schema (no other text). Every operation must have all of its fields; use null where a field allows it. You have no tools here: never write tool or function calls (no <invoke>, <function_calls> or other tags); every change goes in the JSON's operations.
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
    ? `FULL CODE (the full scripts of these library objects: the ones this request names, and any you asked for; use their ids and script ids as given):\n${JSON.stringify(body.code)}\n\n`
    : '';
  // Guidance only this request needs (music, sound effects…): sent with it instead of with every request.
  const topics = (body.topics ?? []).filter((t) => TOPICS[t]);
  const guide = topics.length ? `GUIDANCE FOR THIS REQUEST (part of your instructions):\n${topics.map((t) => TOPICS[t].text).join('\n')}\n\n` : '';
  return { context: `CONTEXT\n${JSON.stringify(body.context)}\n\n`, rest: `${guide}${code}${history}${picturesText(body)}REQUEST\n${body.request}` };
}

/** What the attached pictures are (they are shown with this message, in this order). */
export function picturesText(body: AIRequestBody): string {
  const pics = body.images ?? [];
  if (!pics.length) return '';
  const lines = pics.map((p, i) => {
    const scale = p.width / p.sourceWidth;
    const how = Math.abs(scale - 1) < 0.01 ? 'shown at its own size' : scale > 1 ? `shown enlarged ${Math.round(scale)}× with sharp pixels` : `shown scaled down to ${p.width}×${p.height}`;
    return `- Picture ${i + 1} ("${p.name.replace(/"/g, "'")}"): ${p.sourceWidth}×${p.sourceHeight} pixels as the user's file is, ${how}.`;
  });
  return `PICTURES THE USER ATTACHED (shown with this message, in this order; see the pictures guidance):\n${lines.join('\n')}\n\n`;
}

export function userMessage(body: AIRequestBody): string {
  const { context, rest } = userMessageParts(body);
  return context + rest;
}

/**
 * A finished reply of only words, no JSON at all ("No changes this time: the record shows…"): read as an answer that
 * changes nothing, rather than asked for again (a second request with the whole game costs as much as the first).
 * Null for anything with a brace in it, too short to be a sentence, or with markup in it (tool-call tags such as
 * <invoke name="">, which an AI sometimes writes instead of the JSON: not an answer, so it is asked for again).
 */
export function proseReply(text: string): { kind: 'answer'; message: string; changes: []; operations: []; needCode: null; starter: null } | null {
  const t = text.trim();
  if (t.length < 20 || t.includes('{') || t.split(/\s+/).length < 4) return null;
  if (/<\/?[a-z_][\w:.-]*(\s[^<>]*)?\/?>/i.test(t)) return null;
  return { kind: 'answer', message: t, changes: [], operations: [], needCode: null, starter: null };
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
