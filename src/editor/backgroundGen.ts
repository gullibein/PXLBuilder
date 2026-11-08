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
}

export const useBackgroundGen = create<GenState>(() => ({ sizeMode: 'level', custom: null, busy: false, message: null, error: false }));

/** Whether the image generator can be asked (an address is set). */
export function generatorReady(): boolean {
  return validWorkerUrl(imageWorkerUrl());
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
export async function makeBackground(sceneId: string, what: string, size?: PictureSize, parallax?: number | null): Promise<void> {
  const text = what.trim();
  if (!text || useBackgroundGen.getState().busy) return;
  if (!generatorReady()) {
    useBackgroundGen.setState({ message: 'The image generator has no address: set one in the background card (settings).', error: true });
    return;
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
    useBackgroundGen.setState({ busy: false, message: `Done: ${img.width}×${img.height} pixels. Drag it in the level to move it, its edges to resize it; Undo takes it back.`, error: false });
  } catch (e) {
    useBackgroundGen.setState({ busy: false, message: `The picture couldn't be made: ${(e as Error).message}`, error: true });
    useEditor.getState().logMessage('warn', `Background picture not made: ${(e as Error).message}`);
  }
}
