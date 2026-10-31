import { afterEach, describe, expect, it } from 'vitest';
import { aiResponseSchema, fillMissingNulls, type AIResponse } from '../../core/ai/protocol';
import type { AIProvider } from '../../core/ai/provider';
import { produce } from 'immer';
import { createBuiltinRegistry } from '../../core/components/builtin';
import { createProject, instantiateDefinition } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { useEditor } from '../store';
import { makesAGame, runPrompt, setAIProvider } from './runPrompt';

afterEach(() => setAIProvider(null));

describe('small format slips in an answer', () => {
  it('changes as one text (a list in lines), and missing operations or needCode, are read, not rejected', () => {
    const parsed = aiResponseSchema.safeParse(fillMissingNulls({ kind: 'answer', message: 'Hi', changes: '- one\n- two\n\n• three' }));
    expect(parsed.success).toBe(true);
    expect(parsed.data!.changes).toEqual(['one', 'two', 'three']);
    expect(parsed.data!.operations).toEqual([]);
    const asked = aiResponseSchema.safeParse(fillMissingNulls({ kind: 'need_code', message: '', changes: [], operations: [], needCode: 'topic:shooters' }));
    expect(asked.data?.needCode).toEqual(['topic:shooters']);
  });
});

describe('when the corrected answer is lost', () => {
  it("the first answer is kept when its only problem was a soft one (here: it removes a behavior nobody asked to remove)", async () => {
    let project = createProject(createBuiltinRegistry(), 'Test');
    const enemyDef0 = project.definitions.find((d) => d.name === 'Enemy')!;
    project = produce(project, (d) => {
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 0, y: 0 }));
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(enemyDef0, { x: 200, y: 0 }));
    });
    useEditor.setState({ project });
    const scene = project.scenes[0];
    const enemyDef = project.definitions.find((d) => d.name === 'Enemy')!;
    const enemy = scene.entities.find((e) => e.definitionId === enemyDef.id)!;
    expect(enemy).toBeTruthy();
    const first: AIResponse = {
      kind: 'preview',
      message: 'Gave it a red hat.',
      changes: ['Red hat'],
      operations: [{ op: 'remove_component', target: 'definition', id: enemyDef.id, component: 'Patrol' } as AIResponse['operations'][number]],
      needCode: null,
    } as AIResponse;
    let calls = 0;
    const provider: AIProvider = {
      respond: async () => {
        calls++;
        if (calls === 1) return first;
        throw new Error("The AI's answer was not in the expected form");
      },
    } as AIProvider;
    setAIProvider(provider);
    const outcome = await runPrompt({ kind: 'entity', sceneId: scene.id, entityIds: [enemy.id] }, 'give it a red hat');
    expect(calls).toBe(2);
    expect(outcome.status).not.toBe('error');
    expect('changes' in outcome && outcome.changes.join(' ')).toMatch(/didn't ask for/);
  });

  it('an answer that would not apply at all still fails when its correction is lost', async () => {
    const { project } = useEditor.getState();
    const scene = project.scenes[0];
    let calls = 0;
    setAIProvider({
      respond: async () => {
        calls++;
        if (calls === 1) return { kind: 'preview', message: 'x', changes: [], operations: [{ op: 'remove_component', target: 'definition', id: 'nope', component: 'Patrol' }], needCode: null } as unknown as AIResponse;
        throw new Error('unreadable');
      },
    } as AIProvider);
    const outcome = await runPrompt({ kind: 'level', sceneId: scene.id, point: null }, 'do something');
    expect(outcome.status).toBe('error');
  });
});

