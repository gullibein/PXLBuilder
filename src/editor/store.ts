/**
 * Editor state.
 *
 * The project (game definition) is immutable data replaced on every change.
 * All project changes go through `edit()`, which validates them (via the
 * mutation layer), records one undoable Transaction, and keeps selection
 * consistent. AI operations take the exact same path.
 *
 * Selection is also the AI context: one selected entity, two (a relationship),
 * several (a group), or the level itself (`worldContext`).
 */
import { produce } from 'immer';
import { create } from 'zustand';
import { contextFromSelection, type AIContext } from '../core/ai/context';
import { EMPTY_HISTORY, record, redo, undo, type History, type TransactionSource } from '../core/commands/history';
import type { Operation } from '../core/commands/operations';
import { componentRegistry } from '../core/components/builtin';
import { createProject } from '../core/model/factory';
import { ModelError } from '../core/model/mutations';
import type { Id, Project, Vec2 } from '../core/types';
import type { Camera } from '../render/renderer';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  message: string;
}

export interface EditOptions {
  source?: TransactionSource;
  changes?: string[];
  operations?: Operation[];
  coalesceKey?: string;
}

export type DockPanel = 'library' | 'create' | null;

/** Select (click, drag, box-select) or brush (draw copies of a library object onto the level). */
export type Tool = { kind: 'select' } | { kind: 'brush'; definitionId: Id };
export type TrayTab = 'history' | 'console';

export interface EditorState {
  project: Project;
  activeSceneId: Id;
  /** Selected entities in the active scene, in the order they were selected. */
  selectedEntityIds: Id[];
  /** Library object open in the details drawer. */
  selectedDefinitionId: Id | null;
  /** When set, the level itself is the active context, anchored at this world point (or the view center). */
  worldContext: { point: Vec2 | null } | null;
  /** The global (not object-bound) prompt. */
  globalPrompt: { open: boolean; scope: 'level' | 'project' };
  camera: Camera;
  showGrid: boolean;
  snapToGrid: boolean;
  dirty: boolean;
  log: LogEntry[];
  history: History;
  inspectorOpen: boolean;
  tray: { open: boolean; tab: TrayTab };
  dock: DockPanel;
  tool: Tool;
  /** The object the pen draws with when picked from the tool panel (the last one used). */
  lastBrushId: Id | null;
  /** The background card is open (it is the active context; no object prompt then). */
  backgroundOpen: boolean;
  /** Object whose Sprites panel is open. */
  spritesFor: Id | null;

  /** Applies a change to the project as one undoable transaction. Returns false (and logs) if the change was rejected. */
  edit(label: string, recipe: (draft: Project) => void, opts?: EditOptions): boolean;
  /** Replaces the whole project as an undoable change (New, Open). */
  replaceProject(label: string, project: Project): void;
  /** Loads a project without history (startup restore). */
  loadProject(project: Project): void;
  undo(): void;
  redo(): void;
  markSaved(): void;
  setActiveScene(sceneId: Id): void;
  selectEntities(ids: Id[]): void;
  selectDefinition(id: Id | null): void;
  setWorldContext(point: Vec2 | null | false): void;
  setGlobalPrompt(open: boolean, scope?: 'level' | 'project'): void;
  setCamera(camera: Partial<Camera>): void;
  setShowGrid(show: boolean): void;
  setSnapToGrid(snap: boolean): void;
  setInspectorOpen(open: boolean): void;
  setTray(tray: Partial<EditorState['tray']>): void;
  setDock(dock: DockPanel): void;
  setTool(tool: Tool): void;
  /** Switches to drawing with the last used object (or the first tile object). */
  usePen(): void;
  setBackgroundOpen(open: boolean): void;
  openSprites(definitionId: Id | null): void;
  logMessage(level: LogLevel, message: string): void;
  clearLog(): void;
}

let logId = 0;

/** Keeps selection valid after the project changes underneath it. */
function reconcile(s: EditorState, next: Project): Partial<EditorState> {
  const scene = next.scenes.find((sc) => sc.id === s.activeSceneId) ?? next.scenes[0];
  const existing = new Set(scene.entities.map((e) => e.id));
  const defExists = next.definitions.some((d) => d.id === s.selectedDefinitionId);
  return {
    project: next,
    activeSceneId: scene.id,
    selectedEntityIds: s.selectedEntityIds.filter((id) => existing.has(id)),
    selectedDefinitionId: defExists ? s.selectedDefinitionId : null,
    spritesFor: next.definitions.some((d) => d.id === s.spritesFor) ? s.spritesFor : null,
    tool: s.tool.kind === 'brush' && !next.definitions.some((d) => d.id === (s.tool as { definitionId: Id }).definitionId) ? { kind: 'select' } : s.tool,
    dirty: true,
  };
}

