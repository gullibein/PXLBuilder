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
  /** Seen at an angle (an isometric level): the ground is drawn as 2:1 diamonds, things stand upright on it. */
  iso?: boolean;
}

/**
 * The isometric view: the level stays as it is (seen from above, x right, y down) and is drawn turned 45° and
 * squashed to half its height, so each grid square is a diamond twice as wide as it is tall (a 32 px square: 32 ×
 * 16). Things that stand (characters, blocks) are drawn upright where their square is.
 */
export function isoProject(p: Vec2): Vec2 {
  return { x: 0.5 * (p.x - p.y), y: 0.25 * (p.x + p.y) };
}
export function isoUnproject(s: Vec2): Vec2 {
  return { x: s.x + 2 * s.y, y: 2 * s.y - s.x };
}

/** The level distance a move on the screen (in screen px) is, at this camera. */
export function screenDelta(camera: Camera, d: Vec2): Vec2 {
  const s = { x: d.x / camera.zoom, y: d.y / camera.zoom };
  return camera.iso ? isoUnproject(s) : s;
}

/** The camera that shows level point `world` at screen point `screen`, at `zoom`. */
export function cameraKeeping(camera: Camera, view: ViewSize, world: Vec2, screen: Vec2, zoom: number): Camera {
  const d = screenDelta({ ...camera, zoom }, { x: screen.x - view.width / 2, y: screen.y - view.height / 2 });
  return { ...camera, zoom, x: world.x - d.x, y: world.y - d.y };
}

export interface ViewSize {
  width: number;
  height: number;
}

export function worldToScreen(camera: Camera, view: ViewSize, p: Vec2): Vec2 {
  const d = { x: p.x - camera.x, y: p.y - camera.y };
  const s = camera.iso ? isoProject(d) : d;
  return { x: s.x * camera.zoom + view.width / 2, y: s.y * camera.zoom + view.height / 2 };
}

export function screenToWorld(camera: Camera, view: ViewSize, p: Vec2): Vec2 {
  const d = screenDelta(camera, { x: p.x - view.width / 2, y: p.y - view.height / 2 });
  return { x: d.x + camera.x, y: d.y + camera.y };
}

