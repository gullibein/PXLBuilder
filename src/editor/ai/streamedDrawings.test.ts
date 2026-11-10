import { afterEach, describe, expect, it } from 'vitest';
import type { AIResponse } from '../../core/ai/protocol';
import type { AIProvider, DraftFn } from '../../core/ai/provider';
import { createBuiltinRegistry } from '../../core/components/builtin';
import { createProject } from '../../core/model/factory';
import { useEditor } from '../store';
import { runPrompt, setAIProvider } from './runPrompt';

afterEach(() => setAIProvider(null));

describe('while the AI writes a whole game', () => {
  it("each sprite it has finished drawing goes to the building window before the rest of the answer has come", async () => {
    const project = createProject(createBuiltinRegistry(), 'Test');
    useEditor.setState({ project });
    const drawing = (name: string) => ({ op: 'draw_sprite', name, palette: [{ key: 'a', color: '#ff0000' }], rows: ['aa', 'aa'] });
    const text = JSON.stringify({ kind: 'answer', message: 'Done.', changes: [], operations: [drawing('Hero'), drawing('Slime')], needCode: null, starter: null });
    const events: string[] = [];
    // A stand-in for the AI: writes its answer in pieces (as a stream comes), then gives it whole.
    const provider: AIProvider = {
      async respond(_b, _s, _t, draft?: DraftFn): Promise<AIResponse> {
        for (let n = 1; n <= text.length; n += 25) {
          draft?.(text.slice(0, n));
          await new Promise((r) => setTimeout(r, 0));
        }
        events.push('answer complete');
        return { kind: 'answer', message: 'Done.', changes: [], operations: [], needCode: null, starter: null };
      },
    };
    setAIProvider(provider);
    await runPrompt({ kind: 'project', sceneId: project.scenes[0].id }, 'what is this game?', undefined, undefined, {
      onDrawings: (d) => events.push(`drawn: ${d.map((x) => x.name).join(', ')}`),
    });
    expect(events).toEqual(['drawn: Hero', 'drawn: Slime', 'answer complete']);
  });
});
