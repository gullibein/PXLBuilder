import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../../core/components/builtin';
import { tidyChanges } from '../../core/ai/protocol';
import { createProject } from '../../core/model/factory';
import type { BehaviorScript } from '../../core/script/language';
import { scriptsWritten } from './runPrompt';

const registry = createBuiltinRegistry();
const script = (name: string, vars: number): BehaviorScript => ({ id: `scr_${name}_${Math.round(vars)}`, name, description: '', enabled: true, vars: Array.from({ length: vars }, (_, i) => ({ name: `v${i}`, value: 0 })), states: [], handlers: [] }) as unknown as BehaviorScript;

describe('a game built in two answers', () => {
  it('the scripts the first answer wrote are known (to go along with the second): new or changed ones, the biggest first, the same one on many objects once, within the room there is', () => {
    const before = createProject(registry, 'T', 'topdown');
    const [a, b, c, d] = before.definitions;
    const after = produce(before, (p) => {
      p.definitions.find((x) => x.id === a.id)!.scripts = [script('Side color', 2)];
      p.definitions.find((x) => x.id === b.id)!.scripts = [{ ...script('Side color', 2), id: 'another id' }];
      p.definitions.find((x) => x.id === c.id)!.scripts = [script('Chess rules', 60)];
    });
    expect(scriptsWritten(before, after, 80_000)).toEqual([c.id, a.id]);
    // (What was there before and didn't change is not "written"; nor an object left without scripts.)
    expect(scriptsWritten(after, after, 80_000)).toEqual([]);
    expect(scriptsWritten(before, after, 80_000)).not.toContain(d.id);
    // Too big for the room: left to be asked for; the small ones still go.
    expect(scriptsWritten(before, after, 500)).toEqual([a.id]);
  });

  it('change lines that say nothing are not shown', () => {
    expect(tidyChanges(['null', 'Player: red', '', ' None. ', '"null"', 'n/a', 'Nullify the shield'])).toEqual(['Player: red', 'Nullify the shield']);
  });
});