/** The part of the level the view shows (its four corners, as a box in level coordinates). */
export function worldBoundsOfView(camera: Camera, view: ViewSize): { left: number; top: number; right: number; bottom: number } {
  const pts = [
    { x: 0, y: 0 },
    { x: view.width, y: 0 },
    { x: 0, y: view.height },
    { x: view.width, y: view.height },
  ].map((p) => screenToWorld(camera, view, p));
  return { left: Math.min(...pts.map((p) => p.x)), right: Math.max(...pts.map((p) => p.x)), top: Math.min(...pts.map((p) => p.y)), bottom: Math.max(...pts.map((p) => p.y)) };
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
  if (camera.iso) {
    const s = dpr * camera.zoom;
    const c = isoProject(camera);
    ctx.setTransform(s * 0.5, s * 0.25, -s * 0.5, s * 0.25, dpr * (view.width / 2) - s * c.x, dpr * (view.height / 2) - s * c.y);
    return;
  }
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

/** The part of the level the canvas shows (in the coordinates of the current transform), or null when it can't be told. */
function visibleArea(ctx: CanvasRenderingContext2D): { left: number; right: number; top: number; bottom: number } | null {
  const m = ctx.getTransform();
  if (m.b !== 0 || m.c !== 0) {
    // Seen at an angle: the box round the canvas's four corners in the level (a margin for what stands tall).
    if (!m.is2D || m.a * m.d - m.b * m.c === 0) return null;
    const inv = m.inverse();
    const pts = [
      [0, 0],
      [ctx.canvas.width, 0],
      [0, ctx.canvas.height],
      [ctx.canvas.width, ctx.canvas.height],
    ].map(([x, y]) => inv.transformPoint({ x, y }));
    const pad = 96;
    return { left: Math.min(...pts.map((p) => p.x)) - pad, right: Math.max(...pts.map((p) => p.x)) + pad, top: Math.min(...pts.map((p) => p.y)) - pad, bottom: Math.max(...pts.map((p) => p.y)) + pad };
  }
  if (m.a === 0 || m.d === 0) return null;
  const x0 = -m.e / m.a;
  const x1 = (ctx.canvas.width - m.e) / m.a;
  const y0 = -m.f / m.d;
  const y1 = (ctx.canvas.height - m.f) / m.d;
  return { left: Math.min(x0, x1), right: Math.max(x0, x1), top: Math.min(y0, y1), bottom: Math.max(y0, y1) };
}

/** An entity to draw; `alpha` fades it (open doors, blinking after a hit). */
/** trail: where it was lately, oldest first (a Trail in play). */
export type RenderEntity = ResolvedEntity & { alpha?: number; trail?: { x: number; y: number }[] };

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

export type IsoLook = 'stand' | 'flat' | 'block' | 'iso_floor' | 'iso_block';

/** How a thing is drawn in an isometric level (Sprite.isoLook; auto: tiles in the way are blocks, other tiles lie flat, the rest stands). */
export function isoLookOf(e: ResolvedEntity): IsoLook {
  const l = e.components.Sprite?.isoLook;
  if (l === 'stand' || l === 'flat' || l === 'block' || l === 'iso_floor' || l === 'iso_block') return l;
  if (!e.tile) return 'stand';
  const c = e.components.Collider;
  const body = e.components.PhysicsBody?.bodyType;
  return c && c.isTrigger !== true && body !== 'dynamic' && body !== 'kinematic' ? 'block' : 'flat';
}

/**
 * Drawing order in an isometric level, as a painter does it: diagonal row of squares by row from the back (top left of
 * the level) to the front, and within a row from the bottom up (a floor block's bottom is a block below the ground, so
 * the ground comes before what stands on it, and the ground of the rows in front hides what is sunk below it). A
 * standing thing counts in the row its front reaches (so the floor it walks onto is drawn before it). Then the Sprite
 * layer, then exactly where.
 */
export function isoOrder<T extends ResolvedEntity>(entities: T[]): T[] {
  return entities
    .map((e, i) => {
      const vol = isoVolume(e);
      const { x, y } = e.transform.position;
      const reach = vol ? 0 : 8;
      return { e, i, c: Math.floor((x + reach) / 32) + Math.floor((y + reach) / 32), h: vol ? vol.bottom : isoLiftOf(e), l: layerOf(e), d: x + y };
    })
    .sort((a, b) => a.c - b.c || a.h - b.h || a.l - b.l || a.d - b.d || a.i - b.i)
    .map((x) => x.e);
}

/** The point is inside the outline (a convex shape, its corners going round one way). */
export function insideOutline(p: Vec2, corners: Vec2[]): boolean {
  let sign = 0;
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross === 0) continue;
    if (sign === 0) sign = Math.sign(cross);
    else if (Math.sign(cross) !== sign) return false;
  }
  return true;
}

/** How high it is drawn in an isometric level (Sprite.isoLift: 16 is one block of a 32 px square). */
export function isoLiftOf(e: ResolvedEntity): number {
  const l = e.components.Sprite?.isoLift;
  return typeof l === 'number' && Number.isFinite(l) ? l : 0;
}

/** Isometric auto-tiling (Sprite.isoAuto): the kind of block this is, for the blocks around it. */
export type IsoAuto = 'none' | 'road' | 'land' | 'water';

export function isoAutoOf(e: ResolvedEntity): IsoAuto {
  const a = e.components.Sprite?.isoAuto;
  return a === 'road' || a === 'land' || a === 'water' ? a : 'none';
}

const isWaterBlock = (e: ResolvedEntity) => isoAutoOf(e) === 'water' || e.tags.includes('water');

/** What each of an auto-tiled block's pictures (Sprite.isoPictures) is, in order: the shapes it takes. */
export function isoShapeNames(kind: IsoAuto): string[] {
  if (kind === 'road') return ['Variation', 'Turn SE–SW', 'Turn SE–NE', 'Turn NW–NE', 'Turn NW–SW'];
  if (kind === 'land') return ['Corner north', 'Corner east', 'Corner south', 'Corner west', 'Variation'];
  if (kind === 'water') return ['Shore north', 'Shore east', 'Shore south', 'Shore west', 'Variation'];
  return [];
}

/**
 * Isometric auto-tiling: which of its pictures a block is drawn with, from the blocks around it at its own height
 * (`at(dx, dy)`: what is on the square that far along the level's x and y). On the screen -y is north-east, +x
 * south-east, +y south-west, -x north-west.
 * - road (Sprite.isoPictures: variation, turns SE-SW, SE-NE, NW-NE, NW-SW): where the road of the same object
 *   turns, the turn; elsewhere its own picture or the variation, mixed by where it is.
 * - land (north, east, south, west corners, variation): where water is on two sides next to each other, that
 *   corner (not where that water itself turns: its shore corners already round it off); elsewhere its own picture
 *   or the variation, mixed by where it is.
 * - water (north, east, south, west corners, variation): the same where land is on two sides next to each other.
 * null: its own picture.
 */
