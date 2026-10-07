/**
 * Scene renderer shared by the editor viewport and (later) the play-mode
 * runtime, so both draw the game identically.
 */
import { getEntitySize } from '../core/model/geometry';
import type { ResolvedEntity } from '../core/model/resolve';
import { cellRect } from '../core/model/spriteGrid';
import type { SpriteGrid, Vec2, WorldSettings } from '../core/types';

/** A decoded image, plus its cell grid when it is a sprite sheet. */
export interface LoadedImage {
  source: CanvasImageSource;
  grid?: SpriteGrid;
}

/** Resolves an asset id to a drawable image, or null while it isn't loaded (callers fall back to color). */
export type ImageLookup = (assetId: string) => LoadedImage | null;
const noImages: ImageLookup = () => null;

function imageSize(img: CanvasImageSource): { w: number; h: number } {
  const i = img as { naturalWidth?: number; naturalHeight?: number; width: number; height: number };
  return { w: i.naturalWidth || Number(i.width), h: i.naturalHeight || Number(i.height) };
}

export interface Camera {
  /** World point at the center of the view. */
  x: number;
  y: number;
  zoom: number;
}

export interface ViewSize {
  width: number;
  height: number;
}

export function worldToScreen(camera: Camera, view: ViewSize, p: Vec2): Vec2 {
  return { x: (p.x - camera.x) * camera.zoom + view.width / 2, y: (p.y - camera.y) * camera.zoom + view.height / 2 };
}

export function screenToWorld(camera: Camera, view: ViewSize, p: Vec2): Vec2 {
  return { x: (p.x - view.width / 2) / camera.zoom + camera.x, y: (p.y - view.height / 2) / camera.zoom + camera.y };
}

/** Sets the canvas transform so subsequent drawing is in world coordinates. */
export function applyCamera(ctx: CanvasRenderingContext2D, camera: Camera, view: ViewSize, dpr: number): void {
  ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * (view.width / 2 - camera.x * camera.zoom), dpr * (view.height / 2 - camera.y * camera.zoom));
}

/**
 * Background: a color, optionally an image on top.
 * - cover: image fills the view height and repeats sideways.
 * - tile: image repeats in both directions at its own size (scaled with zoom).
 * parallax 0 keeps it fixed on screen; 1 moves it exactly with the level.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  view: ViewSize,
  dpr: number,
  world: WorldSettings,
  camera: Camera,
  images: ImageLookup = noImages,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = world.backgroundColor;
  ctx.fillRect(0, 0, view.width, view.height);
  const { imageAssetId, fit, parallax } = world.background;
  const img = imageAssetId ? images(imageAssetId)?.source : null;
  if (!img) return;
  const { w: iw, h: ih } = imageSize(img);
  if (!iw || !ih) return;
  const scale = fit === 'cover' ? view.height / ih : camera.zoom;
  const tw = iw * scale;
  const th = ih * scale;
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  // Screen position of the world origin, scaled by how much the background follows the level.
  const ox = mod(view.width / 2 - camera.x * camera.zoom * parallax, tw);
  const oy = fit === 'cover' ? 0 : mod(view.height / 2 - camera.y * camera.zoom * parallax, th);
  ctx.imageSmoothingEnabled = scale < 1;
  for (let x = ox - tw; x < view.width; x += tw) {
    if (fit === 'cover') ctx.drawImage(img, x, 0, tw, th);
    else for (let y = oy - th; y < view.height; y += th) ctx.drawImage(img, x, y, tw, th);
  }
}

/** Mixes a hex color toward white (amount > 0) or black (amount < 0). */
export function shade(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const target = amount > 0 ? 255 : 0;
  const a = Math.abs(amount);
  const ch = (v: number) => Math.round(v + (target - v) * a);
  return `rgb(${ch((n >> 16) & 255)}, ${ch((n >> 8) & 255)}, ${ch(n & 255)})`;
}

/**
 * Sets up the entity's own coordinates (its center at 0,0, its sprite size).
 * An unturned thing has its edges rounded to whole screen pixels: at most
 * zoom levels a tile edge falls between pixels, and two half-covered pixels
 * side by side show as a thin seam between tiles that touch. Rounded, tiles
 * that touch share the same pixel edge at every zoom.
 */
