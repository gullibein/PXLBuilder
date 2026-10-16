import { SPRITE_RESOLUTIONS } from '../../core/model/spriteResolution';
import { applySpriteResolution } from '../quickCommands';
import { useEffect, useRef, useState } from 'react';
import { createLevelFor } from '../../core/model/factory';
import { componentRegistry } from '../../core/components/builtin';
import { addScene, renameProject, resetAllStarterDefinitions } from '../../core/model/mutations';
import { frameView } from '../actions';
import { canExportGame, exportPlayer } from '../gameExport';
import { openFileWithPicker, openProjectFile, PROJECT_FILE_EXTENSION, quickSave } from '../persistence';
import { cloudSavesAvailable } from '../cloudSaves';
import { NoteIcon } from './NoteIcon';
import { getActiveScene, useEditor } from '../store';
import { JobDots } from './JobDots';

/** Minimal top bar: wordmark, level selector, undo/redo, Play, global prompt, menu. */
export function TopBar() {
  const fileInput = useRef<HTMLInputElement>(null);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undoLabel = useEditor((s) => s.history.past.at(-1)?.label);
  const redoLabel = useEditor((s) => s.history.future[0]?.label);
  const globalOpen = useEditor((s) => s.globalPrompt.open);
  const activeSceneId = useEditor((s) => s.activeSceneId);
  const playOnTop = useEditor((s) => s.layout.playButton === 'top');
  const { undo, redo, setGlobalPrompt } = useEditor.getState();

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="wordmark" aria-label="PXLBuilder">
          <span className="wordmark-mark" aria-hidden="true" />
          <span>PXLBuilder</span>
        </span>
        <ProjectMenu onOpen={openGame} />
        <SaveButton />
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

      {playOnTop && <PlayButton />}

      <div className="topbar-right">
        <button
          className={`icon-btn spark-btn job-anchor${globalOpen ? ' active' : ''}`}
          title="Ask about the whole level or game (Ctrl+K)"
          aria-label="Global prompt"
          data-testid="global-prompt-toggle"
          onClick={() => setGlobalPrompt(!globalOpen)}
        >
          ✦
          {/* The whole-level, whole-game and editor prompts (the level's own card shares the level's). */}
          <JobDots keys={['project', 'editor', `level:${activeSceneId}`]} open={globalOpen} below />
        </button>
        <button className="icon-btn note-btn" title="Sound editor" aria-label="Sound editor" data-testid="sound-editor-toggle" onClick={() => useEditor.getState().setSoundEditor('open')}>
          <NoteIcon size={16} />
        </button>
        <MainMenu />
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
              const scene = createLevelFor(useEditor.getState().project, `Level ${scenes.length + 1}`, scenes.find((s) => s.id === useEditor.getState().activeSceneId));
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

function MainMenu() {
  const { open, setOpen, ref } = usePopover();
  const showGrid = useEditor((s) => s.layout.showGrid);
  const snap = useEditor((s) => s.layout.snapToGrid);
  const frameOn = useEditor((s) => s.layout.showCameraOutlines);
  const wireOn = useEditor((s) => s.layout.wireframe);
  const lowRes = useEditor((s) => s.layout.playPixels > 0);
  const inspectorOpen = useEditor((s) => s.inspectorOpen);
  const overlayCount = useEditor((s) => s.layout.overlays.length);
  const s = useEditor.getState();
  const items: { label: string; hint?: string; checked?: boolean; run: () => void; testId?: string; sep?: boolean }[] = [
    { label: 'Details panel', hint: 'I', checked: inspectorOpen, run: () => s.setInspectorOpen(!inspectorOpen), testId: 'menu-details' },
    { label: 'History & console', run: () => s.setTray({ open: true }) },
    { label: 'Frame everything', hint: 'F', run: frameView, sep: true },
    { label: 'Grid', checked: showGrid, run: () => s.setShowGrid(!showGrid) },
    { label: 'Snap to grid', checked: snap, run: () => s.setSnapToGrid(!snap) },
    { label: 'Wireframe view', hint: 'W', checked: wireOn, run: () => s.setLayout({ wireframe: !wireOn }), testId: 'menu-wireframe' },
    { label: 'Camera outlines', checked: frameOn, run: () => s.setLayout({ showCameraOutlines: !frameOn }), testId: 'menu-camera-frame' },
    { label: 'Low-resolution play (faster)', checked: lowRes, run: () => s.setLayout({ playPixels: lowRes ? 0 : 400 }), testId: 'menu-low-res' },
    { label: 'AI connection…', run: () => s.setAIConnectionOpen(true), testId: 'menu-ai-connection', sep: true },
    { label: 'Editor style…', run: () => s.setStylePickerOpen(true), testId: 'menu-style' },
    { label: 'Change the editor…', run: () => s.setGlobalPrompt(true, 'editor'), testId: 'menu-editor-prompt' },
    ...(overlayCount ? [{ label: `Hide info on the level (${overlayCount})`, run: () => s.setLayout({ overlays: [] }), testId: 'menu-clear-overlays' }] : []),
    { label: 'Reset editor layout', run: () => s.resetLayout(), testId: 'menu-reset-layout' },
  ];
  return (
    <div className="popover-anchor" ref={ref}>
      <button className="icon-btn" aria-label="Menu" data-testid="main-menu" onClick={() => setOpen(!open)}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
          <circle cx="8" cy="8" r="1.3" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
        </svg>
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
          <div className="menu-sep" />
          <div className="menu-version" data-testid="app-version" title="The version of PXLBuilder on this page (commit and build time)">
            Version {__PXL_VERSION__}
          </div>
        </div>
      )}
    </div>
  );
}

