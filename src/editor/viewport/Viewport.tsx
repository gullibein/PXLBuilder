import { useEffect, useRef } from 'react';
import { containsPoint, getEntitySize, getWorldBounds, rectsIntersect, type Rect } from '../../core/model/geometry';
import { instantiateDefinition } from '../../core/model/factory';
import { addEntity, moveEntities, removeEntities } from '../../core/model/mutations';
import { cellAt, cellCenter, cellKey, cellSize, cellsOnLine, constrainToAxis, snapToCell, type Cell } from '../../core/model/placement';
import { resolveEntity, type ResolvedEntity } from '../../core/model/resolve';
import { componentRegistry } from '../../core/components/builtin';
import type { Id, Project, Scene, Vec2 } from '../../core/types';
import { resolveRef } from '../../core/logic/refs';
import { relationshipRegistry } from '../../core/logic/vocabulary';
import { relationshipLabel } from '../../core/logic/describe';
import { connectSwitch } from '../actions';
import { applyCamera, drawBackground, drawEntities, screenToWorld, worldToScreen, type Camera, type ImageLookup, type ViewSize } from '../../render/renderer';
import { imageLookup } from '../images';
import { setViewportSize } from '../actions';
import { publishAnchor } from '../prompt/anchor';
import { resolveSceneEntities } from '../selectors';
import { getActiveScene, getSelectionContext, useEditor } from '../store';
import { contextKey } from '../../core/ai/context';
import { theme } from '../theme';
import { jobMarks, useJobs } from '../ai/jobs';
import { cameraFrame, drawCameraFrame } from '../overlays/cameraFrame';
import { drawInfoPanels, drawJumpArcs } from '../overlays/drawOverlays';
import { createWheelInterpreter } from './wheel';

export const DEFINITION_DRAG_TYPE = 'application/x-pxlbuilder-definition';

type Drag =
  | { kind: 'pan'; startScreen: Vec2; startCamera: Camera; moved: boolean }
  | { kind: 'move'; startWorld: Vec2; anchor: Vec2; anchorId: Id; ids: Id[]; delta: Vec2 }
  | { kind: 'marquee'; startWorld: Vec2; currentWorld: Vec2; additive: boolean; baseSelection: Id[]; moved: boolean }
  /** A brush stroke: cells visited so far (painted on release as one undoable step). */
  | { kind: 'paint'; definitionId: Id; erase: boolean; start: Cell; last: Cell; cells: Map<string, Cell> }
  /** Dragging from a switch's red connector onto another object. */
  | { kind: 'connect'; fromId: Id; from: Vec2; current: Vec2; targetId: Id | null };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** Screen space reserved by floating chrome, so the prompt avoids it. */
export const CHROME_INSETS = { top: 4, bottom: 76 };

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

/** The brush's object, resolved as a fresh copy would be (for its size and look). */
function brushPreview(definitionId: Id): ResolvedEntity | null {
  const { project } = useEditor.getState();
  const def = project.definitions.find((d) => d.id === definitionId);
  if (!def) return null;
  return resolveEntity(project, instantiateDefinition(def, { x: 0, y: 0 }), componentRegistry);
}

