/**
 * A picture placed in the level as its background (made by the image
 * generator): its default box (the camera limits box), and redrawing it at a
 * new size from the original picture, so each picture pixel is always one
 * game pixel, however big it is made.
 */
import { resolutionZoom } from '../core/model/camera';
import { replaceImageData, setBackground } from '../core/model/mutations';
import { viewportSize } from './actions';
import type { Id, Project, Scene } from '../core/types';
import { pixelateTo } from './imageWorker';
import { cameraFrame } from './overlays/cameraFrame';
import { resolveSceneEntities } from './selectors';
import { useEditor } from './store';

/** Level pixels per game pixel (picture pixels are drawn for 32-pixel tiles at the game's sprite size). */
export const levelPerPixel = (project: Project) => 32 / (project.settings.spriteResolution ?? 32);

/** The zoom Play shows the level at on a screen this size (the game's resolution, or the camera's zoom). */
export function playZoom(project: Project, scene: Scene, view: { width: number; height: number }): number {
  const pixels = project.settings.playPixels;
  if (!pixels) return scene.camera.zoom;
  return resolutionZoom(scene.camera.zoom, view.height, window.devicePixelRatio || 1, pixels, levelPerPixel(project)).zoom;
}

/** What the camera shows when the level starts (its white outline in the editor), in level pixels. */
export function screenBox(project: Project, scene: Scene): { x: number; y: number; w: number; h: number } {
  const view = viewportSize();
  const f = cameraFrame(scene, resolveSceneEntities(project, scene.id), view, playZoom(project, scene, view)).frame;
  return { x: f.minX, y: f.minY, w: f.maxX - f.minX, h: f.maxY - f.minY };
}

export type PictureSize = 'level' | 'screen' | 'custom';

/**
 * Where a new background picture goes and how big it is: the camera limits box (level), what the camera shows
 * (screen), or a size of the user's (custom: centered on what the camera shows). On whole game pixels.
 */
export function pictureBox(project: Project, scene: Scene, size: PictureSize, custom: { w: number; h: number }): { x: number; y: number; w: number; h: number; pixels: { w: number; h: number } } {
  const k = levelPerPixel(project);
  const screen = screenBox(project, scene);
  const box = size === 'level' ? limitsBox(project, scene) : size === 'screen' ? screen : { x: screen.x + screen.w / 2 - (custom.w * k) / 2, y: screen.y + screen.h / 2 - (custom.h * k) / 2, w: custom.w * k, h: custom.h * k };
  if (size === 'custom') {
    const pixels = { w: clampPixels(custom.w), h: clampPixels(custom.h) };
    return { x: Math.round(box.x / k) * k, y: Math.round(box.y / k) * k, w: pixels.w * k, h: pixels.h * k, pixels };
  }
  // Covering the whole box on whole game pixels (its edges rounded outward, so no strip of it is left uncovered).
  const x = Math.floor(box.x / k) * k;
  const y = Math.floor(box.y / k) * k;
  const pixels = { w: clampPixels(Math.ceil((box.x + box.w) / k) - x / k), h: clampPixels(Math.ceil((box.y + box.h) / k) - y / k) };
  return { x, y, w: pixels.w * k, h: pixels.h * k, pixels };
}

/** The camera limits box (or, without limits, the level, or what the camera shows at the start), in level pixels. */
export function limitsBox(project: Project, scene: Scene): { x: number; y: number; w: number; h: number } {
  const f = cameraFrame(scene, resolveSceneEntities(project, scene.id), { width: 960, height: 540 });
  const b = f.limits ?? f.frame;
  return { x: b.minX, y: b.minY, w: Math.max(32, b.maxX - b.minX), h: Math.max(32, b.maxY - b.minY) };
}

const MAX_SIDE = 2048;
const clampPixels = (n: number) => Math.max(8, Math.min(MAX_SIDE, Math.round(n)));

/** The picture's size in game pixels for that box. */
export function pixelsFor(project: Project, box: { w: number; h: number }): { w: number; h: number } {
  const k = levelPerPixel(project);
  return { w: clampPixels(box.w / k), h: clampPixels(box.h / k) };
}

/** The originals of generated pictures (this visit only): resizing redraws from them, not from the smaller copy. */
const originals = new Map<Id, Blob | string>();
export function rememberOriginal(assetId: Id, source: Blob): void {
  originals.set(assetId, source);
}

/**
 * The background moved or resized to `rect` (level pixels): snapped to whole game pixels, and, at a new size,
 * redrawn from the original at that many pixels. One Undo step with the drag (`coalesceKey`).
 */
export async function placeBackground(sceneId: Id, rect: { x: number; y: number; w: number; h: number }, coalesceKey: string): Promise<void> {
  const { project, edit } = useEditor.getState();
  const scene = project.scenes.find((s) => s.id === sceneId);
  const assetId = scene?.world.background.imageAssetId;
  const asset = project.assets.find((a) => a.id === assetId);
  if (!scene || !asset || asset.kind !== 'image') return;
  const k = levelPerPixel(project);
  const px = pixelsFor(project, rect);
  const snapped = { x: Math.round(rect.x / k) * k, y: Math.round(rect.y / k) * k, w: px.w * k, h: px.h * k };
  const resized = px.w !== asset.width || px.h !== asset.height;
  const redrawn = resized ? await pixelateTo(originals.get(asset.id) ?? asset.data, px.w, px.h) : null;
  edit(
    resized ? 'Resize background' : 'Move background',
    (p) => {
      if (redrawn) replaceImageData(p, asset.id, redrawn.data, redrawn.width, redrawn.height);
      setBackground(p, sceneId, { rect: snapped, fit: 'placed' });
    },
    { coalesceKey },
  );
}
