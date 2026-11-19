/**
 * The one Claude call, shared by the dev server (key from the environment)
 * and the browser (a key the user entered), so both behave identically:
 * same model, system prompt, structured output and error meanings.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { betaJSONSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/beta/json-schema';
import { compactSchema, expandReply } from './compactSchema';
import { readCutOff } from './cutOff';
import { componentRegistry } from '../components/builtin';
import { buildSystemPrompt } from './capabilities';
import { parseJsonReply, proseReply, systemPromptWithReplyFormat, userMessageParts } from './prompt';
import { aiResponseSchema, type AIRequestBody, type AIResponse, readReply } from './protocol';

export const MODEL = 'claude-opus-5-5';

/**
 * The Claude models an Anthropic key can be used with here, and what they cost (US$ per million tokens, Anthropic's
 * price list). Opus is the default; the others cost less and may get hard requests wrong more often.
 */
export const CLAUDE_MODELS = {
  'claude-opus-5-5': { name: 'Claude Opus 5.5', input: 4, output: 20 },
  'claude-sonnet-5-5': { name: 'Claude Sonnet 5.5', input: 2, output: 10 },
  'claude-haiku-5-5': { name: 'Claude Haiku 5.5', input: 0.1, output: 0.5 },
} as const;
export type ClaudeModel = keyof typeof CLAUDE_MODELS;
export const isClaudeModel = (m: unknown): m is ClaudeModel => typeof m === 'string' && m in CLAUDE_MODELS;

/** What one request used and cost (from the token counts the API reports). */
export interface ClaudeUsage {
  model: string;
  inputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  /** US$; null for a model not in CLAUDE_MODELS (a fallback model, say). */
  cost: number | null;
}

/**
 * The price of a request: normal input, cache writes (1.25× input for 5 minutes, 2× for an hour), cache reads
 * (0.1× input) and output (thinking included).
 */
export function usageCost(model: string, u: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number } | null }): ClaudeUsage {
  const price = isClaudeModel(model) ? CLAUDE_MODELS[model] : null;
  const write = u.cache_creation_input_tokens ?? 0;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const write5m = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens ?? 0) : write - write1h;
  const read = u.cache_read_input_tokens ?? 0;
  const cost = price ? (u.input_tokens * price.input + write5m * price.input * 1.25 + write1h * price.input * 2 + read * price.input * 0.1 + u.output_tokens * price.output) / 1e6 : null;
  return { model, inputTokens: u.input_tokens, cacheWriteTokens: write, cacheReadTokens: read, outputTokens: u.output_tokens, cost };
}

let systemPrompt: string | null = null;

export type ClaudeResult = ({ ok: true; response: AIResponse } | { ok: false; status: number; error: string; kind: 'auth' | 'rate' | 'other' }) & { usage?: ClaudeUsage };

/** What happened along the way that the user (or a bug report) should be able to see: told to the console. */
export type ClaudeNote = (message: string) => void;

/**
 * What this account's API key accepts, learned from rejected requests (kept
 * while the app runs): the server-side refusal fallback is a beta feature an
 * organization may not be enabled for, and the reply format may be refused as
 * a structured-output schema. Either is then left out and the same request
 * sent again, so the AI keeps working; answers are validated the same way.
 */
const accepted = { fallbacks: new Set<string>(), format: new Map<string, 'compact' | 'tool'>(), smallOutput: new Set<string>() };

/**
 * The room an answer has, thinking included. The most the current models give (a whole game, or a board game's
 * rules in one script, with the thinking before it, ran into 64,000 and the whole answer was lost). A model that
 * refuses it is asked with the smaller one from then on.
 */
export const MAX_OUTPUT = 128_000;
const SMALL_OUTPUT = 64_000;

/** Which reply format each model was found to take (missing: the full strict format). Kept by the browser for a while. */
export function claudeFormats(): Record<string, 'compact' | 'tool'> {
  return Object.fromEntries(accepted.format);
}