/** Where an entity lands when dropped or moved: tile objects snap to their cells, others to the grid. */
export function snapPosition(p: Vec2, entity: ResolvedEntity | null, grid: number, enabled: boolean): Vec2 {
  if (entity?.tile) return snapToCell(p, cellSize(getEntitySize(entity), grid));
  return enabled ? { x: snap(p.x, grid), y: snap(p.y, grid) } : p;
}

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewSize>({ width: 1, height: 1 });
  const dragRef = useRef<Drag | null>(null);
  const hoverRef = useRef<Id | null>(null);
  /** The connection (arrow) under the pointer, if any. */
  const hoverLinkRef = useRef<Id | null>(null);
  /** Pointer position in world space (for the brush ghost). */
  const pointerWorldRef = useRef<Vec2 | null>(null);
  const spaceDownRef = useRef(false);

  // Canvas sizing.
  useEffect(() => {
    const container = containerRef.current!;
    const canvas = canvasRef.current!;
    const measure = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      viewRef.current = { width: rect.width, height: rect.height };
      setViewportSize(rect.width, rect.height);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    // Measure right away: the observer reports a frame later, and a click in between
    // (e.g. just after stopping Play) would otherwise be mapped with a 1x1 view and miss.
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Render loop. Also publishes the prompt anchor every frame.
  useEffect(() => {
    let frame = 0;
    const draw = (time: number) => {
      frame = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const state = useEditor.getState();
      const scene = getActiveScene(state);
      const view = viewRef.current;
      const dpr = canvas.width / view.width;
      const drag = dragRef.current;

      let entities = resolveSceneEntities(state.project, scene.id);
      if (drag?.kind === 'move' && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
        const moving = new Set(drag.ids);
        entities = entities.map((e) =>
          moving.has(e.id)
            ? { ...e, transform: { ...e.transform, position: { x: e.transform.position.x + drag.delta.x, y: e.transform.position.y + drag.delta.y } } }
            : e,
        );
      }
      const byId = new Map(entities.map((e) => [e.id, e]));
      const selected = state.selectedEntityIds.map((id) => byId.get(id)).filter((e): e is ResolvedEntity => !!e);

      // Observable view state (used by tests and handy when debugging).
      const camAttr = `${state.camera.x.toFixed(1)},${state.camera.y.toFixed(1)},${state.camera.zoom.toFixed(4)}`;
      if (canvas.dataset.camera !== camAttr) canvas.dataset.camera = camAttr;
      if (canvas.dataset.entities !== String(scene.entities.length)) canvas.dataset.entities = String(scene.entities.length);

      const images = imageLookup(state.project);
      const wire = state.layout.wireframe;
      if (wire) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = theme.wire.ground;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else drawBackground(ctx, view, dpr, scene.world, state.camera, images);
      applyCamera(ctx, state.camera, view, dpr);
      if (state.layout.showGrid) drawGrid(ctx, state.camera, view, state.project.settings.gridSize, wire);
      if (wire) drawWireframe(ctx, entities, state.camera.zoom);
      // Things that start hidden (until a rule or switch shows them) are half see-through; invisible things fainter still.
      else drawEntities(ctx, entities.map((e) => (e.components.StartsHidden ? { ...e, alpha: 0.5 } : e)), images, 0.3);
      if ((canvas.dataset.wireframe ?? '') !== (wire ? '1' : '')) canvas.dataset.wireframe = wire ? '1' : '';
      drawJumpArcs(ctx, state.layout.overlays, entities, scene, state.camera.zoom);
      let frameAttr = '';
      if (state.layout.showCameraFrame) {
        const f = cameraFrame(scene, entities, view);
        drawCameraFrame(ctx, f, state.camera.zoom);
        frameAttr = [f.frame.minX, f.frame.minY, f.frame.maxX, f.frame.maxY].map((v) => v.toFixed(0)).join(',');
      }
      if ((canvas.dataset.cameraFrame ?? '') !== frameAttr) canvas.dataset.cameraFrame = frameAttr;
      if (state.tool.kind === 'brush') drawBrush(ctx, state.tool.definitionId, drag, pointerWorldRef.current, state.project.settings.gridSize, state.camera.zoom, images);

      const hovered = hoverRef.current ? byId.get(hoverRef.current) : undefined;
      if (hovered && !state.selectedEntityIds.includes(hovered.id) && !drag) drawHover(ctx, hovered, state.camera.zoom);
      for (const e of selected) drawSelected(ctx, e, state.camera.zoom, time);
      if (state.flash && time < state.flash.until) drawFlash(ctx, state.flash.ids, byId, state.camera.zoom, (state.flash.until - time) / 2200);
      const flashAttr = state.flash && time < state.flash.until ? String(state.flash.ids.length) : '';
      if ((canvas.dataset.flash ?? '') !== flashAttr) canvas.dataset.flash = flashAttr;
      // Existing connections: those of the selection, or all of them while the Logic card is open.
      // Connections: all of them, faint unless they concern the selection (or the Logic card is open); the selected one stands out.
      const selectedSet = new Set(state.selectedEntityIds);
      const links = linksToShow(state.project, scene, byId).map((l) => ({
        ...l,
        selected: l.relId === state.selectedConnectionId,
        hovered: l.relId === hoverLinkRef.current && !drag,
        related: state.logicOpen || selectedSet.has(l.a.id) || selectedSet.has(l.b.id),
      }));
      // Hovered and selected arrows are drawn last, on top.
      const order = (l: (typeof links)[number]) => (l.selected ? 2 : l.hovered ? 1 : 0);
      for (const l of [...links].sort((x, y) => order(x) - order(y))) {
        const look = l.selected ? 'selected' : l.hovered ? 'hover' : !l.simulated || !l.related ? 'faded' : 'normal';
        drawLink(ctx, l.a, l.b, state.camera.zoom, look);
      }
      const hoverLinkAttr = links.find((l) => l.hovered)?.relId ?? '';
      if ((canvas.dataset.hoverLink ?? '') !== hoverLinkAttr) canvas.dataset.hoverLink = hoverLinkAttr;
      const connector = connectorsFor(state.selectedEntityIds, entities, state.camera.zoom);
      for (const c of connector) drawConnector(ctx, c.point, state.camera.zoom);
      if (drag?.kind === 'connect') {
        const target = drag.targetId ? byId.get(drag.targetId) : undefined;
        if (target) drawHover(ctx, target, state.camera.zoom);
        drawConnectDrag(ctx, drag.from, target ? target.transform.position : drag.current, state.camera.zoom);
      }
      if (selected.length === 2) drawRelation(ctx, selected[0], selected[1], state.camera.zoom);
      if (drag?.kind === 'marquee' && drag.moved) drawMarquee(ctx, drag.startWorld, drag.currentWorld, state.camera.zoom);

      // Screen-space labels and the prompt anchor.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const toScreen = (p: Vec2) => worldToScreen(state.camera, view, p);
      for (const l of links) if (l.related || l.selected || l.hovered) drawLinkLabel(ctx, l.verb, toScreen(curveMidpoint(l.a, l.b)), l.selected ? 'selected' : l.hovered ? 'hover' : 'normal');
      const connAttr = state.selectedConnectionId ?? '';
      if ((canvas.dataset.connection ?? '') !== connAttr) canvas.dataset.connection = connAttr;
      const linksAttr = String(links.length);
      if (canvas.dataset.links !== linksAttr) canvas.dataset.links = linksAttr;
      const panels = drawInfoPanels(ctx, state.layout.overlays, entities, scene, toScreen);
      if (canvas.dataset.overlays !== String(panels.length)) canvas.dataset.overlays = String(panels.length);
      // AI prompts still running (dots) or finished and waiting to be looked at (a badge), above their objects.
      const jobs = useJobs.getState().jobs;
      const openCtx = getSelectionContext(state);
      const marks = jobMarks(jobs, openCtx ? contextKey(openCtx) : null);
      for (const id of marks.working) {
        const e = byId.get(id);
        if (e) drawWorkingDots(ctx, toScreen, getWorldBounds(e), time);
      }
      for (const id of marks.waiting) {
        const e = byId.get(id);
        // Blinks while its finished prompt waits for the user (a choice, a proposal, an answer).
        if (e && !marks.working.has(id)) {
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          const b = getWorldBounds(e);
          const tl = toScreen({ x: b.minX, y: b.minY });
          const br = toScreen({ x: b.maxX, y: b.maxY });
          ctx.globalAlpha = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(time / 180));
          ctx.strokeStyle = theme.select;
          ctx.shadowColor = theme.select;
          ctx.shadowBlur = 10;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(tl.x - 4, tl.y - 4, br.x - tl.x + 8, br.y - tl.y + 8);
          ctx.restore();
        }
        if (e && !marks.working.has(id)) drawWaitingBadge(ctx, toScreen, getWorldBounds(e), Object.values(jobs).some((j) => !j.seen && j.outcome?.status === 'error' && 'entityIds' in j.ctx && j.ctx.entityIds.includes(id)));
      }
      const marksAttr = `${marks.working.size},${marks.waiting.size}`;
      if ((canvas.dataset.aiJobs ?? '') !== marksAttr) canvas.dataset.aiJobs = marksAttr;
      if (selected.length === 1) drawLabel(ctx, selected[0].name, toScreen, getWorldBounds(selected[0]));
      if (selected.length === 2) {
        drawLabel(ctx, selected[0].name, toScreen, getWorldBounds(selected[0]));
        drawLabel(ctx, selected[1].name, toScreen, getWorldBounds(selected[1]));
      }

      const viewWH = { w: view.width, h: view.height };
      const selectionCtx = getSelectionContext(state);
      const anchorKey = selectionCtx ? contextKey(selectionCtx) : '';
      if (selected.length > 0) {
        let rect: Rect;
        if (selected.length === 2) {
          const mid = curveMidpoint(selected[0], selected[1]);
          const r = 10 / state.camera.zoom;
          rect = { minX: mid.x - r, minY: mid.y - r, maxX: mid.x + r, maxY: mid.y + r };
        } else {
          rect = selected.map(getWorldBounds).reduce(unionRect);
        }
        const a = toScreen({ x: rect.minX, y: rect.minY });
        const b = toScreen({ x: rect.maxX, y: rect.maxY });
        let screenRect: Rect = { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
        // The prompt sits beside the selection's info panels, not on top of them.
        if (selected.length !== 2) for (const p of panels) if (state.selectedEntityIds.includes(p.entityId)) screenRect = unionRect(screenRect, p.rect);
        publishAnchor({ key: anchorKey, rect: screenRect, view: viewWH, visible: b.x > 0 && a.x < view.width && b.y > 0 && a.y < view.height });
      } else if (state.selectedConnectionId) {
        const l = links.find((x) => x.selected);
        const p = l ? toScreen(curveMidpoint(l.a, l.b)) : { x: view.width / 2, y: view.height / 2 };
        publishAnchor({ key: anchorKey, rect: { minX: p.x - 12, minY: p.y - 12, maxX: p.x + 12, maxY: p.y + 12 }, view: viewWH, visible: !!l });
      } else if (state.worldContext) {
        const p = state.worldContext.point ? toScreen(state.worldContext.point) : { x: view.width / 2, y: view.height / 2 };
        drawWorldMarker(ctx, p, scene.name, time);
        publishAnchor({ key: anchorKey, rect: { minX: p.x - 12, minY: p.y - 12, maxX: p.x + 12, maxY: p.y + 12 }, view: viewWH, visible: true });
      } else {
        publishAnchor(null);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      publishAnchor(null);
    };
  }, []);

  // Wheel zoom (non-passive so the page doesn't scroll).
  useEffect(() => {
    const canvas = canvasRef.current!;
    const interpret = createWheelInterpreter(() => useEditor.getState().layout.mouseZoomSpeed);
    const zoomAt = (screen: Vec2, factor: number) => {
      const { camera, setCamera } = useEditor.getState();
      const view = viewRef.current;
      const before = screenToWorld(camera, view, screen);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * factor));
      // Keep the world point under the cursor fixed.
      setCamera({ zoom, x: before.x - (screen.x - view.width / 2) / zoom, y: before.y - (screen.y - view.height / 2) / zoom });
    };
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const intent = interpret(ev);
      if (intent.kind === 'zoom') {
        zoomAt(localPoint(canvas, ev), intent.factor);
      } else {
        const { camera, setCamera } = useEditor.getState();
        setCamera({ x: camera.x + intent.dx / camera.zoom, y: camera.y + intent.dy / camera.zoom });
      }
    };
    // Safari reports trackpad pinches as gesture events instead of ctrl+wheel.
    let gestureZoom = 1;
    const onGestureStart = (ev: Event) => {
      ev.preventDefault();
      gestureZoom = useEditor.getState().camera.zoom;
    };
    const onGestureChange = (ev: Event) => {
      ev.preventDefault();
      const g = ev as Event & { scale: number; clientX: number; clientY: number };
      zoomAt(localPoint(canvas, g), (gestureZoom * g.scale) / useEditor.getState().camera.zoom);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('gesturestart', onGestureStart);
      canvas.removeEventListener('gesturechange', onGestureChange);
    };
  }, []);

  // Space-to-pan modifier.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTextInput(e.target)) {
        spaceDownRef.current = true;
        if (!dragRef.current && canvasRef.current) canvasRef.current.style.cursor = 'grab';
        if (e.target === document.body || e.target === canvasRef.current) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceDownRef.current = false;
        if (dragRef.current?.kind !== 'pan' && canvasRef.current) canvasRef.current.style.cursor = '';
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const toWorld = (ev: { clientX: number; clientY: number }) =>
    screenToWorld(useEditor.getState().camera, viewRef.current, localPoint(canvasRef.current!, ev));

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    canvas.focus();
    const state = useEditor.getState();
    if (state.dock) state.setDock(null);
    if (ev.button === 1 || (ev.button === 0 && spaceDownRef.current)) {
      ev.preventDefault();
      dragRef.current = { kind: 'pan', startScreen: { x: ev.clientX, y: ev.clientY }, startCamera: { ...state.camera }, moved: false };
      canvas.style.cursor = 'grabbing';
    } else if (state.tool.kind === 'brush' && (ev.button === 0 || ev.button === 2)) {
      // Brush: left button paints, right button erases.
      const preview = brushPreview(state.tool.definitionId);
      if (!preview) return;
      const cell = cellAt(toWorld(ev), cellSize(getEntitySize(preview), state.project.settings.gridSize));
      dragRef.current = { kind: 'paint', definitionId: state.tool.definitionId, erase: ev.button === 2, start: cell, last: cell, cells: new Map([[cellKey(cell), cell]]) };
    } else if (ev.button === 0) {
      const world = toWorld(ev);
      const entities = resolveSceneEntities(state.project, state.activeSceneId);
      const handle = connectorAt(state.selectedEntityIds, entities, world, state.camera.zoom);
      if (handle) {
        dragRef.current = { kind: 'connect', fromId: handle.entityId, from: handle.point, current: world, targetId: null };
        canvas.setPointerCapture(ev.pointerId);
        return;
      }
      const hit = pick(entities, world);
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      const scene = getActiveScene(state);
      const line = hit ? null : connectionAt(state.project, scene, new Map(entities.map((e) => [e.id, e])), world, state.camera.zoom);
      if (line && !additive) {
        state.selectConnection(line);
        return;
      }
      if (hit) {
        let selection = state.selectedEntityIds;
        if (additive) selection = selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id];
        else if (!selection.includes(hit.id)) selection = [hit.id];
        state.selectEntities(selection);
        if (selection.includes(hit.id)) {
          dragRef.current = { kind: 'move', startWorld: world, anchor: hit.transform.position, anchorId: hit.id, ids: selection, delta: { x: 0, y: 0 } };
        }
      } else {
        dragRef.current = { kind: 'marquee', startWorld: world, currentWorld: world, additive, baseSelection: additive ? state.selectedEntityIds : [], moved: false };
      }
    } else {
      return;
    }
    canvas.setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    const state = useEditor.getState();
    pointerWorldRef.current = toWorld(ev);
    if (!drag) {
      if (state.tool.kind === 'brush') {
        hoverRef.current = null;
        canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : 'crosshair';
        return;
      }
      const world = toWorld(ev);
      const entities = resolveSceneEntities(state.project, state.activeSceneId);
      const hit = pick(entities, world);
      hoverRef.current = hit?.id ?? null;
      const onConnector = !!connectorAt(state.selectedEntityIds, entities, world, state.camera.zoom);
      const line = hit || onConnector ? null : connectionAt(state.project, getActiveScene(state), new Map(entities.map((e) => [e.id, e])), world, state.camera.zoom);
      hoverLinkRef.current = line;
      const onLine = !!line;
      canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : onConnector ? 'crosshair' : hit || onLine ? 'pointer' : 'default';
      return;
    }
    if (drag.kind === 'connect') {
      drag.current = toWorld(ev);
      const over = pick(resolveSceneEntities(state.project, state.activeSceneId), drag.current);
      drag.targetId = over && over.id !== drag.fromId ? over.id : null;
      return;
    }
    if (drag.kind === 'paint') {
      const preview = brushPreview(drag.definitionId);
      if (!preview) return;
      let cell = cellAt(toWorld(ev), cellSize(getEntitySize(preview), state.project.settings.gridSize));
      if (ev.shiftKey) cell = constrainToAxis(drag.start, cell);
      for (const c of cellsOnLine(drag.last, cell)) drag.cells.set(cellKey(c), c);
      drag.last = cell;
      return;
    }
    if (drag.kind === 'pan') {
      const z = drag.startCamera.zoom;
      drag.moved = true;
      canvasRef.current!.style.cursor = 'grabbing';
      state.setCamera({ x: drag.startCamera.x - (ev.clientX - drag.startScreen.x) / z, y: drag.startCamera.y - (ev.clientY - drag.startScreen.y) / z });
    } else if (drag.kind === 'move') {
      const world = toWorld(ev);
      const raw = { x: drag.anchor.x + world.x - drag.startWorld.x, y: drag.anchor.y + world.y - drag.startWorld.y };
      // The object under the cursor leads; the rest of the selection keeps its offsets.
      const anchorEntity = resolveSceneEntities(state.project, state.activeSceneId).find((e) => e.id === drag.anchorId) ?? null;
      const target = snapPosition(raw, anchorEntity, state.project.settings.gridSize, state.layout.snapToGrid);
      drag.delta = { x: target.x - drag.anchor.x, y: target.y - drag.anchor.y };
    } else {
      drag.currentWorld = toWorld(ev);
      const screenDist = Math.hypot(drag.currentWorld.x - drag.startWorld.x, drag.currentWorld.y - drag.startWorld.y) * state.camera.zoom;
      if (!drag.moved && screenDist < 4) return;
      drag.moved = true;
      const rect = normalizeRect(drag.startWorld, drag.currentWorld);
      const inside = resolveSceneEntities(state.project, state.activeSceneId)
        .filter((e) => rectsIntersect(rect, getWorldBounds(e)))
        .map((e) => e.id);
      state.selectEntities([...drag.baseSelection, ...inside]);
    }
  };

  const onPointerUp = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (canvasRef.current?.hasPointerCapture(ev.pointerId)) canvasRef.current.releasePointerCapture(ev.pointerId);
    const state = useEditor.getState();
    canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : state.tool.kind === 'brush' ? 'crosshair' : 'default';
    if (drag?.kind === 'paint') {
      commitStroke(drag);
      return;
    }
    if (drag?.kind === 'connect') {
      if (drag.targetId) connectSwitch(drag.fromId, drag.targetId);
      return;
    }
    if (drag?.kind === 'move' && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
      const label = drag.ids.length === 1 ? 'Move' : `Move ${drag.ids.length} objects`;
      state.edit(label, (p) => moveEntities(p, state.activeSceneId, drag.ids, drag.delta));
    } else if (drag?.kind === 'marquee' && !drag.moved && !drag.additive) {
      // A plain click on empty space clears the context: clean canvas, no prompt.
      state.selectEntities([]);
      state.setWorldContext(false);
      state.selectConnection(null);
    }
  };

  const onDoubleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const state = useEditor.getState();
    if (state.tool.kind === 'brush') return;
    const world = toWorld(ev);
    if (!pick(resolveSceneEntities(state.project, state.activeSceneId), world)) state.setWorldContext(world);
  };

  const onDragOver = (ev: React.DragEvent) => {
    if (ev.dataTransfer.types.includes(DEFINITION_DRAG_TYPE)) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (ev: React.DragEvent) => {
    const definitionId = ev.dataTransfer.getData(DEFINITION_DRAG_TYPE);
    if (!definitionId) return;
    ev.preventDefault();
    placeDefinition(definitionId, toWorld(ev));
    useEditor.getState().setDock(null);
    canvasRef.current?.focus();
  };

  return (
    <div className="viewport" ref={containerRef} onDragOver={onDragOver} onDrop={onDrop}>
      <canvas
        ref={canvasRef}
        tabIndex={0}
        data-testid="viewport-canvas"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => {
          hoverRef.current = null;
          hoverLinkRef.current = null;
        }}
        onDoubleClick={onDoubleClick}
        onMouseDown={(e) => e.button === 1 && e.preventDefault() /* no autoscroll on middle-drag */}
        onContextMenu={(e) => e.preventDefault() /* right-drag erases while drawing */}
      />
    </div>
  );
}

