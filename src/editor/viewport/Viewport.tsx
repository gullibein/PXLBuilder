import { useEffect, useRef } from 'react';
import { containsPoint, getEntitySize, getWorldBounds, rectsIntersect, type Rect } from '../../core/model/geometry';
import { instantiateDefinition } from '../../core/model/factory';
import { addEntity, moveEntities } from '../../core/model/mutations';
import type { ResolvedEntity } from '../../core/model/resolve';
import type { Id, Vec2 } from '../../core/types';
import { applyCamera, drawBackground, drawEntities, screenToWorld, type Camera, type ViewSize } from '../../render/renderer';
import { setViewportSize } from '../actions';
import { resolveSceneEntities } from '../selectors';
import { getActiveScene, useEditor } from '../store';

export const DEFINITION_DRAG_TYPE = 'application/x-pxlbuilder-definition';

type Drag =
  | { kind: 'pan'; startScreen: Vec2; startCamera: Camera }
  | { kind: 'move'; startWorld: Vec2; anchor: Vec2; ids: Id[]; delta: Vec2 }
  | { kind: 'marquee'; startWorld: Vec2; currentWorld: Vec2; additive: boolean; baseSelection: Id[] };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;

function snap(value: number, grid: number): number {
  return Math.round(value / grid) * grid;
}

export function Viewport() {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewRef = useRef<ViewSize>({ width: 1, height: 1 });
  const dragRef = useRef<Drag | null>(null);
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

  // Render loop.
  useEffect(() => {
    let frame = 0;
    const draw = () => {
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

      drawBackground(ctx, view, dpr, scene.world.backgroundColor);
      applyCamera(ctx, state.camera, view, dpr);
      if (state.showGrid) drawGrid(ctx, state.camera, view, state.project.settings.gridSize);
      drawEntities(ctx, entities);
      drawSelection(ctx, entities, new Set(state.selectedEntityIds), state.camera.zoom);
      if (drag?.kind === 'marquee') drawMarquee(ctx, drag.startWorld, drag.currentWorld, state.camera.zoom);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
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
      // Keep the world point under the cursor fixed.
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
    if (ev.button === 1 || (ev.button === 0 && spaceDownRef.current)) {
      dragRef.current = { kind: 'pan', startScreen: { x: ev.clientX, y: ev.clientY }, startCamera: { ...state.camera } };
    } else if (ev.button === 0) {
      const world = toWorld(ev);
      const entities = resolveSceneEntities(state.project, state.activeSceneId);
      const hit = pick(entities, world);
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      if (hit) {
        let selection = state.selectedEntityIds;
        if (additive) {
          selection = selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id];
        } else if (!selection.includes(hit.id)) {
          selection = [hit.id];
        }
        state.selectEntities(selection);
        if (selection.includes(hit.id)) {
          dragRef.current = { kind: 'move', startWorld: world, anchor: hit.transform.position, ids: selection, delta: { x: 0, y: 0 } };
        }
      } else {
        dragRef.current = { kind: 'marquee', startWorld: world, currentWorld: world, additive, baseSelection: additive ? state.selectedEntityIds : [] };
        if (!additive) state.selectEntities([]);
      }
    } else {
      return;
    }
    canvas.setPointerCapture(ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const state = useEditor.getState();
    if (drag.kind === 'pan') {
      const z = drag.startCamera.zoom;
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
    if (drag?.kind === 'move' && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
      const { edit, activeSceneId } = useEditor.getState();
      const label = drag.ids.length === 1 ? 'Move entity' : `Move ${drag.ids.length} entities`;
      edit(label, (p) => moveEntities(p, activeSceneId, drag.ids, drag.delta));
    }
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
      />
      <ViewportHud />
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

function ViewportHud() {
  const zoom = useEditor((s) => s.camera.zoom);
  const sceneName = useEditor((s) => getActiveScene(s).name);
  const count = useEditor((s) => getActiveScene(s).entities.length);
  return (
    <div className="viewport-hud">
      {sceneName} · {count} {count === 1 ? 'entity' : 'entities'} · {Math.round(zoom * 100)}%
    </div>
  );
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

function isTextInput(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
}

function drawGrid(ctx: CanvasRenderingContext2D, camera: Camera, view: ViewSize, gridSize: number): void {
  let step = gridSize;
  while (step * camera.zoom < 8) step *= 4;
  const tl = screenToWorld(camera, view, { x: 0, y: 0 });
  const br = screenToWorld(camera, view, { x: view.width, y: view.height });
  ctx.lineWidth = 1 / camera.zoom;
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.beginPath();
  for (let x = Math.floor(tl.x / step) * step; x <= br.x; x += step) {
    ctx.moveTo(x, tl.y);
    ctx.lineTo(x, br.y);
  }
  for (let y = Math.floor(tl.y / step) * step; y <= br.y; y += step) {
    ctx.moveTo(tl.x, y);
    ctx.lineTo(br.x, y);
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.moveTo(0, tl.y);
  ctx.lineTo(0, br.y);
  ctx.moveTo(tl.x, 0);
  ctx.lineTo(br.x, 0);
  ctx.stroke();
}

function drawSelection(ctx: CanvasRenderingContext2D, entities: ResolvedEntity[], selected: Set<Id>, zoom: number): void {
  ctx.lineWidth = 2 / zoom;
  ctx.strokeStyle = '#ffd34d';
  for (const e of entities) {
    if (!selected.has(e.id)) continue;
    const size = getEntitySize(e);
    const { position, rotation, scale } = e.transform;
    ctx.save();
    ctx.translate(position.x, position.y);
    ctx.rotate((rotation * Math.PI) / 180);
    const w = size.x * Math.abs(scale.x);
    const h = size.y * Math.abs(scale.y);
    const pad = 3 / zoom;
    ctx.strokeRect(-w / 2 - pad, -h / 2 - pad, w + pad * 2, h + pad * 2);
    ctx.restore();
  }
}

function drawMarquee(ctx: CanvasRenderingContext2D, a: Vec2, b: Vec2, zoom: number): void {
  const r = normalizeRect(a, b);
  ctx.fillStyle = 'rgba(90,160,255,0.12)';
  ctx.strokeStyle = 'rgba(90,160,255,0.8)';
  ctx.lineWidth = 1 / zoom;
  ctx.fillRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
  ctx.strokeRect(r.minX, r.minY, r.maxX - r.minX, r.maxY - r.minY);
}
