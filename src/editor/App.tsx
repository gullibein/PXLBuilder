import { useEffect } from 'react';
import { deleteSelection, duplicateSelection, frameView, nudgeSelection, selectAll } from './actions';
import { AIConnection } from './chrome/AIConnection';
import { StylePicker } from './chrome/StylePicker';
import { GameChooser } from './chrome/GameChooser';
import { SpriteEditor } from './chrome/SpriteEditor';
import { BackgroundPanel } from './chrome/BackgroundPanel';
import { LogicPanel } from './logic/LogicPanel';
import { Dock } from './chrome/Dock';
import { SpritesPanel } from './chrome/SpritesPanel';
import { GlobalPrompt } from './chrome/GlobalPrompt';
import { ToolPanel } from './chrome/ToolPanel';
import { PlayButton, TopBar } from './chrome/TopBar';
import { Tray } from './chrome/Tray';
import { Inspector } from './panels/Inspector';
import { saveProjectToFile } from './persistence';
import { ContextPrompt } from './prompt/ContextPrompt';
import { useEditor } from './store';
import { PlayView } from './play/PlayView';
import { Viewport } from './viewport/Viewport';
import { applyAccent, applyStyle } from './theme';
import type { EditorLayout } from './layout/settings';

/** Layout classes on the editor root: where panels and buttons go (editor settings). */
function layoutClasses(layout: EditorLayout): string {
  return [
    `tools-${layout.toolPanelSide}`,
    `tray-${layout.trayCorner}`,
    `play-${layout.playButton}`,
    layout.inspector === 'docked' ? `docked docked-${layout.inspectorSide}` : `drawer-${layout.inspectorSide}`,
  ].join(' ');
}

/**
 * Canvas-first layout: the game fills the window. Everything else floats on
 * top of it and is either contextual (the prompt) or opened on demand
 * (library, details, history).
 */
export function App() {
  useGlobalShortcuts();
  const inspectorOpen = useEditor((s) => s.inspectorOpen);
  const mode = useEditor((s) => s.mode);
  const layout = useEditor((s) => s.layout);
  useEffect(() => {
    applyAccent(layout.accentColor);
    applyStyle(layout.editorStyle);
  }, [layout.accentColor, layout.editorStyle]);
  const docked = layout.inspector === 'docked';
  if (mode === 'play') {
    // Build → Play → Game: the editor gets out of the way.
    return (
      <div className={`editor playing ${layoutClasses(layout)}`}>
        <TopBar />
        <main className="stage">
          <PlayView />
          {layout.playButton === 'bottom' && (
            <div className="play-float">
              <PlayButton />
            </div>
          )}
        </main>
      </div>
    );
  }
  return (
    <div className={`editor ${layoutClasses(layout)}`}>
      <TopBar />
      <div className="workspace">
      {docked && <Inspector docked />}
      <main className="stage">
        <Viewport />
        <ContextPrompt />
        <ToolPanel />
        <BackgroundPanel />
        <LogicPanel />
        <SpritesPanel />
        <AIConnection />
        <StylePicker />
        <GameChooser />
        <SpriteEditor />
        <GlobalPrompt />
        <Dock />
        <Tray />
        {inspectorOpen && !docked && <Inspector />}
      </main>
      </div>
    </div>
  );
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const state = useEditor.getState();
      if (state.mode === 'play') {
        // While playing, keys belong to the game; Esc (or Ctrl/Cmd+Enter) stops.
        if (e.key === 'Escape' || (mod && e.key === 'Enter')) {
          e.preventDefault();
          state.setMode('edit');
        }
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        state.setMode('play');
        return;
      }
      if (mod && key === 's') {
        e.preventDefault();
        void saveProjectToFile();
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[data-testid="open-file-input"]')?.click();
        return;
      }
      if (mod && key === 'k') {
        e.preventDefault();
        state.setGlobalPrompt(!state.globalPrompt.open);
        return;
      }
      if (typing) return;
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) state.redo();
        else state.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        state.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (mod && key === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && key === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Enter') {
        // Selecting doesn't steal focus; Enter moves into the prompt when you're ready to type.
        const input = document.querySelector<HTMLTextAreaElement>('[data-testid="context-prompt"] textarea');
        if (input) {
          e.preventDefault();
          input.focus();
        }
      } else if (e.key === 'Escape') {
        if (state.dock) state.setDock(null);
        else if (state.globalPrompt.open) state.setGlobalPrompt(false);
        else if (state.backgroundOpen) state.setBackgroundOpen(false);
        else if (state.logicOpen) state.setLogicOpen(false);
        else if (state.aiConnectionOpen) state.setAIConnectionOpen(false);
        else if (state.stylePickerOpen) state.setStylePickerOpen(false);
        else if (state.gameChooser) state.setGameChooser(null);
        else if (state.spritesFor) state.openSprites(null);
        else if (state.tool.kind === 'brush') state.setTool({ kind: 'select' });
        else {
          state.selectEntities([]);
          state.setWorldContext(false);
          state.selectDefinition(null);
          state.selectConnection(null);
        }
      } else if (key === 'v' && !mod) {
        state.setTool({ kind: 'select' });
      } else if (key === 'b' && !mod) {
        state.usePen();
      } else if (key === 'f' && !mod) {
        frameView();
      } else if (key === 'w' && !mod) {
        state.setLayout({ wireframe: !state.layout.wireframe });
      } else if (key === 'i' && !mod) {
        state.setInspectorOpen(!state.inspectorOpen);
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const grid = state.project.settings.gridSize;
        const step = e.shiftKey ? grid * 4 : grid;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        nudgeSelection(dx, dy);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