/** Places an instance of a definition in the active scene at a world point and selects it. */
export function placeDefinition(definitionId: Id, world: Vec2): Id | null {
  const state = useEditor.getState();
  const def = state.project.definitions.find((d) => d.id === definitionId);
  if (!def) return null;
  const pos = snapPosition(world, brushPreview(def.id), state.project.settings.gridSize, state.layout.snapToGrid);
  const scene = getActiveScene(state);
  const count = scene.entities.filter((e) => e.definitionId === def.id).length;
  const entity = instantiateDefinition(def, pos, count === 0 ? def.name : `${def.name} ${count + 1}`);
  if (!state.edit(`Place ${def.name}`, (p) => addEntity(p, scene.id, entity))) return null;
  state.selectEntities([entity.id]);
  return entity.id;
}

/**
 * Commits a brush stroke as one undoable step: one copy per visited cell that
 * doesn't already hold this object (paint), or removes the copies in those
 * cells (erase).
 */
function commitStroke(stroke: Extract<Drag, { kind: 'paint' }>): void {
  const state = useEditor.getState();
  const def = state.project.definitions.find((d) => d.id === stroke.definitionId);
  const preview = brushPreview(stroke.definitionId);
  if (!def || !preview) return;
  const cell = cellSize(getEntitySize(preview), state.project.settings.gridSize);
  const scene = getActiveScene(state);
  const occupied = new Map<string, Id[]>();
  for (const e of scene.entities) {
    if (e.definitionId !== def.id) continue;
    const key = cellKey(cellAt(e.transform.position, cell));
    occupied.set(key, [...(occupied.get(key) ?? []), e.id]);
  }
  if (stroke.erase) {
    const ids = [...stroke.cells.keys()].flatMap((k) => occupied.get(k) ?? []);
    if (ids.length) state.edit(`Erase ${ids.length} ${def.name}`, (p) => removeEntities(p, scene.id, ids));
    return;
  }
  const free = [...stroke.cells.entries()].filter(([k]) => !occupied.has(k)).map(([, c]) => c);
  if (!free.length) return;
  let n = scene.entities.filter((e) => e.definitionId === def.id).length;
  const created = free.map((c) => instantiateDefinition(def, cellCenter(c, cell), n++ === 0 ? def.name : `${def.name} ${n}`));
  state.edit(created.length === 1 ? `Draw ${def.name}` : `Draw ${created.length} ${def.name}`, (p) => {
    for (const e of created) addEntity(p, scene.id, e);
  });
}