/** What an earlier visit found out (so a visit doesn't ask with formats the model refuses, twice, before answering). */
export function rememberClaudeFormats(formats: Record<string, unknown>): void {
  for (const [model, level] of Object.entries(formats)) if (level === 'compact' || level === 'tool') accepted.format.set(model, level);
}

/** For tests: assume everything is accepted again. */
export function resetClaudeFeatures(): void {
  accepted.fallbacks.clear();
  accepted.format.clear();
  accepted.smallOutput.clear();
}

/**
 * An answer that didn't arrive whole (cut off at the length limit, or the connection lost while it was written):
 * the operations that did arrive whole are kept and applied, saying first that the rest is missing (minutes of work
 * and their price were lost for the last lines). Null: not one arrived.
 */
function keepWhatArrived(text: string, why: string, note: ClaudeNote, expand: (v: unknown) => unknown = (v) => v): ClaudeResult | null {
  const cut = readCutOff(text);
  if (!cut) return null;
  const parsed = readReply(expand(cut.reply));
  if (!parsed.ok || !parsed.response.operations.length) return null;
  const n = parsed.response.operations.length;
  const said = `⚠ The AI's answer ${why}: its first ${n} change${n === 1 ? '' : 's'} arrived whole and ${n === 1 ? 'is' : 'are'} applied, the rest is missing. Ask it to finish the rest (or ask for less at once).`;
  note(`Kept the ${n} operation(s) that arrived whole.`);
  return { ok: true, response: { ...parsed.response, kind: 'preview', message: `${said}${parsed.response.message ? `\n\n${parsed.response.message}` : ''}`, changes: [said, ...parsed.response.changes] } };
}

/** What has arrived of the answer being written (for when it never ends). */
interface Arriving {
  text: string;
  tool: string;
  compact: boolean;
}

/** Asks Claude for structured operations. Never throws for API problems: they come back as plain-language errors. */
export async function askClaude(client: Anthropic, body: AIRequestBody, signal?: AbortSignal, model: ClaudeModel = MODEL, note: ClaudeNote = () => undefined, draft?: (soFar: string, channel?: string) => void): Promise<ClaudeResult> {
  if (typeof body?.request !== 'string' || !body.request.trim() || typeof body.context !== 'object') {
    return { ok: false, status: 400, error: 'Missing request or context', kind: 'other' };
  }
  for (;;) {
    const arriving: Arriving = { text: '', tool: '', compact: false };
    try {
      return await callClaude(client, body, model, signal, note, draft, arriving);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        const why = apiErrorText(e);
        if (!accepted.smallOutput.has(model) && /max_tokens/i.test(why)) {
          accepted.smallOutput.add(model);
          note(`${CLAUDE_MODELS[model].name} did not take ${MAX_OUTPUT.toLocaleString('en-US')} tokens of room for its answer (${why}); asking with ${SMALL_OUTPUT.toLocaleString('en-US')}.`);
          continue;
        }
        // (Per model: a model with no fallback, such as Haiku, refuses the parameter; the others keep it.)
        if (!accepted.fallbacks.has(model) && /fallback|beta/i.test(why)) {
          accepted.fallbacks.add(model);
          note(`${CLAUDE_MODELS[model].name} did not take the refusal fallback (${why}); asking without it.`);
          continue;
        }
        // (Per model: one model refusing the strict reply format says nothing about the others.) Refused, the
        // compact strict format is tried (it fits much smaller limits, e.g. Sonnet's); refused too, the reply tool.
        const level = accepted.format.get(model);
        if (level !== 'tool' && /output_config|format|schema|grammar|union|optional parameters|too complex/i.test(why)) {
          const next = level === 'compact' ? 'tool' : 'compact';
          accepted.format.set(model, next);
          note(
            next === 'compact'
              ? `${CLAUDE_MODELS[model].name} did not take the full strict reply format (${why}); using its compact form instead, for the rest of this visit.`
              : `${CLAUDE_MODELS[model].name} did not take the compact strict reply format either (${why}); asking it to answer with a reply tool instead, for the rest of this visit.`,
          );
          continue;
        }
      }
      // The connection lost while the answer was being written (a long one takes minutes): what arrived whole is
      // kept; with nothing whole, the error says what happened instead of a bare "network error".
      const aborted = (e as Error).name === 'AbortError' || e instanceof Anthropic.APIUserAbortError;
      const lost = !aborted && !(e instanceof Anthropic.APIError && typeof e.status === 'number') && (arriving.text || arriving.tool);
      if (lost) {
        note(`The connection was lost while ${CLAUDE_MODELS[model].name} was writing its answer (${(e as Error).message || 'no details'}); ${(arriving.tool || arriving.text).length.toLocaleString('en-US')} characters had arrived.`);
        const kept = keepWhatArrived(arriving.tool || arriving.text, 'was interrupted (the connection was lost while it was being written)', note, arriving.compact ? (v) => expandReply(v, fullFormat()) : undefined);
        if (kept) return kept;
        return { ok: false, status: 502, error: `The connection to the AI was lost while it was writing its answer (${(e as Error).message || 'network error'}), before any complete change had arrived: nothing was changed. Try again; if it keeps happening, ask for less at once.`, kind: 'other' };
      }
      return failure(e);
    }
  }
}

