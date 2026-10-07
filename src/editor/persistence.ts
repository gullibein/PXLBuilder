import { claudeCapability, type ViewerDownloads } from './claudeViewer';
import { componentRegistry } from '../core/components/builtin';
import { createProject } from '../core/model/factory';
import { projectFromBundle, projectToBundle } from '../core/serialization/serialize';
import type { Project } from '../core/types';
import { useEditor } from './store';

const AUTOSAVE_KEY = 'pxlbuilder.autosave';
export const PROJECT_FILE_EXTENSION = '.pxlproj.json';

/*
 * Autosave lives in IndexedDB: projects with images are larger than
 * localStorage allows. Older autosaves in localStorage are still read once.
 */
const DB_NAME = 'pxlbuilder';
const STORE = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbGet(key: string): Promise<string | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(key: string, value: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function readAutosaveText(): Promise<string | null> {
  try {
    const text = await dbGet(AUTOSAVE_KEY);
    if (text) return text;
  } catch {
    // IndexedDB unavailable (private mode, blocked storage): fall through.
  }
  try {
    return localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return null;
  }
}

/** Restores the autosaved project, if any. Older formats are upgraded on load. Returns true if one was loaded. */
export async function restoreAutosave(): Promise<boolean> {
  const { loadProject, logMessage } = useEditor.getState();
  const text = await readAutosaveText();
  if (!text) return false;
  try {
    const { project, warnings } = projectFromBundle(JSON.parse(text), componentRegistry);
    loadProject(project);
    logMessage('info', `Restored "${project.name}" from local autosave`);
    for (const w of warnings) logMessage('warn', w);
    return true;
  } catch (e) {
    logMessage('error', `Could not restore autosave: ${(e as Error).message}`);
    return false;
  }
}

/** Persists the project shortly after each change. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    clearTimeout(timer);
    timer = setTimeout(() => void writeAutosave(useEditor.getState().project), 300);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

async function writeAutosave(project: Project): Promise<void> {
  const text = JSON.stringify(projectToBundle(project));
  try {
    await dbPut(AUTOSAVE_KEY, text);
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch {
      // ignore
    }
  } catch {
    try {
      localStorage.setItem(AUTOSAVE_KEY, text);
    } catch (e) {
      useEditor.getState().logMessage('warn', `Autosave failed: ${(e as Error).message}`);
    }
  }
}

export function newProject(): void {
  const project = createProject(componentRegistry);
  // Undoable, so there is no need to ask "are you sure?".
  useEditor.getState().replaceProject('New project', project);
  useEditor.getState().logMessage('info', 'Created a new project');
}

/**
 * Offers a text file to save: through the viewer in the published app (the
 * user confirms), as an ordinary download elsewhere.
 */
export async function offerTextFile(filename: string, text: string, type = 'application/json'): Promise<'saved' | 'declined' | 'failed'> {
  const blob = new Blob([text], { type });
  const downloads = await claudeCapability<ViewerDownloads>('downloads');
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      return 'saved';
    } catch (e) {
      return (e as { code?: string }).code === 'declined' ? 'declined' : 'failed';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'saved';
}

/**
 * Downloads the project as one bundle file. In the published app (claude.ai)
 * the viewer offers the file instead (pages may not download by themselves):
 * the user confirms the name and it is saved like any download.
 */
export async function saveProjectToFile(): Promise<void> {
  const { project, markSaved, logMessage } = useEditor.getState();
  const text = JSON.stringify(projectToBundle(project), null, 2);
  const filename = `${slugify(project.name) || 'project'}${PROJECT_FILE_EXTENSION}`;
  const blob = new Blob([text], { type: 'application/json' });
  void writeAutosave(project);

  const downloads = await claudeCapability<ViewerDownloads>('downloads');
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      markSaved();
      logMessage('info', `Saved "${project.name}" (${filename})`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') logMessage('info', 'Save cancelled');
      else if (code === 'rate_limited') logMessage('warn', 'A save is already waiting for your answer');
      else logMessage('error', `Could not save the file here (${code ?? 'unknown'}). Your work is still kept in this browser.`);
    }
    return;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  markSaved();
  logMessage('info', `Saved "${project.name}" (${filename})`);
}

export async function openProjectFile(file: File): Promise<void> {
  const { replaceProject, logMessage } = useEditor.getState();
  try {
    const { project, warnings } = projectFromBundle(JSON.parse(await file.text()), componentRegistry);
    replaceProject(`Open ${file.name}`, project);
    logMessage('info', `Opened "${project.name}" from ${file.name}`);
    for (const w of warnings) logMessage('warn', w);
  } catch (e) {
    logMessage('error', `Could not open ${file.name}: ${(e as Error).message}`);
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
