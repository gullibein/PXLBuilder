/**
 * The game's built-in display (hearts, items, messages, "Level complete!"),
 * drawn into the game on its pixel grid like everything else in it: the
 * hearts are the game's Heart object, drawn the size it is in the level,
 * each of its pixels the level's pixel size; words are in the pixel font.
 */
import type { ResolvedEntity } from '../core/model/resolve';
import { PIXEL_FONT_ADVANCE, pixelTextSize } from './pixelFont';
import { drawEntities, type ImageLookup } from './renderer';
import { onGrid, pixelFontScale, pixelLabel, type PixelGrid } from './screen';

export interface BuiltinHud {
  health: { current: number; max: number } | null;
  items: [string, number][];
  message: string | null;
  banner: string | null;
}

export interface HudView {
  /** The canvas size in canvas pixels. */
  width: number;
  height: number;
  grid: PixelGrid;
  /** Canvas pixels per level pixel (the game's zoom on this screen). */
  levelScale: number;
  /** Canvas pixels per CSS pixel (for margins and words of a readable size on any screen). */
  cssPx: number;
}

const snapUp = (v: number, cell: number) => Math.max(cell, Math.round(v / cell) * cell);

/** Splits words into lines of at most `max` characters. */
function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

/** A box of whole grid cells behind words, then the words (centered at x, y). */
function panel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, scale: number, color: string, v: HudView): void {
  const cell = v.grid.cell;
  const pad = 2 * scale;
  const maxChars = Math.max(4, Math.floor((v.width - 4 * pad) / (PIXEL_FONT_ADVANCE * scale)));
  const lines = wrap(text, maxChars).join('\n');
  const box = pixelTextSize(lines);
  const w = box.w * scale + 2 * pad;
  const h = box.h * scale + 2 * pad;
  const left = Math.round((x - w / 2) / cell) * cell;
  const top = Math.round((y - h / 2) / cell) * cell;
  ctx.fillStyle = 'rgba(15, 12, 30, 0.85)';
  ctx.fillRect(left, top, snapUp(w, cell), snapUp(h, cell));
  pixelLabel(ctx, lines, left + pad, top + pad, 0, 0, scale, color, cell);
}

/** Draws the built-in display over the game (expects no transform: canvas pixels). */
export function drawBuiltinHud(ctx: CanvasRenderingContext2D, hud: BuiltinHud, v: HudView, heart: ResolvedEntity | null, images: ImageLookup, clock = 0): void {
  const cell = v.grid.cell;
  const margin = snapUp(Math.max(2 * cell, 10 * v.cssPx), cell);
  const words = pixelFontScale(14 * v.cssPx, cell);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  let y = margin;
  if (hud.health) {
    const n = Math.min(hud.health.max, 12);
    const sprite = heart?.components.Sprite;
    const id = sprite?.assetId;
    const img = typeof id === 'string' ? images(id) : null;
    const src = img?.source as { naturalWidth?: number; width?: number; naturalHeight?: number; height?: number } | undefined;
    const artW = img?.grid ? img.grid.cellWidth : (src?.naturalWidth || Number(src?.width) || 0);
    const artH = img?.grid ? img.grid.cellHeight : (src?.naturalHeight || Number(src?.height) || 0);
    if (heart && sprite && artW && artH) {
      // The Heart object as it is in the level: its size there, each picture pixel the level's pixel size.
      const w = onGrid(artW, (Number(sprite.width) || artW) * v.levelScale, cell);
      const h = (w / artW) * artH;
      for (let i = 0; i < n; i++) {
        ctx.globalAlpha = i < hud.health.current ? 1 : 0.3;
        const x = margin + i * (w + cell);
        drawEntities(ctx, [{ ...heart, transform: { position: { x: x + w / 2, y: y + h / 2 }, rotation: 0, scale: { x: 1, y: 1 } }, components: { ...heart.components, Sprite: { ...sprite, width: w, height: h, visible: true } } }], images, 0, clock);
      }
      ctx.globalAlpha = 1;
      y += h + 2 * cell;
    } else {
      // No Heart picture: hearts in the pixel font.
      const scale = Math.max(words, 2 * cell);
      for (let i = 0; i < n; i++) pixelLabel(ctx, '♥', margin + i * PIXEL_FONT_ADVANCE * scale, y, 0, 0, scale, i < hud.health.current ? '#ff4d6d' : 'rgba(255,255,255,0.3)', cell);
      y += 6 * scale;
    }
  }
  for (const [item, count] of hud.items) {
    const label = pixelLabel(ctx, count > 1 ? `${item} ×${count}` : item, margin, y, 0, 0, words, '#ffffff', cell);
    y += label.h + 2 * cell;
  }
  if (hud.message) panel(ctx, hud.message, v.width / 2, v.height * 0.25, words, '#ffffff', v);
  if (hud.banner) panel(ctx, hud.banner, v.width / 2, v.height * 0.42, Math.max(2 * cell, pixelFontScale(26 * v.cssPx, cell)), '#ffe08f', v);
  ctx.restore();
}