export const useEditor = create<EditorState>()((set, get) => {
  const initial = createProject(componentRegistry);
  return {
    project: initial,
    activeSceneId: initial.startSceneId,
    selectedEntityIds: [],
    selectedDefinitionId: null,
    worldContext: null,
    globalPrompt: { open: false, scope: 'level' },
    camera: { x: 0, y: 0, zoom: 1 },
    showGrid: true,
    snapToGrid: true,
    dirty: false,
    log: [],
    history: EMPTY_HISTORY,
    inspectorOpen: false,
    tray: { open: false, tab: 'history' },
    dock: null,
    tool: { kind: 'select' },
    lastBrushId: null,
    backgroundOpen: false,
    spritesFor: null,

    edit(label, recipe, opts = {}) {
      const before = get().project;
      let next: Project;
      try {
        // Braces discard any value the recipe returns (immer would treat it as a replacement project).
        next = produce(before, (draft) => {
          recipe(draft);
        });
      } catch (e) {
        if (e instanceof ModelError) {
          get().logMessage('error', `${label}: ${e.message}`);
          return false;
        }
        throw e;
      }
      if (next === before) return true;
      set((s) => ({
        ...reconcile(s, next),
        history: record(s.history, {
          label,
          source: opts.source ?? 'user',
          time: Date.now(),
          before,
          after: next,
          changes: opts.changes ?? [],
          operations: opts.operations ?? [],
          coalesceKey: opts.coalesceKey,
        }),
      }));
      return true;
    },

    replaceProject(label, project) {
      const before = get().project;
      set((s) => ({
        project,
        activeSceneId: project.startSceneId,
        selectedEntityIds: [],
        selectedDefinitionId: null,
        worldContext: null,
        dirty: true,
        history: record(s.history, { label, source: 'user', time: Date.now(), before, after: project, changes: [], operations: [] }),
      }));
    },

    loadProject(project) {
      set({
        project,
        activeSceneId: project.startSceneId,
        selectedEntityIds: [],
        selectedDefinitionId: null,
        worldContext: null,
        camera: { x: 0, y: 0, zoom: 1 },
        dirty: false,
        history: EMPTY_HISTORY,
      });
    },

    undo() {
      const result = undo(get().history);
      if (!result) return;
      set((s) => ({ ...reconcile(s, result.project), history: result.history }));
      get().logMessage('info', `Undid: ${result.transaction.label}`);
    },

    redo() {
      const result = redo(get().history);
      if (!result) return;
      set((s) => ({ ...reconcile(s, result.project), history: result.history }));
      get().logMessage('info', `Redid: ${result.transaction.label}`);
    },

    markSaved() {
      set({ dirty: false });
    },

    setActiveScene(sceneId) {
      if (!get().project.scenes.some((s) => s.id === sceneId)) return;
      set({ activeSceneId: sceneId, selectedEntityIds: [], worldContext: null, camera: { x: 0, y: 0, zoom: get().camera.zoom } });
    },

    selectEntities(ids) {
      const unique = [...new Set(ids)];
      set({
        selectedEntityIds: unique,
        worldContext: unique.length ? null : get().worldContext,
        selectedDefinitionId: unique.length ? null : get().selectedDefinitionId,
        backgroundOpen: unique.length ? false : get().backgroundOpen,
        spritesFor: unique.length ? null : get().spritesFor,
      });
    },

    selectDefinition(id) {
      set({ selectedDefinitionId: id, selectedEntityIds: id ? [] : get().selectedEntityIds, worldContext: id ? null : get().worldContext });
    },

    setWorldContext(point) {
      if (point === false) set({ worldContext: null });
      else set({ worldContext: { point }, selectedEntityIds: [], selectedDefinitionId: null, backgroundOpen: false });
    },

    setGlobalPrompt(open, scope) {
      set((s) => ({ globalPrompt: { open, scope: scope ?? s.globalPrompt.scope } }));
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

    setInspectorOpen(inspectorOpen) {
      set({ inspectorOpen });
    },

    setTray(tray) {
      set((s) => ({ tray: { ...s.tray, ...tray } }));
    },

    setDock(dock) {
      set({ dock });
    },

    setTool(tool) {
      // Drawing has no selection: the prompt steps aside until you go back to selecting.
      if (tool.kind === 'brush') {
        set({ tool, lastBrushId: tool.definitionId, selectedEntityIds: [], worldContext: null, selectedDefinitionId: null, backgroundOpen: false });
      } else set({ tool });
    },

    usePen() {
      const { project, lastBrushId } = get();
      const pick =
        project.definitions.find((d) => d.id === lastBrushId) ??
        project.definitions.find((d) => d.metadata.placement === 'tile') ??
        project.definitions[0];
      if (pick) get().setTool({ kind: 'brush', definitionId: pick.id });
    },

    openSprites(definitionId) {
      if (definitionId) set({ spritesFor: definitionId, dock: null, backgroundOpen: false, selectedEntityIds: [], worldContext: null, tool: { kind: 'select' } });
      else set({ spritesFor: null });
    },

    setBackgroundOpen(open) {
      if (open) set({ spritesFor: null, backgroundOpen: true, selectedEntityIds: [], worldContext: null, selectedDefinitionId: null, globalPrompt: { ...get().globalPrompt, open: false } });
      else set({ backgroundOpen: false });
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

/** The AI context implied by the current selection, or null when nothing is selected. */
export function getSelectionContext(state: Pick<EditorState, 'activeSceneId' | 'selectedEntityIds' | 'worldContext'>): AIContext | null {
  const fromSelection = contextFromSelection(state.activeSceneId, state.selectedEntityIds);
  if (fromSelection) return fromSelection;
  if (state.worldContext) return { kind: 'level', sceneId: state.activeSceneId, point: state.worldContext.point };
  return null;
}