/** Play / Stop. In the top bar, or in the bottom bar (an editor setting). */
export function PlayButton() {
  const mode = useEditor((s) => s.mode);
  const setMode = useEditor((s) => s.setMode);
  const playing = mode === 'play';
  return (
    <button
      className={`play-btn${playing ? ' playing' : ''}`}
      data-testid="play"
      title={playing ? 'Stop and go back to editing (Esc)' : 'Play the level (Ctrl+Enter). Arrows/WASD move, Space jumps, Up/Down climb, R restarts.'}
      onClick={() => setMode(playing ? 'edit' : 'play')}
    >
      {playing ? (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <rect x="2" y="2" width="8" height="8" rx="1.5" fill="currentColor" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 1.8v8.4L10 6z" fill="currentColor" />
        </svg>
      )}
      <span className="play-label">{playing ? 'Stop' : 'Play'}</span>
    </button>
  );
}

/** Open: the saves kept with the app (claude.ai), or a file from the computer. */
export function openGame(): void {
  void cloudSavesAvailable().then(async (cloud) => {
    if (cloud) useEditor.getState().setOpenDialog(true);
    else await openFromComputer();
  });
}

/** A file from the computer: remembered where the page may write files (so Save writes back into it), else the file input. */
export async function openFromComputer(): Promise<void> {
  if (await openFileWithPicker()) return;
  document.querySelector<HTMLInputElement>('[data-testid="open-file-input"]')?.click();
}

/** Save in one click: kept with the app on claude.ai, a file elsewhere. Shows "Saved" for a moment. */
function SaveButton() {
  const dirty = useEditor((s) => s.dirty);
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  useEffect(() => {
    if (state !== 'saved') return;
    const t = setTimeout(() => setState('idle'), 1800);
    return () => clearTimeout(t);
  }, [state]);
  return (
    <button
      className={`save-btn${dirty ? ' dirty' : ''}`}
      title="Save (Ctrl+S): writes the game's file (in Chrome or Edge, straight into the file it was opened from)"
      aria-label="Save"
      data-testid="save-button"
      data-state={state}
      disabled={state === 'saving'}
      onClick={async () => {
        setState('saving');
        setState((await quickSave()) ? 'saved' : 'idle');
      }}
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3 2.5h8l2.5 2.5v8.5H3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M5.5 2.5v3.5h5v-3.5M5.5 13.5v-4h5v4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
      <span>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save'}</span>
    </button>
  );
}

