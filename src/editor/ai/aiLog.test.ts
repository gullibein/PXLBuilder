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
    const store = storage({});
    vi.stubGlobal('localStorage', store);
    vi.resetModules();
    // The game open now; one exchange is about another game.
    const game = (await import('../store')).useEditor.getState().project.id;
    store.setItem(
      'pxlbuilder.aiLog',
      JSON.stringify([
        entry(1, 'entity:p', 'Make the player a green lizard', { project: game, changes: ['Player: new look', "⚠ Left out one part that couldn't be applied: Sprite: All sprite rows must be the same length"] }),
        entry(2, 'entity:e', 'Make the enemy faster', { project: game }),
        entry(3, 'entity:p', 'It did not change!', { project: game, status: 'error', message: "The AI's answer was too long and got cut off." }),
        entry(4, 'project', 'Make a space game', { project: 'prj_other' }),
      ]),
    );
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
    expect(again.useAILog.getState().entries).toHaveLength(4);
    // Another game's "Whole game" conversation isn't this game's.
    expect(again.chatHistory('project')).toEqual([]);
    expect(again.chatEntries(again.useAILog.getState(), 'project', 30, 'prj_other').map((e) => e.request)).toEqual(['Make a space game']);
    vi.unstubAllGlobals();
  });

  it('an undone AI change stays marked undone (also after other edits clear the redo list); redone, it is applied again', async () => {
    vi.stubGlobal('localStorage', storage({}));
    vi.resetModules();
    const log = await import('./aiLog');
    const game = (await import('../store')).useEditor.getState().project.id;
    log.useAILog.setState({ entries: [entry(1, 'entity:p', 'Make it red', { project: game, transactionId: 7 }) as never] });
    log.markUndoneSteps(new Set([7]), new Set());
    expect(log.useAILog.getState().entries[0].undone).toBe(true);
    // Other edits came after: step 7 is in neither list any more, and stays undone.
    log.markUndoneSteps(new Set(), new Set([8]));
    expect(log.useAILog.getState().entries[0].undone).toBe(true);
    log.markUndoneSteps(new Set(), new Set([7]));
    expect(log.useAILog.getState().entries[0].undone).toBe(false);
    vi.unstubAllGlobals();
  });

  it('is saved with the game and comes back when it is opened, for the user to read: never sent to the AI', async () => {
    vi.stubGlobal('localStorage', storage({}));
    vi.resetModules();
    const log = await import('./aiLog');
    const game = (await import('../store')).useEditor.getState().project.id;
    log.useAILog.setState({
      entries: [
        entry(1, 'entity:p', 'Make it red', { project: game, undone: true, trace: [{ kind: 'note', text: 'raw' }] }) as never,
        entry(2, 'project', 'Make a space game', { project: 'prj_other' }) as never,
      ],
    });
    log.newChat('entity:e');
    const saved = JSON.parse(JSON.stringify(log.aiHistoryFor(game)));
    // Only this game's exchanges, without the under-the-hood traces or undo steps.
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]).not.toHaveProperty('trace');
    expect(saved.entries[0]).not.toHaveProperty('transactionId');
    expect(Object.keys(saved.starts)).toEqual(['entity:e']);

    // Another browser opens the file.
    vi.stubGlobal('localStorage', storage({}));
    vi.resetModules();
    const fresh = await import('./aiLog');
    expect(fresh.restoreAIHistory(game, { ...saved, starts: {} })).toBe(1);
    expect(fresh.restoreAIHistory(game, saved)).toBe(0); // not twice
    const back = fresh.chatEntries(fresh.useAILog.getState(), 'entity:p', 30, game);
    expect(back.map((e) => [e.request, e.undone])).toEqual([['Make it red', true]]);
    expect(fresh.chatHistory('entity:p')).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('every placed copy of a library object shares its conversation (with the object\'s card), older ones filed under a copy too', async () => {
    const store = storage({});
    vi.stubGlobal('localStorage', store);
    vi.resetModules();
    const { useEditor } = await import('../store');
    const { produce } = await import('immer');
    const { instantiateDefinition } = await import('../../core/model/factory');
    const project = useEditor.getState().project;
    const ring = project.definitions.find((d) => d.name === 'Coin')!;
    const sceneId = project.scenes[0].id;
    const a = instantiateDefinition(ring, { x: 0, y: 0 });
    const b = instantiateDefinition(ring, { x: 40, y: 0 });
    useEditor.setState({ project: produce(project, (d) => void d.scenes[0].entities.push(a, b)) });
    store.setItem(
      'pxlbuilder.aiLog',
      JSON.stringify([
        entry(1, `entity:${a.id}`, 'Make this coin spin', { project: project.id }),
        entry(2, `object:${ring.id}`, 'Make coins bounce when dropped', { project: project.id }),
        entry(3, 'level:x', 'Something else', { project: project.id }),
      ]),
    );
    const log = await import('./aiLog');
    const onB = { kind: 'entity' as const, sceneId, entityIds: [b.id] as [string] };
    expect(log.conversationKey(onB)).toBe(`object:${ring.id}`);
    expect(log.conversationKey({ kind: 'object', sceneId, definitionId: ring.id })).toBe(`object:${ring.id}`);
    // Copy b's card (never asked about itself) shows both exchanges about the Coin, and the AI is reminded of them.
    const shown = log.chatEntries(log.useAILog.getState(), log.conversationKey(onB)).map((e) => e.request);
    expect(shown).toEqual(['Make this coin spin', 'Make coins bounce when dropped']);
    expect(log.chatHistory(log.conversationKey(onB)).map((h) => h.request)).toEqual(shown);
    // Several things selected keep their own conversation.
    expect(log.conversationKey({ kind: 'pair', sceneId, entityIds: [a.id, b.id] as [string, string] })).toBe(`pair:${a.id},${b.id}`);
  });
});
