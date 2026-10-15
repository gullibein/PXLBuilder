import { produce } from 'immer';
import { changeSpriteResolution } from '../core/model/mutations';
import { DEFAULT_SPRITE_RESOLUTION, type SpriteResolution } from '../core/model/spriteResolution';
import { claudeCapability, type ViewerDownloads } from './claudeViewer';
import { componentRegistry } from '../core/components/builtin';
import { createProject } from '../core/model/factory';
import { gameFromText, projectFromBundle, projectToBundle } from '../core/serialization/serialize';
import type { GameType, Project } from '../core/types';
import { useEditor } from './store';
import { aiHistoryFor, restoreAIHistory } from './ai/aiLog';
import { withoutUnused } from '../core/model/unused';
import { cloudSavesAvailable, saveToCloud } from './cloudSaves';

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

/**
 * A new game of the chosen kind. On the first visit it simply becomes the
 * game; later it replaces the current one as an undoable step, so there is no
 * need to ask "are you sure?".
 */
export function startNewGame(gameType: GameType, first = false, spriteResolution: SpriteResolution = DEFAULT_SPRITE_RESOLUTION): void {
  const project = starterProject(gameType, spriteResolution);
  const kind = gameType === 'topdown' ? 'top-down game' : 'platformer';
  if (first) useEditor.getState().loadProject(project);
  else useEditor.getState().replaceProject('New project', project);
  useEditor.getState().logMessage('info', `Started a new ${kind}`);
}

/** A new game from a starter, at a sprite size. */
function starterProject(gameType: GameType, spriteResolution: SpriteResolution): Project {
  return produce(createProject(componentRegistry, 'Untitled Game', gameType), (p) => {
    if (spriteResolution !== DEFAULT_SPRITE_RESOLUTION) changeSpriteResolution(p, spriteResolution, componentRegistry);
  });
}

/**
 * Makes the brand-new game over from another starter (the AI found it a better start for what the user asked):
 * same game, level ids, name and sprite size, so the prompt building it carries on.
 */
export function switchStarter(gameType: GameType): void {
  const now = useEditor.getState().project;
  const fresh = starterProject(gameType, now.settings.spriteResolution ?? DEFAULT_SPRITE_RESOLUTION);
  const sceneId = now.startSceneId;
  const project = produce(fresh, (p) => {
    p.id = now.id;
    p.name = now.name;
    p.scenes[0].id = sceneId;
    p.startSceneId = sceneId;
  });
  useEditor.getState().replaceProject(gameType === 'topdown' ? 'Top-down starter' : 'Platformer starter', project);
  useEditor.getState().logMessage('info', `Switched the new game to the ${gameType === 'topdown' ? 'top-down' : 'platformer'} starter`);
}

/**
 * Offers a text file to save: through the viewer in the published app (the
 * user confirms), as an ordinary download elsewhere.
 */
export async function offerTextFile(filename: string, text: string, type = 'application/json'): Promise<'saved' | 'declined' | 'failed'> {
  return offerFile(filename, new Blob([text], { type }));
}

