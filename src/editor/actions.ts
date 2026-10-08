/** Editor-level actions shared by menus and keyboard shortcuts. */
import { addRelationship, removeRelationship } from '../core/logic/mutations';
import type { ResolvedEntity } from '../core/model/resolve';
import { getWorldBounds } from '../core/model/geometry';
import { duplicateEntities, moveEntities, removeEntities } from '../core/model/mutations';
import { resolveSceneEntities } from './selectors';
import { useEditor } from './store';

export function deleteSelection(): void {
  const { selectedEntityIds: ids, selectedConnectionId, activeSceneId, edit } = useEditor.getState();
  if (selectedConnectionId) {
    edit('Remove connection', (p) => removeRelationship(p, activeSceneId, selectedConnectionId));
    return;
  }
  if (!ids.length) return;
  edit(ids.length === 1 ? 'Delete entity' : `Delete ${ids.length} entities`, (p) => removeEntities(p, activeSceneId, ids));
}

export function duplicateSelection(): void {
  const { selectedEntityIds: ids, activeSceneId, edit, project, selectEntities } = useEditor.getState();
  if (!ids.length) return;
  const g = project.settings.gridSize;
  let created: string[] = [];
  const ok = edit('Duplicate', (p) => {
    created = duplicateEntities(p, activeSceneId, ids, { x: g, y: g });
  });
  if (ok) selectEntities(created);
}

export function selectAll(): void {
  const { project, activeSceneId, selectEntities } = useEditor.getState();
  selectEntities(project.scenes.find((s) => s.id === activeSceneId)?.entities.map((e) => e.id) ?? []);
}

export function nudgeSelection(dx: number, dy: number): void {
  const { selectedEntityIds: ids, activeSceneId, edit } = useEditor.getState();
  if (!ids.length) return;
  edit('Nudge', (p) => moveEntities(p, activeSceneId, ids, { x: dx, y: dy }));
}

let viewSize = { width: 800, height: 500 };

/** Called by the viewport when it resizes, so framing knows the visible area. */
export function setViewportSize(width: number, height: number): void {
  viewSize = { width, height };
}

/** Whether any of these entities is at least partly on screen (with the camera given, or the current one). */
export function anyInView(subset: ResolvedEntity[], camera = useEditor.getState().camera): boolean {
  const hw = viewSize.width / 2 / camera.zoom;
  const hh = viewSize.height / 2 / camera.zoom;
  return subset.some((e) => {
    const b = getWorldBounds(e);
    return b.maxX > camera.x - hw && b.minX < camera.x + hw && b.maxY > camera.y - hh && b.minY < camera.y + hh;
  });
}

/**
 * Makes sure what an AI change built can be seen: a big change (a level) is
 * framed whole; a smaller one only when none of it is on screen.
 */
export function revealCreated(createdIds: readonly string[]): void {
  const { project, activeSceneId } = useEditor.getState();
  const ids = new Set(createdIds);
  const created = resolveSceneEntities(project, activeSceneId).filter((e) => ids.has(e.id));
  if (!created.length) return;
  if (created.length >= 10 || !anyInView(created)) frameEntities(created);
}

/**
 * Each level keeps the view it was left with (this session). Coming back to a
 * level shows that view again, unless nothing of the level is in it; a level
 * not seen yet (or seen from somewhere empty) is framed whole, so a level is
 * never opened looking at an empty spot far from it.
 */
const levelViews = new Map<string, { x: number; y: number; zoom: number }>();
useEditor.subscribe((s, prev) => {
  if (s.activeSceneId === prev.activeSceneId) return;
  levelViews.set(prev.activeSceneId, prev.camera);
  const all = resolveSceneEntities(s.project, s.activeSceneId);
  const saved = levelViews.get(s.activeSceneId);
  if (saved && (!all.length || anyInView(all, saved))) s.setCamera(saved);
  else if (all.length) frameEntities(all);
});

/** The view shows the level at all (on opening the editor, or a project): if not, frame it. */
export function ensureLevelInView(): void {
  const { project, activeSceneId } = useEditor.getState();
  const all = resolveSceneEntities(project, activeSceneId);
  if (all.length && !anyInView(all)) frameEntities(all);
}

/** Centers and zooms the view on the selection, or on all entities if nothing is selected. */
export function frameView(): void {
  const { project, activeSceneId, selectedEntityIds } = useEditor.getState();
  const all = resolveSceneEntities(project, activeSceneId);
  frameEntities(selectedEntityIds.length ? all.filter((e) => selectedEntityIds.includes(e.id)) : all);
}

/** Zooms and pans so these entities fill the view. */
export function frameEntities(subset: ResolvedEntity[]): void {
  const { width: viewWidth, height: viewHeight } = viewSize;
  const { setCamera } = useEditor.getState();
  if (!subset.length) {
    setCamera({ x: 0, y: 0, zoom: 1 });
    return;
  }
  const b = subset.map(getWorldBounds).reduce((a, r) => ({
    minX: Math.min(a.minX, r.minX),
    minY: Math.min(a.minY, r.minY),
    maxX: Math.max(a.maxX, r.maxX),
    maxY: Math.max(a.maxY, r.maxY),
  }));
  const w = Math.max(64, b.maxX - b.minX);
  const h = Math.max(64, b.maxY - b.minY);
  const zoom = Math.min(4, Math.max(0.1, Math.min(viewWidth / (w * 1.3), viewHeight / (h * 1.3))));
  setCamera({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, zoom });
}

/**
 * Connects a switch to another object (dragging from the switch's red connector):
 * by default the switch opens it. An existing connection between the two is
 * selected instead of adding a second one. The new connection is selected, so
 * its prompt is ready ("the switch moves the door three squares up").
 */
export function connectSwitch(switchId: string, targetId: string): void {
  const { project, activeSceneId, edit, selectConnection, logMessage } = useEditor.getState();
  const scene = project.scenes.find((s) => s.id === activeSceneId);
  if (!scene) return;
  const existing = scene.relationships.find(
    (r) => r.type === 'controls' && r.source.kind === 'entity' && r.source.id === switchId && r.target.kind === 'entity' && r.target.id === targetId,
  );
  if (existing) {
    selectConnection(existing.id);
    return;
  }
  let id = '';
  const names = (eid: string) => scene.entities.find((e) => e.id === eid)?.name ?? '?';
  const ok = edit(`Connect ${names(switchId)} to ${names(targetId)}`, (p) => {
    id = addRelationship(p, activeSceneId, { type: 'controls', source: { kind: 'entity', id: switchId }, target: { kind: 'entity', id: targetId }, params: { action: 'open' }, conditions: [] });
  });
  if (ok) {
    selectConnection(id);
    logMessage('info', `${names(switchId)} now opens ${names(targetId)}`);
  }
}
