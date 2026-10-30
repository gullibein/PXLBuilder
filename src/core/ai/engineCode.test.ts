import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { buildSystemPrompt } from './capabilities';
import { codeFor } from './context';

const registry = createBuiltinRegistry();

describe('ready-made engine-part scripts for the AI', () => {
  it('are not in the instructions sent every time, only named there', () => {
    const prompt = buildSystemPrompt(registry);
    expect(prompt).toContain('engine:<part>:<object id>');
    expect(prompt).not.toContain('"takesOver":"patrolling"');
  });

  it('come when the AI asks for one (need_code "engine:<part>:<object>"), made for that object', () => {
    const project = createProject(registry);
    const key = project.definitions.find((d) => d.name === 'Key')!;
    const [code] = codeFor(project, [`engine:picking_up:${key.id}`]);
    expect(code.name).toBe("the ready-made script for the Key's picking up");
    expect(JSON.stringify(code.scripts[0])).toContain('"item":"key"');
    expect(codeFor(project, ['engine:patrolling'])[0].scripts[0].takesOver).toBe('patrolling');
    expect(codeFor(project, ['engine:nonsense'])).toEqual([]);
  });
});
