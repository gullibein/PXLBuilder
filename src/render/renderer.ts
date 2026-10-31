/**
 * Scene renderer shared by the editor viewport and (later) the play-mode
 * runtime, so both draw the game identically.
 */
import { getEntitySize } from '../core/model/geometry';
import type { ResolvedEntity } from '../core/model/resolve';
import { animationFrame, cellRect } from '../core/model/spriteGrid';
import { autotileIndex } from '../core/model/autotile';
import type { SpriteAnimation, SpriteGrid, Vec2, WorldSettings } from '../core/types';

/** A decoded image, plus its cell grid when it is a sprite sheet. */
export interface LoadedImage {
  source: CanvasImageSource;
  grid?: SpriteGrid;
  /** Plays these cells over time (then Sprite.frame is ignored). */
  animation?: SpriteAnimation;
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
/**
 * The zoom closest to `zoom` at which every pixel of the game's pictures
 * covers a whole number of canvas pixels (or a whole fraction of one), so
 * pixel art is drawn with all its pixels the same size instead of some
 * wider than others. `canvasPerCss`: canvas pixels per CSS pixel;
 * `worldPerArt`: level pixels per picture pixel (1 for 32×32 pictures on
 * 32-pixel tiles).
 */
export function pixelPerfectZoom(zoom: number, canvasPerCss: number, worldPerArt: number): number {
  const perArt = zoom * canvasPerCss * worldPerArt;
  if (!(perArt > 0) || !Number.isFinite(perArt)) return zoom;
  const even = perArt >= 1 ? Math.round(perArt) : 1 / Math.round(1 / perArt);
  return even / (canvasPerCss * worldPerArt);
}

export function applyCamera(ctx: CanvasRenderingContext2D, camera: Camera, view: ViewSize, dpr: number): void {
  ctx.setTransform(dpr * camera.zoom, 0, 0, dpr * camera.zoom, dpr * (view.width / 2 - camera.x * camera.zoom), dpr * (view.height / 2 - camera.y * camera.zoom));
}

/**
 * Background: a color, optionally an image on top.
 * - cover: image fills the view height and repeats sideways.
 * - tile: image repeats in both directions at its own size (scaled with zoom).
 * parallax 0 keeps it fixed on screen; 1 moves it exactly with the level (parallaxY: up and down, when it differs).
 */
export interface BackgroundView {
  /**
   * The editor: a placed picture shows where it is in the level (to move and resize it), and a picture that fills
   * the screen or repeats is shown inside `screen` (what the camera shows at the start), as Play shows it then.
   */
  editing?: boolean;
  /** Where the camera is when the level starts: a placed picture is exactly where it was put then. */
  startCamera?: Vec2 | null;
  /** editing: what the camera shows at the start, in the level. */
  screen?: { minX: number; minY: number; maxX: number; maxY: number } | null;
  /** Seconds of play: how far a scrolling picture and the stars have moved (0, or left out, in the editor). */
  time?: number;
}

export function drawBackground(ctx: CanvasRenderingContext2D, view: ViewSize, dpr: number, world: WorldSettings, camera: Camera, images: ImageLookup = noImages, opts: BackgroundView = {}): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = world.backgroundColor;
  ctx.fillRect(0, 0, view.width, view.height);
  const time = opts.time ?? 0;
  if (world.background.stars) {
    // (In the editor, inside what the camera shows at the start.)
    const sc = opts.editing ? opts.screen : null;
    if (!opts.editing) drawStars(ctx, world.background.stars, view, camera.zoom, time);
    else if (sc) {
      const x0 = (sc.minX - camera.x) * camera.zoom + view.width / 2;
      const y0 = (sc.minY - camera.y) * camera.zoom + view.height / 2;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, (sc.maxX - sc.minX) * camera.zoom, (sc.maxY - sc.minY) * camera.zoom);
      ctx.clip();
      ctx.translate(x0, y0);
      drawStars(ctx, world.background.stars, { width: (sc.maxX - sc.minX) * camera.zoom, height: (sc.maxY - sc.minY) * camera.zoom }, camera.zoom, 0);
      ctx.restore();
    }
  }
  const scrolled = world.background.scroll ? { x: world.background.scroll.x * time, y: world.background.scroll.y * time } : { x: 0, y: 0 };
  const { imageAssetId, fit, parallax } = world.background;
  // Up and down can follow the level differently from left and right.
  const parallaxY = world.background.parallaxY ?? parallax;
  const img = imageAssetId ? images(imageAssetId)?.source : null;
  if (!img) return;
  if (fit === 'placed') {
    const r = world.background.rect;
    if (!r) return;
    // Exactly where it was put when the level starts; as the camera moves on, it follows the level fully (1), not
    // at all (0: it stays on the screen), or in between (farther away).
    const px = opts.editing ? 1 : parallax;
    const py = opts.editing ? 1 : parallaxY;
    const start = opts.startCamera ?? { x: camera.x, y: camera.y };
    const ex = start.x + (camera.x - start.x) * px;
    const ey = start.y + (camera.y - start.y) * py;
    const sx = (r.x - ex) * camera.zoom + view.width / 2;
    const sy = (r.y - ey) * camera.zoom + view.height / 2;
    // On whole canvas pixels, each picture pixel the same size.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, Math.round(sx * dpr), Math.round(sy * dpr), Math.round(r.w * camera.zoom * dpr), Math.round(r.h * camera.zoom * dpr));
    return;
  }
  if (opts.editing) {
    // In the editor only inside what the camera shows at the start (filling the whole workspace would show nothing
    // about how it looks in play), drawn as Play shows it then.
    const sc = opts.screen;
    if (!sc) return;
    const x0 = (sc.minX - camera.x) * camera.zoom + view.width / 2;
    const y0 = (sc.minY - camera.y) * camera.zoom + view.height / 2;
    const w = (sc.maxX - sc.minX) * camera.zoom;
    const h = (sc.maxY - sc.minY) * camera.zoom;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, w, h);
    ctx.clip();
    ctx.translate(x0, y0);
    fillWith(ctx, img, fit, parallax, parallaxY, { width: w, height: h }, { x: (sc.minX + sc.maxX) / 2, y: (sc.minY + sc.maxY) / 2, zoom: camera.zoom });
    ctx.restore();
    return;
  }
  fillWith(ctx, img, fit, parallax, parallaxY, view, camera, scrolled);
}

