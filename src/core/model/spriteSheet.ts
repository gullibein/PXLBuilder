/**
 * Sprite sheets to take out of the app: the game's pictures packed into one
 * image, and a JSON file saying where each one is. The JSON is the common
 * atlas form game engines and tools read ("frames" by name with their
 * rectangle, "animations" as lists of frame names, "meta" with the image),
 * and it also carries each pixel-art picture as data (palette and rows), so
 * the JSON alone is enough to rebuild them.
 */
import type { AssetRecord, Project } from '../types';
import { cellCount, cellRect } from './spriteGrid';

/** One picture to put on the sheet (an image, or a whole sprite sheet / animation strip). */
export interface SheetItem {
  asset: AssetRecord;
  /** Where it goes on the sheet, in its own pixels (before scaling). */
  x: number;
  y: number;
}

export interface SheetLayout {
  items: SheetItem[];
  width: number;
  height: number;
}

const GAP = 1;

/** The pictures that can go on a sheet: images and sprite sheets (not sounds). */
export function sheetAssets(assets: AssetRecord[]): AssetRecord[] {
  return assets.filter((a) => (a.kind === 'image' || a.kind === 'spritesheet') && a.width > 0 && a.height > 0);
}

/**
 * Packs pictures in rows (tallest first), one pixel apart, rows about as wide as the sheet is tall so it
 * comes out roughly square.
 */
export function packSheet(assets: AssetRecord[]): SheetLayout {
  const sorted = [...assets].sort((a, b) => b.height - a.height || b.width - a.width);
  const area = sorted.reduce((s, a) => s + (a.width + GAP) * (a.height + GAP), 0);
  const rowWidth = Math.max(Math.ceil(Math.sqrt(area)), ...sorted.map((a) => a.width));
  const items: SheetItem[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  let width = 0;
  for (const asset of sorted) {
    if (x > 0 && x + asset.width > rowWidth) {
      y += rowHeight + GAP;
      x = 0;
      rowHeight = 0;
    }
    items.push({ asset, x, y });
    x += asset.width + GAP;
    width = Math.max(width, x - GAP);
    rowHeight = Math.max(rowHeight, asset.height);
  }
  return { items, width: Math.max(1, width), height: Math.max(1, y + rowHeight) };
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Names that stay unique when two pictures share one ("Coin", "Coin 2"). */
function uniqueNames(items: SheetItem[]): Map<SheetItem, string> {
  const used = new Set<string>();
  const out = new Map<SheetItem, string>();
  for (const it of items) {
    const base = it.asset.name.trim() || 'Sprite';
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base} ${i}`;
    used.add(name);
    out.set(it, name);
  }
  return out;
}

/**
 * The atlas JSON for a packed sheet drawn `scale` times bigger: every picture as a frame by its name; a sprite
 * sheet's cells as "Name #1", "Name #2"… and an animation as the list of its cells' names (at its speed).
 */
export function atlasJson(layout: SheetLayout, imageName: string, scale: number): Record<string, unknown> {
  const names = uniqueNames(layout.items);
  const frames: Record<string, unknown> = {};
  const animations: Record<string, { frames: string[]; fps: number }> = {};
  const pixelArt: Record<string, unknown> = {};
  const frame = (r: Rect) => {
    const rect = { x: r.x * scale, y: r.y * scale, w: r.w * scale, h: r.h * scale };
    return { frame: rect, rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: rect.w, h: rect.h }, sourceSize: { w: rect.w, h: rect.h } };
  };
  for (const it of layout.items) {
    const name = names.get(it)!;
    const a = it.asset;
    frames[name] = frame({ x: it.x, y: it.y, w: a.width, h: a.height });
    if (a.kind === 'spritesheet' && a.grid) {
      const cell = (n: number) => `${name} #${n}`;
      for (let n = 1; n <= cellCount(a.grid); n++) {
        const r = cellRect(a.grid, n);
        frames[cell(n)] = frame({ x: it.x + r.x, y: it.y + r.y, w: r.w, h: r.h });
      }
      if (a.animation?.frames.length) animations[name] = { frames: a.animation.frames.map(cell), fps: a.animation.fps };
    }
    if (a.pixelArt) pixelArt[name] = { palette: a.pixelArt.palette, frames: a.pixelArt.frames ?? [a.pixelArt.rows] };
  }
  return {
    frames,
    animations,
    meta: { app: 'PXLBuilder', image: imageName, format: 'RGBA8888', size: { w: layout.width * scale, h: layout.height * scale }, scale: String(scale) },
    // The pixel-art pictures as data: one character per pixel, "." transparent, colors in the palette.
    pixelArt,
  };
}

/** A file name from a game or sprite name ("My Game" → "my-game"). */
export function fileBase(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'sprites'
  );
}

/** Pictures the game uses somewhere: as an object's or placed thing's look, a situation's look, in its sprites list, a level background, a script. */
export function usedAssetIds(project: Project): Set<string> {
  const ids = new Set(project.assets.map((a) => a.id));
  const used = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (ids.has(v)) used.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(project.definitions);
  walk(project.scenes);
  return used;
}
