import { levelPerPixel, placeBackground, playZoom } from '../background';
import { panelOf, removePanel } from '../../core/model/panels';
import { touchHarm } from '../../core/model/ruleScripts';
import { MAX_ZOOM, MIN_ZOOM } from './zoomLimits';
import { ZoomBar } from './ZoomBar';
import { useEffect, useRef, useState } from 'react';
import { containsPoint, getEntitySize, getWorldBounds, rectsIntersect, type Rect } from '../../core/model/geometry';
import { instantiateDefinition } from '../../core/model/factory';
import { addEntity, moveEntities, removeEntities, setBackground } from '../../core/model/mutations';
import { cellAt, cellCenter, cellKey, cellSize, cellsOnLine, constrainToAxis, snapToCell, type Cell } from '../../core/model/placement';
import { resolveEntity, type ResolvedEntity } from '../../core/model/resolve';
import { componentRegistry } from '../../core/components/builtin';
import type { Id, Project, Scene, Vec2 } from '../../core/types';
import { resolveRef } from '../../core/logic/refs';
import { relationshipRegistry } from '../../core/logic/vocabulary';
import { relationshipLabel } from '../../core/logic/describe';
import { ContextMenu, editSpriteOf } from '../chrome/Dock';
import { hasCopiedObjects, pasteObjects, runQuickCommand } from '../quickCommands';
import { openProjectFile } from '../persistence';
import { connectSwitch, coveredObjects, deleteSelection, isUnderlay, extendSelection, placeOver, resizeEntity, shortenSelection } from '../actions';
import { edgeLayers, edgeSlice, extendCount, pastSide, shrinkCount, extendOffsets, handleAt, handleCursor, handlesFor, resizeRect, unionRect as boxAround, type Handle } from './handles';
import { applyCamera, byLayer, drawBackground, drawEntities, screenToWorld, worldToScreen, type Camera, type ImageLookup, type ViewSize } from '../../render/renderer';
import { imageLookup } from '../images';
import { ensureLevelInView, setViewportSize } from '../actions';
import { publishAnchor } from '../prompt/anchor';
import { resolveSceneEntities } from '../selectors';
import { getActiveScene, getSelectionContext, useEditor } from '../store';
import { contextKey } from '../../core/ai/context';
import { theme } from '../theme';
import { jobMarks, useJobs } from '../ai/jobs';
import { cameraFrame, drawCameraFrame, outlineAt, type CameraOutline } from '../overlays/cameraFrame';
import { drawInfoPanels, drawJumpArcs } from '../overlays/drawOverlays';
import { createWheelInterpreter } from './wheel';

export const DEFINITION_DRAG_TYPE = 'application/x-pxlbuilder-definition';

type Drag =
  | { kind: 'pan'; startScreen: Vec2; startCamera: Camera; moved: boolean }
  | { kind: 'move'; startWorld: Vec2; anchor: Vec2; anchorId: Id; ids: Id[]; delta: Vec2 }
  | { kind: 'marquee'; startWorld: Vec2; currentWorld: Vec2; additive: boolean; baseSelection: Id[]; moved: boolean }
  /** A brush stroke: cells visited so far (painted on release as one undoable step). */
  | { kind: 'paint'; definitionId: Id; erase: boolean; start: Cell; last: Cell; cells: Map<string, Cell> }
  /**
   * Dragging a side point of the selection box: out, copies of what is along that side (`ids`), `step` apart;
   * in, the selection gets shorter from that side (`layers`, outermost first). `count`: copies so far, or minus
   * the layers taken away.
   */
  | { kind: 'extend'; selection: Id[]; ids: Id[]; step: number; box: Rect; dir: Handle['dir']; count: number; layers: { ids: Id[]; thickness: number }[] }
  /** Dragging a corner point of one object's box: its new size (`rect`, in the level). */
  | { kind: 'resize'; id: Id; box: Rect; dir: Handle['dir']; rect: Rect }
  /** Dragging from a switch's red connector onto another object. */
  | { kind: 'connect'; fromId: Id; from: Vec2; current: Vec2; targetId: Id | null }
  /** The placed background picture (its card open): moved (`dir` null) or resized from a corner or side; one Undo step. */
  | { kind: 'background'; sceneId: Id; box: Rect; dir: Handle['dir'] | null; start: Vec2; rect: Rect; key: string };

/** The background picture is selected on the level (clicked). */
function backgroundSelected(state: ReturnType<typeof useEditor.getState>): boolean {
  return state.backgroundSelected && !!state.worldContext;
}

/**
 * The placed background picture's box, while the Background card is open or the picture is selected (it can be moved
 * and resized then).
 */
function backgroundBox(state: ReturnType<typeof useEditor.getState>): Rect | null {
  if (!state.backgroundOpen && !backgroundSelected(state)) return null;
  const bg = getActiveScene(state).world.background;
  if (bg.fit !== 'placed' || !bg.rect || !bg.imageAssetId) return null;
  return { minX: bg.rect.x, minY: bg.rect.y, maxX: bg.rect.x + bg.rect.w, maxY: bg.rect.y + bg.rect.h };
}

/**
 * Where the background picture is in the editor, to click on: a placed one's box; one that fills the screen or
 * repeats is shown inside what the camera shows at the start. Null without a picture.
 */
function backgroundArea(state: ReturnType<typeof useEditor.getState>, view: ViewSize): { box: Rect; placed: boolean } | null {
  const scene = getActiveScene(state);
  const bg = scene.world.background;
  if (!bg.imageAssetId || !state.project.assets.some((a) => a.id === bg.imageAssetId)) return null;
  if (bg.fit === 'placed') return bg.rect ? { box: { minX: bg.rect.x, minY: bg.rect.y, maxX: bg.rect.x + bg.rect.w, maxY: bg.rect.y + bg.rect.h }, placed: true } : null;
  const entities = resolveSceneEntities(state.project, scene.id);
  if (!entities.length) return null;
  return { box: cameraFrame(scene, entities, view, playZoom(state.project, scene, view)).frame, placed: false };
}

const inBox = (b: Rect, p: Vec2) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** A box after dragging one of its corners or sides to a point (the other sides stay), never smaller than `min`. */
function dragSide(box: Rect, dir: Handle['dir'], p: Vec2, min: number): Rect {
  const r = { ...box };
  if (dir.x > 0) r.maxX = Math.max(box.minX + min, p.x);
  if (dir.x < 0) r.minX = Math.min(box.maxX - min, p.x);
  if (dir.y > 0) r.maxY = Math.max(box.minY + min, p.y);
  if (dir.y < 0) r.minY = Math.min(box.maxY - min, p.y);
  return r;
}

/** A box resized from a corner to about `free`, with the shape of `box` (the opposite corner stays). */
function keepShape(box: Rect, dir: Handle['dir'], free: Rect): Rect {
  const bw = box.maxX - box.minX;
  const bh = box.maxY - box.minY;
  // The larger of the two changes decides the scale.
  const scale = Math.max((free.maxX - free.minX) / bw, (free.maxY - free.minY) / bh);
  const w = bw * scale;
  const h = bh * scale;
  const minX = dir.x > 0 ? box.minX : box.maxX - w;
  const minY = dir.y > 0 ? box.minY : box.maxY - h;
  return { minX, minY, maxX: minX + w, maxY: minY + h };
}

