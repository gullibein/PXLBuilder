import { useEffect, useRef } from 'react';
import { cellRect } from '../core/model/spriteGrid';
import type { AssetRecord } from '../core/types';
import { decodedImage } from './images';

/** Draws an image asset, or one numbered cell of a sprite sheet, fitted into a square of `size` px, pixel-crisp. */
export function SpriteImage({ asset, frame = 1, size }: { asset: AssetRecord; frame?: number; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const grid = asset.kind === 'spritesheet' ? asset.grid : undefined;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const img = decodedImage(asset.id, asset.data);
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      const g = canvas.getContext('2d')!;
      g.imageSmoothingEnabled = false;
      const r = grid ? cellRect(grid, frame) : { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
      if (!r.w || !r.h) return;
      const k = (size * dpr) / Math.max(r.w, r.h);
      const w = r.w * k;
      const h = r.h * k;
      g.drawImage(img, r.x, r.y, r.w, r.h, (size * dpr - w) / 2, (size * dpr - h) / 2, w, h);
    };
    if (img.complete && img.naturalWidth) draw();
    else img.addEventListener('load', draw, { once: true });
    return () => img.removeEventListener('load', draw);
  }, [asset.id, asset.data, grid, frame, size]);
  return <canvas ref={ref} style={{ width: size, height: size, display: 'block' }} aria-hidden="true" />;
}