async function callClaude(client: Anthropic, body: AIRequestBody, model: ClaudeModel, signal: AbortSignal | undefined, note: ClaudeNote, draft: ((soFar: string, channel?: string) => void) | undefined, arriving: Arriving): Promise<ClaudeResult> {
  // Fast: the same model thinking less (the biggest part of the wait).
  const effort = body.speed === 'fast' ? ('low' as const) : ('medium' as const);
  // The game's data is its own block, cached: a second request with the same game (the answer sent back to be fixed,
  // or another question before anything changed) reads it at a tenth of the price instead of paying for it again.
  const { context, rest } = userMessageParts(body);
  const common = {
    model,
    // Room for big answers (a whole game, many drawings at once); the request is streamed, so a long one doesn't time out.
    max_tokens: accepted.smallOutput.has(model) ? SMALL_OUTPUT : MAX_OUTPUT,
    messages: [
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: context, cache_control: { type: 'ephemeral' as const } },
          // Pictures the user attached (after the cached game data: they come with this request only).
          ...(body.images ?? []).map((p) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: p.mediaType, data: p.data } })),
          { type: 'text' as const, text: rest },
        ],
      },
    ],
    ...(!accepted.fallbacks.has(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
  };
  // The system prompt (the same for every request, about 25,000 tokens) is cached for an hour, not 5 minutes, so a
  // pause between prompts doesn't mean paying to write it again.
  // (The app's fixed reference, if any, follows it and is cached with it.)
  const cachedSystem = (text: string) => [
    ...(body.reference ? [{ type: 'text' as const, text }] : []),
    { type: 'text' as const, text: body.reference ?? text, cache_control: { type: 'ephemeral' as const, ttl: '1h' as const } },
  ];
  // Streamed (a long answer takes minutes), and the whole message read at the end: the same message parse/create give.
  // (Whoever wants the answer as it is written hears it: its text so far, and a reply tool's input so far.)
  // (A reply tool's input is also kept as it was written: of an answer cut off inside it, the message holds only
  // what could be guessed of it.)
  const send = <P extends Parameters<typeof client.beta.messages.stream>[0]>(params: P) => {
    const stream = client.beta.messages.stream(params, { signal });
    arriving.text = '';
    arriving.tool = '';
    if (typeof stream.on === 'function') {
      stream.on('text', (_delta, soFar) => {
        arriving.text = soFar;
        draft?.(soFar, 'text');
      });
      stream.on('inputJson', (delta) => {
        arriving.tool += delta;
        draft?.(arriving.tool, 'tool');
      });
    }
    return stream.finalMessage();
  };
  const used = (r: { model?: string; usage?: Parameters<typeof usageCost>[1] }) => (r.usage ? usageCost(r.model ?? model, r.usage) : undefined);
  const declined: ClaudeResult = { ok: true, response: { kind: 'unsupported', message: 'The AI declined this request.', changes: [], operations: [], needCode: null, starter: null } };
  const incomplete: ClaudeResult = { ok: false, status: 502, error: 'The AI response was incomplete. Try a smaller request.', kind: 'other' };
  const salvaged = (text: string, expand?: (v: unknown) => unknown) => keepWhatArrived(text, 'was cut off at the length limit', note, expand);

  const level = accepted.format.get(model);
  if (level === 'compact') {
    arriving.compact = true;
    systemPrompt ??= buildSystemPrompt(componentRegistry);
    const response = await send({
      ...common,
      output_config: { effort, format: betaJSONSchemaOutputFormat(compactFormat() as Parameters<typeof betaJSONSchemaOutputFormat>[0]) },
      system: cachedSystem(systemPrompt + COMPACT_NOTE),
    });
    const usage = used(response);
    const withUsage = <T extends ClaudeResult>(r: T): T => (usage ? { ...r, usage } : r);
    if (response.stop_reason === 'refusal') return withUsage(declined);
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      note(`${CLAUDE_MODELS[model].name}'s answer ${response.stop_reason === 'max_tokens' ? `reached the length limit (${common.max_tokens} tokens)` : 'did not fit the reply format'}. It began: ${replyText(response).slice(0, 600)}`);
      return withUsage((response.stop_reason === 'max_tokens' ? salvaged(replyText(response), (v) => expandReply(v, fullFormat())) : null) ?? incomplete);
    }
    const parsed = readReply(expandReply(response.parsed_output, fullFormat()));
    if (!parsed.ok) {
      note(`${CLAUDE_MODELS[model].name}'s answer (compact format) did not read back into the reply format: ${parsed.issues}`);
      return withUsage({ ok: false, status: 502, error: "The AI's answer was not in the expected form. Try again.", kind: 'other' });
    }
    if (parsed.dropped.length) note(`Left out of ${CLAUDE_MODELS[model].name}'s answer, not in the reply format: ${parsed.dropped.join('; ')}`);
    return withUsage({ ok: true, response: parsed.response });
  }
  if (!level) {
    systemPrompt ??= buildSystemPrompt(componentRegistry);
    const response = await send({
      ...common,
      output_config: { effort, format: betaZodOutputFormat(aiResponseSchema) },
      system: cachedSystem(systemPrompt),
    });
    const usage = used(response);
    const withUsage = <T extends ClaudeResult>(r: T): T => (usage ? { ...r, usage } : r);
    if (response.stop_reason === 'refusal') return withUsage(declined);
    if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
      note(`${CLAUDE_MODELS[model].name}'s answer ${response.stop_reason === 'max_tokens' ? `reached the length limit (${common.max_tokens} tokens)` : 'did not fit the reply format'}. It began: ${replyText(response).slice(0, 600)}`);
      return withUsage((response.stop_reason === 'max_tokens' ? salvaged(replyText(response)) : null) ?? incomplete);
    }
    return withUsage({ ok: true, response: response.parsed_output });
  }

  // Without the strict format: Claude is offered a "reply" tool whose input is the reply format (it can't be forced
  // to call it on current models, so it is asked to), and a plain JSON answer is read too. A reply that starts writing
  // tool calls as text (a known failure of these models) is stopped there instead of running to the length limit.
  const system = cachedSystem(systemPromptWithReplyFormat() + REPLY_TOOL_NOTE);
  const ask = (messages: typeof common.messages | (typeof common.messages[number] | { role: 'assistant' | 'user'; content: unknown })[]) =>
    send({ ...common, messages: messages as typeof common.messages, output_config: { effort }, system, tools: [replyTool()], tool_choice: { type: 'auto' }, stop_sequences: FAKE_TOOL_CALL });
  let response = await ask(common.messages);
  let usage = used(response);
  const withUsage = <T extends ClaudeResult>(r: T): T => (usage ? { ...r, usage } : r);
  if (response.stop_reason === 'refusal') return withUsage(declined);
  const cutOff = () => {
    const inTool = response.content.some((b) => b.type === 'tool_use');
    note(`${CLAUDE_MODELS[model].name}'s answer reached the length limit (${common.max_tokens} tokens${inTool ? ', written into the reply tool' : ''}). It began: ${replyText(response).slice(0, 600) || '(no text)'}`);
    return withUsage(salvaged(inTool ? arriving.tool : replyText(response)) ?? incomplete);
  };
  if (response.stop_reason === 'max_tokens') return cutOff();
  if (response.stop_reason === 'stop_sequence') note(`${CLAUDE_MODELS[model].name} began writing a tool call as text; stopped it there.`);
  let text = replyText(response);
  // A finished reply of only words is an answer (never one stopped where it began writing a tool call).
  let raw: unknown = toolReply(response) ?? (response.stop_reason === 'stop_sequence' ? null : proseReply(text));
  if (raw === null) try {
    raw = parseJsonReply(text);
  } catch (e) {
    // Not readable: said in the console (with what came back), and asked once more for it as valid JSON.
    const problem = (e as Error).message;
    note(`${CLAUDE_MODELS[model].name}'s answer couldn't be read (${problem}); asking it to send it again. It began: ${text.slice(0, 600)}`);
    response = await ask([
      ...common.messages,
      { role: 'assistant', content: text.trim() || '(no answer)' },
      { role: 'user', content: `That answer could not be read (${problem}), so nothing was changed. Send the whole answer again by calling the reply tool once, with the reply object as its input. Do not write tool calls or XML tags as text.` },
    ]);
    const more = used(response);
    if (usage && more) usage = { ...more, inputTokens: usage.inputTokens + more.inputTokens, cacheReadTokens: usage.cacheReadTokens + more.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens + more.cacheWriteTokens, outputTokens: usage.outputTokens + more.outputTokens, cost: usage.cost !== null && more.cost !== null ? usage.cost + more.cost : null };
    if (response.stop_reason === 'max_tokens') return cutOff();
    if (response.stop_reason === 'stop_sequence') note(`${CLAUDE_MODELS[model].name} began writing a tool call as text again; stopped it there.`);
    text = replyText(response);
    try {
      raw = toolReply(response) ?? parseJsonReply(text);
    } catch (e2) {
      note(`Still not readable (${(e2 as Error).message}). It began: ${text.slice(0, 600)}`);
      return withUsage({ ok: false, status: 502, error: "The AI's answer could not be read (twice; the Console shows what came back). Try again, or ask for less at once.", kind: 'other' });
    }
  }
  const parsed = readReply(raw);
  if (!parsed.ok) {
    note(`${CLAUDE_MODELS[model].name}'s answer was read, but not in the reply format: ${parsed.issues}`);
    return withUsage({ ok: false, status: 502, error: "The AI's answer was not in the expected form. Try again.", kind: 'other' });
  }
  if (parsed.dropped.length) note(`Left out of ${CLAUDE_MODELS[model].name}'s answer, not in the reply format: ${parsed.dropped.join('; ')}`);
  return withUsage({ ok: true, response: parsed.response });
}