const rectOf = (b: Rect) => ({ x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY });

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
  /** The right-click menu on the level (on an object, or on empty space to paste). */
  const [menu, setMenu] = useState<{ x: number; y: number; entityId: Id | null; definitionId: Id | null; world: Vec2 } | null>(null);
  const viewRef = useRef<ViewSize>({ width: 1, height: 1 });
  const dragRef = useRef<Drag | null>(null);
  /**
   * Fingers on the screen. One finger works like the mouse; a second one turns
   * it into a two-finger gesture (pan with both, pinch to zoom) and cancels
   * whatever the first finger started, until all fingers are lifted.
   */
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; start: { clientX: number; clientY: number }; touch: boolean }>({ timer: null, start: { clientX: 0, clientY: 0 }, touch: false });
  const touchRef = useRef<{ points: Map<number, Vec2>; gesture: { mid: Vec2; dist: number; camera: Camera } | null; lastTap: { at: number; x: number; y: number } | null }>({ points: new Map(), gesture: null, lastTap: null });
  const hoverRef = useRef<Id | null>(null);
  /** The connection (arrow) under the pointer, if any. */
  const hoverLinkRef = useRef<Id | null>(null);
  /** The camera outline under the mouse (it glows a little). */
  const hoverOutlineRef = useRef<CameraOutline | null>(null);
  /** The level drawn once (see the render loop): redrawn only when the game, the view or a drag changes it. */
  const layerRef = useRef<{ canvas: HTMLCanvasElement; key: string; entities: ResolvedEntity[] | null; project: unknown; animated: ResolvedEntity[]; at: Vec2 } | null>(null);
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
    // Opening the editor (or coming back from Play) never shows an empty spot far from the level.
    ensureLevelInView();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Render loop. Also publishes the prompt anchor every frame.
  useEffect(() => {
    layerRef.current = null;
    let frame = 0;
    // What the last frame was drawn from: an unchanged editor with nothing moving on screen isn't drawn again (an
    // idle editor then costs nothing, which matters on a laptop on battery).
    let lastSig: unknown[] = [];
    let lastMoving = true;
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
      const jobsNow = useJobs.getState().jobs;
      const sig = [state, jobsNow, view.width, view.height, canvas.width, canvas.height, hoverRef.current, hoverOutlineRef.current, hoverLinkRef.current, layerRef.current?.key];
      if (!lastMoving && !drag && sig.length === lastSig.length && sig.every((v, i) => v === lastSig[i])) return;
      lastSig = sig;
      // Something on screen moves by itself (animations, the selection's pulse, AI work, a flash): drawn every frame.
      lastMoving =
        state.selectedEntityIds.length > 0 ||
        !!state.worldContext ||
        !!state.selectedConnectionId ||
        state.tool.kind === 'brush' ||
        state.tool.kind === 'eyedropper' ||
        (!!state.flash && time < state.flash.until + 100) ||
        Object.keys(jobsNow).length > 0 ||
        (layerRef.current?.animated.length ?? 1) > 0 ||
        layerRef.current?.key === '';

      const placed = resolveSceneEntities(state.project, scene.id);
      let entities = placed;
      if (drag?.kind === 'move' && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
        const moving = new Set(drag.ids);
        entities = entities.map((e) =>
          moving.has(e.id)
            ? { ...e, transform: { ...e.transform, position: { x: e.transform.position.x + drag.delta.x, y: e.transform.position.y + drag.delta.y } } }
            : e,
        );
      }
      if (drag?.kind === 'resize') entities = entities.map((e) => (e.id === drag.id ? resizedEntity(e, drag.rect) : e));
      // Shortening: what will go is shown faint (and out of the selection) until let go.
      const shortening = drag?.kind === 'extend' && drag.count < 0 ? new Set(drag.layers.slice(0, -drag.count).flatMap((l) => l.ids)) : null;
      if (shortening) entities = entities.map((e) => (shortening.has(e.id) ? { ...e, alpha: 0.2 } : e));
      const byId = new Map(entities.map((e) => [e.id, e]));
      const selected = state.selectedEntityIds.filter((id) => !shortening?.has(id)).map((id) => byId.get(id)).filter((e): e is ResolvedEntity => !!e);

      // Observable view state (used by tests and handy when debugging).
      const camAttr = `${state.camera.x.toFixed(1)},${state.camera.y.toFixed(1)},${state.camera.zoom.toFixed(4)}`;
      if (canvas.dataset.camera !== camAttr) canvas.dataset.camera = camAttr;
      if (canvas.dataset.entities !== String(scene.entities.length)) canvas.dataset.entities = String(scene.entities.length);

      const images = imageLookup(state.project);
      const wire = state.layout.wireframe;
      /*
       * The level (background, grid and everything placed) is drawn into a layer of its own, and that layer is
       * drawn again only when something in it changes: the game, what is being dragged, the view or its zoom, a
       * picture that finished loading. Moving the mouse (hover frames, outlines, the prompt anchor) then costs only
       * the overlays, not the whole level again: on a slow laptop on battery that is the difference between the
       * hover frame following the mouse and lagging seconds behind.
       *
       * The layer reaches a margin beyond the view on every side, so scrolling (a big level is mostly scrolled
       * through) only moves it, on whole screen pixels; it is drawn again once the view goes past its edge.
       */
      const layer = (layerRef.current ??= { canvas: document.createElement('canvas'), key: '', entities: null, project: null, animated: [], at: { x: 0, y: 0 } });
      const marginCss = Math.min(360, Math.round(Math.min(view.width, view.height) * 0.35));
      const margin = Math.round(marginCss * dpr);
      const key = `${scene.id}|${state.camera.zoom}|${canvas.width}x${canvas.height}|${wire ? 1 : 0}|${state.layout.showGrid ? 1 : 0}`;
      // How far the view moved since the layer was drawn, in canvas pixels (whole ones: pixel art stays sharp).
      const shiftX = Math.round((layer.at.x - state.camera.x) * state.camera.zoom * dpr);
      const shiftY = Math.round((layer.at.y - state.camera.y) * state.camera.zoom * dpr);
      if (layer.key !== key || layer.entities !== entities || layer.project !== state.project || Math.abs(shiftX) > margin || Math.abs(shiftY) > margin) {
        if (layer.canvas.width !== canvas.width + 2 * margin || layer.canvas.height !== canvas.height + 2 * margin) {
          layer.canvas.width = canvas.width + 2 * margin;
          layer.canvas.height = canvas.height + 2 * margin;
        }
        layer.at = { x: state.camera.x, y: state.camera.y };
        // The layer's own view: the canvas's and the margin around it.
        const lview = { width: layer.canvas.width / dpr, height: layer.canvas.height / dpr };
        const lctx = layer.canvas.getContext('2d')!;
        lctx.setTransform(1, 0, 0, 1, 0, 0);
        lctx.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
        let missing = false;
        const tracked: typeof images = (id) => {
          const img = images(id);
          if (!img) missing = true;
          return img;
        };
        if (wire) {
          lctx.fillStyle = theme.wire.ground;
          lctx.fillRect(0, 0, layer.canvas.width, layer.canvas.height);
        } else {
          // (A picture that fills the screen or repeats: shown inside what the camera shows at the start.)
          const screen = placed.length ? cameraFrame(scene, placed, view, playZoom(state.project, scene, view)).frame : null;
          drawBackground(lctx, lview, dpr, scene.world, state.camera, tracked, { editing: true, screen });
        }
        applyCamera(lctx, state.camera, lview, dpr);
        if (state.layout.showGrid) drawGrid(lctx, state.camera, lview, state.project.settings.gridSize, wire);
        // Things that start hidden (until a rule or switch shows them) are half see-through; invisible things fainter
        // still. Animated sprites play in the editor too: they are drawn every frame, on top of the layer.
        const shown = entities.map((e) => (e.components.StartsHidden ? { ...e, alpha: 0.5 } : e));
        const isAnimated = (e: ResolvedEntity) => {
          const id = e.components.Sprite?.assetId;
          return typeof id === 'string' && !!images(id)?.animation;
        };
        if (wire) drawWireframe(lctx, entities, state.camera.zoom);
        else drawEntities(lctx, shown.filter((e) => !isAnimated(e)), tracked, 0.3, 0);
        layer.animated = wire ? [] : shown.filter(isAnimated);
        // A picture not loaded yet was drawn as its color: the layer is drawn again once it is.
        layer.key = missing ? '' : key;
        layer.entities = entities;
        layer.project = state.project;
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      {
        const dx = Math.round((layer.at.x - state.camera.x) * state.camera.zoom * dpr);
        const dy = Math.round((layer.at.y - state.camera.y) * state.camera.zoom * dpr);
        ctx.drawImage(layer.canvas, dx - margin, dy - margin);
      }
      applyCamera(ctx, state.camera, view, dpr);
      if (layer.animated.length) drawEntities(ctx, layer.animated, images, 0.3, time / 1000);
      if ((canvas.dataset.wireframe ?? '') !== (wire ? '1' : '')) canvas.dataset.wireframe = wire ? '1' : '';
      drawJumpArcs(ctx, state.layout.overlays, entities, scene, state.camera.zoom);
      let frameAttr = '';
      // The camera outline once anything is placed (with nothing to follow, it shows where a still camera looks).
      if (state.layout.showCameraOutlines && placed.length) {
        // From where things are, not where they're being dragged: the camera frame stays put while the player is held.
        const f = cameraFrame(scene, placed, view, playZoom(state.project, scene, view));
        drawCameraFrame(ctx, f, state.camera.zoom, { hover: hoverOutlineRef.current, selected: state.cameraOutline });
        frameAttr = [f.frame.minX, f.frame.minY, f.frame.maxX, f.frame.maxY].map((v) => v.toFixed(0)).join(',');
      }
      if ((canvas.dataset.cameraFrame ?? '') !== frameAttr) canvas.dataset.cameraFrame = frameAttr;
      const outlineAttr = `${hoverOutlineRef.current ?? ''}|${state.cameraOutline ?? ''}`;
      if (canvas.dataset.cameraOutline !== outlineAttr) canvas.dataset.cameraOutline = outlineAttr;
      if (state.tool.kind === 'brush' && !state.altHeld) drawBrush(ctx, state.tool.definitionId, drag, pointerWorldRef.current, state.project.settings.gridSize, state.camera.zoom, images);

      const hovered = hoverRef.current ? byId.get(hoverRef.current) : undefined;
      if (hovered && !state.selectedEntityIds.includes(hovered.id) && !drag) drawHover(ctx, hovered, state.camera.zoom);
      // Copies a side drag will make, faint until let go.
      let ghosts: ResolvedEntity[] = [];
      if (drag?.kind === 'extend' && drag.count > 0) {
        const originals = entities.filter((e) => drag.ids.includes(e.id));
        ghosts = extendOffsets(drag.dir, drag.step, drag.count).flatMap((o) =>
          originals.map((e) => ({ ...e, id: `${e.id}~${o.x},${o.y}`, alpha: 0.55, transform: { ...e.transform, position: { x: e.transform.position.x + o.x, y: e.transform.position.y + o.y } } })),
        );
        if (!wire) drawEntities(ctx, ghosts, images, 0.3, time / 1000);
        else drawWireframe(ctx, ghosts, state.camera.zoom);
      }
      const reach = drag?.kind === 'extend' ? (shortening ? boxAround(selected.map(getWorldBounds)) : boxAround([drag.box, ...ghosts.map(getWorldBounds)])) : null;
      drawSelection(ctx, selected, state.camera.zoom, time, !drag || drag.kind === 'extend' || drag.kind === 'resize', reach);
      const bgBox = backgroundBox(state);
      if (bgBox) drawBackgroundBox(ctx, bgBox, state.camera.zoom);
      // A selected picture that fills the screen or repeats: its outline only (it can't be moved or resized).
      const bgArea = backgroundSelected(state) ? backgroundArea(state, view) : null;
      if (bgArea && !bgArea.placed) drawBackgroundBox(ctx, bgArea.box, state.camera.zoom, false);
      // Where a picture about to be generated goes, and how big it is.
      const t0 = state.backgroundOpen ? state.backgroundTarget : null;
      // (Not over a picture already made in that very box.)
      const target = t0 && !(bgBox && bgBox.minX === t0.x && bgBox.minY === t0.y && bgBox.maxX === t0.x + t0.w && bgBox.maxY === t0.y + t0.h) ? t0 : null;
      if (target) drawPictureTarget(ctx, target, state.camera.zoom);
      const targetAttr = target ? [target.x, target.y, target.x + target.w, target.y + target.h].map((v) => v.toFixed(0)).join(',') : '';
      if ((canvas.dataset.backgroundTarget ?? '') !== targetAttr) canvas.dataset.backgroundTarget = targetAttr;
      const bgAttr = bgBox ? [bgBox.minX, bgBox.minY, bgBox.maxX, bgBox.maxY].map((v) => v.toFixed(0)).join(',') : '';
      if ((canvas.dataset.backgroundBox ?? '') !== bgAttr) canvas.dataset.backgroundBox = bgAttr;
      const handlesAttr = selected.length ? selectionFrame(selected).handles.map((h) => `${h.kind[0]}${h.dir.x},${h.dir.y}@${h.at.x.toFixed(0)},${h.at.y.toFixed(0)}`).join(' ') : '';
      if ((canvas.dataset.handles ?? '') !== handlesAttr) canvas.dataset.handles = handlesAttr;
      // The middle of the selection, in the level (for tests: where to right-click it).
      const selBox = selected.length ? selectionFrame(selected).box : null;
      const selAttr = selBox ? `${((selBox.minX + selBox.maxX) / 2).toFixed(0)},${((selBox.minY + selBox.maxY) / 2).toFixed(0)}` : '';
      if ((canvas.dataset.selection ?? '') !== selAttr) canvas.dataset.selection = selAttr;
      // What is selected, as the AI would get it (entity, pair, group, level…), card open or not (for tests).
      const ctxAttr = getSelectionContext(state)?.kind ?? '';
      if ((canvas.dataset.context ?? '') !== ctxAttr) canvas.dataset.context = ctxAttr;
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
      } else if (bgArea) {
        // The background: the ✦ and its card go with the picture's box.
        const a = toScreen({ x: bgArea.box.minX, y: bgArea.box.minY });
        const b = toScreen({ x: bgArea.box.maxX, y: bgArea.box.maxY });
        // (Only the part of it in view: a level-sized picture is mostly off screen.)
        const r = { minX: Math.max(a.x, 0), minY: Math.max(a.y, CHROME_INSETS.top), maxX: Math.min(b.x, view.width), maxY: Math.min(b.y, view.height - CHROME_INSETS.bottom) };
        publishAnchor({ key: anchorKey, rect: r, view: viewWH, visible: r.maxX > r.minX && r.maxY > r.minY });
      } else if (state.worldContext) {
        const p = state.worldContext.point ? toScreen(state.worldContext.point) : { x: view.width / 2, y: view.height / 2 };
        // A selected camera outline glows instead (the level's marker is for a spot on the level).
        if (!state.cameraOutline) drawWorldMarker(ctx, p, scene.name, time);
        if (canvas.dataset.marker !== (state.cameraOutline ? '' : '1')) canvas.dataset.marker = state.cameraOutline ? '' : '1';
        publishAnchor({ key: anchorKey, rect: { minX: p.x - 12, minY: p.y - 12, maxX: p.x + 12, maxY: p.y + 12 }, view: viewWH, visible: true });
      } else {
        publishAnchor(null);
      }
      if (!state.worldContext && canvas.dataset.marker) canvas.dataset.marker = '';
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
      // Touch pinches are handled from the fingers themselves (with panning); this is for trackpads.
      if (touchRef.current.points.size >= 2) return;
      const g = ev as Event & { scale: number; clientX: number; clientY: number };
      zoomAt(localPoint(canvas, g), (gestureZoom * g.scale) / useEditor.getState().camera.zoom);
    };
    // A finger on the level never scrolls or pans the page (Safari can otherwise take a drag over: the view moves and
    // the drag is cancelled). Panning is with two fingers, done here.
    const onTouchMove = (ev: TouchEvent) => ev.preventDefault();
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('gesturestart', onGestureStart);
    canvas.addEventListener('gesturechange', onGestureChange);
    return () => {
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('touchmove', onTouchMove);
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
    // Alt held: the eyedropper (let go, the tool is back). Its default (the browser's menu bar) is kept from taking the keys.
    const altDown = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || isTextInput(e.target)) return;
      e.preventDefault();
      useEditor.getState().setAltHeld(true);
      if (!dragRef.current && canvasRef.current) canvasRef.current.style.cursor = EYEDROPPER_CURSOR;
    };
    const altUp = (e: KeyboardEvent) => {
      if (e.key !== 'Alt') return;
      e.preventDefault();
      useEditor.getState().setAltHeld(false);
      if (!dragRef.current && canvasRef.current) canvasRef.current.style.cursor = '';
    };
    const blur = () => useEditor.getState().setAltHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('keydown', altDown);
    window.addEventListener('keyup', altUp);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('keydown', altDown);
      window.removeEventListener('keyup', altUp);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const toWorld = (ev: { clientX: number; clientY: number }) =>
    screenToWorld(useEditor.getState().camera, viewRef.current, localPoint(canvasRef.current!, ev));

  /** Starts a two-finger gesture from the fingers down now. */
  const startGesture = () => {
    const [a, b] = [...touchRef.current.points.values()];
    touchRef.current.gesture = { mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), camera: { ...useEditor.getState().camera } };
  };

  /** The object's menu (or, on empty space, the level's) where the pointer is. */
  const openMenuAt = (p: { clientX: number; clientY: number }) => {
    const state = useEditor.getState();
    if (state.tool.kind === 'brush') return;
    const world = toWorld(p);
    const hit = pick(resolveSceneEntities(state.project, state.activeSceneId), world);
    if (hit && !state.selectedEntityIds.includes(hit.id)) state.selectEntities([hit.id]);
    setMenu({ x: p.clientX, y: p.clientY, entityId: hit?.id ?? null, definitionId: hit?.definitionId ?? null, world });
  };

  const cancelLongPress = () => {
    const lp = longPressRef.current;
    if (lp.timer) clearTimeout(lp.timer);
    lp.timer = null;
  };

  const onPointerDown = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    canvas.focus();
    // (Read again after the tool changes below: a tap on an object while drawing goes on as a selection.)
    let state = useEditor.getState();
    longPressRef.current.touch = ev.pointerType === 'touch';
    cancelLongPress();
    if (ev.pointerType === 'touch' && touchRef.current.points.size === 0 && state.tool.kind !== 'brush') {
      // A long press (a finger held still for half a second) opens the menu, as the right button does.
      const at = { clientX: ev.clientX, clientY: ev.clientY };
      longPressRef.current.start = at;
      longPressRef.current.timer = setTimeout(() => {
        longPressRef.current.timer = null;
        const drag = dragRef.current;
        if (drag?.kind === 'marquee') useEditor.getState().selectEntities(drag.baseSelection);
        dragRef.current = null;
        useEditor.getState().setObjectDrag(false);
        openMenuAt(at);
      }, 500);
    }
    if (ev.pointerType === 'touch') {
      const touch = touchRef.current;
      touch.points.set(ev.pointerId, localPoint(canvas, ev));
      capture(canvas, ev.pointerId);
      if (touch.points.size >= 2 || touch.gesture) {
        // A second finger: this is a pan/zoom, not a drawing or a drag (or a long press). What the first finger began is dropped.
        cancelLongPress();
        const drag = dragRef.current;
        if (drag?.kind === 'marquee') state.selectEntities(drag.baseSelection);
        dragRef.current = null;
        state.setObjectDrag(false);
        if (touch.points.size >= 2) startGesture();
        return;
      }
      // Tapping a placed object selects it, also while drawing with an object.
      if (state.tool.kind === 'brush' && pick(resolveSceneEntities(state.project, state.activeSceneId), toWorld(ev))) {
        state.setTool({ kind: 'select' });
        state = useEditor.getState();
      }
    }
    if (state.dock) state.setDock(null);
    // Working on the level closes the whole-level/game card (its prompt carries on; dots on ✦ show it).
    if (state.globalPrompt.open) state.setGlobalPrompt(false);
    if (ev.button === 0 && !spaceDownRef.current && (state.tool.kind === 'eyedropper' || ev.altKey)) {
      // The eyedropper: the clicked object's kind, to place or draw with (as if picked in the Objects panel).
      const hit = pick(resolveSceneEntities(state.project, state.activeSceneId), toWorld(ev));
      if (hit?.definitionId && state.project.definitions.some((d) => d.id === hit.definitionId)) state.pickUp(hit.definitionId);
      else if (hit) state.logMessage('warn', `${hit.name} is one of a kind (not from the Objects panel): there's nothing to draw it with.`);
      return;
    }
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
    } else if (ev.button === 0 && state.tool.kind === 'marquee') {
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      const world = toWorld(ev);
      dragRef.current = { kind: 'marquee', startWorld: world, currentWorld: world, additive, baseSelection: additive ? state.selectedEntityIds : [], moved: false };
    } else if (ev.button === 0) {
      const world = toWorld(ev);
      const entities = resolveSceneEntities(state.project, state.activeSceneId);
      // The placed background (its card open): its corners and sides resize it, and inside it, where no object is,
      // it is dragged along.
      const bgBox = backgroundBox(state);
      if (bgBox) {
        const h = handleAt(handlesFor(bgBox, true), bgBox, world, state.camera.zoom, ev.pointerType === 'touch' ? 18 : 8);
        const inside = world.x >= bgBox.minX && world.x <= bgBox.maxX && world.y >= bgBox.minY && world.y <= bgBox.maxY;
        if (h || (inside && !pick(entities, world))) {
          dragRef.current = { kind: 'background', sceneId: state.activeSceneId, box: bgBox, dir: h ? h.dir : null, start: world, rect: bgBox, key: `${state.activeSceneId}.background.${ev.timeStamp}` };
          capture(canvas, ev.pointerId);
          return;
        }
      }
      const handle = connectorAt(state.selectedEntityIds, entities, world, state.camera.zoom);
      if (handle) {
        dragRef.current = { kind: 'connect', fromId: handle.entityId, from: handle.point, current: world, targetId: null };
        capture(canvas, ev.pointerId);
        return;
      }
      const additive = ev.shiftKey || ev.ctrlKey || ev.metaKey;
      // A point on the selection box: sides repeat the selection in a line, corners resize one object.
      const chosen = entities.filter((e) => state.selectedEntityIds.includes(e.id));
      const frame = chosen.length && !additive ? selectionFrame(chosen) : null;
      const boxHandle = frame && handleAt(frame.handles, frame.box, world, state.camera.zoom, ev.pointerType === 'touch' ? 18 : 8);
      if (frame && boxHandle) {
        dragRef.current =
          boxHandle.kind === 'side'
            ? (() => {
                const items = chosen.map((e) => ({ id: e.id, bounds: getWorldBounds(e) }));
                return { kind: 'extend' as const, selection: chosen.map((e) => e.id), ...edgeSlice(items, frame.box, boxHandle.dir), box: frame.box, dir: boxHandle.dir, count: 0, layers: edgeLayers(items, boxHandle.dir) };
              })()
            : { kind: 'resize', id: chosen[0].id, box: frame.box, dir: boxHandle.dir, rect: frame.box };
        // The prompt card steps aside while the box is being dragged.
        state.setObjectDrag(true);
        capture(canvas, ev.pointerId);
        return;
      }
      const hit = pick(entities, world);
      const scene = getActiveScene(state);
      const line = hit ? null : connectionAt(state.project, scene, new Map(entities.map((e) => [e.id, e])), world, state.camera.zoom);
      if (line && !additive) {
        // A single click selects it; the prompt card opens on a double-click.
        if (state.selectedConnectionId !== line) state.setPromptOpen(false);
        state.selectConnection(line);
        return;
      }
      // A camera outline (its label, or its line where no object is under it): select it (it glows) and open its prompt
      // card (with Settings for the camera's settings).
      const outline = additive || !state.layout.showCameraOutlines || !entities.length ? null : outlineAt(cameraFrame(scene, entities, viewRef.current, playZoom(state.project, scene, viewRef.current)), world, state.camera.zoom, hit ? 0 : 6);
      if (outline) {
        state.selectCameraOutline(outline, world);
        state.setPromptOpen(true);
        return;
      }
      if (hit) {
        let selection = state.selectedEntityIds;
        if (additive) selection = selection.includes(hit.id) ? selection.filter((id) => id !== hit.id) : [...selection, hit.id];
        else if (!selection.includes(hit.id)) selection = [hit.id];
        // Selecting something else closes the prompt card (a double-click opens one); pressing on what is already
        // selected (to move it) keeps it.
        if (selection.length !== state.selectedEntityIds.length || selection.some((id) => !state.selectedEntityIds.includes(id))) state.setPromptOpen(false);
        state.selectEntities(selection);
        if (selection.includes(hit.id)) {
          dragRef.current = { kind: 'move', startWorld: world, anchor: hit.transform.position, anchorId: hit.id, ids: selection, delta: { x: 0, y: 0 } };
        }
      } else {
        if (!additive) state.setPromptOpen(false);
        dragRef.current = { kind: 'marquee', startWorld: world, currentWorld: world, additive, baseSelection: additive ? state.selectedEntityIds : [], moved: false };
      }
    } else {
      return;
    }
    capture(canvas, ev.pointerId);
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLCanvasElement>) => {
    const touch = touchRef.current;
    // The finger moved: a drag, not a long press.
    const lp = longPressRef.current;
    if (lp.timer && Math.hypot(ev.clientX - lp.start.clientX, ev.clientY - lp.start.clientY) > 8) cancelLongPress();
    if (ev.pointerType === 'touch' && touch.points.has(ev.pointerId)) {
      touch.points.set(ev.pointerId, localPoint(canvasRef.current!, ev));
      const g = touch.gesture;
      if (g) {
        if (touch.points.size < 2) return;
        // Pan with the point between the fingers, zoom by how far apart they are, around that point.
        const [a, b] = [...touch.points.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, g.camera.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist)));
        const view = viewRef.current;
        const anchor = screenToWorld(g.camera, view, g.mid);
        useEditor.getState().setCamera({ zoom, x: anchor.x - (mid.x - view.width / 2) / zoom, y: anchor.y - (mid.y - view.height / 2) / zoom });
        return;
      }
    }
    const drag = dragRef.current;
    const state = useEditor.getState();
    pointerWorldRef.current = toWorld(ev);
    if (!drag) {
      if (state.tool.kind === 'eyedropper' || state.altHeld || ev.altKey) {
        // What a click would pick up glows.
        hoverRef.current = spaceDownRef.current ? null : (pick(resolveSceneEntities(state.project, state.activeSceneId), toWorld(ev))?.id ?? null);
        canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : EYEDROPPER_CURSOR;
        return;
      }
      if (state.tool.kind === 'marquee') {
        hoverRef.current = null;
        canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : 'crosshair';
        return;
      }
      if (state.tool.kind === 'brush') {
        hoverRef.current = null;
        canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : 'crosshair';
        return;
      }
      const world = toWorld(ev);
      const entities = resolveSceneEntities(state.project, state.activeSceneId);
      const bgBox = backgroundBox(state);
      const bgHandle = bgBox && handleAt(handlesFor(bgBox, true), bgBox, world, state.camera.zoom, 8);
      if (bgBox && (bgHandle || (world.x >= bgBox.minX && world.x <= bgBox.maxX && world.y >= bgBox.minY && world.y <= bgBox.maxY && !pick(entities, world)))) {
        hoverRef.current = null;
        canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : bgHandle ? handleCursor(bgHandle) : 'move';
        return;
      }
      const chosen = entities.filter((e) => state.selectedEntityIds.includes(e.id));
      const frame = chosen.length ? selectionFrame(chosen) : null;
      const handle = frame && handleAt(frame.handles, frame.box, world, state.camera.zoom, 8);
      if (handle) {
        hoverRef.current = null;
        canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : handleCursor(handle);
        return;
      }
      const hit = pick(entities, world);
      hoverRef.current = hit?.id ?? null;
      const onConnector = !!connectorAt(state.selectedEntityIds, entities, world, state.camera.zoom);
      const line = hit || onConnector ? null : connectionAt(state.project, getActiveScene(state), new Map(entities.map((e) => [e.id, e])), world, state.camera.zoom);
      hoverLinkRef.current = line;
      const onLine = !!line;
      hoverOutlineRef.current = onConnector || onLine || !state.layout.showCameraOutlines || !entities.length ? null : outlineAt(cameraFrame(getActiveScene(state), entities, viewRef.current, playZoom(state.project, getActiveScene(state), viewRef.current)), world, state.camera.zoom, hit ? 0 : 6);
      // On the outline's label: that is what a click picks, not the object under it.
      if (hoverOutlineRef.current) hoverRef.current = null;
      canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : onConnector ? 'crosshair' : hit || onLine || hoverOutlineRef.current ? 'pointer' : 'default';
      return;
    }
    if (drag.kind === 'connect') {
      drag.current = toWorld(ev);
      const over = pick(resolveSceneEntities(state.project, state.activeSceneId), drag.current);
      drag.targetId = over && over.id !== drag.fromId ? over.id : null;
      return;
    }
    if (drag.kind === 'extend') {
      const p = toWorld(ev);
      const past = pastSide(drag.box, drag.dir, p);
      drag.count = past >= 0 ? extendCount(drag.box, drag.dir, p, drag.step) : -shrinkCount(drag.layers, -past);
      return;
    }
    if (drag.kind === 'background') {
      const p = toWorld(ev);
      const k = levelPerPixel(state.project);
      if (drag.dir) {
        const free = dragSide(drag.box, drag.dir, p, 8 * k);
        // A corner keeps the picture's shape (Shift: any shape); a side stretches it one way.
        drag.rect = drag.dir.x && drag.dir.y && !ev.shiftKey ? keepShape(drag.box, drag.dir, free) : free;
      }
      else {
        // Moved in whole game pixels.
        const dx = Math.round((p.x - drag.start.x) / k) * k;
        const dy = Math.round((p.y - drag.start.y) / k) * k;
        drag.rect = { minX: drag.box.minX + dx, maxX: drag.box.maxX + dx, minY: drag.box.minY + dy, maxY: drag.box.maxY + dy };
      }
      // Shown as it goes (stretched while resizing; drawn again at its new size when let go), all one Undo step.
      state.edit('Move background', (pr) => setBackground(pr, drag.sceneId, { rect: rectOf(drag.rect) }), { coalesceKey: drag.key });
      return;
    }
    if (drag.kind === 'resize') {
      const grid = state.layout.snapToGrid ? state.project.settings.gridSize / 2 : null;
      drag.rect = resizeRect(drag.box, drag.dir, toWorld(ev), grid, 4);
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
      // Moving objects: the prompt card steps aside until they're let go.
      state.setObjectDrag(true);
      // Over the trash can: it lights up (dropping deletes them).
      state.setTrashHot(overTrash(ev));
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
    const touch = touchRef.current;
    cancelLongPress();
    if (ev.pointerType === 'touch') {
      touch.points.delete(ev.pointerId);
      if (touch.gesture) {
        // The gesture lasts until every finger is up; with two still down it goes on from where they are.
        if (touch.points.size >= 2) startGesture();
        else if (touch.points.size === 0) touch.gesture = null;
        return;
      }
    }
    const drag = dragRef.current;
    dragRef.current = null;
    useEditor.getState().setObjectDrag(false);
    if (canvasRef.current?.hasPointerCapture(ev.pointerId)) canvasRef.current.releasePointerCapture(ev.pointerId);
    const state = useEditor.getState();
    canvasRef.current!.style.cursor = spaceDownRef.current ? 'grab' : state.tool.kind === 'eyedropper' || state.altHeld ? EYEDROPPER_CURSOR : state.tool.kind === 'brush' || state.tool.kind === 'marquee' ? 'crosshair' : 'default';
    if (drag?.kind === 'paint') {
      commitStroke(drag);
      return;
    }
    if (drag?.kind === 'connect') {
      if (drag.targetId) connectSwitch(drag.fromId, drag.targetId);
      return;
    }
    if (drag?.kind === 'extend') {
      if (drag.count > 0) extendSelection(drag.ids, extendOffsets(drag.dir, drag.step, drag.count), drag.selection);
      else if (drag.count < 0) shortenSelection(drag.layers.slice(0, -drag.count).flatMap((l) => l.ids), drag.selection);
      return;
    }
    if (drag?.kind === 'background') {
      if (drag.rect !== drag.box) void placeBackground(drag.sceneId, rectOf(drag.rect), drag.key);
      return;
    }
    if (drag?.kind === 'resize') {
      const r = drag.rect;
      if (r.minX !== drag.box.minX || r.maxX !== drag.box.maxX || r.minY !== drag.box.minY || r.maxY !== drag.box.maxY) resizeEntity(drag.id, r);
      return;
    }
    // Over the trash when let go (or when the browser took the touch over: pointercancel's position isn't reliable,
    // so the last move counts).
    const dropOnTrash = drag?.kind === 'move' && (ev.type === 'pointerup' ? overTrash(ev) : state.trashHot);
    state.setTrashHot(false);
    if (drag?.kind === 'move' && dropOnTrash) {
      // Dropped on the trash can: deleted (Undo brings them back).
      state.edit(drag.ids.length === 1 ? 'Delete entity' : `Delete ${drag.ids.length} entities`, (p) => removeEntities(p, state.activeSceneId, drag.ids));
      return;
    }
    if (drag?.kind === 'move' && (drag.delta.x !== 0 || drag.delta.y !== 0)) {
      const label = drag.ids.length === 1 ? 'Move' : `Move ${drag.ids.length} objects`;
      state.edit(label, (p) => moveEntities(p, state.activeSceneId, drag.ids, drag.delta));
    } else if (drag?.kind === 'move' && ev.pointerType === 'touch' && ev.type === 'pointerup') {
      // Double-tap on an object: its prompt card (as a double-click does; touch screens don't always send one).
      const p = localPoint(canvasRef.current!, ev);
      const last = touch.lastTap;
      if (last && ev.timeStamp - last.at < 350 && Math.hypot(p.x - last.x, p.y - last.y) < 24) {
        touch.lastTap = null;
        state.setPromptOpen(true);
      } else touch.lastTap = { at: ev.timeStamp, x: p.x, y: p.y };
    } else if (drag?.kind === 'marquee' && !drag.moved && state.tool.kind === 'marquee' && pick(resolveSceneEntities(state.project, state.activeSceneId), toWorld(ev))) {
      // The marquee tool: a click on an object selects it (Shift adds it, or takes it out).
      const hit = pick(resolveSceneEntities(state.project, state.activeSceneId), toWorld(ev))!;
      const base = drag.baseSelection;
      state.selectEntities(drag.additive ? (base.includes(hit.id) ? base.filter((id) => id !== hit.id) : [...base, hit.id]) : [hit.id]);
    } else if (drag?.kind === 'marquee' && !drag.moved && !drag.additive) {
      // A plain click on empty space clears the context: clean canvas, no prompt. On the background picture, it
      // selects that (its box to move and resize it, ✦ for its card).
      state.selectEntities([]);
      state.setWorldContext(false);
      state.selectConnection(null);
      const world = toWorld(ev);
      const area = state.tool.kind === 'select' ? backgroundArea(state, viewRef.current) : null;
      if (area && inBox(area.box, world)) state.selectBackground(world);
      // Double-tap on empty space: the level's prompt (as a double-click does; touch screens don't always send one).
      if (ev.pointerType === 'touch' && ev.type === 'pointerup') {
        const p = localPoint(canvasRef.current!, ev);
        const last = touch.lastTap;
        if (last && ev.timeStamp - last.at < 350 && Math.hypot(p.x - last.x, p.y - last.y) < 24) {
          touch.lastTap = null;
          state.setWorldContext(toWorld(ev));
          state.setPromptOpen(true);
        } else touch.lastTap = { at: ev.timeStamp, x: p.x, y: p.y };
      }
    }
  };

  /**
   * A double-click opens the AI prompt card: for the object (or the selected group it belongs to), a connection, the
   * camera outline, or (on empty space) the level.
   */
  const onDoubleClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const state = useEditor.getState();
    if (state.tool.kind === 'brush' || state.tool.kind === 'eyedropper') return;
    const world = toWorld(ev);
    const entities = resolveSceneEntities(state.project, state.activeSceneId);
    const hit = pick(entities, world);
    const scene = getActiveScene(state);
    // The camera outline is picked as a single click picks it.
    const outline = state.layout.showCameraOutlines && entities.length ? outlineAt(cameraFrame(scene, entities, viewRef.current, playZoom(state.project, scene, viewRef.current)), world, state.camera.zoom, hit ? 0 : 6) : null;
    if (outline) state.selectCameraOutline(outline, world);
    else if (hit) {
      if (!state.selectedEntityIds.includes(hit.id)) state.selectEntities([hit.id]);
    } else {
      const line = connectionAt(state.project, scene, new Map(entities.map((e) => [e.id, e])), world, state.camera.zoom);
      if (line) state.selectConnection(line);
      else state.setWorldContext(world);
    }
    state.setPromptOpen(true);
  };

  const onDragOver = (ev: React.DragEvent) => {
    // A file from the computer: a saved game (or an exported game page) to open.
    if (ev.dataTransfer.types.includes(DEFINITION_DRAG_TYPE) || ev.dataTransfer.types.includes('Files')) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (ev: React.DragEvent) => {
    const file = ev.dataTransfer.files?.[0];
    if (file) {
      ev.preventDefault();
      // Opens it in place of the game here (Undo brings this one back).
      if (/\.(json|html?)$/i.test(file.name)) void openProjectFile(file);
      else useEditor.getState().logMessage('warn', `${file.name} isn't a saved game (a .pxlproj.json file, or a game exported as .html)`);
      return;
    }
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
        onContextMenu={(e) => {
          // While drawing, the right button erases; otherwise it's the object's menu. (On a touch screen the menu
          // comes from a long press, timed here, not from the browser's own long-press menu.)
          e.preventDefault();
          if (longPressRef.current.touch) return;
          openMenuAt(e);
        }}
      />
      <ZoomBar />
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            {
              // The AI prompt card for it (or, on empty space, for the level), as a double-click opens it.
              label: 'Ask AI…',
              testId: 'ctx-ask-ai',
              run: () => {
                const s = useEditor.getState();
                if (!menu.entityId) s.setWorldContext(menu.world);
                s.setPromptOpen(true);
                requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-testid="context-prompt"] textarea')?.focus());
              },
            },
            {
              // The object's settings (or, on empty space, the level's): position, size, health, gravity…
              label: 'Details…',
              testId: 'ctx-details',
              run: () => {
                const s = useEditor.getState();
                if (!menu.entityId) s.setWorldContext(menu.world);
                s.setInspectorOpen(true);
              },
            },
            ...(menu.definitionId ? [{ label: 'Edit sprite', testId: 'menu-edit-sprite', run: () => editSpriteOf(menu.definitionId!) }] : []),
            ...(menu.entityId ? [{ label: 'Code', testId: 'menu-code', run: () => useEditor.getState().openCodeEditor({ definitionId: menu.definitionId, entityId: menu.entityId }) }] : []),
            // The object's own editor panel: described to the AI on the panel itself, beside the object.
            ...(menu.entityId && menu.definitionId ? panelEntries(menu.definitionId) : []),
            ...(menu.entityId
              ? [
                  { label: 'Copy', testId: 'menu-copy', run: () => void runQuickCommand(null, { kind: 'copy' }) },
                  { label: 'Cut', testId: 'menu-cut', run: () => void runQuickCommand(null, { kind: 'cut' }) },
                ]
              : []),
            ...(hasCopiedObjects() ? [{ label: 'Paste here', testId: 'menu-paste', run: () => void pasteObjects(menu.world) }] : []),
            ...(menu.entityId ? [{ label: 'Delete', testId: 'menu-delete', run: deleteSelection }] : []),
          ]}
        />
      )}
    </div>
  );
}

