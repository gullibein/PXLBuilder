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

describe("a starter's object made into something else", () => {
  it("loses the starter's description when it is renamed and a part is taken from it (the Coin made an X Mark is no \"collectible coin\"); one only renamed keeps it", async () => {
    const { produce } = await import('immer');
    const { applyOperations } = await import('./operations');
    const project = createProject(registry, 'T', 'topdown');
    const coin = project.definitions.find((d) => d.name === 'Coin')!;
    const enemy = project.definitions.find((d) => d.name === 'Key')!;
    expect(coin.description).not.toBe('');
    const after = produce(project, (p) => {
      applyOperations(
        p,
        [
          { op: 'rename', target: 'definition', id: coin.id, name: 'X Mark' },
          { op: 'remove_component', target: 'definition', id: coin.id, component: 'Collectible' },
          { op: 'rename', target: 'definition', id: enemy.id, name: 'Goblin' },
        ] as unknown as Operation[],
        registry,
      );
    });
    expect(after.definitions.find((d) => d.id === coin.id)).toMatchObject({ name: 'X Mark', description: '' });
    expect(after.definitions.find((d) => d.id === enemy.id)).toMatchObject({ name: 'Goblin', description: enemy.description });
    // (A part taken from it without a new name: still what it was called.)
    const stripped = produce(project, (p) => {
      applyOperations(p, [{ op: 'remove_component', target: 'definition', id: coin.id, component: 'Collectible' }] as unknown as Operation[], registry);
    });
    expect(stripped.definitions.find((d) => d.id === coin.id)!.description).toBe(coin.description);
  });
});
