import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { gameFromText, projectToBundle } from './serialize';

const registry = createBuiltinRegistry();

describe('a game from a dropped file', () => {
  const bundle = JSON.stringify(projectToBundle(createProject(registry, 'Dropped')));
  it('a saved game (.pxlproj.json)', () => {
    expect(gameFromText(bundle, registry).project.name).toBe('Dropped');
  });
  it('an exported game page, with or without touch controls', () => {
    for (const attrs of ['', ' data-touch="1"']) {
      const page = `<!doctype html><html><head><script type="application/json" id="pxl-game"${attrs}>${bundle.replace(/</g, '\\u003c')}</script></head></html>`;
      expect(gameFromText(page, registry).project.name).toBe('Dropped');
    }
  });
  it('anything else is refused', () => {
    expect(() => gameFromText('hello', registry)).toThrow();
    expect(() => gameFromText('<html></html>', registry)).toThrow(/no PXLBuilder game/);
  });
});
