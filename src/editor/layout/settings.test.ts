import { describe, expect, it } from 'vitest';
import { checkEditorSetting, DEFAULT_LAYOUT, EDITOR_SETTINGS, editorReference, editorSettingsPayload, loadLayout } from './settings';

describe('editor settings', () => {
  it('have defaults for every setting', () => {
    expect(Object.keys(DEFAULT_LAYOUT).sort()).toEqual([...EDITOR_SETTINGS.map((s) => s.key), 'overlays'].sort());
    expect(DEFAULT_LAYOUT).toMatchObject({ playButton: 'top', inspector: 'floating', mouseZoomSpeed: 1 });
  });

  it('validate every value against the setting schema', () => {
    expect(checkEditorSetting('playButton', 'bottom')).toBeNull();
    expect(checkEditorSetting('playButton', 'sideways')).toMatch(/must be one of: top, bottom/);
    expect(checkEditorSetting('accentColor', '#2ea043')).toBeNull();
    expect(checkEditorSetting('accentColor', 'green')).toMatch(/hex color/);
    expect(checkEditorSetting('mouseZoomSpeed', 10)).toMatch(/<= 3/);
    expect(checkEditorSetting('fontSize', 14)).toMatch(/no setting "fontSize"/);
  });

  it('tell the AI each setting and its allowed values once (fixed reference, cached), and the current values per request', () => {
    const payload = editorSettingsPayload({ ...DEFAULT_LAYOUT, inspector: 'docked' });
    expect(payload.values).toMatchObject({ inspector: 'docked', mouseZoomSpeed: 1 });
    expect(JSON.stringify(payload).length).toBeLessThan(800);
    const ref = editorReference();
    expect(ref).toContain('- inspector (');
    expect(ref).toContain('one of floating | docked');
    expect(ref).toContain('number 0.25..3');
    expect(ref).toContain('EDITOR OVERLAYS');
    expect(ref).not.toContain("current: "); // values are not part of the fixed text
  });

  it('fall back to defaults when nothing is saved (or storage is unavailable)', () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});
