/**
 * Per-frame channel from the viewport renderer to the contextual prompt: the
 * screen-space bounds of whatever is the current AI context. Bypasses React
 * so the prompt can follow panning, zooming and dragging without re-renders.
 */
import type { ScreenRect } from './placement';

export interface Anchor {
  /** The context (contextKey) these bounds belong to, so a prompt never uses bounds drawn for the previous selection. */
  key: string;
  rect: ScreenRect;
  view: { w: number; h: number };
  /** False when the anchored thing is scrolled out of view. */
  visible: boolean;
}

type Listener = (anchor: Anchor | null) => void;
const listeners = new Set<Listener>();
let current: Anchor | null = null;

function same(a: Anchor | null, b: Anchor | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.key === b.key &&
    a.visible === b.visible &&
    a.view.w === b.view.w &&
    a.view.h === b.view.h &&
    Math.abs(a.rect.minX - b.rect.minX) < 0.5 &&
    Math.abs(a.rect.minY - b.rect.minY) < 0.5 &&
    Math.abs(a.rect.maxX - b.rect.maxX) < 0.5 &&
    Math.abs(a.rect.maxY - b.rect.maxY) < 0.5
  );
}

export function publishAnchor(anchor: Anchor | null): void {
  if (same(anchor, current)) return;
  current = anchor;
  for (const l of listeners) l(anchor);
}

export function subscribeAnchor(listener: Listener): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}
