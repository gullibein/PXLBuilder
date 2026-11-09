/**
 * Making a background picture with the image generator: asked for by the AI (the generate_background operation, from
 * the background card's prompt or any other) at the size chosen in the background card (Level, Screen or one's own),
 * brought down to the game's pixels and set as the level's background. Its progress is shown in the background card.
 */
import { create } from 'zustand';
import { createImageAsset } from '../core/model/factory';
import { addAsset, setBackground } from '../core/model/mutations';
import { generateImage, imageWorkerUrl, pixelateTo, validWorkerUrl } from './imageWorker';
import { limitsBox, pictureBox, pixelsFor, rememberOriginal, type PictureSize } from './background';
import { useEditor } from './store';

interface GenState {
  /** The picture size chosen in the background card (what the AI's pictures are made at, unless it asks otherwise). */
  sizeMode: PictureSize;
  custom: { w: number; h: number } | null;
  busy: boolean;
  message: string | null;
  error: boolean;
  /** Why the last picture asked for wasn't made (for the AI's next answer), or null. */
  lastError: string | null;
}

export const useBackgroundGen = create<GenState>(() => ({ sizeMode: 'level', custom: null, busy: false, message: null, error: false, lastError: null }));

/** Inside claude.ai (the published app): the page may not contact other sites, so the generator can't be reached. */
function insideClaude(): boolean {
  return typeof (globalThis as { claude?: { use?: unknown } }).claude?.use === 'function';
}

/** Whether the image generator can be asked, and if not, why. */
export function generatorStatus(): { ready: boolean; why?: string } {
  if (insideClaude()) return { ready: false, why: "the app on claude.ai can't contact the image generator (pages there may not reach other sites); it works in PXLBuilder at gullibein.github.io/PXLBuilder" };
  if (!validWorkerUrl(imageWorkerUrl())) return { ready: false, why: 'the image generator has no address (Background panel → settings)' };
  return { ready: true };
}

/** Whether the image generator can be asked. */
export function generatorReady(): boolean {
  return generatorStatus().ready;
}

/** What is sent to the image generator for a background described as `what`. */
export function backgroundPrompt(what: string): string {
  return `${what}, video game background scenery, finely detailed digital painting with small crisp details, flat even lighting, no characters, no text`;
}

/** The picture's size and place in the level, as chosen in the background card (or `size` when given). */
export function generatorTarget(sceneId: string, size?: PictureSize) {
  const { project } = useEditor.getState();
  const scene = project.scenes.find((x) => x.id === sceneId) ?? project.scenes[0];
  const g = useBackgroundGen.getState();
  return pictureBox(project, scene, size ?? g.sizeMode, g.custom ?? pixelsFor(project, limitsBox(project, scene)));
}

/**
 * Makes the picture and sets it as the level's background (one Undo step). `size`: Level, Screen or the card's own
 * size; `parallax`: how it moves with the level (default: a Screen picture stays on the screen, others move with it).
 */
export async function makeBackground(sceneId: string, what: string, size?: PictureSize, parallax?: number | null): Promise<{ ok: boolean; message: string }> {
  const text = what.trim();
  if (!text) return { ok: false, message: 'Nothing to paint was given.' };
  if (useBackgroundGen.getState().busy) return { ok: false, message: 'Another background picture is being made; ask again when it is done.' };
  const status = generatorStatus();
  if (!status.ready) {
    const message = `The background picture wasn't made: ${status.why}.`;
    useBackgroundGen.setState({ message, error: true, lastError: status.why ?? null });
    return { ok: false, message };
  }
  useBackgroundGen.setState({ busy: true, message: `Making the picture: “${text}”… (this can take half a minute)`, error: false });
  try {
    const mode = size ?? useBackgroundGen.getState().sizeMode;
    const box = generatorTarget(sceneId, mode);
    const { w, h } = box.pixels;
    // Not "pixel art": image generators draw that as big fake pixels, many real pixels each, which come out far too
    // coarse once the picture is brought down to the game's pixels. A finely detailed picture, brought down here,
    // becomes pixel art at the game's own resolution (a small star one or two game pixels).
    const blob = await generateImage(backgroundPrompt(text), { width: w, height: h });
    const img = await pixelateTo(blob, w, h);
    const asset = createImageAsset(text.slice(0, 40), img.data, img.width, img.height, 'png');
    rememberOriginal(asset.id, blob);
    const { edit, logMessage } = useEditor.getState();
    // In the box shown in the level, each picture pixel one game pixel. The size of the screen stays on the screen
    // (the usual background); others move with the level.
    edit('Generate background', (p) => {
      addAsset(p, asset);
      setBackground(p, sceneId, { imageAssetId: asset.id, fit: 'placed', parallax: parallax ?? (mode === 'screen' ? 0 : 1), rect: { x: box.x, y: box.y, w: box.w, h: box.h } });
    });
    logMessage('info', `Background made: "${text}" (${img.width}×${img.height}, the game's own pixels).`);
    const message = `Done: ${img.width}×${img.height} pixels. Drag it in the level to move it, its edges to resize it; Undo takes it back.`;
    useBackgroundGen.setState({ busy: false, message, error: false, lastError: null });
    return { ok: true, message: `The background picture is ready (${img.width}×${img.height} pixels).` };
  } catch (e) {
    const why = (e as Error).message;
    useBackgroundGen.setState({ busy: false, message: `The picture couldn't be made: ${why}`, error: true, lastError: why });
    useEditor.getState().logMessage('warn', `Background picture not made: ${why}`);
    return { ok: false, message: `The background picture wasn't made: ${why}` };
  }
}
