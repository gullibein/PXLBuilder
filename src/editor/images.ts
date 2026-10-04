/**
 * Decoded images for the project's assets, shared by every canvas draw.
 * Images decode asynchronously; until one is ready the renderer draws the
 * sprite's color, and the next animation frame picks the image up.
 */
import type { Project } from '../core/types';
import type { ImageLookup } from '../render/renderer';

const cache = new Map<string, { data: string; img: HTMLImageElement }>();

/** The decoded image for a data URL (shared with UI thumbnails). */
export function decodedImage(assetId: string, data: string): HTMLImageElement {
  let entry = cache.get(assetId);
  if (!entry || entry.data !== data) {
    const img = new Image();
    img.src = data;
    entry = { data, img };
    cache.set(assetId, entry);
  }
  return entry.img;
}

export function imageLookup(project: Project): ImageLookup {
  return (assetId) => {
    const asset = project.assets.find((a) => a.id === assetId);
    if (!asset || (asset.kind !== 'image' && asset.kind !== 'spritesheet')) return null;
    let entry = cache.get(assetId);
    if (!entry || entry.data !== asset.data) {
      const img = new Image();
      img.src = asset.data;
      entry = { data: asset.data, img };
      cache.set(assetId, entry);
    }
    if (!entry.img.complete || entry.img.naturalWidth === 0) return null;
    return { source: entry.img, grid: asset.kind === 'spritesheet' ? asset.grid : undefined };
  };
}
