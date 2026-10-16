import { useEditor } from '../store';
import { MAX_ZOOM, MIN_ZOOM } from './zoomLimits';

/** The slider counts in doublings, so every part of it zooms by the same ratio (0.1× to 8×, 100% a little right of the middle). */
const toSlider = (zoom: number) => Math.log2(zoom);
const fromSlider = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, 2 ** v));
/** − and + zoom by this much. */
const STEP = 1.25;

/**
 * Zoom for the level (bottom left): − / slider / +, and the zoom in percent
 * (a click on it goes back to 100%). Zooms around the middle of the view.
 */
export function ZoomBar() {
  const zoom = useEditor((s) => s.camera.zoom);
  const set = (z: number) => {
    const { camera, setCamera } = useEditor.getState();
    setCamera({ ...camera, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)) });
  };
  return (
    <div className="zoom-bar" data-testid="zoom-bar">
      <button className="tool" aria-label="Zoom out" title="Zoom out" data-testid="zoom-out" onClick={() => set(zoom / STEP)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8h9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <input
        type="range"
        aria-label="Zoom"
        data-testid="zoom-slider"
        min={toSlider(MIN_ZOOM)}
        max={toSlider(MAX_ZOOM)}
        step={0.01}
        value={toSlider(zoom)}
        onChange={(e) => set(fromSlider(Number(e.target.value)))}
        // Arrow keys on the slider stay with it (not the editor's shortcuts), and the level gets the keys back after a drag.
        onKeyDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => (e.currentTarget as HTMLInputElement).blur()}
      />
      <button className="tool" aria-label="Zoom in" title="Zoom in" data-testid="zoom-in" onClick={() => set(zoom * STEP)}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8h9M8 3.5v9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <button className="zoom-pct" title="Back to 100%" data-testid="zoom-reset" onClick={() => set(1)}>
        {Math.round(zoom * 100)}%
      </button>
    </div>
  );
}
