import { describe, expect, it } from 'vitest';
import { checkEditorSetting, DEFAULT_LAYOUT, EDITOR_SETTINGS, editorSettingsPayload, loadLayout } from './settings';

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

  it('tell the AI each setting, its allowed values and its current value', () => {
    const payload = editorSettingsPayload({ ...DEFAULT_LAYOUT, inspector: 'docked' });
    expect(payload.settings.find((s) => s.key === 'inspector')).toMatchObject({ type: 'enum', options: ['floating', 'docked'], value: 'docked' });
    expect(payload.settings.find((s) => s.key === 'mouseZoomSpeed')).toMatchObject({ min: 0.25, max: 3, value: 1 });
  });

  it('fall back to defaults when nothing is saved (or storage is unavailable)', () => {
    expect(loadLayout()).toEqual(DEFAULT_LAYOUT);
  });
});
