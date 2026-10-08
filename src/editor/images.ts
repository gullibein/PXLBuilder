/**
 * Decoded images for the project's assets, shared by every canvas draw.
 * Images decode asynchronously; until one is ready the renderer draws the
 * sprite's color, and the next animation frame picks the image up.
 *
 * SVG images (pixel art: the starter art and the AI's drawings, one rectangle
 * per run of pixels) are turned into a bitmap once, at their own pixel size,
 * and that bitmap is what gets drawn. Drawn as SVG, the browser redraws the
 * vector at every on-screen size, and at most sizes the edges between pixel
 * rows fall between screen pixels and show as thin lines across the sprite
 * (like scanlines); it also redraws the vector every frame. A bitmap scaled
 * with smoothing off has neither problem.
 */
import type { Project } from '../core/types';
import type { ImageLookup } from '../render/renderer';

interface Entry {
  data: string;
  img: HTMLImageElement;
  /** The pixel-exact bitmap of an SVG, made once it has loaded. */
  bitmap: HTMLCanvasElement | null;
}

const cache = new Map<string, Entry>();

function entryFor(assetId: string, data: string): Entry {
  let entry = cache.get(assetId);
  if (!entry || entry.data !== data) {
    const img = new Image();
    img.src = data;
    entry = { data, img, bitmap: null };
    cache.set(assetId, entry);
  }
  return entry;
}

/** What to draw for a loaded entry: the image, or for SVG its bitmap. */
function sourceOf(entry: Entry): CanvasImageSource {
  if (!entry.data.startsWith('data:image/svg')) return entry.img;
  if (!entry.bitmap) {
    const c = document.createElement('canvas');
    c.width = entry.img.naturalWidth;
    c.height = entry.img.naturalHeight;
    c.getContext('2d')?.drawImage(entry.img, 0, 0, c.width, c.height);
    entry.bitmap = c;
  }
  return entry.bitmap;
}

const loaded = (img: HTMLImageElement) => img.complete && img.naturalWidth > 0;

/**
 * The drawable image for a data URL (shared with UI thumbnails), and its
 * size; `onReady` is called once it can be drawn (at once if it already can).
 * Returns a function that stops waiting.
 */
export function whenImageReady(assetId: string, data: string, onReady: (source: CanvasImageSource, width: number, height: number) => void): () => void {
  const entry = entryFor(assetId, data);
  const ready = () => onReady(sourceOf(entry), entry.img.naturalWidth, entry.img.naturalHeight);
  if (loaded(entry.img)) {
    ready();
    return () => {};
  }
  entry.img.addEventListener('load', ready, { once: true });
  return () => entry.img.removeEventListener('load', ready);
}

export function imageLookup(project: Project): ImageLookup {
  return (assetId) => {
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset || (asset.kind !== 'image' && asset.kind !== 'spritesheet')) return null;
    const entry = entryFor(assetId, asset.data);
    if (!loaded(entry.img)) return null;
    const sheet = asset.kind === 'spritesheet';
    return { source: sourceOf(entry), grid: sheet ? asset.grid : undefined, animation: sheet && asset.animation?.frames.length ? asset.animation : undefined };
  };
}
