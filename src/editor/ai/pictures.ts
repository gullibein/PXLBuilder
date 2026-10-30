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

/** Characters for a grid's colors ("." is see-through). */
const GRID_KEYS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * A picture as text, for an AI that can't be sent pictures (claude.ai inside the Claude app): a grid of characters,
 * one per cell, with its colors as hex. Pixel art is read at its own art-pixel size (each cell exactly one art
 * pixel, found from the picture), so a sprite sheet comes through exactly; a bigger picture is reduced to at most
 * `maxCells` cells a side, each cell the color most of its pixels have.
 */
export async function pictureGrid(p: AIPicture, index: number, maxCells = 128): Promise<string> {
  const bytes = Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: p.mediaType }));
  // Back to the user's own pixels (it was sent enlarged by a whole number, or scaled down).
  const k = p.width / p.sourceWidth;
  const ow = k >= 2 && Number.isInteger(k) ? p.sourceWidth : p.width;
  const oh = k >= 2 && Number.isInteger(k) ? p.sourceHeight : p.height;
  const c = document.createElement('canvas');
  c.width = ow;
  c.height = oh;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false;
  g.drawImage(bitmap, 0, 0, ow, oh);
  const px = g.getImageData(0, 0, ow, oh).data;
  const at = (x: number, y: number) => {
    const i = (y * ow + x) * 4;
    return px[i + 3] < 128 ? -1 : (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
  };
  // The art pixel: the largest block size (2-8) whose blocks are each one color, for some placement of the grid
  // (compression noise allowed: colors within a small distance count as the same, and a few blocks may differ).
  const near = (a: number, b: number) => {
    if (a === b) return true;
    if (a < 0 || b < 0) return false;
    return Math.abs(((a >> 16) & 255) - ((b >> 16) & 255)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255)) <= 48;
  };
  const uniform = (size: number, ox: number, oy: number) => {
    let same = 0;
    let all = 0;
    for (let y = oy; y + size <= oh; y += size)
      for (let x = ox; x + size <= ow; x += size) {
        const c0 = at(x + (size >> 1), y + (size >> 1));
        all++;
        if (near(at(x, y), c0) && near(at(x + size - 1, y), c0) && near(at(x, y + size - 1), c0) && near(at(x + size - 1, y + size - 1), c0)) same++;
      }
    return all ? same / all : 0;
  };
  let art = 1;
  for (let size = 8; size >= 2 && art === 1; size--)
    for (let oy = 0; oy < size && art === 1; oy++) for (let ox = 0; ox < size && art === 1; ox++) if (uniform(size, ox, oy) >= 0.93) art = size;
  const cell = art * Math.max(1, Math.ceil(Math.max(ow, oh) / art / maxCells));
  const w = Math.ceil(ow / cell);
  const h = Math.ceil(oh / cell);
  // Each cell: the color most of its pixels have (close shades counted as one).
  const shade = (v: number) => (v < 0 ? -1 : v & 0xf0f0f0);
  const cells: number[] = [];
  const count = new Map<number, number>();
  for (let cy = 0; cy < h; cy++)
    for (let cx = 0; cx < w; cx++) {
      const votes = new Map<number, { n: number; v: number }>();
      const s = Math.max(1, Math.floor(cell / 4));
      for (let y = cy * cell + (s >> 1); y < Math.min(oh, (cy + 1) * cell); y += s)
        for (let x = cx * cell + (s >> 1); x < Math.min(ow, (cx + 1) * cell); x += s) {
          const v = at(x, y);
          const k = shade(v);
          const e = votes.get(k);
          if (e) e.n++;
          else votes.set(k, { n: 1, v });
        }
      const best = [...votes.values()].sort((a, b) => b.n - a.n)[0]?.v ?? -1;
      cells.push(best);
      if (best >= 0) count.set(best, (count.get(best) ?? 0) + 1);
    }
  // The palette: the most used colors, skipping ones too close to a color already in it; the rest take the nearest.
  const palette: number[] = [];
  for (const [v] of [...count.entries()].sort((a, b) => b[1] - a[1])) {
    if (palette.length >= GRID_KEYS.length) break;
    if (!palette.some((q) => near(q, v))) palette.push(v);
  }
  const rgb = (v: number) => [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  const nearest = new Map<number, number>();
  const keyOf = (v: number): string => {
    if (v < 0) return '.';
    let i = nearest.get(v);
    if (i === undefined) {
      const [r, gg, b] = rgb(v);
      let bestD = Infinity;
      i = 0;
      palette.forEach((q, j) => {
        const [r2, g2, b2] = rgb(q);
        const d = (r - r2) ** 2 + (gg - g2) ** 2 + (b - b2) ** 2;
        if (d < bestD) {
          bestD = d;
          i = j;
        }
      });
      nearest.set(v, i);
    }
    return GRID_KEYS[i];
  };
  const rows: string[] = [];
  for (let y = 0; y < h; y++) rows.push(cells.slice(y * w, (y + 1) * w).map(keyOf).join(''));
  const hex = (v: number) => `#${v.toString(16).padStart(6, '0')}`;
  return [
    `Picture ${index + 1} ("${p.name.replace(/"/g, "'")}") as text: ${w}×${h} cells, each cell ${cell}×${cell} pixels of the ${ow}×${oh} picture${art > 1 ? ` (its art pixels are ${art}×${art}, so ${cell === art ? 'every cell is exactly one art pixel' : `every cell is ${cell / art}×${cell / art} art pixels`})` : ''}.`,
    `Colors: ${palette.map((v, i) => `${GRID_KEYS[i]}=${hex(v)}`).join(' ')}${cells.includes(-1) ? ' .=see-through' : ''}`,
    ...rows,
  ].join('\n');
}
