import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './editor/App';
import { restoreAutosave, startAutosave } from './editor/persistence';
import './editor/editor.css';

restoreAutosave();
startAutosave();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