let fullFormatSchema: Record<string, unknown> | null = null;
/** The reply format as JSON Schema. */
function fullFormat(): Record<string, unknown> {
  fullFormatSchema ??= z.toJSONSchema(aiResponseSchema) as Record<string, unknown>;
  return fullFormatSchema;
}
let compactFormatSchema: Record<string, unknown> | null = null;
/** Its compact form (core/ai/compactSchema.ts), for models whose strict format allows fewer null-or-value fields. */
function compactFormat(): Record<string, unknown> {
  compactFormatSchema ??= compactSchema(fullFormat());
  return compactFormatSchema;
}

const COMPACT_NOTE = `

REPLY FORMAT NOTE
In this reply format, a field that this guide says may be null is written differently: a text field is "" (an empty string) for none, and any other field (a number, true/false, a list, an object) is left out for none. needCode is left out unless kind is need_code; starter is "" unless kind is switch_starter.`;

const REPLY_TOOL_NOTE = `

HOW TO ANSWER
Call the reply tool exactly once, with the whole reply object (the REPLY FORMAT above) as its input. Write no other text, and never write tool calls or XML tags as text.`;

/** A reply written as tool-call markup in the text: stopped at its start (the model is asked again). */
const FAKE_TOOL_CALL = ['<invoke', '<function_calls'];

