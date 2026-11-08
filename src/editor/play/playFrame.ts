/**
 * One frame of the game as Play draws it: the background, the level through
 * the camera on whole pixels, what scripts drew, and the built-in display,
 * all on the game's pixel grid. Shared by Play and by the game's picture
 * for PXLGameSite (taken the same way, so it looks exactly like the game).
 */
import { pixelFontFor } from '../../render/pixelFont';
import { drawFog } from '../../runtime/fog';
import type { Project, Scene } from '../../core/types';
import { drawBuiltinHud, type BuiltinHud } from '../../render/hud';
import { applyCamera, drawBackground, drawEntities, isoProject, isoUnproject, pixelPerfectZoom, type ImageLookup } from '../../render/renderer';
import type { ResolvedEntity } from '../../core/model/resolve';
import { drawScreenDrawings, type LookCache, type PixelGrid } from '../../render/screen';
import type { Runtime } from '../../runtime/runtime';

export interface FrameSetup {
  project: Project;
  scene: Scene;
  /** The screen area in CSS px. */
  size: { width: number; height: number };
  /** The game's zoom over the camera's own (from its resolution). */
  extraZoom: number;
  worldPerArt: number;
  images: ImageLookup;
  looks: LookCache;
  heartLook: ResolvedEntity | null;
  /** Where the camera was when the level started (a placed background is exactly where it was put then). */
  startCamera?: { x: number; y: number } | null;
}

/** The built-in display as the game shows it now. */
export function hudOf(runtime: Runtime, banner: string | null): BuiltinHud {
  const p = runtime.entities.find((e) => e.controller);
  return {
    health: p?.health && !runtime.builtinHidden.has('hearts') ? { current: p.health.current, max: p.health.max } : null,
    items: p?.inventory && !runtime.builtinHidden.has('items') ? [...p.inventory.entries()] : [],
    message: runtime.messages.at(-1) ?? null,
    banner,
  };
}

/** Draws the frame; returns the pixel grid it used. */
export function drawPlayFrame(ctx: CanvasRenderingContext2D, runtime: Runtime, f: FrameSetup, banner: string | null): PixelGrid {
  const { size, worldPerArt, images, looks } = f;
  const canvas = ctx.canvas;
  const dpr = canvas.width / size.width;
  // Every picture pixel the same size: the zoom is rounded to the nearest that gives whole canvas pixels.
  const frameNow = runtime.cam.frame();
  // (Fitted to the screen's height or width: exactly, as asked, even if a picture pixel is then not a whole number of canvas pixels.)
  const fitted = f.scene.camera?.fit === 'height' || f.scene.camera?.fit === 'width';
  const zoomNow = fitted ? frameNow.zoom * f.extraZoom : pixelPerfectZoom(frameNow.zoom * f.extraZoom, dpr, worldPerArt);
  // The camera moves in whole canvas pixels (as on a real low-resolution screen), never between them.
  const snapAxis = (c: number, half: number) => (half - Math.round(dpr * (half - c * zoomNow)) / dpr) / zoomNow;
  let view = { ...frameNow, zoom: zoomNow, x: snapAxis(frameNow.x, size.width / 2), y: snapAxis(frameNow.y, size.height / 2) };
  if (frameNow.iso) {
    // (Seen at an angle: snapped where it is on the screen.)
    const c = isoProject(frameNow);
    view = { ...frameNow, zoom: zoomNow, ...isoUnproject({ x: snapAxis(c.x, size.width / 2), y: snapAxis(c.y, size.height / 2) }) };
  }
  drawBackground(ctx, size, dpr, f.scene.world, view, images, { startCamera: f.startCamera ?? null, time: runtime.completed ?? runtime.time });
  applyCamera(ctx, view, size, dpr);
  // Everything drawn over the game keeps to its pixel grid: each pixel the size of a picture pixel in the level.
  const perArt = zoomNow * dpr * worldPerArt;
  // (Text in the pixel font that fits the game's sprite size: tiny for 8×8 sprites, bigger and finer for finer ones.)
  const grid: PixelGrid = { cell: perArt >= 1 ? Math.round(perArt) : 1, lowRes: (f.project.settings.playPixels ?? 0) > 0, font: pixelFontFor(f.project.settings.spriteResolution) };
  // What scripts drew: on the ground under everything (highlighted squares), labels in the level, then the screen
  // layer (HUDs, scores, menus) on top, then the built-in display.
  const drawings = [...runtime.drawings.values()];
  if (drawings.some((d) => d.under)) {
    drawScreenDrawings(ctx, drawings, 'under', size, looks, images, runtime.time, grid);
    applyCamera(ctx, view, size, dpr);
  }
  // (Animations hold still too once the level is won.)
  drawEntities(ctx, runtime.renderList(), images, 0, runtime.completed ?? runtime.time, worldPerArt);
  drawScreenDrawings(ctx, drawings, 'world', size, looks, images, runtime.time, grid);
  // Fog of war over the level (under the screen's own drawings: the HUD stays readable).
  if (runtime.fog) drawFog(ctx, runtime.fog);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawScreenDrawings(ctx, drawings, 'screen', size, looks, images, runtime.time, grid);
  drawBuiltinHud(ctx, hudOf(runtime, banner), { width: canvas.width, height: canvas.height, grid, levelScale: zoomNow * dpr, cssPx: dpr }, f.heartLook, images, runtime.time);
  return grid;
}
