/**
 * Prompt cards close when the user clicks (or taps) anywhere outside them, as they do on their ×. Clicks on the
 * button that opens a card ([data-prompt-opener]: it opens and closes it itself) and on what a card opens for
 * itself or work on its result ([data-prompt-keep]: the AI connection dialog, Undo and Redo) don't count.
 */
import { useEffect, useRef, type RefObject } from 'react';

export function useCloseOutside(ref: RefObject<HTMLElement | null>, onClose: (() => void) | undefined): void {
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!close.current || !ref.current || !t || !t.isConnected) return;
      if (ref.current.contains(t) || t.closest?.('[data-prompt-opener], [data-prompt-keep]')) return;
      close.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [ref]);
}