/** Ghost of the brush under the pointer, plus the cells of the stroke in progress. */
function drawBrush(ctx: CanvasRenderingContext2D, definitionId: Id, drag: Drag | null, pointer: Vec2 | null, grid: number, zoom: number, images: ImageLookup): void {
  const preview = brushPreview(definitionId);
  if (!preview) return;
  const cell = cellSize(getEntitySize(preview), grid);
  const stroke = drag?.kind === 'paint' ? drag : null;
  const cells = stroke ? [...stroke.cells.values()] : pointer ? [cellAt(pointer, cell)] : [];
  ctx.save();
  if (stroke?.erase) {
    ctx.strokeStyle = theme.erase;
    ctx.lineWidth = 2 / zoom;
    for (const c of cells) {
      const p = cellCenter(c, cell);
      ctx.strokeRect(p.x - cell.x / 2 + 2 / zoom, p.y - cell.y / 2 + 2 / zoom, cell.x - 4 / zoom, cell.y - 4 / zoom);
    }
  } else {
    ctx.globalAlpha = 0.55;
    drawEntities(
      ctx,
      cells.map((c) => ({ ...preview, transform: { ...preview.transform, position: cellCenter(c, cell) } })),
      images,
    );
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.select;
    ctx.lineWidth = 1 / zoom;
    ctx.setLineDash([4 / zoom, 3 / zoom]);
    for (const c of cells) {
      const p = cellCenter(c, cell);
      ctx.strokeRect(p.x - cell.x / 2, p.y - cell.y / 2, cell.x, cell.y);
    }
  }
  ctx.restore();
}

