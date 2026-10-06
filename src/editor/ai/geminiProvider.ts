/**
 * Google Gemini, called straight from the browser with the user's own Gemini
 * API key (from Google AI Studio). Only works where the page may contact
 * Google: PXLBuilder running on your computer, not the published claude.ai
 * app (published pages can't contact other services).
 *
 * The reply format is spelled out in the prompt (the same JSON Schema the
 * claude.ai connection uses) and Gemini is asked for JSON; the answer is
 * checked against the schema before any operation is applied, and the usual
 * "send the exact problem back once" retry applies on top.
 */
import { systemPromptWithReplyFormat, userMessage } from '../../core/ai/prompt';
import { AIUnavailableError, aiResponseSchema, type AIRequestBody, type AIResponse } from '../../core/ai/protocol';
import type { AIProvider } from '../../core/ai/provider';

const API = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  thought?: boolean;
}
interface GeminiReply {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

function headers(apiKey: string): Record<string, string> {
  // The key is the user's own, entered by them, and only ever sent to Google's API (as a header, not in the URL).
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
}

/** Answers that mean "busy or out of quota right now", worth trying another model for. */
const BUSY_STATUSES = new Set([429, 500, 503, 504]);
/** After a busy answer, go straight to the backup for this long (instead of waiting to be turned away each time). */
const BUSY_PAUSE_MS = 2 * 60_000;
const busyUntil = new Map<string, number>();

/** The model was busy (or the quota for it was used up): another model may still answer. */
class BusyError extends AIUnavailableError {}

/** A plain-language message for a failed call. */
function problem(status: number, reply: GeminiReply | null, model: string): string {
  const msg = reply?.error?.message ?? '';
  if (status === 400 && /api key/i.test(msg)) return 'Your Gemini API key was not accepted. Check it in ⋯ → AI connection.';
  if (status === 401 || status === 403) return 'Your Gemini API key was not accepted (or may not use this model). Check it in ⋯ → AI connection.';
  if (status === 404) return `The Gemini model "${model}" isn't available for your key. Pick another model in ⋯ → AI connection.`;
  if (status === 429) return `Gemini (${model}) is rate limited, or your quota for it is used up. Try again in a moment.`;
  if (BUSY_STATUSES.has(status)) return `Gemini (${model}) is busy right now (high demand). Try again in a moment.`;
  return `Gemini request failed (${status}${msg ? `: ${msg}` : ''}).`;
}

/** The JSON object in a reply (Gemini in JSON mode returns bare JSON; tolerate a ```json fence anyway). */
export function parseJsonReply(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(trimmed);
}

export class GeminiProvider implements AIProvider {
  /**
   * `backup`: the model to ask when `model` is busy (null: none). `onBackup`
   * hears when that happens, in words for the console.
   */
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly backup: string | null = null,
    private readonly onBackup?: (note: string) => void,
  ) {}

  private async call(model: string, body: AIRequestBody, signal: AbortSignal | undefined, thinkLess: boolean): Promise<{ status: number; reply: GeminiReply | null }> {
    let res: Response;
    try {
      res = await fetch(`${API}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: headers(this.apiKey),
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemPromptWithReplyFormat() }] },
          contents: [{ role: 'user', parts: [{ text: userMessage(body) }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 32768,
            // Fast: think less (models without thinking levels reject this; see ask()).
            ...(thinkLess ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
          },
        }),
      });
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new AIUnavailableError("Could not reach Gemini from this page. On claude.ai published pages can't contact other services: use Claude there, or run PXLBuilder on your computer.");
    }
    const reply = (await res.json().catch(() => null)) as GeminiReply | null;
    return { status: res.status, reply };
  }

  async respond(body: AIRequestBody, signal?: AbortSignal): Promise<AIResponse> {
    const backup = this.backup && this.backup !== this.model ? this.backup : null;
    // The chosen model was busy a moment ago: go straight to the backup for now.
    if (backup && (busyUntil.get(this.model) ?? 0) > Date.now()) return this.ask(backup, body, signal);
    try {
      return await this.ask(this.model, body, signal);
    } catch (e) {
      if (!(e instanceof BusyError) || !backup) throw e;
      busyUntil.set(this.model, Date.now() + BUSY_PAUSE_MS);
      this.onBackup?.(`Gemini: ${this.model} is busy, so ${backup} answers instead (for the next couple of minutes).`);
      return this.ask(backup, body, signal);
    }
  }

  private async ask(model: string, body: AIRequestBody, signal?: AbortSignal): Promise<AIResponse> {
    const fast = body.speed === 'fast';
    let { status, reply } = await this.call(model, body, signal, fast);
    // A model without thinking levels: ask again without that setting.
    if (fast && status === 400 && /thinking/i.test(reply?.error?.message ?? '')) ({ status, reply } = await this.call(model, body, signal, false));
    if (BUSY_STATUSES.has(status)) {
      throw new BusyError(problem(status, reply, model));
    }
    if (status !== 200 || !reply) throw new AIUnavailableError(problem(status, reply, model));
    if (reply.promptFeedback?.blockReason) throw new AIUnavailableError('Gemini declined this request.');
    const candidate = reply.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new AIUnavailableError('The AI response was incomplete. Try a smaller request.');
    if (candidate?.finishReason && !['STOP', 'FINISH_REASON_UNSPECIFIED'].includes(candidate.finishReason)) throw new AIUnavailableError(`Gemini stopped early (${candidate.finishReason.toLowerCase()}).`);
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    let raw: unknown;
    try {
      raw = parseJsonReply(text);
    } catch {
      throw new AIUnavailableError("Gemini's answer could not be read. Try again, or ask for less at once.");
    }
    const parsed = aiResponseSchema.safeParse(raw);
    if (!parsed.success) throw new AIUnavailableError("Gemini's answer was not in the expected form. Try again.");
    return parsed.data;
  }
}

/** For tests: forget which models were busy. */
export function resetGeminiBusy(): void {
  busyUntil.clear();
}

/** The Gemini models this key may use for answers (also checks the key; spends no tokens). Flash models first. */
export async function listGeminiModels(apiKey: string): Promise<{ ok: true; models: string[] } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(`${API}/models?pageSize=200`, { headers: headers(apiKey) });
  } catch {
    return { ok: false, message: "Could not reach Gemini from this page (network, or the page isn't allowed to contact other services)." };
  }
  const reply = (await res.json().catch(() => null)) as { models?: { name: string; supportedGenerationMethods?: string[] }[] } & GeminiReply | null;
  if (!res.ok || !reply) return { ok: false, message: res.status === 400 || res.status === 401 || res.status === 403 ? 'The key was not accepted.' : `Gemini answered ${res.status}.` };
  const models = (reply.models ?? [])
    .filter((m) => m.name.startsWith('models/gemini') && (m.supportedGenerationMethods ?? []).includes('generateContent'))
    .map((m) => m.name.slice('models/'.length));
  const rank = (id: string) => (/flash/.test(id) && !/lite|image|tts|audio|live|embed/.test(id) ? 0 : /flash/.test(id) ? 1 : 2);
  models.sort((a, b) => rank(a) - rank(b) || b.localeCompare(a, undefined, { numeric: true }));
  return { ok: true, models };
}
