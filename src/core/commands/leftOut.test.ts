import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { SCRIPT_LIMITS } from '../script/language';
import { pruneOperations, scriptsLeftOut, type Operation } from './operations';

const registry = createBuiltinRegistry();

describe('parts of an answer that are left out', () => {
  it('a script among them is known by name (a game without its rules script is said first, not as a last line)', () => {
    const project = createProject(registry, 'T', 'topdown');
    const wall = project.definitions.find((d) => d.name === 'Wall')!;
    const rules = (vars: number) => ({
      op: 'set_script',
      target: 'definition',
      id: wall.id,
      scriptJson: JSON.stringify({ name: 'Chess Rules', description: '', vars: Array.from({ length: vars }, (_, i) => ({ name: `v${i}`, value: 0 })), states: [], handlers: [{ when: { on: 'start' }, do: [{ do: 'set', var: 'v0', value: '1' }] }] }),
    });
    const ops = [{ op: 'set_definition_meta', id: wall.id, name: 'Square', description: null, category: null }, rules(SCRIPT_LIMITS.vars + 1)] as unknown as Operation[];
    const { kept, skipped, left } = pruneOperations(project, ops, registry);
    expect(left).toHaveLength(1);
    expect(kept).toHaveLength(ops.length - 1);
    expect(skipped[0]).toMatch(/Script "Chess Rules" has too many variables \(121; max 120\)/);
    expect(scriptsLeftOut(left)).toEqual(['"Chess Rules"']);
    // (The same script within the limits is kept: a hundred variables are no problem.)
    expect(pruneOperations(project, [rules(100)] as unknown as Operation[], registry).left).toEqual([]);
    // Other things left out are not scripts.
    expect(scriptsLeftOut([{ op: 'remove_entity', id: 'nope' }] as unknown as Operation[])).toEqual([]);
    expect(scriptsLeftOut([{ op: 'set_script', target: 'definition', id: 'x', scriptJson: 'not json' }] as unknown as Operation[])).toEqual(['a script']);
  });
});
