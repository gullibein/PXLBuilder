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
