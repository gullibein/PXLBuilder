import { AutotileEditor } from './chrome/AutotileEditor';
import { ObjectPanel } from './prompt/ObjectPanel';
import { usesMenuKey } from '../core/script/language';
import { ObjectCard } from './chrome/ObjectCard';
import { GameSite } from './gamesite/GameSite';
import { OpenDialog } from './chrome/OpenDialog';
import { FileFixDialog } from './chrome/FileFixDialog';
import { quickSave } from './persistence';
import { CodeEditor } from './chrome/CodeEditor';
import { SaveDialog } from './chrome/SaveDialog';
import { ExportGameDialog } from './chrome/ExportGameDialog';
import { SoundEditor } from './chrome/SoundEditor';
import { MusicStudio } from './chrome/MusicStudio';
import { SpriteExport } from './chrome/SpriteExport';
import { useEffect } from 'react';
import { hasCopiedObjects, pasteObjects, runQuickCommand } from './quickCommands';
import { deleteSelection, duplicateSelection, frameView, nudgeSelection, selectAll } from './actions';
import { AIConnection } from './chrome/AIConnection';
import { StylePicker } from './chrome/StylePicker';
import { GameChooser } from './chrome/GameChooser';
import { SpriteEditor } from './chrome/SpriteEditor';
import { CameraPanel } from './chrome/CameraPanel';
import { BackgroundPanel } from './chrome/BackgroundPanel';
import { LogicPanel } from './logic/LogicPanel';
import { Dock } from './chrome/Dock';
import { SpritesPanel } from './chrome/SpritesPanel';
import { GlobalPrompt } from './chrome/GlobalPrompt';
import { ToolPanel } from './chrome/ToolPanel';
import { openGame, PlayButton, TopBar } from './chrome/TopBar';
import { Tray } from './chrome/Tray';
import { Inspector } from './panels/Inspector';
import { ContextPrompt } from './prompt/ContextPrompt';
import { useEditor } from './store';
import { PlayView, playSummaryLine } from './play/PlayView';
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
          <PlayView
            project={useEditor.getState().project}
            startSceneId={useEditor.getState().activeSceneId}
            playPixels={() => useEditor.getState().layout.playPixels}
            stopHint={usesMenuKey(useEditor.getState().project) ? 'Ctrl+Enter stops' : 'Esc stops'}
            touchControls
            onEnd={(report, project) => {
              const { setLastPlay, logMessage } = useEditor.getState();
              setLastPlay(report, project);
              const summary = playSummaryLine(report);
              if (summary) logMessage(report.scriptErrors.length ? 'warn' : 'info', `${summary} Open Debug to see what happened, or ask the AI why.`);
            }}
          />
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
        <ObjectPanel />
        <ToolPanel />
        <ObjectCard />
        <BackgroundPanel />
        <CameraPanel />
        <LogicPanel />
        <SpritesPanel />
        <AIConnection />
        <StylePicker />
        <GameChooser />
        {/* (Under the sprite editor: one of its pictures opens there, on top.) */}
        <AutotileEditor />
        <SpriteEditor />
        <SpriteExport />
        <CodeEditor />
        <SaveDialog />
        <OpenDialog />
        <FileFixDialog />
        <GameSite />
        <ExportGameDialog />
        <SoundEditor />
        <MusicStudio />
        <GlobalPrompt />
        <Dock />
        <Tray />
        {inspectorOpen && !docked && <Inspector />}
      </main>
      </div>
    </div>
  );
}

/** Some text on the page is marked (selected with the mouse): Ctrl+C is for it, not for the selected objects. */
function textSelected(): boolean {
  return (window.getSelection()?.toString().trim().length ?? 0) > 0;
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const state = useEditor.getState();
      // PXLGameSite is open: its keys are its own (and a game played there gets the game's).
      if (state.gameSite) return;
      if (state.mode === 'play') {
        // While playing, keys belong to the game; Esc (or Ctrl/Cmd+Enter) stops. A game with a menu of its own
        // (a pause menu on the menu key) gets Escape: Ctrl/Cmd+Enter or Stop stops it then.
        if ((e.key === 'Escape' && !usesMenuKey(state.project)) || (mod && e.key === 'Enter')) {
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
        // Ctrl+Shift+S: Save as file…; Ctrl+S saves in one step.
        if (e.shiftKey) state.setSaveDialog(true);
        else void quickSave();
        return;
      }
      if (mod && key === 'o') {
        e.preventDefault();
        openGame();
        return;
      }
      if (mod && key === 'k') {
        e.preventDefault();
        state.setGlobalPrompt(!state.globalPrompt.open);
        return;
      }
      if (typing) return;
      // The music machine has its own keys (a piano on the keyboard): only undo, redo and Esc reach the editor.
      if (state.musicStudio && !(mod && (key === 'z' || key === 'y')) && e.key !== 'Escape') return;
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
      } else if (mod && (key === 'c' || key === 'x') && state.selectedEntityIds.length && !textSelected()) {
        // Copy / cut placed objects (Ctrl+V pastes them, also into another level). Text marked with the mouse (an
        // AI answer, a message) is copied as text instead, as everywhere else.
        e.preventDefault();
        runQuickCommand(null, { kind: key === 'c' ? 'copy' : 'cut' });
      } else if (mod && key === 'v' && hasCopiedObjects()) {
        e.preventDefault();
        pasteObjects();
      } else if (mod && key === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Enter') {
        // Enter opens the prompt card for what is selected (as a double-click does) and moves into it.
        if (!state.selectedEntityIds.length && !state.worldContext && !state.selectedConnectionId) return;
        e.preventDefault();
        state.setPromptOpen(true);
        requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="context-prompt"] textarea')?.focus());
      } else if (e.key === 'Escape') {
        if (state.musicStudio) state.setMusicStudio(null);
        else if (state.soundEditor) state.setSoundEditor(null);
        else if (state.dock) state.setDock(null);
        else if (state.globalPrompt.open) state.setGlobalPrompt(false);
        else if (state.backgroundOpen) state.setBackgroundOpen(false);
        else if (state.logicOpen) state.setLogicOpen(false);
        else if (state.aiConnectionOpen) state.setAIConnectionOpen(false);
        else if (state.stylePickerOpen) state.setStylePickerOpen(false);
        else if (state.gameChooser) state.setGameChooser(null);
        else if (state.spriteExport) state.openSpriteExport(null);
        else if (state.saveDialog) state.setSaveDialog(false);
        else if (state.exportGameOpen) state.setExportGameOpen(false);
        else if (state.spritesFor) state.openSprites(null);
        else if (state.tool.kind !== 'select') state.setTool({ kind: 'select' });
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
      } else if (key === 'm' && !mod) {
        state.setTool({ kind: 'marquee' });
      } else if (key === 'e' && !mod) {
        state.setTool({ kind: 'eyedropper' });
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
