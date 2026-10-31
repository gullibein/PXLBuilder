import { afterEach, describe, expect, it } from 'vitest';
import { aiResponseSchema, fillMissingNulls, type AIResponse } from '../../core/ai/protocol';
import type { AIProvider } from '../../core/ai/provider';
import { produce } from 'immer';
import { createBuiltinRegistry } from '../../core/components/builtin';
import { createProject, instantiateDefinition } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { useEditor } from '../store';
import { runPrompt, setAIProvider } from './runPrompt';

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
