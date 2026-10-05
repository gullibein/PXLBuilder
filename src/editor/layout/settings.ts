/**
 * Editor settings: the parts of the editor's own interface that can be
 * changed (by the Editor prompt, the menu, or tests). Like components, each
 * one is declared with a typed schema, so the AI gets an exact list of what
 * it may change and every value is validated before it is applied. The AI
 * never edits the interface any other way.
 *
 * Settings are the user's preferences, not part of the game: they are saved
 * in this browser, not in the project, and have their own undo.
 */
import type { EditorSettingsPayload } from '../../core/ai/context';
import { validateField, type FieldSchema } from '../../core/components/schema';
import { checkOverlay, overlaysPayload, type EditorOverlay } from '../overlays/overlays';

export interface EditorLayout {
  playButton: 'top' | 'bottom';
  inspector: 'floating' | 'docked';
  inspectorSide: 'right' | 'left';
  toolPanelSide: 'left' | 'right';
  trayCorner: 'right' | 'left';
  accentColor: string;
  mouseZoomSpeed: number;
  showGrid: boolean;
  snapToGrid: boolean;
  /** Extra information drawn over the level while editing (see overlays.ts). */
  overlays: EditorOverlay[];
}

export interface EditorSetting {
  key: keyof EditorLayout;
  label: string;
  description: string;
  field: FieldSchema;
}

export const EDITOR_SETTINGS: (EditorSetting & { key: Exclude<keyof EditorLayout, 'overlays'> })[] = [
  {
    key: 'playButton',
    label: 'Play button',
    description: 'Where the Play/Stop button is. top: centre of the top bar. bottom: in the bottom bar, next to Create and Objects.',
    field: { kind: 'enum', options: ['top', 'bottom'], default: 'top' },
  },
  {
    key: 'inspector',
    label: 'Details panel (inspector)',
    description: 'floating: opens on demand over the level (the sliders button on a prompt, or I). docked: always shown as a column at the side; the level view makes room for it.',
    field: { kind: 'enum', options: ['floating', 'docked'], default: 'floating' },
  },
  {
    key: 'inspectorSide',
    label: 'Details panel side',
    description: 'Which side the details panel is on (floating or docked).',
    field: { kind: 'enum', options: ['right', 'left'], default: 'right' },
  },
  {
    key: 'toolPanelSide',
    label: 'Tool panel side',
    description: 'Which side the tool panel (select, draw, background, logic) is on.',
    field: { kind: 'enum', options: ['left', 'right'], default: 'left' },
  },
  {
    key: 'trayCorner',
    label: 'History and console buttons',
    description: 'Which bottom corner the AI History and Console buttons are in.',
    field: { kind: 'enum', options: ['right', 'left'], default: 'right' },
  },
  {
    key: 'accentColor',
    label: 'Accent color',
    description: 'The editor highlight color: buttons, selection, active tools.',
    field: { kind: 'color', default: '#7b6cf6' },
  },
  {
    key: 'mouseZoomSpeed',
    label: 'Mouse wheel zoom speed',
    description: 'How much one mouse-wheel notch zooms (1 = normal, 0.5 = half as much). Trackpads are not affected.',
    field: { kind: 'number', default: 1, min: 0.25, max: 3, step: 0.05 },
  },
  { key: 'showGrid', label: 'Grid', description: 'Show the dot grid on the level.', field: { kind: 'boolean', default: true } },
  { key: 'snapToGrid', label: 'Snap to grid', description: 'Snap objects to the grid when placing and moving them.', field: { kind: 'boolean', default: true } },
];

export const DEFAULT_LAYOUT: EditorLayout = { ...(Object.fromEntries(EDITOR_SETTINGS.map((s) => [s.key, s.field.default])) as Omit<EditorLayout, 'overlays'>), overlays: [] };

/** Validates one setting; returns the error or null. */
export function checkEditorSetting(key: string, value: unknown): string | null {
  const setting = EDITOR_SETTINGS.find((s) => s.key === key);
  if (!setting) return `The editor has no setting "${key}"`;
  const err = validateField(setting.field, value);
  return err ? `${setting.label} ${err}` : null;
}

/** What the AI sees in editor scope: every setting, its allowed values and its current value. */
export function editorSettingsPayload(layout: EditorLayout): EditorSettingsPayload {
  return {
    settings: EDITOR_SETTINGS.map((s) => ({
      key: s.key,
      label: s.label,
      description: s.description,
      type: s.field.kind,
      ...(s.field.kind === 'enum' ? { options: s.field.options } : {}),
      ...(s.field.kind === 'number' ? { min: s.field.min, max: s.field.max } : {}),
      value: layout[s.key],
    })),
    ...overlaysPayload(layout.overlays),
  };
}

const STORAGE_KEY = 'pxlbuilder.editor';

/** Saved settings, with anything unknown or invalid replaced by its default. */
export function loadLayout(): EditorLayout {
  const layout = { ...DEFAULT_LAYOUT };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown>;
    for (const s of EDITOR_SETTINGS) {
      if (s.key in saved && checkEditorSetting(s.key, saved[s.key]) === null) (layout as Record<string, unknown>)[s.key] = saved[s.key];
    }
    if (Array.isArray(saved.overlays)) layout.overlays = (saved.overlays as unknown[]).filter((o) => checkOverlay(o) === null) as EditorOverlay[];
  } catch {
    // Storage unavailable or corrupt: defaults.
  }
  return layout;
}

export function saveLayout(layout: EditorLayout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // Not saved (private mode, storage full); the editor still works.
  }
}
