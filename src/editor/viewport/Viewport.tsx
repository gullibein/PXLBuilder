import { useEffect, useRef } from 'react';
import { containsPoint, getEntitySize, getWorldBounds, rectsIntersect, type Rect } from '../../core/model/geometry';
import { instantiateDefinition } from '../../core/model/factory';
import { addEntity, moveEntities } from '../../core/model/mutations';
import type { ResolvedEntity } from '../../core/model/resolve';
import type { Id, Vec2 } from '../../core/types';
import { applyCamera, drawBackground, drawEntities, screenToWorld, worldToScreen, type Camera, type ViewSize } from '../../render/renderer';
import { setViewportSize } from '../actions';
import { publishAnchor } from '../prompt/anchor';
import { resolveSceneEntities } from '../selectors';
import { getActiveScene, useEditor } from '../store';
import { theme } from '../theme';

export const DEFINITION_DRAG_TYPE = 'application/x-pxlbuilder-definition';

type Drag =
  | { kind: 'pan'; startScreen: Vec2; startCamera: Camera; moved: boolean }
  | { kind: 'move'; startWorld: Vec2; anchor: Vec2; ids: Id[]; delta: Vec2 }
  | { kind: 'marquee'; startWorld: Vec2; currentWorld: Vec2; additive: boolean; baseSelection: Id[]; moved: boolean };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