/** Offers any file (a PNG…) to save, the same way. */
export async function offerFile(filename: string, blob: Blob): Promise<'saved' | 'declined' | 'failed'> {
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

const DROP_KEY = 'pxlbuilder.saveDropUnused';
/** Whether saves leave out the objects no level uses (the Save window's choice, remembered in this browser). */
export function dropUnusedChoice(): boolean {
  try {
    return localStorage.getItem(DROP_KEY) === '1';
  } catch {
    return false;
  }
}
export function setDropUnusedChoice(on: boolean): void {
  try {
    localStorage.setItem(DROP_KEY, on ? '1' : '0');
  } catch {
    // Not remembered; fine.
  }
}

export const sizeText = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** The game as a saved file's text (with its AI History, for the user to read back; never sent to the AI). */
function gameFileText(dropUnused: boolean): string {
  const { project, logMessage } = useEditor.getState();
  let saved = project;
  if (dropUnused) {
    const r = withoutUnused(project);
    saved = r.project;
    if (r.objects.length) logMessage('info', `Left out of the save: ${r.objects.length} unused object${r.objects.length === 1 ? '' : 's'} (${r.objects.join(', ')})${r.pictures ? ` and ${r.pictures} picture${r.pictures === 1 ? '' : 's'} only they used` : ''}. They are still here in the editor.`);
  }
  return JSON.stringify({ ...projectToBundle(saved), aiHistory: aiHistoryFor(project.id) });
}

/**
 * Save in one step (the Save button, Ctrl+S): in the published app on
 * claude.ai, kept with the app (no download dialogs; Open lists it);
 * elsewhere as a file (in Chrome and Edge over the file saved to before).
 * Resolves whether it was saved.
 */
export async function quickSave(): Promise<boolean> {
  const { project, markSaved, logMessage } = useEditor.getState();
  if (await cloudSavesAvailable()) {
    void writeAutosave(project);
    const r = await saveToCloud(project.id, project.name, gameFileText(dropUnusedChoice()));
    if (r.ok) {
      markSaved();
      logMessage('info', `Saved "${project.name}" (${sizeText(r.bytes)}): Open lists it. Save as file… gives you a copy on your computer.`);
      return true;
    }
    logMessage('error', `Could not save here (${r.error}). Your work is still kept in this browser; Save as file… saves a copy on your computer.`);
    return false;
  }
  await saveProjectToFile({ dropUnused: dropUnusedChoice() });
  return !useEditor.getState().dirty;
}

/** Opens a game from a saved file's text (a file from the computer, or a save kept with the app). */
export function openGameText(text: string, from: string): void {
  const { replaceProject, logMessage } = useEditor.getState();
  try {
    const { project, warnings } = gameFromText(text, componentRegistry);
    replaceProject(`Open ${from}`, project);
    logMessage('info', `Opened "${project.name}" from ${from}`);
    if (text.trimStart().startsWith('{')) restoreAIHistory(project.id, (JSON.parse(text) as { aiHistory?: unknown }).aiHistory);
    for (const w of warnings) logMessage('warn', w);
  } catch (e) {
    logMessage('error', `Could not open ${from}: ${(e as Error).message}`);
  }
}

/** Where each game was last saved, when the browser lets the page write files itself (Chrome, Edge): Save replaces it. */
const savedFiles = new Map<string, FileSystemFileHandleLike>();

interface FileSystemFileHandleLike {
  name: string;
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
  queryPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(o: { mode: 'readwrite' }): Promise<PermissionState>;
}
type SaveFilePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<FileSystemFileHandleLike>;

/** The file this game was saved to in this visit (Save writes over it), if any. */
export function savedFileName(projectId: string): string | null {
  return savedFiles.get(projectId)?.name ?? null;
}

/** Whether Save can write a file itself (and so replace it), rather than download a new copy each time. */
export function canReplaceFiles(): boolean {
  return typeof (window as { showSaveFilePicker?: unknown }).showSaveFilePicker === 'function';
}

export interface SaveOptions {
  /** Leave out the library objects no level uses (and pictures only they show). */
  dropUnused?: boolean;
  /** Choose a new file even if the game was saved to one already. */
  asNew?: boolean;
}

/**
 * Saves the project as one bundle file. In the published app (claude.ai) the
 * viewer offers the file instead (pages may not download by themselves): the
 * user confirms the name and it is saved like any download. Where the browser
 * lets the page write files (Chrome, Edge), the first Save asks where, and the
 * next ones write over that file; elsewhere it is an ordinary download.
 */
export async function saveProjectToFile(options: SaveOptions = {}): Promise<void> {
  const { project, markSaved, logMessage } = useEditor.getState();
  const text = gameFileText(options.dropUnused ?? false);
  const filename = `${slugify(project.name) || 'project'}${PROJECT_FILE_EXTENSION}`;
  const blob = new Blob([text], { type: 'application/json' });
  const size = sizeText(blob.size);
  void writeAutosave(project);

  const downloads = await claudeCapability<ViewerDownloads>('downloads');
  if (downloads) {
    try {
      await downloads.save({ filename, data: blob });
      markSaved();
      logMessage('info', `Saved "${project.name}" (${filename}, ${size})`);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'declined') logMessage('info', 'Save cancelled');
      else if (code === 'rate_limited') logMessage('warn', 'A save is already waiting for your answer');
      else logMessage('error', `Could not save the file here (${code ?? 'unknown'}). Your work is still kept in this browser.`);
    }
    return;
  }

  const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (typeof picker === 'function') {
    try {
      let handle = options.asNew ? undefined : savedFiles.get(project.id);
      if (handle?.requestPermission && (await handle.queryPermission?.({ mode: 'readwrite' })) !== 'granted' && (await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') handle = undefined;
      handle ??= await picker.call(window, { suggestedName: filename, types: [{ description: 'PXLBuilder game', accept: { 'application/json': ['.json'] } }] });
      const out = await handle.createWritable();
      await out.write(blob);
      await out.close();
      savedFiles.set(project.id, handle);
      markSaved();
      logMessage('info', `Saved "${project.name}" (${handle.name}, ${size})`);
      return;
    } catch (e) {
      if ((e as { name?: string }).name === 'AbortError') {
        logMessage('info', 'Save cancelled');
        return;
      }
      // Not allowed here (e.g. inside another site's frame): an ordinary download instead.
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
  markSaved();
  logMessage('info', `Saved "${project.name}" (${filename}, ${size})`);
}

export async function openProjectFile(file: File): Promise<void> {
  try {
    openGameText(await file.text(), file.name);
  } catch (e) {
    useEditor.getState().logMessage('error', `Could not open ${file.name}: ${(e as Error).message}`);
  }
}

export function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