/** Places an instance of a definition in the active scene at a world point and selects it (asking first if it covers something). */
export function placeDefinition(definitionId: Id, world: Vec2): void {
  const state = useEditor.getState();
  const def = state.project.definitions.find((d) => d.id === definitionId);
  if (!def) return;
  const pos = snapPosition(world, brushPreview(def.id), state.project.settings.gridSize, state.layout.snapToGrid);
  const scene = getActiveScene(state);
  const count = scene.entities.filter((e) => e.definitionId === def.id).length;
  const entity = instantiateDefinition(def, pos, count === 0 ? def.name : `${def.name} ${count + 1}`);
  const resolved = resolveEntity(state.project, entity, componentRegistry);
  placeOver(coveredObjects([getWorldBounds(resolved)], new Set(), isUnderlay(resolved.components)), def.name, (overwrite) => {
    const s = useEditor.getState();
    const ok = s.edit(overwrite.length ? `Place ${def.name}, replacing ${overwrite.length}` : `Place ${def.name}`, (p) => {
      if (overwrite.length) removeEntities(p, scene.id, overwrite);
      addEntity(p, scene.id, entity);
    });
    if (ok) s.selectEntities([entity.id]);
  });
}

/**
 * Commits a brush stroke as one undoable step: one copy per visited cell that
 * doesn't already hold this object (paint), or removes the copies in those
 * cells (erase). Cells with other objects in them: "Overwrite or Add?" first.
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
    // The right button erases whatever is there, whatever is being drawn with: in each cell of the stroke, the
    // objects under its middle; a floor (drawn under everything) only once nothing else is left on it.
    const all = resolveSceneEntities(state.project, scene.id);
    const ids = new Set<Id>();
    for (const c of stroke.cells.values()) {
      const p = cellCenter(c, cell);
      const here = all.filter((e) => {
        const b = getWorldBounds(e);
        return p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;
      });
      const onTop = here.filter((e) => !isUnderlay(e.components));
      for (const e of onTop.length ? onTop : here) ids.add(e.id);
    }
    if (ids.size) state.edit(ids.size === 1 ? 'Erase 1 object' : `Erase ${ids.size} objects`, (p) => removeEntities(p, scene.id, [...ids]));
    return;
  }
  const free = [...stroke.cells.entries()].filter(([k]) => !occupied.has(k)).map(([, c]) => c);
  if (!free.length) return;
  let n = scene.entities.filter((e) => e.definitionId === def.id).length;
  const created = free.map((c) => instantiateDefinition(def, cellCenter(c, cell), n++ === 0 ? def.name : `${def.name} ${n}`));
  const boxes = created.map((e) => getWorldBounds(resolveEntity(state.project, e, componentRegistry)));
  // (Copies of this same object were skipped above: drawing over them adds nothing.)
  const covered = coveredObjects(boxes, new Set(), isUnderlay(preview.components)).filter((e) => e.definitionId !== def.id);
  const once = state.tool.kind === 'brush' && state.tool.once;
  placeOver(covered, def.name, (overwrite) => {
    const s = useEditor.getState();
    const label = `${created.length === 1 ? `Draw ${def.name}` : `Draw ${created.length} ${def.name}`}${overwrite.length ? `, replacing ${overwrite.length}` : ''}`;
    const ok = s.edit(label, (p) => {
      if (overwrite.length) removeEntities(p, scene.id, overwrite);
      for (const e of created) addEntity(p, scene.id, e);
    });
    // Picked in the Objects panel (not with the Draw tool): back to selecting, the last one placed selected.
    if (ok && once) {
      s.setTool({ kind: 'select' });
      s.selectEntities([created[created.length - 1].id]);
    }
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

/** The pointer is over the trash can in the bottom bar. */
function overTrash(ev: { clientX: number; clientY: number }): boolean {
  const r = document.querySelector('[data-testid="trash"]')?.getBoundingClientRect();
  return !!r && ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
}

