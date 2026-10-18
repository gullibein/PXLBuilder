/**
 * The game's picture for PXLGameSite: its first level as Play shows it when
 * it starts, at the game's own resolution (one image pixel per game pixel),
 * drawn with the same code as Play.
 */
import { componentRegistry } from '../../core/components/builtin';
import { resolutionZoom } from '../../core/model/camera';
import type { Project } from '../../core/types';
import { InputState } from '../../runtime/input';
import { Runtime } from '../../runtime/runtime';
import { LookCache } from '../../render/screen';
import { imageLookup, whenImageReady } from '../images';
import { drawPlayFrame } from '../play/playFrame';

/** The screen the picture is taken on (CSS px): a common 16:9 game window. */
const SCREEN = { width: 480, height: 270 };

/** Waits until the game's pictures can be drawn (or a few seconds have passed). */
async function picturesReady(project: Project): Promise<void> {
  const waits = project.assets
    .filter((a) => a.kind === 'image' || a.kind === 'spritesheet')
    .map((a) => new Promise<void>((resolve) => whenImageReady(a.id, a.data, () => resolve())));
  await Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 4000))]);
}

/** A PNG data URL of the game's start, or null where there is no canvas. */
export async function gameShot(project: Project): Promise<string | null> {
  if (typeof document === 'undefined' || !project.scenes.length) return null;
  await picturesReady(project);
  const scene = project.scenes[0];
  const runtime = new Runtime(project, scene.id, componentRegistry);
  const worldPerArt = 32 / (project.settings.spriteResolution ?? 32);
  const gamePixels = project.settings.playPixels ?? 0;
  let shrink = 1;
  let extraZoom = 1;
  if (gamePixels > 0) {
    const r = resolutionZoom(runtime.camera.zoom, SCREEN.height, 1, gamePixels, worldPerArt);
    shrink = r.shrink;
    extraZoom = r.zoom / runtime.camera.zoom;
  } else {
    // At the pictures' own pixels (one image pixel per picture pixel), so the picture is small and sharp.
    shrink = Math.max(1, Math.round(runtime.camera.zoom * worldPerArt));
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(SCREEN.width / shrink));
  canvas.height = Math.max(1, Math.round(SCREEN.height / shrink));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  runtime.cam.setView(SCREEN.width / extraZoom, SCREEN.height / extraZoom);
  runtime.screen = { w: SCREEN.width, h: SCREEN.height };
  runtime.cam.snap();
  // A moment of play, so what the scripts draw when it starts (scores, hearts) is there too.
  const input = new InputState();
  for (let i = 0; i < 3; i++) runtime.update(1 / 60, input);
  runtime.cam.snap();
  const looks = new LookCache(project, componentRegistry);
  const heartDef = project.definitions.find((d) => d.metadata.starter === 'Heart') ?? project.definitions.find((d) => d.name.toLowerCase() === 'heart');
  drawPlayFrame(ctx, runtime, { project, scene, size: SCREEN, extraZoom, worldPerArt, images: imageLookup(project), looks, heartLook: heartDef ? looks.get(heartDef.id) : null }, null);
  return canvas.toDataURL('image/png');
}