function placeOnScreen(ctx: CanvasRenderingContext2D, position: { x: number; y: number }, rotation: number, scale: { x: number; y: number }, size: { x: number; y: number }): void {
  const m = ctx.getTransform();
  if (rotation % 360 !== 0 || m.b !== 0 || m.c !== 0 || size.x <= 0 || size.y <= 0) {
    ctx.translate(position.x, position.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale.x, scale.y);
    return;
  }
  const hw = (size.x * Math.abs(scale.x)) / 2;
  const hh = (size.y * Math.abs(scale.y)) / 2;
  const x0 = Math.round(m.a * (position.x - hw) + m.e);
  const x1 = Math.round(m.a * (position.x + hw) + m.e);
  const y0 = Math.round(m.d * (position.y - hh) + m.f);
  const y1 = Math.round(m.d * (position.y + hh) + m.f);
  // At least one pixel, so tiny things don't vanish when zoomed far out.
  const w = Math.max(1, Math.abs(x1 - x0));
  const h = Math.max(1, Math.abs(y1 - y0));
  ctx.setTransform((w / size.x) * Math.sign(scale.x || 1) * Math.sign(m.a), 0, 0, (h / size.y) * Math.sign(scale.y || 1) * Math.sign(m.d), (x0 + x1) / 2, (y0 + y1) / 2);
}

/** An entity to draw; `alpha` fades it (open doors, blinking after a hit). */
export type RenderEntity = ResolvedEntity & { alpha?: number };

const tileKey = (definitionId: string | null, x: number, y: number) => `${definitionId}|${Math.round(x)}|${Math.round(y)}`;

/**
 * Draws entities in order (later entities on top). Expects world-space transform on ctx.
 * Tile objects of the same kind join into one surface: a lighter top edge only
 * where nothing sits above, a darker base only where nothing sits below.
 */
export function drawEntities(
  ctx: CanvasRenderingContext2D,
  entities: RenderEntity[],
  images: ImageLookup = noImages,
  /** In the editor, things set to invisible are drawn faintly (so they can be found and edited); in play they aren't drawn. */
  invisibleAlpha = 0,
): void {
  const tiles = new Set<string>();
  for (const e of entities) if (e.tile) tiles.add(tileKey(e.definitionId, e.transform.position.x, e.transform.position.y));

  for (const entity of entities) {
    const sprite = entity.components.Sprite;
    const invisible = sprite?.visible === false;
    if (!sprite || (invisible && invisibleAlpha <= 0)) continue;
    const size = getEntitySize(entity);
    const { position, rotation, scale } = entity.transform;
    const color = typeof sprite.color === 'string' ? sprite.color : '#cccccc';
    ctx.save();
    if (entity.alpha !== undefined || invisible) ctx.globalAlpha = (entity.alpha ?? 1) * (invisible ? invisibleAlpha : 1);
    placeOnScreen(ctx, position, rotation, scale, size);
    ctx.fillStyle = color;
    const img = typeof sprite.assetId === 'string' ? images(sprite.assetId) : null;
    if (img) {
      // Pixel art stays crisp. The image (or sheet cell) stretches to the sprite size.
      ctx.imageSmoothingEnabled = false;
      if (img.grid) {
        const r = cellRect(img.grid, typeof sprite.frame === 'number' ? sprite.frame : 1);
        ctx.drawImage(img.source, r.x, r.y, r.w, r.h, -size.x / 2, -size.y / 2, size.x, size.y);
      } else {
        ctx.drawImage(img.source, -size.x / 2, -size.y / 2, size.x, size.y);
      }
    } else if (entity.tile) {
      const w = size.x;
      const h = size.y;
      ctx.fillRect(-w / 2, -h / 2, w, h);
      const above = tiles.has(tileKey(entity.definitionId, position.x, position.y - h * scale.y));
      const below = tiles.has(tileKey(entity.definitionId, position.x, position.y + h * scale.y));
      if (!above) {
        ctx.fillStyle = shade(color, 0.35);
        ctx.fillRect(-w / 2, -h / 2, w, Math.max(2, h * 0.22));
      }
      if (!below) {
        ctx.fillStyle = shade(color, -0.25);
        ctx.fillRect(-w / 2, h / 2 - Math.max(2, h * 0.12), w, Math.max(2, h * 0.12));
      }
    } else if (entity.components.Collider?.shape === 'circle') {
      ctx.beginPath();
      ctx.ellipse(0, 0, size.x / 2, size.y / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(-size.x / 2, -size.y / 2, size.x, size.y);
    }
    ctx.restore();
  }
}
