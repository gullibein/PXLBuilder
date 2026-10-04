/** Editor-level actions shared by menus and keyboard shortcuts. */
import { getWorldBounds } from '../core/model/geometry';
import { duplicateEntities, moveEntities, removeEntities } from '../core/model/mutations';
import { resolveSceneEntities } from './selectors';
import { useEditor } from './store';

export function deleteSelection(): void {
  const { selectedEntityIds: ids, activeSceneId, edit } = useEditor.getState();
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

/** Centers and zooms the view on the selection, or on all entities if nothing is selected. */
export function frameView(): void {
  const { width: viewWidth, height: viewHeight } = viewSize;
  const { project, activeSceneId, selectedEntityIds, setCamera } = useEditor.getState();
  const all = resolveSceneEntities(project, activeSceneId);
  const subset = selectedEntityIds.length ? all.filter((e) => selectedEntityIds.includes(e.id)) : all;
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