/**
 * Stars moving by themselves: 1-3 layers, the farther ones smaller, dimmer and slower (depth). Each layer is the same
 * random pattern of stars repeating every 256 screen pixels (always the same: a game looks the same every time),
 * moved by `speed` × time; every star on whole picture pixels, as everything else.
 */
function drawStars(ctx: CanvasRenderingContext2D, stars: NonNullable<WorldSettings['background']['stars']>, view: ViewSize, zoom: number, time: number): void {
  // The pattern repeats every 256 level pixels.
  const tile = 256 * zoom;
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  // (mulberry32: well spread, no rows or stripes.)
  let seed = 7919;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const px = Math.max(1, Math.round(zoom));
  ctx.fillStyle = stars.color;
  for (let layer = 0; layer < stars.layers; layer++) {
    // Nearest last: the biggest, brightest and fastest.
    const depth = (layer + 1) / stars.layers;
    // density: stars per 100×100 level pixels, all layers together (more of the far, small ones).
    const count = Math.round(((stars.density * 256 * 256) / 10000 / stars.layers) * (1.5 - depth * 0.5));
    const ox = stars.speed.x * depth * time * zoom;
    const oy = stars.speed.y * depth * time * zoom;
    const size = px * (depth > 0.99 && stars.layers > 1 ? 2 : 1);
    ctx.globalAlpha = 0.35 + 0.65 * depth;
    for (let i = 0; i < count; i++) {
      const sx = mod(rand() * tile + ox, tile);
      const sy = mod(rand() * tile + oy, tile);
      for (let x = sx; x < view.width; x += tile) for (let y = sy; y < view.height; y += tile) ctx.fillRect(Math.round(x / px) * px, Math.round(y / px) * px, size, size);
    }
  }
  ctx.globalAlpha = 1;
}

