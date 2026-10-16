/**
 * Wheel input: trackpads and mice send the same `wheel` event, but people
 * expect different things from them.
 *
 * - Trackpad two-finger scroll: pan.
 * - Trackpad pinch: zoom (browsers report it as a wheel event with ctrlKey);
 *   a coarse mouse notch with ctrlKey zooms by the mouse step, not the pinch rate.
 * - Alt (or Cmd/Ctrl) + scroll: zoom, on any device.
 * - Classic mouse wheel: zoom.
 *
 * Mouse wheels zoom by a fixed, moderate step per notch whether or not Alt is
 * held (a notch is a large delta; the trackpad rate would make it a huge jump),
 * and fast spins are capped per event so the view never leaps.
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
/** Zoom per pixel of mouse-wheel delta; one usual notch (100) is about 14%. */
const MOUSE_ZOOM_RATE = 0.0013;
/** Largest delta one mouse event counts for (accelerated or fast-spun wheels send several hundred). */
const MOUSE_DELTA_CAP = 100;
const TRACKPAD_ZOOM_RATE = 0.004;
/** Largest delta one pinch event counts for (about 1.4× at most). */
const PINCH_DELTA_CAP = 35;

/** `speed` scales mouse-wheel zoom (1 = default). */
export function createWheelInterpreter(speed: () => number = () => 1) {
  let lastTrackpad = -Infinity;
  return (e: WheelLike): WheelIntent => {
    const unit = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? PAGE : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;

    // Some browsers report Alt/Shift + wheel on the horizontal axis.
    const d = dy || dx;
    const fineGrained = e.deltaMode === 0 && ((e.deltaX !== 0 && e.deltaY !== 0) || !Number.isInteger(d) || Math.abs(d) < MOUSE_STEP_MIN);
    const mouseZoom = (): WheelIntent => ({ kind: 'zoom', factor: Math.exp(-Math.sign(d) * Math.min(Math.abs(d), MOUSE_DELTA_CAP) * MOUSE_ZOOM_RATE * speed()) });

    if (e.ctrlKey) {
      // A pinch sends many small, fine steps. A mouse notch with Ctrl (or a mouse wheel some apps report with ctrlKey
      // set) is one coarse step of about 100: at the pinch rate that was a 2.7× jump per notch, so it zooms by the
      // mouse step instead.
      if (!fineGrained) return mouseZoom();
      return { kind: 'zoom', factor: Math.exp(-Math.max(-PINCH_DELTA_CAP, Math.min(PINCH_DELTA_CAP, dy)) * 0.01) };
    }

    const trackpad = fineGrained || e.timeStamp - lastTrackpad < TRACKPAD_STICKY_MS;
    if (trackpad) lastTrackpad = e.timeStamp;

    if (e.altKey || e.metaKey) return trackpad ? { kind: 'zoom', factor: Math.exp(-d * TRACKPAD_ZOOM_RATE) } : mouseZoom();
    if (trackpad) return { kind: 'pan', dx, dy };
    if (e.shiftKey) return { kind: 'pan', dx: d, dy: 0 }; // Shift + mouse wheel scrolls sideways
    return mouseZoom();
  };
}
