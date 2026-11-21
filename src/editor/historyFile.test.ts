import { produce } from 'immer';
import { afterEach, describe, expect, it } from 'vitest';
import type { AIResponse } from '../core/ai/protocol';
import type { AIProvider } from '../core/ai/provider';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createProject } from '../core/model/factory';
import { gameFromText } from '../core/serialization/serialize';
import { TRACE_TEXT_MAX } from '../core/ai/trace';
import { clearDiagnostics, diagnosticsFor, withoutKeys } from './ai/diagnostics';
import { runPrompt, setAIProvider } from './ai/runPrompt';
import { gameNotes, historyFileText, scriptNote } from './historyFile';
import { resolveEntity } from '../core/model/resolve';
import type { BehaviorScript } from '../core/script/language';
import { useEditor } from './store';

const registry = createBuiltinRegistry();
afterEach(() => {
  setAIProvider(null);
  clearDiagnostics();
});

describe('Save with history', () => {
  it('the file is the game (it opens as usual) with every AI request of the visit in full: what was sent, the answer uncut, the steps, how it ended', async () => {
    const project = createProject(registry, 'Neon Game', 'topdown');
    useEditor.setState({ project, activeSceneId: project.scenes[0].id });
    const wall = project.definitions.find((d) => d.name === 'Wall')!;
    // An answer longer than the AI History keeps of one (its steps are cut at 16,000 characters).
    const long = 'A long word about the look. '.repeat(900);
    expect(long.length).toBeGreaterThan(TRACE_TEXT_MAX);
    const answer: AIResponse = { kind: 'preview', message: long, changes: ['Wall: renamed'], operations: [{ op: 'rename', target: 'definition', id: wall.id, name: 'Board Frame' }], needCode: null, starter: null } as AIResponse;
    const provider: AIProvider = {
      respond: async (_body, _signal, trace) => {
        trace?.('reply', JSON.stringify(answer));
        return answer;
      },
    };
    setAIProvider(provider);
    const steps: string[] = [];
    const outcome = await runPrompt({ kind: 'project', sceneId: project.scenes[0].id }, 'call the wall a board frame', undefined, (_k, t) => steps.push(t));
    expect(outcome.status).toBe('applied');
    // (Whoever listens still hears every step, as before.)
    expect(steps.length).toBeGreaterThan(1);

    const text = historyFileText();
    const file = JSON.parse(text) as { diagnostics: { version: string; requests: ReturnType<typeof diagnosticsFor>; console: unknown[]; game: ReturnType<typeof gameNotes>; ai: Record<string, unknown> } };
    const d = file.diagnostics;
    expect(d.version).toBe(__PXL_VERSION__);
    expect(d.requests).toHaveLength(1);
    const r = d.requests[0];
    expect(r.request).toBe('call the wall a board frame');
    expect(r.outcome).toMatchObject({ status: 'applied', changes: ['Wall: renamed'] });
    expect(r.exchanges).toHaveLength(1);
    expect((r.exchanges[0].answer as AIResponse).message).toBe(long);
    expect(r.exchanges[0].sent.request).toContain('call the wall a board frame');
    expect((r.exchanges[0].sent.context as { library: unknown[] }).library.length).toBeGreaterThan(3);
    // The steps uncut (the AI History's copy of the same step is cut).
    expect(r.steps.some((s) => s.kind === 'reply' && s.text.length > TRACE_TEXT_MAX && !s.text.includes('[cut:'))).toBe(true);
    // The AI connection's settings, and no key among them.
    expect(Object.keys(d.ai).sort()).toEqual(['claudeModel', 'geminiBackup', 'geminiModel', 'speed', 'vendor']);
    expect(d.game.objects).toBe(useEditor.getState().project.definitions.length);
    // It opens as the game it is.
    const opened = gameFromText(text, registry);
    expect(opened.project.name).toBe('Neon Game');
    expect(opened.project.definitions.some((x) => x.name === 'Board Frame')).toBe(true);
  });

  it('a failed request is kept too, with its error; and anything that looks like an API key is taken out of the text', async () => {
    const project = createProject(registry, 'T', 'topdown');
    useEditor.setState({ project, activeSceneId: project.scenes[0].id });
    setAIProvider({
      respond: async () => {
        throw new Error('The AI response was incomplete. Try a smaller request.');
      },
    });
    const outcome = await runPrompt({ kind: 'project', sceneId: project.scenes[0].id }, 'make it rain', undefined, undefined).catch((e: Error) => ({ status: 'error' as const, message: e.message }));
    expect(outcome.status).toBe('error');
    const [r] = diagnosticsFor(project.id);
    expect(r.exchanges[0].answer).toEqual({ error: 'The AI response was incomplete. Try a smaller request.' });
    expect(r.outcome?.status).toBe('error');
    expect(withoutKeys('key sk-ant-api03-AbCdEf123456_xyz and AIzaSyA1234567890abcdefghijklmnop')).toBe('key [key removed] and [key removed]');
    expect(historyFileText()).not.toMatch(/sk-ant-|AIza[0-9A-Za-z_-]{20,}/);
  });

  it("notes on the scripts: how big each is, and the long formulas written more than once (a tic-tac-toe's three-in-a-row test, twice)", () => {
    const line = Array.from({ length: 6 }, (_, i) => `exists(thing_at(self.x + ${i} * 32, self.y, tt))`).join(' and ');
    expect(line.length).toBeGreaterThan(120);
    const script = {
      id: 's',
      name: 'Rules',
      description: '',
      enabled: true,
      vars: [{ name: 'tt', value: 'x' }],
      states: ['human', 'cpu'],
      handlers: [
        { when: { on: 'tick' }, state: 'cpu', if: line, do: [{ do: 'state', name: 'human' }] },
        { when: { on: 'tick' }, state: 'human', if: null, do: [{ do: 'if', cond: line, then: [{ do: 'if', cond: 'true', then: [{ do: 'state', name: 'cpu' }], else: [] }], else: [{ do: 'state', name: 'cpu' }] }] },
      ],
    } as unknown as BehaviorScript;
    expect(scriptNote('Game Master', script)).toEqual({
      owner: 'Game Master',
      script: 'Rules',
      handlers: 2,
      statements: 5,
      vars: 1,
      states: 2,
      deepest: 3,
      longestExpression: line.length,
      repeated: [{ chars: line.length, times: 2, begins: line.slice(0, 80) }],
      characters: JSON.stringify(script).length,
    });
    // A board with nobody to steer is said to be one.
    const project = produce(createProject(registry, 'T', 'topdown'), (p) => {
      p.definitions[0].scripts = [script];
      p.scenes[0].entities = p.scenes[0].entities.filter((e) => !resolveEntity(p, e, registry).components.CharacterController);
    });
    const notes = gameNotes(project);
    expect(notes.scripts.map((n) => n.script)).toContain('Rules');
    expect(notes.scripts.find((n) => n.script === 'Rules')!.owner).toBe(project.definitions[0].name);
    expect(notes.levelsToGetThrough).toBe(project.scenes[0].entities.length === 0);
  });
});