/** A picture filling the view's height and repeating sideways (cover), or repeating at its own size (tile). */
function fillWith(ctx: CanvasRenderingContext2D, img: CanvasImageSource, fit: 'cover' | 'tile', parallax: number, parallaxY: number, view: ViewSize, camera: Camera, scrolled = { x: 0, y: 0 }): void {
  const { w: iw, h: ih } = imageSize(img);
  if (!iw || !ih) return;
  const scale = fit === 'cover' ? view.height / ih : camera.zoom;
  const tw = iw * scale;
  const th = ih * scale;
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  // Screen position of the world origin, scaled by how much the background follows the level.
  // (A scrolling picture moves by itself too, by `scrolled` level pixels; a filling one that scrolls up or down
  // repeats up and down as well.)
  const ox = mod(view.width / 2 - camera.x * camera.zoom * parallax + scrolled.x * camera.zoom, tw);
  const oy = fit === 'cover' ? mod(scrolled.y * camera.zoom, th) : mod(view.height / 2 - camera.y * camera.zoom * parallaxY + scrolled.y * camera.zoom, th);
  const repeatY = fit !== 'cover' || scrolled.y !== 0;
  ctx.imageSmoothingEnabled = scale < 1;
  for (let x = ox - tw; x < view.width; x += tw) {
    if (!repeatY) ctx.drawImage(img, x, 0, tw, th);
    else for (let y = oy - th; y < view.height; y += th) ctx.drawImage(img, x, y, tw, th);
  }
}

/** Tinted copies of pictures, per picture and color (made once; a game uses a handful of colors). */
const tintCache = new WeakMap<object, Map<string, CanvasImageSource>>();

/**
 * The picture multiplied by a color: white becomes the color, grays darker
 * shades of it, its see-through parts stay as they are. Falls back to the
 * picture itself where there is no canvas to draw on (tests).
 */
