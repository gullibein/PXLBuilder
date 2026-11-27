/**
 * The level's problems, looked for without holding up the editor (docs §30, W1.1): when a level is looked at
 * (at once, when the editor is left alone, when asked), and that what is shown is never passed off as current
 * when the level has changed since.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { produce } from 'immer';
import { createBuiltinRegistry } from '../core/components/builtin';
import { addEntity } from '../core/model/mutations';
import { instantiateDefinition } from '../core/model/factory';
import { makeWorld } from '../regression/worlds';
import { AT_ONCE_BELOW, QUIET_MS, UNASKED_MS, checkLevelNow, checkWhen, levelCheck, lookSoon, noteInput, resetLevelCheck } from './levelCheck';
import { useEditor } from './store';

const registry = createBuiltinRegistry();
const oneMore = (p: ReturnType<typeof makeWorld>['project']) =>
  produce(p, (d) => {
    const def = d.definitions.find((x) => x.name === 'Wall' || x.name === 'Platform')!;
    addEntity(d, d.scenes[0].id, instantiateDefinition(def, { x: -640, y: -640 }));
  });

describe('when a level is looked at for problems', () => {
  it('by its size and by how long a look takes', () => {
    expect(checkWhen(AT_ONCE_BELOW - 1, 1)).toBe('at once');
    expect(checkWhen(AT_ONCE_BELOW, 0.01)).toBe('when quiet');
    expect(checkWhen(Math.floor(UNASKED_MS / 0.01), 0.01)).toBe('when quiet');
    expect(checkWhen(Math.floor(UNASKED_MS / 0.01) + 1, 0.01)).toBe('when asked');
    expect(checkWhen(150000, 0.01)).toBe('when asked');
  });

  beforeEach(() => {
    vi.useFakeTimers();
    resetLevelCheck();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetLevelCheck();
  });

  it('a small level: at once, at every change, always current', () => {
    const w = makeWorld('city', 30, 20, registry);
    const id = w.project.scenes[0].id;
    expect(levelCheck(w.project, id)).toMatchObject({ state: 'current', looked: true });
    expect(levelCheck(oneMore(w.project), id).state).toBe('current');
  });

  it('a bigger level: what was found last is shown as from before, and looked at again once the editor is left alone', () => {
    // (A look taken to cost a thousandth of a millisecond a thing: 5,000 things are looked at unasked.)
    resetLevelCheck(0.001);
    const w = makeWorld('city', 130, 80, registry);
    const id = w.project.scenes[0].id;
    expect(w.things).toBeGreaterThanOrEqual(AT_ONCE_BELOW);
    expect(levelCheck(w.project, id)).toMatchObject({ state: 'soon', looked: false, problems: [] });
    lookSoon(w.project, id);
    vi.advanceTimersByTime(QUIET_MS + 20);
    const first = levelCheck(w.project, id);
    expect(first).toMatchObject({ state: 'current', looked: true });
    // Changed: the same list, not current.
    const next = oneMore(w.project);
    expect(levelCheck(next, id)).toMatchObject({ state: 'soon', looked: true, problems: first.problems });
    // Still being used: no look. Left alone: looked at.
    lookSoon(next, id);
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(QUIET_MS - 100);
      noteInput();
      expect(levelCheck(next, id).state).toBe('soon');
    }
    vi.advanceTimersByTime(QUIET_MS + 20);
    expect(levelCheck(next, id).state).toBe('current');
  });

  it('a level too big to look at unasked: said so, nothing looked at until asked, "checking" in between', () => {
    resetLevelCheck(1);
    const w = makeWorld('city', 130, 80, registry);
    const id = w.project.scenes[0].id;
    useEditor.getState().loadProject(w.project);
    const p = useEditor.getState().project;
    expect(levelCheck(p, id)).toMatchObject({ state: 'ask', looked: false });
    vi.advanceTimersByTime(60000);
    expect(levelCheck(p, id).state).toBe('ask');
    checkLevelNow();
    expect(levelCheck(p, id).state).toBe('checking');
    vi.advanceTimersByTime(60);
    expect(levelCheck(p, id)).toMatchObject({ state: 'current', looked: true });
  });
});