/** Keeps a pointer's events coming to the canvas while it is down (a finger or a drag leaving it); never fails the gesture. */
function capture(canvas: HTMLCanvasElement, pointerId: number): void {
  try {
    canvas.setPointerCapture(pointerId);
  } catch {
    // Not an active pointer any more (lifted already): nothing to keep.
  }
}

/** Topmost entity under a world point. */
function pick(entities: ResolvedEntity[], p: Vec2): ResolvedEntity | null {
  // What is drawn on top is picked first (a floor on a lower layer never hides what stands on it).
  const ordered = byLayer(entities);
  for (let i = ordered.length - 1; i >= 0; i--) if (containsPoint(ordered[i], p)) return ordered[i];
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
  if (touchHarm(e.scripts) || e.tags.includes('enemy') || e.tags.includes('hazard')) return 'danger';
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

/** A player-controlled character (what the camera outline waits for). */

/** The eyedropper's pointer: its tip (bottom left) is the point that picks. */
const EYEDROPPER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><path d="M2 18l1-4 8-8 3 3-8 8z" fill="#fff" stroke="#000" stroke-width="1.3" stroke-linejoin="round"/><path d="M10 5l2-2a2.1 2.1 0 0 1 3 0l2 2a2.1 2.1 0 0 1 0 3l-2 2z" fill="#000"/></svg>',
)}") 2 18, crosshair`;

