import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { applyOperations, checkOperations, type Operation } from '../commands/operations';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import type { BehaviorScript, Project } from '../types';
import { setScript } from './mutations';

const registry = createBuiltinRegistry();

/** A game whose Player has a script: on start set a var; on a key, two statements. */
function game(): { project: Project; defId: string; scriptId: string } {
  let defId = '';
  let scriptId = '';
  const project = produce(createProject(registry), (d) => {
    const def = d.definitions.find((x) => x.name === 'Player')!;
    defId = def.id;
    scriptId = setScript(d, { target: 'definition', id: def.id }, {
      name: 'Board',
      description: 'Test script.',
      vars: [{ name: 'n', value: 0 }],
      handlers: [
        { when: { on: 'start' }, do: [{ do: 'set', var: 'n', value: '1' }] },
        { when: { on: 'key', key: 'jump', edge: 'pressed' }, do: [{ do: 'set', var: 'n', value: 'n + 1' }, { do: 'set', var: 'n', value: 'n * 2' }] },
      ],
    });
  });
  return { project, defId, scriptId };
}

const edit = (g: ReturnType<typeof game>, edits: unknown): Operation => ({ op: 'edit_script', target: 'definition', id: g.defId, scriptId: g.scriptId, editsJson: JSON.stringify(edits) });
const scriptOf = (p: Project, g: ReturnType<typeof game>) => p.definitions.find((d) => d.id === g.defId)!.scripts!.find((s) => s.id === g.scriptId)! as BehaviorScript;

describe('edit_script: changing part of a script', () => {
  it('replaces, inserts and removes statements and handlers; the rest stays as it was', () => {
    const g = game();
    const after = produce(g.project, (d) =>
      void applyOperations(
        d,
        [
          edit(g, [
            { at: 'handlers.1.do.1', action: 'remove', was: 'n * 2' },
            { at: 'handlers.1.do.0', action: 'insert', value: { do: 'set', var: 'n', value: '0' }, was: '"do":"set"' },
            { at: 'handlers.0.do.0', action: 'replace', value: { do: 'set', var: 'n', value: '5' } },
            { at: 'handlers.2', action: 'insert', value: { when: { on: 'every', seconds: 1 }, do: [{ do: 'set', var: 'n', value: 'n - 1' }] } },
          ]),
        ],
        registry,
      ),
    );
    const s = scriptOf(after, g);
    expect(s.name).toBe('Board');
    expect(s.handlers).toHaveLength(3);
    expect(s.handlers[0].do).toMatchObject([{ do: 'set', value: '5' }]);
    expect(s.handlers[1].do).toMatchObject([{ do: 'set', value: '0' }, { do: 'set', value: 'n + 1' }]);
    expect(s.handlers[2].when).toMatchObject({ on: 'every', seconds: 1 });
  });

  it('adding at the end of a list: at its length (whatever "was" says: nothing is there), or by naming the list itself', () => {
    // Both ways an AI added a jump sound to the end of a jump script, refused before this.
    const g = game();
    const sound = { do: 'set', var: 'n', value: '7' };
    const atLength = produce(g.project, (d) => void applyOperations(d, [edit(g, [{ at: 'handlers.1.do.2', action: 'insert', value: sound, was: 'end' }])], registry));
    expect(scriptOf(atLength, g).handlers[1].do).toMatchObject([{ value: 'n + 1' }, { value: 'n * 2' }, { value: '7' }]);
    const theList = produce(g.project, (d) => void applyOperations(d, [edit(g, [{ at: 'handlers.1.do', action: 'insert', value: sound }])], registry));
    expect(scriptOf(theList, g).handlers[1].do).toMatchObject([{ value: 'n + 1' }, { value: 'n * 2' }, { value: '7' }]);
    // A handler added to the end of the handlers the same way; a whole new list still replaces it.
    const handler = produce(g.project, (d) => void applyOperations(d, [edit(g, [{ at: 'handlers', action: 'insert', value: { when: { on: 'every', seconds: 2 }, do: [sound] } }])], registry));
    expect(scriptOf(handler, g).handlers).toHaveLength(3);
    const list = produce(g.project, (d) => void applyOperations(d, [edit(g, [{ at: 'handlers.1.do', action: 'replace', value: [sound] }])], registry));
    expect(scriptOf(list, g).handlers[1].do).toMatchObject([{ value: '7' }]);
  });

  it('a wrong position or an unexpected "was" is refused with what is really there (nothing changes)', () => {
    const g = game();
    expect(checkOperations(g.project, [edit(g, [{ at: 'handlers.1.do.0', action: 'remove', was: 'play_sound' }])], registry)).toMatch(/not what was expected \("play_sound"\); it is \{"do":"set"/);
    expect(checkOperations(g.project, [edit(g, [{ at: 'handlers.7.do.0', action: 'remove' }])], registry)).toMatch(/nothing at "handlers\.7\.do\.0"/);
    expect(checkOperations(g.project, [edit(g, [{ at: 'handlers.1.do.5', action: 'insert', value: { do: 'set', var: 'n', value: '1' } }])], registry)).toMatch(/only 2 items/);
    expect(checkOperations(g.project, [edit(g, [{ at: 'id', action: 'replace', value: 'x' }])], registry)).toMatch(/id can't be changed/);
    expect(checkOperations(g.project, [{ ...(edit(g, []) as Extract<Operation, { op: 'edit_script' }>), scriptId: 'scr_nope' }], registry)).toMatch(/has no script "scr_nope" \(its scripts: .*"Board"/);
  });

  it('the edited script is checked like a whole one (a broken statement is refused)', () => {
    const g = game();
    expect(checkOperations(g.project, [edit(g, [{ at: 'handlers.0.do.0', action: 'replace', value: { do: 'jump', force: 'nonsense(' } }])], registry)).toBeTruthy();
    expect(checkOperations(g.project, [edit(g, [{ at: 'handlers.0.do.0', action: 'replace', value: { do: 'set', var: 'n', value: '2' } }])], registry)).toBeNull();
  });
});