export function isoAutoPicture(e: ResolvedEntity, at: (dx: number, dy: number) => ResolvedEntity[]): string | null {
  const kind = isoAutoOf(e);
  const pics = e.components.Sprite?.isoPictures;
  if (kind === 'none' || !Array.isArray(pics)) return null;
  const pic = (n: number) => (typeof pics[n] === 'string' && pics[n] ? (pics[n] as string) : null);
  const sides = (test: (o: ResolvedEntity) => boolean) => isoSides(at, test);
  const corner = (s: Sides) => {
    const n = isoCorner(s);
    return n < 0 ? null : pic(n);
  };
  // (Mixed by where it is: the same square always gets the same one; `in5` of 5 squares the variation.)
  const mixed = (n: number, in5: number) => {
    const i = Math.floor(e.transform.position.x / 32);
    const j = Math.floor(e.transform.position.y / 32);
    return (((i * 73856093) ^ (j * 19349663)) >>> 0) % 5 < in5 ? pic(n) : null;
  };
  if (kind === 'road') {
    const s = sides((o) => o.definitionId === e.definitionId && o !== e);
    const n = +s.ne + +s.se + +s.sw + +s.nw;
    if (n === 2) {
      const turn = s.se && s.sw ? pic(1) : s.se && s.ne ? pic(2) : s.nw && s.ne ? pic(3) : s.nw && s.sw ? pic(4) : null;
      if (turn) return turn;
    }
    return mixed(0, 2);
  }
  if (kind === 'land') {
    // (Water that turns, a shore corner, next to it: the land stays as it is, or the two round off twice.)
    const turning = (dx: number, dy: number) => at(dx, dy).some((o) => isoAutoOf(o) === 'water' && isoCorner(isoSides((x, y) => at(dx + x, dy + y), isLandFor(o))) >= 0);
    const s = sides(isWaterBlock);
    const n = isoCorner(s);
    const steps = [[[-1, 0], [0, -1]], [[0, -1], [1, 0]], [[1, 0], [0, 1]], [[0, 1], [-1, 0]]][n];
    if (n >= 0 && !steps.some(([dx, dy]) => turning(dx, dy))) return pic(n);
    return mixed(4, 1);
  }
  return corner(sides(isLandFor(e))) ?? mixed(4, 1);
}

type Sides = { ne: boolean; se: boolean; sw: boolean; nw: boolean };

/** Which of a square's four sides (north-east -y, south-east +x, south-west +y, north-west -x) have what passes the test. */
function isoSides(at: (dx: number, dy: number) => ResolvedEntity[], test: (o: ResolvedEntity) => boolean): Sides {
  const has = (dx: number, dy: number) => at(dx, dy).some(test);
  return { ne: has(0, -1), se: has(1, 0), sw: has(0, 1), nw: has(-1, 0) };
}

/** The corner two sides next to each other make: 0 north (NW+NE), 1 east (NE+SE), 2 south (SE+SW), 3 west (SW+NW); -1 none. */
function isoCorner(s: Sides): number {
  return s.nw && s.ne ? 0 : s.ne && s.se ? 1 : s.se && s.sw ? 2 : s.sw && s.nw ? 3 : -1;
}

/** Land, as water sees it: a floor block that is not water. */
const isLandFor = (water: ResolvedEntity) => (o: ResolvedEntity) => o !== water && !isWaterBlock(o) && isoLookOf(o) === 'iso_floor';

/** A block's height (half its width: 2:1 blocks), in isoLift units. */
export function isoBlockHeight(e: ResolvedEntity): number {
  return (getEntitySize(e).x * Math.abs(e.transform.scale.x)) / 2;
}

/**
 * The space a block fills in an isometric level, from its bottom to its top (isoLift units, 0 the ground): a floor
 * block's top is at its lift, a wall block stands on it. Null for what is not a block.
 */
export function isoVolume(e: ResolvedEntity): { bottom: number; top: number } | null {
  const look = isoLookOf(e);
  const lift = isoLiftOf(e);
  const h = isoBlockHeight(e);
  if (look === 'iso_floor') return { bottom: lift - h, top: lift };
  if (look === 'iso_block' || look === 'block') return { bottom: lift, top: lift + h };
  return null;
}

