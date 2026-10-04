/**
 * Positions the contextual prompt next to its anchor (the selection's screen
 * bounds) so it is never clipped: above by default, below near the top edge,
 * beside the object near the left/right edges.
 */
export interface ScreenRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type PromptSide = 'top' | 'bottom' | 'left' | 'right';

export interface Placement {
  x: number;
  y: number;
  side: PromptSide;
  /** Connector line from the prompt to the anchor, in the same coordinates. */
  connector: { x1: number; y1: number; x2: number; y2: number };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, hi < lo ? lo : v));

export function placePrompt(
  anchor: ScreenRect,
  size: { w: number; h: number },
  view: { w: number; h: number },
  opts: { margin?: number; gap?: number; insetTop?: number; insetBottom?: number } = {},
): Placement {
  const margin = opts.margin ?? 12;
  const gap = opts.gap ?? 26;
  const top = (opts.insetTop ?? 0) + margin;
  const bottom = view.h - (opts.insetBottom ?? 0) - margin;
  const cx = (anchor.minX + anchor.maxX) / 2;
  const cy = (anchor.minY + anchor.maxY) / 2;

  const fits: Record<PromptSide, boolean> = {
    top: anchor.minY - gap - size.h >= top,
    bottom: anchor.maxY + gap + size.h <= bottom,
    right: anchor.maxX + gap + size.w <= view.w - margin,
    left: anchor.minX - gap - size.w >= margin,
  };
  const nearLeft = cx - size.w / 2 < margin;
  const nearRight = cx + size.w / 2 > view.w - margin;
  const order: PromptSide[] = nearLeft
    ? ['right', 'top', 'bottom', 'left']
    : nearRight
      ? ['left', 'top', 'bottom', 'right']
      : ['top', 'bottom', 'right', 'left'];
  const side = order.find((s) => fits[s]) ?? 'top';

  let x: number;
  let y: number;
  if (side === 'top' || side === 'bottom') {
    x = clamp(cx - size.w / 2, margin, view.w - size.w - margin);
    y = side === 'top' ? anchor.minY - gap - size.h : anchor.maxY + gap;
  } else {
    x = side === 'right' ? anchor.maxX + gap : anchor.minX - gap - size.w;
    y = cy - size.h / 2;
  }
  // Never clipped, even when nothing fits (e.g. the object fills the view).
  x = clamp(x, margin, view.w - size.w - margin);
  y = clamp(y, top, bottom - size.h);

  let connector: Placement['connector'];
  if (side === 'top' || side === 'bottom') {
    const lx = clamp(cx, x + 18, x + size.w - 18);
    connector = side === 'top' ? { x1: lx, y1: y + size.h, x2: lx, y2: anchor.minY - 6 } : { x1: lx, y1: y, x2: lx, y2: anchor.maxY + 6 };
  } else {
    const ly = clamp(cy, y + 14, y + size.h - 14);
    connector = side === 'right' ? { x1: x, y1: ly, x2: anchor.maxX + 6, y2: ly } : { x1: x + size.w, y1: ly, x2: anchor.minX - 6, y2: ly };
  }
  return { x, y, side, connector };
}
