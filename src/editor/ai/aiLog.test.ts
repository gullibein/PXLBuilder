import { describe, expect, it, vi } from 'vitest';

/** A browser storage stand-in holding what an earlier visit saved. */
function storage(saved: Record<string, string>) {
  const data = new Map(Object.entries(saved));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
}

const entry = (id: number, key: string, request: string, extra: Record<string, unknown> = {}) => ({
  id,
  time: id * 1000,
  key,
  where: 'Player',
  request,
  status: 'applied',
  message: `Did ${request}`,
  changes: [],
  warn: false,
  transactionId: 7,
  undone: false,
  note: null,
  ...extra,
});

describe('AI conversations (kept in the AI History log)', () => {
  it('survive a reload: the AI is reminded of the last exchanges about the same thing, with failures and the app\'s notes', async () => {
    const store = storage({
      'pxlbuilder.aiLog': JSON.stringify([
        entry(1, 'entity:p', 'Make the player a green lizard', { changes: ['Player: new look', "⚠ Left out one part that couldn't be applied: Sprite: All sprite rows must be the same length"] }),
        entry(2, 'entity:e', 'Make the enemy faster'),
        entry(3, 'entity:p', 'It did not change!', { status: 'error', message: "The AI's answer was too long and got cut off." }),
      ]),
    });
    vi.stubGlobal('localStorage', store);
    vi.resetModules();
    const log = await import('./aiLog');
    const history = log.chatHistory('entity:p');
    expect(history.map((h) => h.request)).toEqual(['Make the player a green lizard', 'It did not change!']);
    expect(history[0].reply).toContain('⚠ Left out one part');
    expect(history[1].reply).toMatch(/^\[The app: this request failed and nothing was changed: The AI's answer was too long/);
    // Undo steps from the earlier visit mean nothing now.
    expect(log.useAILog.getState().entries.every((e) => e.transactionId === null)).toBe(true);

    // New chat: the conversation about the player starts again (and stays started again after a reload).
    log.newChat('entity:p');
    expect(log.chatHistory('entity:p')).toEqual([]);
    expect(log.chatHistory('entity:e')).toHaveLength(1);
    vi.resetModules();
    const again = await import('./aiLog');
    expect(again.chatHistory('entity:p')).toEqual([]);
    expect(again.useAILog.getState().entries).toHaveLength(3);
    vi.unstubAllGlobals();
  });
});
