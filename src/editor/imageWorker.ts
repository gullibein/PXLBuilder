/**
 * Pictures made by an image generator (a Cloudflare Worker: POST
 * {"prompt": "..."} gives back the image): PXLBuilder's own by default, or
 * one the user sets in the Background card's settings (kept in this
 * browser). The picture is then brought down to the game's own pixels, like
 * everything else in the game.
 */

const KEY = 'pxl.imageWorker';

/** PXLBuilder's own image generator: used unless another one is set. (An address, not a key: it holds no secret.) */
export const DEFAULT_IMAGE_WORKER = 'https://pxlbuilder-image.gundur.workers.dev';

export function imageWorkerUrl(): string {
  try {
    return localStorage.getItem(KEY) || DEFAULT_IMAGE_WORKER;
  } catch {
    return DEFAULT_IMAGE_WORKER;
  }
}

export function setImageWorkerUrl(url: string): void {
  try {
    if (url.trim() && url.trim() !== DEFAULT_IMAGE_WORKER) localStorage.setItem(KEY, url.trim());
    else localStorage.removeItem(KEY);
  } catch {
    // Not kept (private window): asked again next time.
  }
}

/** Whether an address looks usable (https, or http on this computer for testing). */
export function validWorkerUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || (u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname));
  } catch {
    return false;
  }
}

/** Asks the generator for a picture; the error says what went wrong in plain words. */
export async function generateImage(prompt: string, signal?: AbortSignal): Promise<Blob> {
  const url = imageWorkerUrl();
  if (!validWorkerUrl(url)) throw new Error('Set the image generator\'s address first (Settings, under Generate).');
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }), signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error(
      "Could not reach the image generator. Inside claude.ai the page may not be allowed to contact other sites: use PXLBuilder at gullibein.github.io/PXLBuilder for this (the picture is kept in the game, so it shows here too). Otherwise check the address, and that the Worker allows requests from web pages (CORS).",
    );
  }
  if (!res.ok) throw new Error(`The image generator answered with an error (${res.status}). Its free allowance for today may be used up; try again later.`);
  const blob = await res.blob();
  if (!blob.type.startsWith('image/') && blob.size < 100) throw new Error('The image generator did not send a picture back.');
  return blob;
}

/** The picture's height in pixels for this game: its resolution, or the screen's height in its picture pixels. */
export function backgroundPixels(playPixels: number | null | undefined, spriteResolution: number | undefined): number {
  if (playPixels && playPixels > 0) return playPixels;
  return Math.round(720 / (32 / (spriteResolution ?? 32)));
}

/** The colors a picture is brought down to (a palette, like a real pixel-art background). */
const COLORS = 32;

/**
 * Picks up to `n` colors for the pixels: the most common colors after grouping
 * close ones (5 bits per channel), each the average of its group.
 */
export function paletteFor(data: Uint8ClampedArray, n = COLORS): [number, number, number][] {
  const groups = new Map<number, { count: number; r: number; g: number; b: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const k = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    const g = groups.get(k);
    if (g) {
      g.count++;
      g.r += data[i];
      g.g += data[i + 1];
      g.b += data[i + 2];
    } else groups.set(k, { count: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
  }
  const chosen: [number, number, number][] = [];
  const near = (c: [number, number, number], d: [number, number, number]) => (c[0] - d[0]) ** 2 + (c[1] - d[1]) ** 2 + (c[2] - d[2]) ** 2;
  // The most common first, skipping ones almost the same as a color already chosen (so a sky doesn't take all 32).
  for (const g of [...groups.values()].sort((a, b) => b.count - a.count)) {
    const c: [number, number, number] = [Math.round(g.r / g.count), Math.round(g.g / g.count), Math.round(g.b / g.count)];
    if (chosen.some((x) => near(x, c) < 18 * 18)) continue;
    chosen.push(c);
    if (chosen.length >= n) break;
  }
  return chosen.length ? chosen : [[0, 0, 0]];
}

/** Every pixel set to the nearest palette color (in place). */
export function toPalette(data: Uint8ClampedArray, palette: [number, number, number][]): void {
  for (let i = 0; i < data.length; i += 4) {
    let best = 0;
    let bestD = Infinity;
    for (let j = 0; j < palette.length; j++) {
      const p = palette[j];
      const d = (data[i] - p[0]) ** 2 + (data[i + 1] - p[1]) ** 2 + (data[i + 2] - p[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    data[i] = palette[best][0];
    data[i + 1] = palette[best][1];
    data[i + 2] = palette[best][2];
    data[i + 3] = 255;
  }
}

/** The generated picture at the game's pixels: `height` pixels tall (its shape kept), in a small palette, as a PNG. */
export async function pixelate(blob: Blob, height: number): Promise<{ data: string; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const h = Math.max(8, Math.min(height, bitmap.height));
  const w = Math.max(8, Math.round((bitmap.width / bitmap.height) * h));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas here');
  // Averaged down (each new pixel the mix of the ones it covers), then into the palette.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  const img = ctx.getImageData(0, 0, w, h);
  toPalette(img.data, paletteFor(img.data));
  ctx.putImageData(img, 0, 0);
  return { data: canvas.toDataURL('image/png'), width: w, height: h };
}
