import { useEffect } from 'react';
import { deleteSelection, duplicateSelection, frameView, nudgeSelection, selectAll } from './actions';
import { MenuBar } from './MenuBar';
import { ConsolePanel } from './panels/ConsolePanel';
import { Inspector } from './panels/Inspector';
import { LibraryPanel } from './panels/LibraryPanel';
import { saveProjectToFile } from './persistence';
import { useEditor } from './store';
import { Viewport } from './viewport/Viewport';

export function App() {
  useGlobalShortcuts();
  return (
    <div className="editor">
      <MenuBar />
      <div className="workspace">
        <LibraryPanel />
        <Viewport />
        <Inspector />
      </div>
      <ConsolePanel />
    </div>
  );
}

function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProjectToFile();
        return;
      }
      if (mod && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        document.querySelector<HTMLInputElement>('[data-testid="open-file-input"]')?.click();
        return;
      }
      if (typing) return;
      const grid = useEditor.getState().project.settings.gridSize;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        selectAll();
      } else if (e.key === 'Escape') {
        useEditor.getState().selectEntities([]);
        useEditor.getState().selectDefinition(null);
      } else if (e.key === 'f' && !mod) {
        frameView();
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
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