/** Screen space reserved by floating chrome, so the prompt avoids it. */
export const CHROME_INSETS = { top: 64, bottom: 76 };

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewSize>({ width: 1, height: 1 });
  const dragRef = useRef<Drag | null>(null);
  const hoverRef = useRef<Id | null>(null);
  const spaceDownRef = useRef(false);

  // Canvas sizing.
  useEffect(() => {
    const container = containerRef.current!;
    const canvas = canvasRef.current!;
    const ro = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      viewRef.current = { width: rect.width, height: rect.height };
      setViewportSize(rect.width, rect.height);
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    });
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

      drawBackground(ctx, view, dpr, scene.world.backgroundColor);
      applyCamera(ctx, state.camera, view, dpr);
      if (state.showGrid) drawGrid(ctx, state.camera, view, state.project.settings.gridSize);
      drawEntities(ctx, entities);

      const hovered = hoverRef.current ? byId.get(hoverRef.current) : undefined;
      if (hovered && !state.selectedEntityIds.includes(hovered.id) && !drag) drawHover(ctx, hovered, state.camera.zoom);
      for (const e of selected) drawSelected(ctx, e, state.camera.zoom, time);
      if (selected.length === 2) drawRelation(ctx, selected[0], selected[1], state.camera.zoom);
      if (drag?.kind === 'marquee' && drag.moved) drawMarquee(ctx, drag.startWorld, drag.currentWorld, state.camera.zoom);

      // Screen-space labels and the prompt anchor.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const toScreen = (p: Vec2) => worldToScreen(state.camera, view, p);
      if (selected.length === 1) drawLabel(ctx, selected[0].name, toScreen, getWorldBounds(selected[0]));
      if (selected.length === 2) {
        drawLabel(ctx, selected[0].name, toScreen, getWorldBounds(selected[0]));
        drawLabel(ctx, selected[1].name, toScreen, getWorldBounds(selected[1]));
      }

      const viewWH = { w: view.width, h: view.height };
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
        publishAnchor({ rect: { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y }, view: viewWH, visible: b.x > 0 && a.x < view.width && b.y > 0 && a.y < view.height });
      } else if (state.worldContext) {
        const p = state.worldContext.point ? toScreen(state.worldContext.point) : { x: view.width / 2, y: view.height / 2 };
        drawWorldMarker(ctx, p, scene.name, time);
        publishAnchor({ rect: { minX: p.x - 12, minY: p.y - 12, maxX: p.x + 12, maxY: p.y + 12 }, view: viewWH, visible: true });
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
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const { camera, setCamera } = useEditor.getState();
      const screen = localPoint(canvas, ev);
      const before = screenToWorld(camera, viewRef.current, screen);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom * Math.exp(-ev.deltaY * 0.0015)));
      const view = viewRef.current;
      setCamera({ zoom, x: before.x - (screen.x - view.width / 2) / zoom, y: before.y - (screen.y - view.height / 2) / zoom });
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // Space-to-pan modifier.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isTextInput(e.target)) {
        spaceDownRef.current = true;
        if (e.target === document.body || e.target === canvasRef.current) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDownRef.current = false;
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
      dragRef.current = { kind: 'pan', startScreen: { x: ev.clientX, y: ev.clientY }, startCamera: { ...state.camera }, moved: false };
    } else if (ev.button === 0) {
      const world = toWorld(ev);
      const hit = pick(resolveSceneEntities(state.project, state.activeSceneId), world);
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      if (hit) {
        let selection = state.selectedEntityIds;
        if (additive) selection = selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id];
        else if (!selection.includes(hit.id)) selection = [hit.id];
        state.selectEntities(selection);
        if (selection.includes(hit.id)) {
          dragRef.current = { kind: 'move', startWorld: world, anchor: hit.transform.position, ids: selection, delta: { x: 0, y: 0 } };
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
    if (!drag) {
      const hit = pick(resolveSceneEntities(state.project, state.activeSceneId), toWorld(ev));
      hoverRef.current = hit?.id ?? null;
      canvasRef.current!.style.cursor = hit ? 'pointer' : 'default';
      return;
    }
    if (drag.kind === 'pan') {
      const z = drag.startCamera.zoom;
      drag.moved = true;
      canvasRef.current!.style.cursor = 'grabbing';
      state.setCamera({ x: drag.startCamera.x - (ev.clientX - drag.startScreen.x) / z, y: drag.startCamera.y - (ev.clientY - drag.startScreen.y) / z });
    } else if (drag.kind === 'move') {
      const world = toWorld(ev);
      let target = { x: drag.anchor.x + world.x - drag.startWorld.x, y: drag.anchor.y + world.y - drag.startWorld.y };
      if (state.snapToGrid) {
        const g = state.project.settings.gridSize;
        target = { x: snap(target.x, g), y: snap(target.y, g) };
      }
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
    canvasRef.current!.style.cursor = 'default';
    const state = useEditor.getState();
    if (drag?.kind === 'move' && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
      const label = drag.ids.length === 1 ? 'Move' : `Move ${drag.ids.length} objects`;
      state.edit(label, (p) => moveEntities(p, state.activeSceneId, drag.ids, drag.delta));
    } else if (drag?.kind === 'marquee' && !drag.moved && !drag.additive) {
      // A plain click on empty space clears the context: clean canvas, no prompt.
      state.selectEntities([]);
      state.setWorldContext(false);
    }
  };

  const onDoubleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const state = useEditor.getState();
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
        onPointerLeave={() => (hoverRef.current = null)}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}

/** Places an instance of a definition in the active scene at a world point and selects it. */
export function placeDefinition(definitionId: Id, world: Vec2): Id | null {
  const state = useEditor.getState();
  const def = state.project.definitions.find((d) => d.id === definitionId);
  if (!def) return null;
  const g = state.project.settings.gridSize;
  const pos = state.snapToGrid ? { x: snap(world.x, g), y: snap(world.y, g) } : world;
  const scene = getActiveScene(state);
  const count = scene.entities.filter((e) => e.definitionId === def.id).length;
  const entity = instantiateDefinition(def, pos, count === 0 ? def.name : `${def.name} ${count + 1}`);
  if (!state.edit(`Place ${def.name}`, (p) => addEntity(p, scene.id, entity))) return null;
  state.selectEntities([entity.id]);
  return entity.id;
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

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, view: ViewSize, gridSize: number): void {
  let step = gridSize;
  while (step * camera.zoom < 10) step *= 4;
  const tl = screenToWorld(camera, view, { x: 0, y: 0 });
  const br = screenToWorld(camera, view, { x: view.width, y: view.height });
  // Dots at grid intersections: present but quiet, so the game stays the focus.
  ctx.fillStyle = theme.gridDot;
  const r = 1 / camera.zoom;
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
    for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
}

/** Traces the entity's own shape (rect or ellipse) in local space. */
function traceShape(ctx: CanvasRenderingContext2D, e: ResolvedEntity, pad: number): void {
  const size = getEntitySize(e);
  const { position, rotation, scale } = e.transform;
  const w = size.x * Math.abs(scale.x) + pad * 2;
  const h = size.y * Math.abs(scale.y) + pad * 2;
  ctx.translate(position.x, position.y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.beginPath();
  if (e.components.Collider?.shape === 'circle') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(6, w / 4, h / 4));
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
  ctx.save();
  traceShape(ctx, e, 4 / zoom);
  ctx.shadowColor = theme.selectGlow;
  ctx.shadowBlur = 18 * breathe;
  ctx.strokeStyle = theme.select;
  ctx.lineWidth = 2 / zoom;
  ctx.stroke();
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

/** Two selected objects: an arrow from the first to the second shows the relationship being described. */
function drawRelation(ctx: CanvasRenderingContext2D, a: ResolvedEntity, b: ResolvedEntity, zoom: number): void {
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
  ctx.strokeStyle = theme.select;
  ctx.fillStyle = theme.select;
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([6 / zoom, 5 / zoom]);
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

function drawLabel(ctx: CanvasRenderingContext2D, text: string, toScreen: (p: Vec2) => Vec2, bounds: Rect): void {
  const p = toScreen({ x: (bounds.minX + bounds.maxX) / 2, y: bounds.maxY });
  ctx.save();
  ctx.font = `600 10px ${theme.uiFont}`;
  ctx.letterSpacing = '1.2px';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
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
