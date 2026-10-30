/**
 * Pictures the user attaches to a prompt (pasted, dropped or picked): an example of the game they want, a sprite
 * sheet. Each is read in the browser (any kind it can show, AVIF and WebP too) and made ready to send: at most about
 * 1.15 megapixels and 1568 px a side (what the AI reads best; bigger costs more and shows it nothing more). Small
 * pixel art is enlarged by a whole number with sharp pixels, so the AI sees each art pixel; PNG keeps them exact
 * (JPEG only for a picture too heavy as PNG).
 */
import { MAX_PICTURES, type AIPicture } from '../../core/ai/protocol';

const MAX_EDGE = 1568;
const MAX_AREA = 1_150_000;
/** Heavier than this as PNG: sent as JPEG instead. */
const MAX_PNG_BYTES = 3_500_000;

export { MAX_PICTURES };

/** The size a picture is sent at: enlarged by a whole number when small (sharp pixels), scaled down when big. */
export function sendSize(w: number, h: number): { width: number; height: number; sharp: boolean } {
  const fit = Math.min(MAX_EDGE / Math.max(w, h), Math.sqrt(MAX_AREA / (w * h)));
  if (fit >= 2) {
    const k = Math.floor(fit);
    return { width: w * k, height: h * k, sharp: true };
  }
  if (fit >= 1) return { width: w, height: h, sharp: true };
  return { width: Math.max(1, Math.floor(w * fit)), height: Math.max(1, Math.floor(h * fit)), sharp: false };
}

/** A picture ready to send, and a small URL to show it with until it is sent. */
export interface AttachedPicture {
  picture: AIPicture;
  thumb: string;
}

async function decode(file: Blob): Promise<CanvasImageSource & { width: number; height: number }> {
  try {
    return await createImageBitmap(file);
  } catch {
    // (Some kinds only an <img> can read.)
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read the picture'))), type, quality));
}

function base64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Reads one file (or pasted image) as a picture to send; rejects with a plain message when it isn't one. */
export async function readPicture(file: Blob, name = (file as File).name || 'pasted picture'): Promise<AttachedPicture> {
  if (file.type && !file.type.startsWith('image/')) throw new Error(`"${name}" isn't a picture.`);
  let source: Awaited<ReturnType<typeof decode>>;
  try {
    source = await decode(file);
  } catch {
    throw new Error(`"${name}" couldn't be read as a picture.`);
  }
  const size = sendSize(source.width, source.height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = !size.sharp;
  g.imageSmoothingQuality = 'high';
  g.drawImage(source, 0, 0, size.width, size.height);
  let blob = await toBlob(canvas, 'image/png');
  let mediaType: AIPicture['mediaType'] = 'image/png';
  if (blob.size > MAX_PNG_BYTES) {
    blob = await toBlob(canvas, 'image/jpeg', 0.92);
    mediaType = 'image/jpeg';
  }
  // A small copy to show on the card.
  const t = document.createElement('canvas');
  const k = Math.min(1, 96 / Math.max(source.width, source.height));
  t.width = Math.max(1, Math.round(source.width * k));
  t.height = Math.max(1, Math.round(source.height * k));
  const tg = t.getContext('2d')!;
  tg.imageSmoothingEnabled = k < 1;
  tg.drawImage(source, 0, 0, t.width, t.height);
  return {
    picture: { name, mediaType, data: await base64(blob), width: size.width, height: size.height, sourceWidth: source.width, sourceHeight: source.height },
    thumb: t.toDataURL('image/png'),
  };
}

/** The image files among pasted or dropped things. */
export function imageFiles(list: DataTransfer | null): File[] {
  if (!list) return [];
  const files = [...list.files];
  // (A copied image in some browsers is only an item, not a file.)
  if (!files.length) for (const item of [...list.items]) if (item.kind === 'file') files.push(...(item.getAsFile() ? [item.getAsFile()!] : []));
  return files.filter((f) => !f.type || f.type.startsWith('image/'));
}