/** The selection's box (exactly around it) and its handles; corners only for one unturned object. */
function selectionFrame(selected: ResolvedEntity[]): { box: Rect; handles: Handle[] } {
  const box = boxAround(selected.map(getWorldBounds))!;
  const resizable = selected.length === 1 && selected[0].transform.rotation % 360 === 0 && !!(selected[0].components.Sprite || selected[0].components.Collider);
  return { box, handles: handlesFor(box, resizable) };
}

/** A resolved object drawn at a new size (a corner being dragged): its sprite (or collider) size and middle. */
function resizedEntity(e: ResolvedEntity, r: Rect): ResolvedEntity {
  const sx = Math.abs(e.transform.scale.x) || 1;
  const sy = Math.abs(e.transform.scale.y) || 1;
  const w = (r.maxX - r.minX) / sx;
  const h = (r.maxY - r.minY) / sy;
  const components = { ...e.components };
  if (components.Sprite) components.Sprite = { ...components.Sprite, width: w, height: h };
  if (components.Collider && (!components.Sprite || components.Collider.matchSprite !== false)) components.Collider = { ...components.Collider, size: { x: w, y: h } };
  return { ...e, components, transform: { ...e.transform, position: { x: (r.minX + r.maxX) / 2, y: (r.minY + r.maxY) / 2 } } };
}