function localPoint(canvas: HTMLCanvasElement, ev: { clientX: number; clientY: number }): Vec2 {
  const rect = canvas.getBoundingClientRect();
  return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
}

/** Topmost entity under a world point. */
function pick(entities: ResolvedEntity[], p: Vec2): ResolvedEntity | null {
  for (let i = entities.length - 1; i >= 0; i--) if (containsPoint(entities[i], p)) return entities[i];
  return null;
}

function normalizeRect(a: Vec2, b: Vec2): Rect {
  return { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) };
}

function unionRect(a: Rect, b: Rect): Rect {
  return { minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY) };
}

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, view: ViewSize, gridSize: number, wire = false): void {
  let step = gridSize;
  while (step * camera.zoom < 10) step *= 4;
  const tl = screenToWorld(camera, view, { x: 0, y: 0 });
  const br = screenToWorld(camera, view, { x: view.width, y: view.height });
  if (theme.gridMajor) {
    // Drafting paper: a faint line every 8 grid steps.
    const major = step * 8;
    ctx.strokeStyle = theme.gridMajor;
    ctx.lineWidth = 1 / camera.zoom;
    ctx.beginPath();
    for (let x = Math.floor(tl.x / major) * major; x <= br.x; x += major) {
      ctx.moveTo(x, tl.y);
      ctx.lineTo(x, br.y);
    }
    for (let y = Math.floor(tl.y / major) * major; y <= br.y; y += major) {
      ctx.moveTo(tl.x, y);
      ctx.lineTo(br.x, y);
    }
    ctx.stroke();
  }
  // Dots at grid intersections: present but quiet, so the game stays the focus.
  ctx.fillStyle = wire ? withAlpha(theme.wire.solid, 0.22) : theme.gridDot;
  const r = 1 / camera.zoom;
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
}

/** What kind of thing an entity is, for its wireframe color. */
function wireKind(e: ResolvedEntity): keyof Omit<typeof theme.wire, 'ground' | 'fill' | 'glow' | 'dash'> {
  const c = e.components;
  if (c.CharacterController) return 'character';
  if (c.Damage || e.tags.includes('enemy') || e.tags.includes('hazard')) return 'danger';
  if (c.Collectible) return 'item';
  if (!c.Collider || c.Collider.isTrigger === true) return 'trigger';
  return 'solid';
}