function tinted(source: CanvasImageSource, color: string): CanvasImageSource {
  const w = (source as { width?: number }).width ?? 0;
  const h = (source as { height?: number }).height ?? 0;
  if (!w || !h || typeof document === 'undefined') return source;
  let byColor = tintCache.get(source);
  if (!byColor) tintCache.set(source, (byColor = new Map()));
  const hit = byColor.get(color);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = Number(w);
  canvas.height = Number(h);
  const c = canvas.getContext('2d');
  if (!c) return source;
  c.imageSmoothingEnabled = false;
  c.drawImage(source, 0, 0);
  c.globalCompositeOperation = 'multiply';
  c.fillStyle = color;
  c.fillRect(0, 0, canvas.width, canvas.height);
  // Multiply fills the see-through parts too: keep only where the picture is, as see-through as it is there.
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(source, 0, 0);
  if (byColor.size > 64) byColor.clear();
  byColor.set(color, canvas);
  return canvas;
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
 * Sets up the entity's own coordinates (its center at 0,0, its sprite size), from the level's transform `m`.
 * An unturned thing has its edges rounded to whole screen pixels: at most
 * zoom levels a tile edge falls between pixels, and two half-covered pixels
 * side by side show as a thin seam between tiles that touch. Rounded, tiles
 * that touch share the same pixel edge at every zoom.
 */
function placeOnScreen(ctx: CanvasRenderingContext2D, m: DOMMatrix, position: { x: number; y: number }, rotation: number, scale: { x: number; y: number }, size: { x: number; y: number }): void {
  if (rotation % 360 !== 0 || m.b !== 0 || m.c !== 0 || size.x <= 0 || size.y <= 0) {
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.translate(position.x, position.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(scale.x, scale.y);
    return;
  }
  const hw = (size.x * Math.abs(scale.x)) / 2;
  const hh = (size.y * Math.abs(scale.y)) / 2;
  // On whole canvas pixels: the left/top edge is rounded and the size kept (rounding both edges on their own would
  // draw a thing one pixel wider or narrower depending on where it is, stretching its pixels as it moves).
  const x0 = Math.round(m.a * (position.x - hw) + m.e);
  const x1 = x0 + Math.round(m.a * 2 * hw);
  const y0 = Math.round(m.d * (position.y - hh) + m.f);
  const y1 = y0 + Math.round(m.d * 2 * hh);
  // At least one pixel, so tiny things don't vanish when zoomed far out.
  const w = Math.max(1, Math.abs(x1 - x0));
  const h = Math.max(1, Math.abs(y1 - y0));
  ctx.setTransform((w / size.x) * Math.sign(scale.x || 1) * Math.sign(m.a), 0, 0, (h / size.y) * Math.sign(scale.y || 1) * Math.sign(m.d), (x0 + x1) / 2, (y0 + y1) / 2);
}

/** The part of the level the canvas shows (in the coordinates of the current transform), or null when it is turned or skewed. */
function visibleArea(ctx: CanvasRenderingContext2D): { left: number; right: number; top: number; bottom: number } | null {
  const m = ctx.getTransform();
  if (m.b !== 0 || m.c !== 0 || m.a === 0 || m.d === 0) return null;
  const x0 = -m.e / m.a;
  const x1 = (ctx.canvas.width - m.e) / m.a;
  const y0 = -m.f / m.d;
  const y1 = (ctx.canvas.height - m.f) / m.d;
  return { left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };
}

/** An entity to draw; `alpha` fades it (open doors, blinking after a hit). */
export type RenderEntity = ResolvedEntity & { alpha?: number };

const layerOf = (e: ResolvedEntity) => {
  const l = e.components.Sprite?.layer;
  return typeof l === 'number' ? l : 0;
};

/** In drawing order: by Sprite layer (lower first), keeping the given order within a layer. */
export function byLayer<T extends ResolvedEntity>(entities: T[]): T[] {
  if (!entities.some((e) => layerOf(e) !== 0)) return entities;
  return entities
    .map((e, i) => ({ e, i, l: layerOf(e) }))
    .sort((a, b) => a.l - b.l || a.i - b.i)
    .map((x) => x.e);
}

const tileKey = (definitionId: string | null, x: number, y: number) => `${definitionId}|${Math.round(x)}|${Math.round(y)}`;

/** Picture pixels cut from each row of a rounded corner, the row at the edge first (a pixel-art quarter circle: 2 → [2, 1], 4 → [4, 2, 1, 1]). */
export function cornerCuts(r: number): number[] {
  return Array.from({ length: r }, (_, i) => Math.ceil(r - Math.sqrt(r * r - (r - i) ** 2) - 1e-9));
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface TileCorners {
  /** This tile's own corners that are cut off (nothing of its kind next to it on those two sides). */
  cut: Corner[];
  /** Corners of the empty cell above or below this tile that are filled (a tunnel turning): the cell (dy = -1 above, 1 below) and which of its corners. */
  fill: { dy: -1 | 1; corner: Corner }[];
}

/**
 * Which corners a tile rounds, from which cells around it hold a tile of the
 * same kind (`has(dx, dy)`, in cells). An inside corner is filled by the tile
 * above or below the empty cell (never by the one beside it too), so no fill is
 * drawn twice.
 */
export function tileCorners(has: (dx: number, dy: number) => boolean): TileCorners {
  const up = has(0, -1);
  const down = has(0, 1);
  const left = has(-1, 0);
  const right = has(1, 0);
  const cut: Corner[] = [];
  if (!up && !left) cut.push('tl');
  if (!up && !right) cut.push('tr');
  if (!down && !left) cut.push('bl');
  if (!down && !right) cut.push('br');
  const fill: TileCorners['fill'] = [];
  // The empty cell below: filled at its top-left when the tile left of it and the one left of this are there.
  if (!down) {
    if (left && has(-1, 1)) fill.push({ dy: 1, corner: 'tl' });
    if (right && has(1, 1)) fill.push({ dy: 1, corner: 'tr' });
  }
  if (!up) {
    if (left && has(-1, -1)) fill.push({ dy: -1, corner: 'bl' });
    if (right && has(1, -1)) fill.push({ dy: -1, corner: 'br' });
  }
  return { cut, fill };
}

/**
 * Adds to the path the rectangle (x, y, w, h) without the given corners, each
 * cut as a staircase (`cuts`, in units of px × py), as rows of whole picture pixels.
 */
function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, cut: Corner[], cuts: number[], px: number, py: number): void {
  const r = cuts.length;
  const has = (c: Corner) => cut.includes(c);
  ctx.rect(x, y + r * py, w, h - 2 * r * py);
  for (let i = 0; i < r; i++) {
    const top = y + i * py;
    const bottom = y + h - (i + 1) * py;
    const tl = has('tl') ? cuts[i] * px : 0;
    const tr = has('tr') ? cuts[i] * px : 0;
    const bl = has('bl') ? cuts[i] * px : 0;
    const br = has('br') ? cuts[i] * px : 0;
    ctx.rect(x + tl, top, w - tl - tr, py);
    ctx.rect(x + bl, bottom, w - bl - br, py);
  }
}

/** Adds to the path the filled part of an empty cell's corner (x, y, w, h: the cell): the cut shape, the other way round. */
function cornerFillPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, corner: Corner, cuts: number[], px: number, py: number): void {
  cuts.forEach((n, i) => {
    const ry = corner[0] === 't' ? y + i * py : y + h - (i + 1) * py;
    const rx = corner[1] === 'l' ? x : x + w - n * px;
    ctx.rect(rx, ry, n * px, py);
  });
}

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
  /** Seconds, for animated sprites (play time in the game; a running clock in the editor). */
  clock = 0,
): void {
  // Tiles, and anything with rounded corners (an object the AI made for dirt need not be marked a tile), by cell.
  const rounds = (e: ResolvedEntity) => typeof e.components.Sprite?.roundCorners === 'number' && (e.components.Sprite.roundCorners as number) > 0;
  const autotiled = (e: ResolvedEntity) => e.components.Sprite?.autotile === true && typeof e.components.Sprite.autotileSheet === 'string';
  const shown = visibleArea(ctx);
  // How far around its middle a thing reaches (a turned one at most half its diagonal).
  const reach = (e: ResolvedEntity, size: Vec2) => {
    const { rotation, scale } = e.transform;
    const w = Math.abs(size.x * scale.x);
    const h = Math.abs(size.y * scale.y);
    return { hx: (rotation % 360 !== 0 ? Math.hypot(w, h) : w) / 2 + 1, hy: (rotation % 360 !== 0 ? Math.hypot(w, h) : h) / 2 + 1, w, h };
  };
  const within = (e: ResolvedEntity, hx: number, hy: number) =>
    !shown || !(e.transform.position.x + hx < shown.left || e.transform.position.x - hx > shown.right || e.transform.position.y + hy < shown.top || e.transform.position.y - hy > shown.bottom);
  // Only what is on the canvas, and the tiles right around it (they decide its rounded corners and edges), is
  // looked at further: a big level otherwise costs as much as if all of it were on screen, every frame.
  const near = shown
    ? entities.filter((e) => {
        const r = reach(e, getEntitySize(e));
        return within(e, r.hx + r.w, r.hy + r.h);
      })
    : entities;
  const tiles = new Set<string>();
  for (const e of near) if (e.tile || rounds(e) || autotiled(e)) tiles.add(tileKey(e.definitionId, e.transform.position.x, e.transform.position.y));
  // (Each thing's own drawing state is undone by hand: save and restore for each of thousands of tiles cost more
  // than drawing them. Only a clipped one, for rounded corners, saves and restores.)
  const base = ctx.getTransform();
  const baseAlpha = ctx.globalAlpha;
  const baseSmoothing = ctx.imageSmoothingEnabled;

  for (const entity of byLayer(near)) {
    const sprite = entity.components.Sprite;
    const invisible = sprite?.visible === false;
    if (!sprite || (invisible && invisibleAlpha <= 0)) continue;
    const size = getEntitySize(entity);
    const { position, rotation, scale } = entity.transform;
    // Off the canvas: not drawn.
    const ext = reach(entity, size);
    if (!within(entity, ext.hx, ext.hy)) continue;
    const color = typeof sprite.color === 'string' ? sprite.color : '#cccccc';
    ctx.globalAlpha = entity.alpha !== undefined || invisible ? baseAlpha * (entity.alpha ?? 1) * (invisible ? invisibleAlpha : 1) : baseAlpha;
    // (Placed from the level's own transform: `base`, not whatever the thing before left.)
    placeOnScreen(ctx, base, position, rotation, scale, size);
    ctx.fillStyle = color;
    // Autotiled: the one of its 16 pictures that fits the tiles of its kind around it.
    const sheet = autotiled(entity) ? images(sprite.autotileSheet as string) : null;
    const neighbours = () => {
      const sx = size.x * Math.abs(scale.x);
      const sy = size.y * Math.abs(scale.y);
      return autotileIndex((dx, dy) => tiles.has(tileKey(entity.definitionId, position.x + dx * sx, position.y + dy * sy)));
    };
    const img = sheet?.grid ? sheet : typeof sprite.assetId === 'string' ? images(sprite.assetId) : null;
    const source = img && sprite.tint === true ? tinted(img.source, color) : img?.source;
    const cell = img === sheet && sheet ? cellRect(sheet.grid!, neighbours() + 1) : img?.grid ? cellRect(img.grid, img.animation ? animationFrame(img.animation, clock) : typeof sprite.frame === 'number' ? sprite.frame : 1) : null;
    /** The picture (or, without one, the color) over the tile's own square moved `dy` tiles down. */
    const paint = (dy: number) => {
      const y = -size.y / 2 + dy * size.y;
      if (img && source) {
        // Pixel art stays crisp. The image (or sheet cell) stretches to the sprite size.
        ctx.imageSmoothingEnabled = false;
        if (cell) ctx.drawImage(source, cell.x, cell.y, cell.w, cell.h, -size.x / 2, y, size.x, size.y);
        else ctx.drawImage(source, -size.x / 2, y, size.x, size.y);
      } else ctx.fillRect(-size.x / 2, y, size.x, size.y);
    };
    // Rounded corners of a tile surface: from the tiles of the same kind around it.
    let clipped = false;
    const round = rounds(entity) && rotation % 360 === 0 && !(sheet && img === sheet);
    if (round) {
      const art = cell ? { w: cell.w, h: cell.h } : source ? imageSize(source) : { w: size.x, h: size.y };
      const px = size.x / (art.w || size.x);
      const py = size.y / (art.h || size.y);
      const r = Math.min(Math.round(sprite.roundCorners as number), Math.floor(Math.min(art.w, art.h) / 2));
      const cuts = cornerCuts(r);
      const sx = size.x * Math.abs(scale.x);
      const sy = size.y * Math.abs(scale.y);
      const corners = tileCorners((dx, dy) => tiles.has(tileKey(entity.definitionId, position.x + dx * sx, position.y + dy * sy)));
      for (const f of corners.fill) {
        ctx.save();
        ctx.beginPath();
        cornerFillPath(ctx, -size.x / 2, -size.y / 2 + f.dy * size.y, size.x, size.y, f.corner, cuts, px, py);
        ctx.clip();
        paint(f.dy);
        ctx.restore();
      }
      if (corners.cut.length && r > 0) {
        ctx.save();
        clipped = true;
        ctx.beginPath();
        roundedRectPath(ctx, -size.x / 2, -size.y / 2, size.x, size.y, corners.cut, cuts, px, py);
        ctx.clip();
      }
    }
    if (img) {
      paint(0);
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
    if (clipped) ctx.restore();
  }
  ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
  ctx.globalAlpha = baseAlpha;
  ctx.imageSmoothingEnabled = baseSmoothing;
}