let replyToolDef: { name: string; description: string; input_schema: { type: 'object'; [k: string]: unknown } } | null = null;
/** The reply format as a tool (its input is checked here, against the same schema, so it needs no strict mode). */
function replyTool() {
  if (!replyToolDef) {
    const { $schema: _schema, ...schema } = z.toJSONSchema(aiResponseSchema) as Record<string, unknown>;
    replyToolDef = { name: 'reply', description: 'Send your answer to the app: the whole reply object, once.', input_schema: { ...schema, type: 'object' } };
  }
  return replyToolDef;
}

/** The reply tool's input, if the answer called it. */
function toolReply(response: { content: { type: string; name?: string; input?: unknown }[] }): unknown | null {
  const call = response.content.find((b) => b.type === 'tool_use' && b.name === 'reply');
  return call ? call.input : null;
}

/** The text of a reply (its text blocks). */
function replyText(response: { content: { type: string; text?: string }[] }): string {
  return response.content.map((b) => (b.type === 'text' ? (b.text ?? '') : '')).join('');
}

function failure(e: unknown): ClaudeResult {
  if ((e as Error).name === 'AbortError' || e instanceof Anthropic.APIUserAbortError) throw e;
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return { ok: false, status: 401, error: 'The Anthropic API key was not accepted.', kind: 'auth' };
  }
  if (e instanceof Anthropic.RateLimitError) return { ok: false, status: 429, error: 'The AI is rate limited. Try again in a moment.', kind: 'rate' };
  if (e instanceof Anthropic.APIConnectionError) return { ok: false, status: 502, error: 'Could not reach the Anthropic API (network or browser blocked the request).', kind: 'other' };
  if (e instanceof Anthropic.BadRequestError && /credit balance/i.test(apiErrorText(e))) {
    // The API is billed separately from a Claude subscription (Pro, Max): prepaid credits in the Console.
    return {
      ok: false,
      status: 402,
      error: 'Your Anthropic API account has no credit left. The API is paid separately from a Claude subscription: add credits at console.anthropic.com → Billing, or use PXLBuilder on claude.ai, where the AI runs on your Claude subscription.',
      kind: 'other',
    };
  }
  if (e instanceof Anthropic.APIError) return { ok: false, status: 502, error: `AI request failed (${e.status ?? 'network'}): ${apiErrorText(e)}`, kind: 'other' };
  const message = (e as Error).message ?? '';
  if (/api key|apiKey|credentials|authentication/i.test(message)) return { ok: false, status: 401, error: 'No Anthropic API key found.', kind: 'auth' };
  return { ok: false, status: 500, error: `AI request failed: ${message}`, kind: 'other' };
}

/** Anthropic's own explanation of a failed request (and its id, for support), instead of a bare status code. */
export function apiErrorText(e: InstanceType<typeof Anthropic.APIError>): string {
  const body = e.error as { error?: { message?: unknown } } | undefined;
  const message = typeof body?.error?.message === 'string' ? body.error.message : e.message.replace(/^\d{3}\s+/, '');
  return `${message || 'no details given'}${e.requestID ? ` (request ${e.requestID})` : ''}`;
}
