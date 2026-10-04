/**
 * Wheel input: trackpads and mice send the same `wheel` event, but people
 * expect different things from them.
 *
 * - Trackpad two-finger scroll: pan.
 * - Trackpad pinch: zoom (browsers report it as a wheel event with ctrlKey).
 * - Alt (or Cmd/Ctrl) + scroll: zoom, on any device.
 * - Classic mouse wheel: zoom.
 *
 * A mouse wheel is recognized by coarse, purely vertical, whole-number steps
 * (or line/page delta modes). Trackpads send fine-grained deltas, often with
 * some horizontal movement. Once a trackpad gesture is seen, the following
 * events (momentum, fast flicks with large deltas) keep panning.
 */
export type WheelIntent = { kind: 'zoom'; factor: number } | { kind: 'pan'; dx: number; dy: number };

export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  timeStamp: number;
}

const LINE = 16;
const PAGE = 800;
const TRACKPAD_STICKY_MS = 400;
const MOUSE_STEP_MIN = 40;

export function createWheelInterpreter() {
  let lastTrackpad = -Infinity;
  return (e: WheelLike): WheelIntent => {
    const unit = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? PAGE : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;

    if (e.ctrlKey) return { kind: 'zoom', factor: Math.exp(-dy * 0.01) }; // pinch (or Ctrl+wheel)
    if (e.altKey || e.metaKey) return { kind: 'zoom', factor: Math.exp(-(dy || dx) * 0.004) };

    const fineGrained = e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < MOUSE_STEP_MIN);
    if (fineGrained || e.timeStamp - lastTrackpad < TRACKPAD_STICKY_MS) {
      lastTrackpad = e.timeStamp;
      return { kind: 'pan', dx, dy };
    }
    if (e.shiftKey) return { kind: 'pan', dx: dy, dy: 0 }; // Shift + mouse wheel scrolls sideways
    return { kind: 'zoom', factor: Math.exp(-dy * 0.0015) };
  };
}