/** The lift that puts a thing's bottom at `bottom` (a block's bottom; a floor block's top goes a block higher; anything else stands there). */
export function isoLiftFor(e: ResolvedEntity, bottom: number): number {
  return isoLookOf(e) === 'iso_floor' ? bottom + isoBlockHeight(e) : bottom;
}

/**
 * Where it is drawn on the screen (CSS px of the view), and for a block where its top's middle is: what a click on
 * it means. Null for what lies flat on the ground.
 */
export function isoScreenBox(e: ResolvedEntity, camera: Camera, view: ViewSize): { left: number; top: number; right: number; bottom: number; topFace: Vec2 | null; w: number; outline: Vec2[] | null } | null {
  const look = isoLookOf(e);
  if (look === 'flat') return null;
  const size = getEntitySize(e);
  const at = worldToScreen(camera, view, e.transform.position);
  const z = camera.zoom;
  const W = size.x * Math.abs(e.transform.scale.x) * z;
  const H = size.y * Math.abs(e.transform.scale.y) * z;
  const lift = isoLiftOf(e) * z;
  // A block's outline on the screen: its top's diamond and its two sides (the six corners round it).
  const outline = (t: Vec2, hb: number): Vec2[] => [
    { x: t.x, y: t.y - W / 4 },
    { x: t.x + W / 2, y: t.y },
    { x: t.x + W / 2, y: t.y + hb },
    { x: t.x, y: t.y + W / 4 + hb },
    { x: t.x - W / 2, y: t.y + hb },
    { x: t.x - W / 2, y: t.y },
  ];
  const box = (top: number, bottom: number, face: Vec2 | null) => ({ left: at.x - W / 2, right: at.x + W / 2, top, bottom, topFace: face, w: W, outline: face ? outline(face, look === 'block' ? W / 2 : H - W / 2) : null });
  if (look === 'stand') return box(at.y + W / 8 - H - lift, at.y + W / 8 - lift, null);
  if (look === 'iso_floor') return box(at.y - W / 4 - lift, at.y - W / 4 - lift + H, { x: at.x, y: at.y - lift });
  if (look === 'iso_block') return box(at.y - W / 4 - (H - W / 2) - lift, at.y - W / 4 - (H - W / 2) - lift + H, { x: at.x, y: at.y - (H - W / 2) - lift });
  return box(at.y - W / 2 - W / 4 - lift, at.y + W / 4 - lift, { x: at.x, y: at.y - W / 2 - lift });
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

/** A position on the art-pixel grid (`px` level pixels a cell). */
const snap = (v: number, px: number) => Math.round(v / px) * px;

/**
 * A light around a thing (Glow), as pixel art: three solid rings on the game's art-pixel grid, each adding a fixed
 * step of the glow color (outer faint, inner bright), never a smooth blur. Each ring is drawn row by row (one
 * rectangle per row), so a glow costs a few dozen rectangles whatever its size.
 */
function drawGlow(ctx: CanvasRenderingContext2D, at: Vec2, glow: Record<string, unknown>, across: number, alpha: number, clock: number, px: number): void {
  const color = typeof glow.color === 'string' ? glow.color : '#ffd166';
  const reach = Math.max(px, typeof glow.size === 'number' ? glow.size : 10);
  // A pulse grows and shrinks it by whole art pixels.
  const pulse = typeof glow.pulse === 'number' && glow.pulse > 0 ? Math.sin(clock * glow.pulse * Math.PI * 2) : 0;
  const strength = Math.min(1, Math.max(0, typeof glow.strength === 'number' ? glow.strength : 0.7)) * (1 + 0.15 * pulse);
  const outer = snap(across / 2 + reach * (1 + 0.2 * pulse), px);
  if (strength <= 0 || !Number.isFinite(outer) || outer <= 0) return;
  const cx = snap(at.x, px);
  const cy = snap(at.y, px);
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = color;
  // Outer, middle, inner: added on top of each other, so the brightness steps up toward the middle.
  const rings = [
    { r: outer, a: 0.22 },
    { r: snap(across / 2 + reach * 0.62, px), a: 0.22 },
    { r: snap(across / 2 + reach * 0.3, px), a: 0.28 },
  ];
  for (const ring of rings) {
    if (ring.r <= 0) continue;
    ctx.globalAlpha = Math.min(1, alpha * strength * ring.a * 1.4);
    for (let y = -ring.r; y < ring.r; y += px) {
      const mid = y + px / 2;
      const half = Math.sqrt(Math.max(0, ring.r * ring.r - mid * mid));
      const w = snap(half, px);
      if (w > 0) ctx.fillRect(cx - w, cy + y, w * 2, px);
    }
  }
  ctx.globalCompositeOperation = op;
}

/**
 * A tail along where a thing was (Trail), as pixel art: solid squares on the art-pixel grid, shrinking and stepping
 * darker toward the end, the last part broken up (every other square) instead of fading out.
 */
function drawTrail(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], trail: Record<string, unknown>, across: number, alpha: number, clock: number, px: number): void {
  const color = typeof trail.color === 'string' ? trail.color : '#ffd166';
  const width = snap(typeof trail.width === 'number' && trail.width > 0 ? trail.width : Math.max(px, across), px) || px;
  const n = points.length;
  if (n < 2) return;
  // The path, one sample an art pixel apart (oldest first).
  const path: { x: number; y: number; k: number }[] = [];
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  let gone = 0;
  for (let i = 1; i < n; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / px));
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      path.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, k: total > 0 ? (gone + len * t) / total : 1 });
    }
    gone += len;
  }
  const shades = [shade(color, -0.55), shade(color, -0.3), color];
  ctx.globalAlpha = alpha;
  const seen = new Set<string>();
  path.forEach((p, i) => {
    const band = p.k < 0.34 ? 0 : p.k < 0.67 ? 1 : 2;
    let size: number;
    if (trail.style === 'sparks') {
      // Single art pixels (two near the head) scattered beside the way, flickering: the same for a given spot and
      // moment, never random noise.
      const h = Math.sin((Math.round(p.x / px) * 12.9898 + Math.round(p.y / px) * 78.233 + Math.floor(clock * 15)) * 43758.5453);
      const r = h - Math.floor(h);
      if (r < 0.4) return;
      size = band === 2 && r > 0.85 ? px * 2 : px;
      const h2 = Math.sin((r * 91.17 + i * 7.31) * 43758.5453);
      const r2 = h2 - Math.floor(h2);
      p = { ...p, x: p.x + snap((r2 - 0.5) * (width + px * 2), px), y: p.y + snap(((r * 7) % 1 - 0.5) * (width + px * 2), px) };
    } else if (trail.style === 'dots') {
      if (i % 4 || i > path.length - 3) return;
      size = Math.max(px, snap(width * 0.7 * p.k, px));
    } else {
      // (The faint end broken up.)
      if (band === 0 && i % 2) return;
      size = Math.max(px, snap(width * (0.35 + 0.65 * p.k), px));
    }
    const x = snap(p.x - size / 2, px);
    const y = snap(p.y - size / 2, px);
    const key = `${x},${y},${size}`;
    if (seen.has(key)) return;
    seen.add(key);
    ctx.fillStyle = shades[band];
    ctx.fillRect(x, y, size, size);
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
  /** Level pixels per art pixel (32 / the game's sprite size): glows and tails keep to that grid. */
  artPixel = 1,
): void {
  const px = Math.max(0.25, artPixel);
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
  // Seen at an angle (an isometric level): the camera's transform is skewed; canvas px per level px on screen.
  const iso = Math.abs(base.b) > 1e-12 && Math.abs(base.c) > 1e-12;
  const isoScale = iso ? Math.hypot(base.a, base.b) / Math.hypot(0.5, 0.25) : 1;

  // Isometric auto-tiling: what is on each square at each height (only built when something auto-tiles).
  let isoCells: Map<string, ResolvedEntity[]> | null = null;
  const isoKey = (x: number, y: number, lift: number) => `${Math.floor(x / 32)},${Math.floor(y / 32)},${Math.round(lift)}`;
  if (iso && near.some((e) => isoAutoOf(e) !== 'none')) {
    isoCells = new Map();
    for (const e of near) {
      if (!e.components.Sprite) continue;
      const k = isoKey(e.transform.position.x, e.transform.position.y, isoLiftOf(e));
      const list = isoCells.get(k);
      if (list) list.push(e);
      else isoCells.set(k, [e]);
    }
  }

  for (const entity of iso ? isoOrder(near) : byLayer(near)) {
    const sprite = entity.components.Sprite;
    const invisible = sprite?.visible === false;
    if (!sprite || (invisible && invisibleAlpha <= 0)) continue;
    const size = getEntitySize(entity);
    const { position, rotation, scale } = entity.transform;
    // Off the canvas: not drawn.
    const ext = reach(entity, size);
    if (!within(entity, ext.hx, ext.hy)) continue;
    const color = typeof sprite.color === 'string' ? sprite.color : '#cccccc';
    // Its tail and its light, under it.
    if (!invisible) {
      if (entity.trail && entity.components.Trail) {
        ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
        drawTrail(ctx, entity.trail, entity.components.Trail, Math.min(size.x * Math.abs(scale.x), size.y * Math.abs(scale.y)), baseAlpha * (entity.alpha ?? 1), clock, px);
      }
      if (entity.components.Glow) {
        ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f);
        drawGlow(ctx, position, entity.components.Glow, Math.max(size.x * Math.abs(scale.x), size.y * Math.abs(scale.y)), baseAlpha * (entity.alpha ?? 1), clock, px);
      }
    }
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
    const cells = isoCells;
    const autoPicture = cells && isoAutoOf(entity) !== 'none' ? isoAutoPicture(entity, (dx, dy) => cells.get(isoKey(position.x + dx * 32, position.y + dy * 32, isoLiftOf(entity))) ?? []) : null;
    const assetId = autoPicture ?? (typeof sprite.assetId === 'string' ? sprite.assetId : null);
    const img = sheet?.grid ? sheet : assetId ? images(assetId) : null;
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
    // Isometric: standing things and blocks are drawn upright where their square is (flat things lie on the ground
    // through the camera's own transform, as below).
    if (iso) {
      const look = isoLookOf(entity);
      if (look !== 'flat') {
        const s = isoScale;
        const lift = (typeof sprite.isoLift === 'number' ? sprite.isoLift : 0) * s;
        const at = base.transformPoint({ x: position.x, y: position.y });
        const W = size.x * Math.abs(scale.x) * s;
        const H = size.y * Math.abs(scale.y) * s;
        if (look === 'block') {
          // A block from a picture seen from above: the picture on top (raised half its width), its sides shaded.
          const hb = W / 2;
          const up = hb + lift;
          const hw = (size.x * Math.abs(scale.x)) / 2;
          const hh = (size.y * Math.abs(scale.y)) / 2;
          const west = base.transformPoint({ x: position.x - hw, y: position.y + hh });
          const south = base.transformPoint({ x: position.x + hw, y: position.y + hh });
          const east = base.transformPoint({ x: position.x + hw, y: position.y - hh });
          const face = (a: DOMPoint, b: DOMPoint, dark: number) => {
            const ux = b.x - a.x;
            const uy = b.y - a.y;
            ctx.setTransform(ux / size.x, uy / size.x, 0, hb / size.y, a.x + ux / 2, a.y - up + uy / 2 + hb / 2);
            paint(0);
            ctx.fillStyle = `rgba(0, 0, 0, ${dark})`;
            ctx.fillRect(-size.x / 2, -size.y / 2, size.x, size.y);
            ctx.fillStyle = color;
          };
          face(west, south, 0.25);
          face(south, east, 0.45);
          ctx.setTransform(base.a, base.b, base.c, base.d, base.e, base.f - up);
          ctx.translate(position.x, position.y);
          ctx.scale(scale.x, scale.y);
          paint(0);
          continue;
        }
        // An upright picture: standing (its bottom a little below its square's middle), or an isometric block whose
        // top is the ground (iso_floor) or that stands on the square (iso_block).
        const top = look === 'stand' ? at.y + W / 8 - H : look === 'iso_floor' ? at.y - W / 4 : at.y - W / 4 - (H - W / 2);
        const x0 = Math.round(at.x - W / 2);
        const y0 = Math.round(top - lift);
        // A standing thing's shadow on its square, where it stands: shows which square it is on.
        if (look === 'stand' && !invisible) {
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
          ctx.beginPath();
          ctx.ellipse(at.x, at.y - lift, W * 0.3, W * 0.13, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = color;
        }
        const w = Math.max(1, Math.round(W));
        const h = Math.max(1, Math.round(H));
        ctx.setTransform((w / size.x) * Math.sign(scale.x || 1), 0, 0, (h / size.y) * Math.sign(scale.y || 1), x0 + w / 2, y0 + h / 2);
        if (look === 'stand' && rotation % 360 !== 0) ctx.rotate((rotation * Math.PI) / 180);
        if (!img && entity.components.Collider?.shape === 'circle') {
          ctx.beginPath();
          ctx.ellipse(0, 0, size.x / 2, size.y / 2, 0, 0, Math.PI * 2);
          ctx.fill();
        } else paint(0);
        continue;
      }
    }
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
