/** The request text sent to the model (shared by every way of reaching Claude). */
import type { AIRequestBody } from './protocol';

export function userMessage(body: AIRequestBody): string {
  const history = body.history.length
    ? `Recent requests in this same context (oldest first; the project data above reflects their results):\n${body.history
        .map((h) => `- User: ${h.request}\n  You: ${h.reply}`)
        .join('\n')}\n\n`
    : '';
  return `CONTEXT\n${JSON.stringify(body.context)}\n\n${history}REQUEST\n${body.request}`;
}
