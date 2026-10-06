import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './editor/App';
import { restoreAutosave, startAutosave } from './editor/persistence';
import './editor/editor.css';
import './editor/styles.css';

// Restore before the first render so the editor never flashes an empty project.
void restoreAutosave().finally(() => {
  startAutosave();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
