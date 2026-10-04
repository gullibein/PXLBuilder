/**
 * Editor state. The project (game definition) is immutable data replaced on
 * every edit; all project changes go through `edit()`, which is the single seam
 * where the command/transaction system (undo/redo, AI operations) will attach.
 */
import { produce } from 'immer';
import { create } from 'zustand';
import { componentRegistry } from '../core/components/builtin';
import { createProject } from '../core/model/factory';
import { ModelError } from '../core/model/mutations';
import type { Id, Project } from '../core/types';
import type { Camera } from '../render/renderer';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  message: string;
}

export interface EditorState {
  project: Project;
  activeSceneId: Id;
  /** Selected scene entities in the active scene (multi-selection). */
  selectedEntityIds: Id[];
  /** Selected object definition (library). Mutually exclusive with entity selection. */
  selectedDefinitionId: Id | null;
  camera: Camera;
  showGrid: boolean;
  snapToGrid: boolean;
  dirty: boolean;
  log: LogEntry[];

  /** Applies a change to the project. Returns false (and logs) if the change was rejected. */
  edit(label: string, recipe: (draft: Project) => void): boolean;
  /** Replaces the whole project (new / open). */
  loadProject(project: Project, opts?: { dirty?: boolean }): void;
  markSaved(): void;
  setActiveScene(sceneId: Id): void;
  selectEntities(ids: Id[]): void;
  selectDefinition(id: Id | null): void;
  setCamera(camera: Partial<Camera>): void;
  setShowGrid(show: boolean): void;
  setSnapToGrid(snap: boolean): void;
  logMessage(level: LogLevel, message: string): void;
  clearLog(): void;
}

let logId = 0;

export const useEditor = create<EditorState>()((set, get) => {
  const initial = createProject(componentRegistry);
  return {
    project: initial,
    activeSceneId: initial.startSceneId,
    selectedEntityIds: [],
    selectedDefinitionId: null,
    camera: { x: 0, y: 0, zoom: 1 },
    showGrid: true,
    snapToGrid: true,
    dirty: false,
    log: [],

    edit(label, recipe) {
      let next: Project;
      try {
        // Braces discard any value the recipe returns (immer would treat it as a replacement project).
        next = produce(get().project, (draft) => {
          recipe(draft);
        });
      } catch (e) {
        if (e instanceof ModelError) {
          get().logMessage('error', `${label}: ${e.message}`);
          return false;
        }
        throw e;
      }
      if (next === get().project) return true;
      set((s) => {
        const scene = next.scenes.find((sc) => sc.id === s.activeSceneId) ?? next.scenes[0];
        const existing = new Set(scene.entities.map((e) => e.id));
        const defExists = next.definitions.some((d) => d.id === s.selectedDefinitionId);
        return {
          project: next,
          activeSceneId: scene.id,
          selectedEntityIds: s.selectedEntityIds.filter((id) => existing.has(id)),
          selectedDefinitionId: defExists ? s.selectedDefinitionId : null,
          dirty: true,
        };
      });
      return true;
    },

    loadProject(project, opts = {}) {
      set({
        project,
        activeSceneId: project.startSceneId,
        selectedEntityIds: [],
        selectedDefinitionId: null,
        camera: { x: 0, y: 0, zoom: 1 },
        dirty: opts.dirty ?? false,
      });
    },

    markSaved() {
      set({ dirty: false });
    },

    setActiveScene(sceneId) {
      if (!get().project.scenes.some((s) => s.id === sceneId)) return;
      set({ activeSceneId: sceneId, selectedEntityIds: [], camera: { x: 0, y: 0, zoom: get().camera.zoom } });
    },

    selectEntities(ids) {
      set({ selectedEntityIds: [...new Set(ids)], selectedDefinitionId: ids.length ? null : get().selectedDefinitionId });
    },

    selectDefinition(id) {
      set({ selectedDefinitionId: id, selectedEntityIds: id ? [] : get().selectedEntityIds });
    },

    setCamera(camera) {
      set((s) => ({ camera: { ...s.camera, ...camera } }));
    },

    setShowGrid(showGrid) {
      set({ showGrid });
    },

    setSnapToGrid(snapToGrid) {
      set({ snapToGrid });
    },

    logMessage(level, message) {
      set((s) => ({ log: [...s.log.slice(-199), { id: ++logId, time: Date.now(), level, message }] }));
    },

    clearLog() {
      set({ log: [] });
    },
  };
});

export function getActiveScene(state: Pick<EditorState, 'project' | 'activeSceneId'>) {
  return state.project.scenes.find((s) => s.id === state.activeSceneId) ?? state.project.scenes[0];
}
