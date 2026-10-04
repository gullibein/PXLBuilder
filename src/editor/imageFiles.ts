/** Reading user image files in the browser. */
import type { PixelData } from '../core/model/spriteGrid';

export interface ReadImage {
  data: string;
  width: number;
  height: number;
  ext: string;
  pixels: () => PixelData;
}

/**
 * Reads an image file. With `maxSide`, larger images are scaled down (fine for
 * backgrounds; never used for sprite sheets, whose cells must stay exact).
 */
export async function readImageFile(file: File, opts: { maxSide?: number } = {}): Promise<ReadImage> {
  if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`);
  let data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  let img = new Image();
  img.src = data;
  await img.decode();
  let ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
  const big = Math.max(img.naturalWidth, img.naturalHeight);
  if (opts.maxSide && big > opts.maxSide && ext !== 'svg') {
    const k = opts.maxSide / big;
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    ext = ext === 'jpg' ? 'jpg' : 'png';
    data = c.toDataURL(ext === 'jpg' ? 'image/jpeg' : 'image/png', 0.9);
    img = new Image();
    img.src = data;
    await img.decode();
  }
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  return {
    data,
    width,
    height,
    ext,
    pixels: () => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      return g.getImageData(0, 0, width, height);
    },
  };
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