/** The project: its name, and New / Open / Save / reset the built-in objects. */
function ProjectMenu({ onOpen }: { onOpen: () => void }) {
  const { open, setOpen, ref } = usePopover();
  const name = useEditor((s) => s.project.name);
  const dirty = useEditor((s) => s.dirty);
  const items: { label: string; hint?: string; detail?: string; run: () => void; testId: string; sep?: boolean }[] = [
    { label: 'New project', detail: 'Pick a platformer or a top-down game: an empty level with that kind of built-in objects', run: () => useEditor.getState().setGameChooser('new'), testId: 'menu-new' },
    { label: 'Open…', hint: 'Ctrl+O', run: onOpen, testId: 'menu-open' },
    { label: 'Save', hint: 'Ctrl+S', detail: "In one click (the Save button at the top does the same): into the game's file; in Chrome or Edge with no dialog once allowed", run: () => void quickSave(), testId: 'menu-quick-save' },
    { label: 'Save as file…', detail: 'Name the game and save it as a file on your computer', run: () => useEditor.getState().setSaveDialog(true), testId: 'menu-save' },
    ...(canExportGame()
      ? [
          {
            label: 'Export game…',
            detail: 'As a web page that plays in any browser, or as a Windows or macOS app. No editor needed.',
            run: () => useEditor.getState().setExportGameOpen(true),
            testId: 'menu-export-game',
          },
          {
            label: 'Download game player (HTML)',
            detail: 'A web page that plays any game dropped onto it (a saved .pxlproj.json, or an exported game)',
            run: () => void exportPlayer(),
            testId: 'menu-export-player',
          },
        ]
      : []),
    {
      label: 'Export sprites…',
      detail: "All of the game's pictures as one sprite sheet: a PNG, and a JSON saying where each one is",
      run: () => useEditor.getState().openSpriteExport({ assets: null, name: useEditor.getState().project.name }),
      testId: 'menu-export-sprites',
    },
    {
      label: 'Reset objects to defaults',
      detail: 'Built-in objects go back to how they ship. Your level and your own objects stay.',
      run: resetObjectsToDefaults,
      testId: 'menu-reset-objects',
      sep: true,
    },
  ];
  return (
    <div className="popover-anchor" ref={ref}>
      <button className="project-btn" data-testid="project-menu" title="Project" onClick={() => setOpen(!open)}>
        <span className="grow">{name}</span>
        {dirty && <span className="dirty-dot inline" title="Unsaved changes" />}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="m2.5 4 2.5 2.5L7.5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="menu-pop wide" role="menu" data-testid="project-menu-pop">
          <GameNameField />
          <div className="menu-sep" />
          {items.map((item) => (
            <div key={item.label}>
              {item.sep && <div className="menu-sep" />}
              <button
                role="menuitem"
                className="menu-row stacked"
                data-testid={item.testId}
                onClick={() => {
                  setOpen(false);
                  item.run();
                }}
              >
                <span className="menu-row-main">
                  <span className="grow">{item.label}</span>
                  {item.hint && <kbd>{item.hint}</kbd>}
                </span>
                {item.detail && <span className="menu-detail">{item.detail}</span>}
              </button>
            </div>
          ))}
          <div className="menu-sep" />
          <SpriteSizeRow onPicked={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function resetObjectsToDefaults(): void {
  const { edit, logMessage } = useEditor.getState();
  let counts = { reset: 0, added: 0 };
  const ok = edit('Reset objects to defaults', (p) => {
    counts = resetAllStarterDefinitions(p, componentRegistry);
  });
  if (ok) logMessage('info', `Reset ${counts.reset} built-in objects to their defaults${counts.added ? ` and restored ${counts.added} deleted one${counts.added === 1 ? '' : 's'}` : ''}. Undo brings your versions back.`);
}

/** The built-in objects' sprite size: 8, 16, 32 (as they ship) or 64 art pixels per tile. */
function SpriteSizeRow({ onPicked }: { onPicked: () => void }) {
  const res = useEditor((s) => s.project.settings.spriteResolution ?? 32);
  return (
    <div className="menu-row stacked sprite-size-row" data-testid="sprite-size">
      <span className="menu-row-main">
        <span className="grow">Sprite size</span>
        {SPRITE_RESOLUTIONS.map((r) => (
          <button
            key={r}
            className={`chip-btn${r === res ? ' on' : ''}`}
            aria-pressed={r === res}
            data-testid={`sprite-size-${r}`}
            title={`${r}×${r} pixels a tile${r === 32 ? ' (as the objects ship)' : ''}`}
            onClick={() => {
              onPicked();
              applySpriteResolution(r);
            }}
          >
            {r}
          </button>
        ))}
      </span>
      <span className="menu-detail">How detailed the built-in objects' pictures are. Objects with your own drawings keep them.</span>
    </div>
  );
}

/** The game's name, renamed right here (Enter or leaving the field; Esc puts it back). One Undo step. */
function GameNameField() {
  const name = useEditor((s) => s.project.name);
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name]);
  const commit = () => {
    const next = text.trim();
    if (!next) return setText(name);
    if (next !== name) useEditor.getState().edit(`Rename game to ${next}`, (p) => renameProject(p, next));
  };
  return (
    <label className="menu-row stacked game-name-field">
      <span className="menu-detail">Game name</span>
      <input
        value={text}
        maxLength={80}
        data-testid="game-name"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setText(name);
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}
