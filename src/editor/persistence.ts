import { componentRegistry } from '../core/components/builtin';
import { createProject } from '../core/model/factory';
import { projectFromBundle, projectToBundle } from '../core/serialization/serialize';
import type { Project } from '../core/types';
import { useEditor } from './store';

const AUTOSAVE_KEY = 'pxlbuilder.autosave';
export const PROJECT_FILE_EXTENSION = '.pxlproj.json';

/** Restores the autosaved project, if any. Returns true if one was loaded. */
export function restoreAutosave(): boolean {
  const { loadProject, logMessage } = useEditor.getState();
  let text: string | null = null;
  try {
    text = localStorage.getItem(AUTOSAVE_KEY);
  } catch {
    return false;
  }
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

/** Persists the project to local storage shortly after each change. */
export function startAutosave(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = useEditor.subscribe((state, prev) => {
    if (state.project === prev.project) return;
    clearTimeout(timer);
    timer = setTimeout(() => writeAutosave(useEditor.getState().project), 300);
  });
  return () => {
    clearTimeout(timer);
    unsubscribe();
  };
}

function writeAutosave(project: Project): void {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(projectToBundle(project)));
  } catch (e) {
    useEditor.getState().logMessage('warn', `Autosave failed: ${(e as Error).message}`);
  }
}

export function newProject(): void {
  const project = createProject(componentRegistry);
  useEditor.getState().loadProject(project);
  writeAutosave(project);
  useEditor.getState().logMessage('info', 'Created a new project');
}

/** Downloads the project as a single bundle file. */
export function saveProjectToFile(): void {
  const { project, markSaved, logMessage } = useEditor.getState();
  const text = JSON.stringify(projectToBundle(project), null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slugify(project.name) || 'project'}${PROJECT_FILE_EXTENSION}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  writeAutosave(project);
  markSaved();
  logMessage('info', `Saved "${project.name}" (${a.download})`);
}

export async function openProjectFile(file: File): Promise<void> {
  const { loadProject, logMessage } = useEditor.getState();
  try {
    const { project, warnings } = projectFromBundle(JSON.parse(await file.text()), componentRegistry);
    loadProject(project);
    writeAutosave(project);
    logMessage('info', `Opened "${project.name}" from ${file.name}`);
    for (const w of warnings) logMessage('warn', w);
  } catch (e) {
    logMessage('error', `Could not open ${file.name}: ${(e as Error).message}`);
  }
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