/** "#rrggbb" with an alpha. */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/**
 * Wireframe view: every object as its outline (its collider's shape and
 * size), colored by kind (player, dangerous, item, see-through, solid) in
 * the editor style's colors, with a faint fill. Things you can walk through
 * are dashed; a cross marks each object's center.
 */
function drawWireframe(ctx: CanvasRenderingContext2D, entities: ResolvedEntity[], zoom: number): void {
  const w = theme.wire;
  const px = 1 / zoom;
  ctx.save();
  ctx.lineJoin = 'round';
  if (w.glow) ctx.shadowBlur = w.glow;
  for (const e of entities) {
    const kind = wireKind(e);
    const color = w[kind];
    ctx.save();
    traceShape(ctx, e, 0, false);
    ctx.fillStyle = withAlpha(color, w.fill);
    ctx.shadowColor = 'transparent';
    ctx.fill();
    if (w.glow) ctx.shadowColor = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = (kind === 'solid' ? 1.25 : 1.75) * px;
    ctx.setLineDash(kind === 'trigger' || (w.dash && kind === 'item') ? [5 * px, 4 * px] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    // Center mark.
    const s = 3 * px;
    ctx.beginPath();
    ctx.moveTo(-s, 0);
    ctx.lineTo(s, 0);
    ctx.moveTo(0, -s);
    ctx.lineTo(0, s);
    ctx.lineWidth = 1 * px;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

/** Traces the entity's own shape (rect or ellipse) in local space. */
function traceShape(ctx: CanvasRenderingContext2D, e: ResolvedEntity, pad: number, rounded = true): void {
  const size = getEntitySize(e);
  const { position, rotation, scale } = e.transform;
  const w = size.x * Math.abs(scale.x) + pad * 2;
  const h = size.y * Math.abs(scale.y) + pad * 2;
  ctx.translate(position.x, position.y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.beginPath();
  if (e.components.Collider?.shape === 'circle') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (rounded) ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(6, w / 4, h / 4));
  else ctx.rect(-w / 2, -h / 2, w, h);
}

function drawHover(ctx: CanvasRenderingContext2D, e: ResolvedEntity, zoom: number): void {
  ctx.save();
  traceShape(ctx, e, 3 / zoom);
  ctx.strokeStyle = theme.hover;
  ctx.lineWidth = 1.5 / zoom;
  ctx.stroke();
  ctx.restore();
}

function drawSelected(ctx: CanvasRenderingContext2D, e: ResolvedEntity, zoom: number, time: number): void {
  const breathe = 0.75 + 0.25 * Math.sin(time / 600);
  const size = getEntitySize(e);
  const { position, rotation, scale } = e.transform;
  const pad = 4 / zoom;
  const w = size.x * Math.abs(scale.x) + pad * 2;
  const h = size.y * Math.abs(scale.y) + pad * 2;
  ctx.save();
  ctx.translate(position.x, position.y);
  ctx.rotate((rotation * Math.PI) / 180);
  // Soft glow, thin outline, and small corner handles: the object is "active".
  ctx.shadowColor = theme.selectGlow;
  ctx.shadowBlur = 16 * breathe;
  ctx.strokeStyle = theme.select;
  ctx.lineWidth = 1.5 / zoom;
  ctx.strokeRect(-w / 2, -h / 2, w, h);
  ctx.shadowBlur = 0;
  const s = 5 / zoom;
  ctx.fillStyle = theme.handle;
  ctx.strokeStyle = theme.select;
  ctx.lineWidth = 1 / zoom;
  for (const [cx, cy] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
  }
  ctx.restore();
}

function curveControl(a: ResolvedEntity, b: ResolvedEntity): { from: Vec2; to: Vec2; ctrl: Vec2 } {
  const pa = a.transform.position;
  const pb = b.transform.position;
  const mx = (pa.x + pb.x) / 2;
  const my = (pa.y + pb.y) / 2;
  const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
  // Bow the arrow upward a little so it reads as a link, not a measurement.
  const nx = (pb.y - pa.y) / dist;
  const ny = -(pb.x - pa.x) / dist;
  const bow = Math.min(80, dist * 0.25) * (ny <= 0 ? 1 : -1);
  return { from: pa, to: pb, ctrl: { x: mx + nx * bow, y: my + ny * bow } };
}

function curveMidpoint(a: ResolvedEntity, b: ResolvedEntity): Vec2 {
  const { from, to, ctrl } = curveControl(a, b);
  return { x: 0.25 * from.x + 0.5 * ctrl.x + 0.25 * to.x, y: 0.25 * from.y + 0.5 * ctrl.y + 0.25 * to.y };
}

interface Link {
  relId: Id;
  a: ResolvedEntity;
  b: ResolvedEntity;
  verb: string;
  simulated: boolean;
}

const MAX_LINKS = 120;

/** Entity-to-entity arrows for the level's relationships (a relationship naming an object or tag gives several). */
function linksToShow(project: Project, scene: Scene, byId: Map<Id, ResolvedEntity>): Link[] {
  const links: Link[] = [];
  for (const r of scene.relationships) {
    const t = relationshipRegistry.get(r.type);
    for (const s of resolveRef(project, scene, r.source)) {
      for (const d of resolveRef(project, scene, r.target)) {
        if (s.id === d.id) continue;
        const a = byId.get(s.id);
        const b = byId.get(d.id);
        if (a && b) links.push({ relId: r.id, a, b, verb: relationshipLabel(r), simulated: t?.simulated === true });
        if (links.length >= MAX_LINKS) return links;
      }
    }
  }
  return links;
}

/** The red connectors on a selected switch: left and right of its selection frame (same size as the corner boxes). */
const CONNECTOR_RADIUS = 5;

function connectorsFor(selectedIds: Id[], entities: ResolvedEntity[], zoom: number): { entityId: Id; point: Vec2 }[] {
  if (selectedIds.length !== 1) return [];
  const e = entities.find((x) => x.id === selectedIds[0]);
  if (!e?.components.Switch) return [];
  const b = getWorldBounds(e);
  const pad = 4 / zoom;
  const y = (b.minY + b.maxY) / 2;
  return [
    { entityId: e.id, point: { x: b.minX - pad, y } },
    { entityId: e.id, point: { x: b.maxX + pad, y } },
  ];
}

function connectorAt(selectedIds: Id[], entities: ResolvedEntity[], world: Vec2, zoom: number): { entityId: Id; point: Vec2 } | null {
  return connectorsFor(selectedIds, entities, zoom).find((c) => Math.hypot(c.point.x - world.x, c.point.y - world.y) * zoom <= CONNECTOR_RADIUS + 5) ?? null;
}

function drawConnector(ctx: CanvasRenderingContext2D, p: Vec2, zoom: number): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(p.x, p.y, CONNECTOR_RADIUS / zoom, 0, Math.PI * 2);
  ctx.fillStyle = theme.connector;
  ctx.fill();
  ctx.lineWidth = 1.5 / zoom;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  ctx.restore();
}

function drawConnectDrag(ctx: CanvasRenderingContext2D, from: Vec2, to: Vec2, zoom: number): void {
  ctx.save();
  ctx.strokeStyle = theme.connector;
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(to.x, to.y, 4 / zoom, 0, Math.PI * 2);
  ctx.fillStyle = theme.connector;
  ctx.fill();
  ctx.restore();
}

/** How close (screen px) the pointer must be to an arrow to hover or click it. */
const LINK_HIT_PX = 11;

/** The connection whose line passes within a few pixels of `world`, if any. */
function connectionAt(project: Project, scene: Scene, byId: Map<Id, ResolvedEntity>, world: Vec2, zoom: number): Id | null {
  let best: { id: Id; d: number } | null = null;
  for (const l of linksToShow(project, scene, byId)) {
    const { from, to, ctrl } = curveControl(l.a, l.b);
    let prev = from;
    for (let i = 1; i <= 24; i++) {
      const t = i / 24;
      const p = { x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * ctrl.x + t * t * to.x, y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * ctrl.y + t * t * to.y };
      const d = distToSegment(world, prev, p) * zoom;
      if (d <= LINK_HIT_PX && (!best || d < best.d)) best = { id: l.relId, d };
      prev = p;
    }
    // The label in the middle ("opens") counts too.
    const mid = curveMidpoint(l.a, l.b);
    if (Math.abs(world.x - mid.x) * zoom <= 28 && Math.abs(world.y - mid.y) * zoom <= 10 && (!best || best.d > 0)) best = { id: l.relId, d: 0 };
  }
  return best?.id ?? null;
}

function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** Things an AI change just touched: a fading glow, so you see where it went. */
function drawFlash(ctx: CanvasRenderingContext2D, ids: Id[], byId: Map<Id, ResolvedEntity>, zoom: number, left: number): void {
  ctx.save();
  ctx.strokeStyle = theme.logic;
  ctx.shadowColor = theme.logic;
  ctx.shadowBlur = 12;
  ctx.globalAlpha = Math.min(1, left * 1.5);
  ctx.lineWidth = 3 / zoom;
  for (const id of ids) {
    const e = byId.get(id);
    if (!e) continue;
    const b = getWorldBounds(e);
    const pad = 4 / zoom;
    ctx.strokeRect(b.minX - pad, b.minY - pad, b.maxX - b.minX + 2 * pad, b.maxY - b.minY + 2 * pad);
  }
  ctx.restore();
}

function drawLinkLabel(ctx: CanvasRenderingContext2D, text: string, p: Vec2, look: 'normal' | 'hover' | 'selected' = 'normal'): void {
  ctx.save();
  ctx.font = `800 10px ${theme.uiFont}`;
  const w = ctx.measureText(text).width + 12;
  // A little sticker: ink outline, flat fill, a hard offset shadow.
  ctx.fillStyle = theme.ink;
  ctx.beginPath();
  ctx.roundRect(p.x - w / 2 + 1.5, p.y - 8 + 2, w, 16, 8);
  ctx.fill();
  if (look !== 'normal') {
    ctx.shadowColor = theme.link;
    ctx.shadowBlur = look === 'selected' ? 14 : 7;
  }
  ctx.fillStyle = theme.link;
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(p.x - w / 2, p.y - 8, w, 16, 8);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.stroke();
  ctx.fillStyle = theme.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, p.x, p.y + 0.5);
  ctx.restore();
}

/**
 * An existing connection, drawn like a blueprint annotation in ink: a dark
 * outline under bright rounded dashes, a pin where it starts and a chunky
 * outlined arrowhead. Faded when it doesn't concern the selection (or does
 * nothing in play yet); a soft glow on hover; fully lit and thicker when
 * selected (no animation).
 */
function drawLink(ctx: CanvasRenderingContext2D, a: ResolvedEntity, b: ResolvedEntity, zoom: number, look: 'normal' | 'faded' | 'hover' | 'selected'): void {
  const { start, end, ctrl } = linkPath(a, b, zoom);
  const px = 1 / zoom;
  const width = (look === 'selected' ? 3.5 : look === 'hover' ? 3 : 2.5) * px;
  const color = theme.link;
  const curve = () => {
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(ctrl.x, ctrl.y, end.x, end.y);
  };
  ctx.save();
  ctx.globalAlpha = look === 'faded' ? 0.4 : 1;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Glow first, so the ink stays crisp on top.
  if (look === 'hover' || look === 'selected') {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = look === 'selected' ? 0.55 : 0.28;
    ctx.shadowColor = color;
    ctx.shadowBlur = look === 'selected' ? 18 : 9;
    ctx.lineWidth = width + (look === 'selected' ? 6 : 4) * px;
    curve();
    ctx.stroke();
    ctx.restore();
  }
  // Ink underlay (solid), then the bright dashes.
  ctx.strokeStyle = theme.ink;
  ctx.lineWidth = width + 3 * px;
  curve();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash([7 * px, 6 * px]);
  curve();
  ctx.stroke();
  ctx.setLineDash([]);
  // Pin at the start.
  ctx.beginPath();
  ctx.arc(start.x, start.y, 2.5 * px + width / 2, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5 * px;
  ctx.strokeStyle = theme.ink;
  ctx.stroke();
  // Arrowhead.
  const angle = Math.atan2(end.y - ctrl.y, end.x - ctrl.x);
  const s = (look === 'selected' ? 13 : 11) * px;
  ctx.beginPath();
  ctx.moveTo(end.x + Math.cos(angle) * 2 * px, end.y + Math.sin(angle) * 2 * px);
  ctx.lineTo(end.x - s * Math.cos(angle - 0.5), end.y - s * Math.sin(angle - 0.5));
  ctx.lineTo(end.x - s * 0.62 * Math.cos(angle), end.y - s * 0.62 * Math.sin(angle));
  ctx.lineTo(end.x - s * Math.cos(angle + 0.5), end.y - s * Math.sin(angle + 0.5));
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.75 * px;
  ctx.strokeStyle = theme.ink;
  ctx.stroke();
  ctx.restore();
}

/** Where an arrow between two entities starts and ends (just outside each) and its curve. */
function linkPath(a: ResolvedEntity, b: ResolvedEntity, zoom: number): { start: Vec2; end: Vec2; ctrl: Vec2 } {
  const { from, to, ctrl } = curveControl(a, b);
  const ra = Math.max(getEntitySize(a).x, getEntitySize(a).y) / 2 + 10 / zoom;
  const rb = Math.max(getEntitySize(b).x, getEntitySize(b).y) / 2 + 12 / zoom;
  const trim = (p: Vec2, toward: Vec2, r: number) => {
    const d = Math.hypot(toward.x - p.x, toward.y - p.y) || 1;
    return { x: p.x + ((toward.x - p.x) / d) * r, y: p.y + ((toward.y - p.y) / d) * r };
  };
  return { start: trim(from, ctrl, ra), end: trim(to, ctrl, rb), ctrl };
}

/**
 * An arrow from `a` to `b`: dashed in the selection color for two selected
 * objects (the relationship being described), or solid in the logic color
 * for an existing connection (faded when it does nothing in play yet).
 */
function drawRelation(
  ctx: CanvasRenderingContext2D,
  a: ResolvedEntity,
  b: ResolvedEntity,
  zoom: number,
  style: { color: string; dashed: boolean; faded?: boolean; width?: number; glow?: boolean } = { color: theme.select, dashed: true },
): void {
  const { from, to, ctrl } = curveControl(a, b);
  const ra = Math.max(getEntitySize(a).x, getEntitySize(a).y) / 2 + 10 / zoom;
  const rb = Math.max(getEntitySize(b).x, getEntitySize(b).y) / 2 + 12 / zoom;
  const trim = (p: Vec2, toward: Vec2, r: number) => {
    const d = Math.hypot(toward.x - p.x, toward.y - p.y) || 1;
    return { x: p.x + ((toward.x - p.x) / d) * r, y: p.y + ((toward.y - p.y) / d) * r };
  };
  const start = trim(from, ctrl, ra);
  const end = trim(to, ctrl, rb);
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  if (style.faded) ctx.globalAlpha = 0.45;
  if (style.glow) {
    ctx.shadowColor = style.color;
    ctx.shadowBlur = 10;
  }
  ctx.lineWidth = (style.width ?? 2) / zoom;
  if (style.dashed) ctx.setLineDash([6 / zoom, 5 / zoom]);
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(ctrl.x, ctrl.y, end.x, end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const angle = Math.atan2(end.y - ctrl.y, end.x - ctrl.x);
  const s = 9 / zoom;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x - s * Math.cos(angle - 0.45), end.y - s * Math.sin(angle - 0.45));
  ctx.lineTo(end.x - s * Math.cos(angle + 0.45), end.y - s * Math.sin(angle + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Three bouncing dots in a little bubble above an object whose AI prompt is still running. */
function drawWorkingDots(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2, bounds: Rect, time: number): void {
  const p = toScreen({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY });
  const cx = p.x;
  const cy = p.y - 16;
  ctx.save();
  ctx.fillStyle = theme.ink;
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  ctx.roundRect(cx - 19, cy - 9, 38, 18, 9);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = theme.select;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = theme.select;
  for (let i = 0; i < 3; i++) {
    const phase = (time / 160 - i * 0.9) % (Math.PI * 2);
    const lift = Math.max(0, Math.sin(phase)) * 3;
    ctx.beginPath();
    ctx.arc(cx - 9 + i * 9, cy - lift, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** A small badge above an object whose AI prompt finished while its card was closed (a proposal, an answer or an error). */
function drawWaitingBadge(ctx: CanvasRenderingContext2D, toScreen: (p: Vec2) => Vec2, bounds: Rect, error: boolean): void {
  const p = toScreen({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.minY });
  const cx = p.x;
  const cy = p.y - 16;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fillStyle = error ? theme.erase : theme.select;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = theme.ink;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 12px ${theme.uiFont}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(error ? '!' : '✦', cx, cy + 0.5);
  ctx.restore();
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, toScreen: (p: Vec2) => Vec2, bounds: Rect): void {
  const p = toScreen({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY });
  ctx.save();
  ctx.font = theme.labelFont;
  ctx.letterSpacing = '1.2px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.shadowColor = theme.labelShadow;
  ctx.shadowBlur = 4;
  ctx.fillStyle = theme.label;
  ctx.fillText(text.toUpperCase(), p.x, p.y + 10);
  ctx.restore();
}

function drawWorldMarker(ctx: CanvasRenderingContext2D, p: Vec2, sceneName: string, time: number): void {
  const pulse = (time % 1800) / 1800;
  ctx.save();
  ctx.strokeStyle = theme.select;
  ctx.globalAlpha = 1 - pulse;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 6 + pulse * 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.select;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 10px ${theme.uiFont}`;
  ctx.letterSpacing = '1.2px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.label;
  ctx.fillText(sceneName.toUpperCase(), p.x, p.y + 14);
  ctx.restore();
}

function drawMarquee(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, zoom: number): void {
  const r = normalizeRect(a, b);
  ctx.fillStyle = theme.marqueeFill;
  ctx.strokeStyle = theme.marqueeStroke;
  ctx.lineWidth = 1 / zoom;
  ctx.fillRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
  ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
}
