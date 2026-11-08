/**
 * Checks an AI answer's drawings of isometric blocks before it is applied (sent back once with the problem, as other
 * checks are): a block drawn flat (a square seen from above, not a block seen at an angle), and an auto-tiled block
 * restyled without its shapes (its turns or corners left in the old style).
 */
import type { Operation } from '../commands/operations';
import { looksFlat } from '../model/isoBlockArt';
import { isoShapesOf } from '../model/isoShapes';
import { normalizePixelArt } from '../model/pixelArt';
import type { Project } from '../types';

export function isoDrawingProblem(project: Project, operations: Operation[]): string | null {
  const flat: string[] = [];
  const restyled = new Map<string, Set<string>>();
  const shapesDrawn = new Map<string, Set<string>>();
  for (const op of operations) {
    if (op.op !== 'draw_sprite' || op.target !== 'definition') continue;
    const def = project.definitions.find((d) => d.id === op.id);
    const sprite = def?.components.Sprite;
    if (!def || !sprite || (sprite.isoLook !== 'iso_floor' && sprite.isoLook !== 'iso_block')) continue;
    const shape = op.isoShape ?? null;
    if (looksFlat(normalizePixelArt({ palette: op.palette, rows: op.rows }))) flat.push(shape ? `${def.name}'s ${shape}` : def.name);
    if (shape) {
      if (!shapesDrawn.has(def.id)) shapesDrawn.set(def.id, new Set());
      shapesDrawn.get(def.id)!.add(shape);
    } else if (!op.situation && isoShapesOf(sprite.isoAuto).length) restyled.set(def.id, new Set());
  }
  const missing: string[] = [];
  for (const id of restyled.keys()) {
    const def = project.definitions.find((d) => d.id === id)!;
    const left = isoShapesOf(def.components.Sprite.isoAuto)
      .map((s) => s.key)
      .filter((k) => !shapesDrawn.get(id)?.has(k));
    if (left.length) missing.push(`${def.name} (${left.join(', ')})`);
  }
  const out: string[] = [];
  if (flat.length)
    out.push(
      `${flat.join(', ')} ${flat.length === 1 ? 'was' : 'were'} drawn flat, as a square seen from above, but ${flat.length === 1 ? 'it is an isometric block' : 'they are isometric blocks'}: a block seen at an angle, its diamond top (as wide as the picture, half as high) and its two shaded sides below, every corner of the picture empty ("."). Start from each block's own pixels (look.sprite.pixelArt / look.isoShapes, or ask need_code "look:<object id>") and keep that shape exactly, changing only colors, texture and details`,
    );
  if (missing.length)
    out.push(
      `the restyled auto-tiled block${missing.length === 1 ? '' : 's'} ${missing.join('; ')} kept ${missing.length === 1 ? 'its' : 'their'} old shapes, so the turns and corners no longer match: redraw each of those shapes too, with draw_sprite isoShape, each from its own pixels, in the new style`,
    );
  return out.length ? out.join('; also, ') : null;
}

/** Words of a request that asks for a sprite size ("8x8", "16×16 sprites", "chunkier pixels", "more detailed sprites"). */
const SIZE_WORDS = /\b(8|16|32|64)\s*[x×*]\s*(8|16|32|64)\b|sprite\s*size|pixel\s*size|resolution|chunk(y|ier)|8.?bit|16.?bit|bigger pixels|smaller pixels|more detail|less detail|lower.?res|higher.?res|hi.?res|low.?res/i;

/**
 * The sprite size changed (set_sprite_resolution) when the request didn't ask for one: the user chose it (the New
 * game window, the ⋯ menu), so it is sent back. Null when it is fine.
 */
export function spriteSizeProblem(project: Project, request: string, operations: Operation[]): string | null {
  const now = project.settings.spriteResolution ?? 32;
  const op = operations.find((o) => o.op === 'set_sprite_resolution' && (o as { resolution?: number }).resolution !== now);
  if (!op || SIZE_WORDS.test(request)) return null;
  const to = (op as { resolution?: number }).resolution;
  return `it changes the sprite size to ${to}×${to}, but the user chose ${now}×${now} sprites and did not ask for another size: leave set_sprite_resolution out and draw every sprite at ${now}×${now} (each target's spriteGrid)`;
}