describe('a whole new game asked for on Whole game', () => {
  it('"make a game like this" is a new game; changes to this game are not', () => {
    expect(makesAGame('make a game like this')).toBe(true);
    expect(makesAGame('Build me a space shooter game')).toBe(true);
    expect(makesAGame('make the game harder')).toBe(false);
    expect(makesAGame('make my game faster')).toBe(false);
    expect(makesAGame('add more enemies')).toBe(false);
  });

  it('the AI asks for guidance, then for the other starter: the game is made over on it and built', async () => {
    useEditor.setState({ project: createProject(createBuiltinRegistry(), 'Test', 'platformer') });
    const scene = useEditor.getState().project.scenes[0];
    const replies: AIResponse[] = [
      { kind: 'need_code', message: 'Getting the shooter guidance.', changes: [], operations: [], needCode: ['topic:shooters'], starter: null } as AIResponse,
      { kind: 'switch_starter', message: "That's a space shooter seen from above.", changes: [], operations: [], needCode: null, starter: 'topdown' } as AIResponse,
      { kind: 'answer', message: 'Built it.', changes: [], operations: [], needCode: null, starter: null } as AIResponse,
    ];
    const seen: { topics?: string[]; newGame?: unknown }[] = [];
    setAIProvider({
      respond: async (body: { topics?: string[]; context: { newGame?: unknown } }) => {
        seen.push({ topics: body.topics, newGame: body.context.newGame });
        return replies[Math.min(seen.length - 1, replies.length - 1)];
      },
    } as unknown as AIProvider);
    await runPrompt({ kind: 'project', sceneId: scene.id }, 'make a game like this');
    expect(seen[0].newGame).toBeTruthy();
    expect(seen[1].topics).toContain('shooters');
    expect(useEditor.getState().project.settings.gameType).toBe('topdown');
    expect(seen.length).toBeGreaterThanOrEqual(3);
  });
});

describe('a big answer with one broken part', () => {
  it('only that part goes back, and its correction is put in its place; the rest is kept', async () => {
    let project = createProject(createBuiltinRegistry(), 'Test');
    project = produce(project, (d) => {
      m.addEntity(d, d.scenes[0].id, instantiateDefinition(d.definitions.find((x) => x.name === 'Player')!, { x: 0, y: 0 }));
    });
    useEditor.setState({ project });
    const enemy = project.definitions.find((d) => d.name === 'Enemy')!;
    const color = (c: string) => ({ op: 'set_component_field', target: 'definition', id: enemy.id, component: 'Sprite', field: 'color', valueJson: JSON.stringify(c) });
    const script = (value: string) => ({ op: 'set_script', target: 'definition', id: enemy.id, scriptJson: JSON.stringify({ name: 'Points', vars: [{ name: 'points', value: 100 }], handlers: [{ when: { on: 'start' }, do: [{ do: 'set', var: 'points', value }] }] }) });
    const ops = [color('#111111'), color('#222222'), script('score + points'), color('#333333'), color('#444444'), color('#555555')];
    const asked: string[] = [];
    setAIProvider({
      respond: async (body: { request: string }) => {
        asked.push(body.request);
        if (asked.length === 1) return { kind: 'preview', message: 'Built.', changes: ['Points'], operations: ops, needCode: null, starter: null } as unknown as AIResponse;
        return { kind: 'preview', message: '', changes: [], operations: [script('points + 1')], needCode: null, starter: null } as unknown as AIResponse;
      },
    } as unknown as AIProvider);
    const outcome = await runPrompt({ kind: 'level', sceneId: project.scenes[0].id, point: null }, 'give the enemy points');
    expect(asked.length).toBe(2);
    expect(asked[1]).toMatch(/Send ONLY the corrected replacements/);
    expect(asked[1]).toMatch(/operation 3 \(set_script\)/);
    expect(outcome.status).toBe('applied');
    const after = useEditor.getState().project.definitions.find((d) => d.id === enemy.id)!;
    expect(after.scripts!.some((s) => s.name === 'Points')).toBe(true);
    expect(JSON.stringify(after.components)).toContain('#555555');
  });
});

describe('ready-made scripts', () => {
  it('{"ready":"Swooper"} is written out in full, with only the given settings changed', async () => {
    const { expandReadyScript } = await import('../../core/script/ready');
    const s = expandReadyScript({ ready: 'Swooper', settings: { entry: 'right', group: 'fighter' } }) as { name: string; vars: { name: string; value: unknown }[]; handlers: unknown[] };
    expect(s.name).toBe('Swooper');
    expect(s.vars.find((v) => v.name === 'entry')!.value).toBe('right');
    expect(s.vars.find((v) => v.name === 'speed')!.value).toBe(240);
    expect(s.handlers.length).toBeGreaterThan(3);
    expect(() => expandReadyScript({ ready: 'Swooper', settings: { hx: 3 } })).toThrow(/no setting "hx"/);
    expect(() => expandReadyScript({ ready: 'Nope' })).toThrow(/no ready-made script/);
  });
});

describe('small slips in scripts', () => {
  it('a number where an expression goes is read as that expression', async () => {
    const { scriptSchema: parseScript } = await import('../../core/script/language');
    expect(parseScript.safeParse({ id: 's1', name: 'S', vars: [], handlers: [{ when: { on: 'tick' }, do: [{ do: 'camera_shake', strength: 3, seconds: 0.3 }] }] }).success).toBe(true);
  });
});
