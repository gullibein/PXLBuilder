import { useEffect, useRef, useState } from 'react';
import { createScene } from '../../core/model/factory';
import { addScene } from '../../core/model/mutations';
import { frameView } from '../actions';
import { newProject, openProjectFile, PROJECT_FILE_EXTENSION, saveProjectToFile } from '../persistence';
import { getActiveScene, useEditor } from '../store';

/** Minimal top bar: wordmark, level selector, undo/redo, Play, global prompt, menu. */
export function TopBar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undoLabel = useEditor((s) => s.history.past.at(-1)?.label);
  const redoLabel = useEditor((s) => s.history.future[0]?.label);
  const globalOpen = useEditor((s) => s.globalPrompt.open);
  const { undo, redo, setGlobalPrompt } = useEditor.getState();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="wordmark" aria-label="PXLBuilder">
          <span className="wordmark-mark" aria-hidden="true" />
          <span>PXLBuilder</span>
        </span>
        <SceneSelector />
        <div className="icon-group">
          <button className="icon-btn" disabled={!canUndo} title={canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Nothing to undo'} aria-label="Undo" data-testid="undo" onClick={undo}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M6 4 3 7l3 3M3.5 7H10a3 3 0 0 1 0 6H8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button className="icon-btn" disabled={!canRedo} title={canRedo ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Nothing to redo'} aria-label="Redo" data-testid="redo" onClick={redo}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <path d="m10 4 3 3-3 3M12.5 7H6a3 3 0 0 0 0 6h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <button className="play-btn" disabled title="Play mode arrives with the game runtime (next phase)" data-testid="play">
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
        </svg>
        Play
      </button>

      <div className="topbar-right">
        <button
          className={`icon-btn spark-btn${globalOpen ? ' active' : ''}`}
          title="Ask about the whole level or game (Ctrl+K)"
          aria-label="Global prompt"
          data-testid="global-prompt-toggle"
          onClick={() => setGlobalPrompt(!globalOpen)}
        >
          ✦
        </button>
        <MainMenu onOpen={() => fileInput.current?.click()} />
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={`${PROJECT_FILE_EXTENSION},.json,application/json`}
        data-testid="open-file-input"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void openProjectFile(file);
          e.target.value = '';
        }}
      />
    </header>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function SceneSelector() {
  const { open, setOpen, ref } = usePopover();
  const scenes = useEditor((s) => s.project.scenes);
  const active = useEditor(getActiveScene);
  const { setActiveScene, edit } = useEditor.getState();
  return (
    <div className="popover-anchor" ref={ref}>
      <button className="scene-btn" data-testid="scene-selector" onClick={() => setOpen(!open)}>
        {active.name}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="m2.5 4 2.5 2.5L7.5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="menu-pop" role="menu" data-testid="scene-menu">
          {scenes.map((s) => (
            <button
              key={s.id}
              role="menuitem"
              className={`menu-row${s.id === active.id ? ' current' : ''}`}
              onClick={() => {
                setActiveScene(s.id);
                setOpen(false);
              }}
            >
              {s.name}
            </button>
          ))}
          <div className="menu-sep" />
          <button
            role="menuitem"
            className="menu-row"
            data-testid="new-scene"
            onClick={() => {
              const scene = createScene(`Level ${scenes.length + 1}`);
              if (edit('New level', (p) => addScene(p, scene))) setActiveScene(scene.id);
              setOpen(false);
            }}
          >
            + New level
          </button>
        </div>
      )}
    </div>
  );
}

function MainMenu({ onOpen }: { onOpen: () => void }) {
  const { open, setOpen, ref } = usePopover();
  const showGrid = useEditor((s) => s.showGrid);
  const snap = useEditor((s) => s.snapToGrid);
  const inspectorOpen = useEditor((s) => s.inspectorOpen);
  const dirty = useEditor((s) => s.dirty);
  const s = useEditor.getState();
  const items: { label: string; hint?: string; checked?: boolean; run: () => void; testId?: string; sep?: boolean }[] = [
    { label: 'Details panel', hint: 'I', checked: inspectorOpen, run: () => s.setInspectorOpen(!inspectorOpen), testId: 'menu-details' },
    { label: 'History & console', run: () => s.setTray({ open: true }) },
    { label: 'Frame everything', hint: 'F', run: frameView, sep: true },
    { label: 'Grid', checked: showGrid, run: () => s.setShowGrid(!showGrid) },
    { label: 'Snap to grid', checked: snap, run: () => s.setSnapToGrid(!snap) },
    { label: 'New project', run: newProject, testId: 'menu-new', sep: true },
    { label: 'Open…', hint: 'Ctrl+O', run: onOpen, testId: 'menu-open' },
    { label: 'Save', hint: 'Ctrl+S', run: saveProjectToFile, testId: 'menu-save' },
  ];
  return (
    <div className="popover-anchor" ref={ref}>
      <button className="icon-btn" aria-label="Menu" data-testid="main-menu" onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
        {dirty && <span className="dirty-dot" title="Unsaved changes" />}
      </button>
      {open && (
        <div className="menu-pop right" role="menu">
          {items.map((item) => (
            <div key={item.label}>
              {item.sep && <div className="menu-sep" />}
              <button
                role="menuitem"
                className="menu-row"
                data-testid={item.testId}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                <span className="check">{item.checked ? '✓' : ''}</span>
                <span className="grow">{item.label}</span>
                {item.hint && <kbd>{item.hint}</kbd>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