/**
 * The selection: each object outlined exactly (no gap), and the points to drag: on one object its corners
 * (resize) and sides (repeat in a line); on several, the sides of the box around them all.
 */
function drawSelection(ctx: CanvasRenderingContext2D, selected: ResolvedEntity[], zoom: number, time: number, withHandles: boolean, extended: Rect | null): void {
  if (!selected.length) return;
  const breathe = 0.75 + 0.25 * Math.sin(time / 600);
  ctx.save();
  ctx.shadowColor = theme.selectGlow;
  ctx.shadowBlur = 16 * breathe;
  ctx.strokeStyle = theme.select;
  ctx.lineWidth = 1.5 / zoom;
  for (const e of selected) {
    ctx.save();
    traceShape(ctx, e, 0, false);
    ctx.stroke();
    ctx.restore();
  }
  ctx.shadowBlur = 0;
  const frame = selectionFrame(selected);
  if (selected.length > 1 || extended) {
    // The box the side points belong to (and how far a side drag reaches).
    const b = extended ?? frame.box;
    ctx.setLineDash([5 / zoom, 4 / zoom]);
    ctx.lineWidth = 1 / zoom;
    ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.setLineDash([]);
  }
  if (withHandles && !extended && Math.min(frame.box.maxX - frame.box.minX, frame.box.maxY - frame.box.minY) * zoom >= 12) {
    const s = 7 / zoom;
    ctx.fillStyle = theme.handle;
    ctx.strokeStyle = theme.select;
    ctx.lineWidth = 1.25 / zoom;
    for (const h of frame.handles) {
      ctx.beginPath();
      // Corners square (resize), sides round (repeat in a line).
      if (h.kind === 'corner') ctx.rect(h.at.x - s / 2, h.at.y - s / 2, s, s);
      else ctx.arc(h.at.x, h.at.y, s / 2 + 0.5 / zoom, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** The box a new background picture will fill, with its size in game pixels. */
function drawPictureTarget(ctx: CanvasRenderingContext2D, t: { x: number; y: number; w: number; h: number; pixels: { w: number; h: number } }, zoom: number): void {
  ctx.save();
  ctx.fillStyle = 'rgba(124, 108, 255, 0.10)';
  ctx.fillRect(t.x, t.y, t.w, t.h);
  ctx.strokeStyle = theme.select;
  ctx.lineWidth = 2 / zoom;
  ctx.setLineDash([10 / zoom, 6 / zoom]);
  ctx.strokeRect(t.x, t.y, t.w, t.h);
  ctx.setLineDash([]);
  ctx.font = `600 ${12 / zoom}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = theme.select;
  ctx.fillText(`New picture · ${t.pixels.w} × ${t.pixels.h} pixels`, t.x + 6 / zoom, t.y + 6 / zoom);
  ctx.restore();
}

/** The placed background's box with its handles (corners and sides resize it). */
function drawBackgroundBox(ctx: CanvasRenderingContext2D, box: Rect, zoom: number, handles = true): void {
  ctx.save();
  ctx.strokeStyle = theme.select;
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeRect(box.minX, box.minY, box.maxX - box.minX, box.maxY - box.minY);
  ctx.setLineDash([]);
  const s = 8 / zoom;
  ctx.fillStyle = theme.handle;
  ctx.lineWidth = 1.25 / zoom;
  for (const h of handles ? handlesFor(box, true) : []) {
    ctx.beginPath();
    ctx.rect(h.at.x - s / 2, h.at.y - s / 2, s, s);
    ctx.fill();
    ctx.stroke();
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
  // Out past the selection box's side points (those repeat the switch in a line).
  const pad = 18 / zoom;
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

/** The zoom Play will use for this level: its camera's, or the one the game's resolution makes (as Play works it out). */


/** "Add panel…" (or "Edit panel…" and "Remove panel") for an object's own editor panel (prompt/ObjectPanel.tsx). */
function panelEntries(definitionId: string) {
  const state = useEditor.getState();
  const has = !!panelOf(state.project.definitions.find((d) => d.id === definitionId));
  const remove = () => {
    useEditor.getState().setPanelAsk(null);
    useEditor.getState().edit('Remove panel', (p) => removePanel(p, definitionId));
  };
  return [
    { label: has ? 'Edit panel…' : 'Add panel…', testId: 'menu-panel', run: () => useEditor.getState().setPanelAsk(definitionId) },
    ...(has ? [{ label: 'Remove panel', testId: 'menu-panel-remove', run: remove }] : []),
  ];
}
