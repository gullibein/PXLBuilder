import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './editor/App';
import { restoreAutosave, startAutosave } from './editor/persistence';
import { useEditor } from './editor/store';
import './editor/editor.css';
import './editor/styles.css';

// Restore before the first render so the editor never flashes an empty project.
// The first visit (no saved game) starts by asking what kind of game to make.
void restoreAutosave()
  .then((restored) => {
    if (!restored) useEditor.getState().setGameChooser('first');
  })
  .finally(() => {
    startAutosave();
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
