import { componentRegistry } from '../../core/components/builtin';
import { CAMERA_HELP, ZOOM_RANGE, type CameraSettings } from '../../core/model/camera';
import { setCameraFollow, setCameraSettings, setEntityComponentField, setPlayPixels } from '../../core/model/mutations';
import { resolveEntity } from '../../core/model/resolve';
import type { Id } from '../../core/types';
import { NumberInput, Vec2Input } from '../panels/FieldEditor';
import { getActiveScene, useEditor } from '../store';

/** Play resolutions offered (pixels tall), besides the editor's setting and full sharpness. */
const RESOLUTIONS = [128, 180, 240, 270, 360, 400, 480, 720];

/**
 * The level's camera, opened by clicking the camera outline on the level:
 * what it follows and how softly, zoom, look-ahead, dead zone, limits, where
 * a still camera looks, and the game's play resolution. Every change is one
 * Undo step (a slider drag is one step).
 */
export function CameraPanel() {
  const outline = useEditor((s) => s.cameraOutline);
  const scene = useEditor(getActiveScene);
  const project = useEditor((s) => s.project);
  const editorPixels = useEditor((s) => s.layout.playPixels);
  if (!outline) return null;
  const { edit, setWorldContext } = useEditor.getState();
  const sid = scene.id;
  const c = scene.camera;
  const set = (label: string, patch: Partial<CameraSettings>, key?: string) => edit(label, (p) => setCameraSettings(p, sid, patch), key ? { coalesceKey: `${sid}.camera.${key}` } : undefined);

  const resolved = scene.entities.map((e) => ({ e, r: resolveEntity(project, e, componentRegistry) }));
  const followed = resolved.find((x) => x.r.components.CameraTarget) ?? null;
  const ease = Number(followed?.r.components.CameraTarget?.followStrength ?? 0.15);
  // What it can follow: things with a name of their own first (Player, Board…), then the many of a kind by place.
  const counts = new Map<string, number>();
  for (const { e } of resolved) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const label = (e: (typeof scene.entities)[number]) => ((counts.get(e.name) ?? 0) > 1 ? `${e.name} at ${Math.round(e.transform.position.x)}, ${Math.round(e.transform.position.y)}` : e.name);
  const options = [...resolved].sort((a, b) => Number((counts.get(a.e.name) ?? 0) > 1) - Number((counts.get(b.e.name) ?? 0) > 1) || a.e.name.localeCompare(b.e.name));
  const follow = (id: Id | null) => {
    const name = id ? scene.entities.find((e) => e.id === id)?.name : null;
    edit(name ? `Camera follows ${name}` : 'Still camera', (p) => setCameraFollow(p, sid, id, componentRegistry));
  };

  const gamePixels = project.settings.playPixels;
  const resolutionValue = gamePixels === undefined ? 'editor' : String(gamePixels);
  const resolutions = [...new Set([...RESOLUTIONS, ...(gamePixels ? [gamePixels] : [])])].sort((a, b) => a - b);

  return (
    <section className="background-panel camera-panel" data-testid="camera-panel" aria-label="Camera">
      <header className="bg-head">
        <span>
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="1.8" y="4.5" width="10.5" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="m12.3 8 3.9-2.2v6.4L12.3 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          Camera <span className="muted">· {scene.name}</span>
        </span>
        <button className="icon-btn" aria-label="Close camera" data-testid="camera-panel-close" onClick={() => setWorldContext(false)}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="cam-grid">
        <label htmlFor="cam-follow" title="What the camera follows during play (it gets a Camera Target). Nothing: the camera stays still.">
          Follows
        </label>
        <select id="cam-follow" data-testid="camera-follow" value={followed?.e.id ?? ''} onChange={(e) => follow(e.target.value || null)}>
          <option value="">Nothing (still camera)</option>
          {options.map(({ e }) => (
            <option key={e.id} value={e.id}>
              {label(e)}
            </option>
          ))}
        </select>

        {followed && (
          <>
            <label htmlFor="cam-ease" title="How quickly the camera catches up: low = soft and slow, 1 = sticks to it exactly.">
              Ease
            </label>
            <span className="cam-slider">
              <input
                id="cam-ease"
                type="range"
                min={0.05}
                max={1}
                step={0.05}
                value={ease}
                data-testid="camera-ease"
                onChange={(e) =>
                  edit('Camera ease', (p) => setEntityComponentField(p, sid, followed.e.id, 'CameraTarget', 'followStrength', Number(e.target.value), componentRegistry), {
                    coalesceKey: `${sid}.camera.ease`,
                  })
                }
              />
              <span className="muted">{ease.toFixed(2)}</span>
            </span>
          </>
        )}

        <label htmlFor="cam-zoom" title={CAMERA_HELP.zoom}>
          Zoom
        </label>
        <span className="cam-slider">
          <input id="cam-zoom" type="range" min={ZOOM_RANGE.min} max={ZOOM_RANGE.max} step={0.05} value={c.zoom} data-testid="camera-zoom-slider" onChange={(e) => set('Camera zoom', { zoom: Number(e.target.value) }, 'zoom')} />
          <NumberInput value={c.zoom} step={0.05} testId="camera-panel-zoom" onCommit={(zoom) => set('Camera zoom', { zoom })} />
        </span>

        {followed && (
          <>
            <label title={CAMERA_HELP.lookAhead}>Look ahead</label>
            <NumberInput value={c.lookAhead} step={16} testId="camera-panel-lookahead" onCommit={(lookAhead) => set('Camera look-ahead', { lookAhead })} />
            <label title={CAMERA_HELP.deadZone}>Dead zone</label>
            <Vec2Input value={c.deadZone} step={8} testId="camera-panel-deadzone" onCommit={(deadZone) => set('Camera dead zone', { deadZone })} />
          </>
        )}

        {!followed && (
          <>
            <label title={CAMERA_HELP.fixedAt}>Looks at</label>
            {c.fixedAt ? (
              <span className="cam-fixed">
                <Vec2Input value={c.fixedAt} step={16} testId="camera-panel-fixed" onCommit={(fixedAt) => set('Camera position', { fixedAt })} />
                <button className="link small" onClick={() => set('Camera position', { fixedAt: null })}>
                  middle
                </button>
              </span>
            ) : (
              <button className="link small cam-left" data-testid="camera-panel-fixed-set" onClick={() => set('Camera position', { fixedAt: { x: 0, y: 0 } })}>
                the middle of the level · set a point
              </button>
            )}
          </>
        )}

        <label htmlFor="cam-limits" title={CAMERA_HELP.bounds}>
          Limits
        </label>
        <select
          id="cam-limits"
          value={c.bounds}
          data-testid="camera-panel-bounds"
          onChange={(e) => {
            const bounds = e.target.value as CameraSettings['bounds'];
            set('Camera limits', bounds === 'custom' && !c.customBounds ? { bounds, customBounds: { minX: -480, minY: -320, maxX: 480, maxY: 320 } } : { bounds });
          }}
        >
          <option value="none">None (goes anywhere)</option>
          <option value="level">Inside the level</option>
          <option value="custom">A custom area</option>
        </select>
        {c.bounds === 'custom' && c.customBounds && (
          <>
            <label>From</label>
            <Vec2Input value={{ x: c.customBounds.minX, y: c.customBounds.minY }} step={32} onCommit={(v) => set('Camera limits', { customBounds: { ...c.customBounds!, minX: v.x, minY: v.y } })} />
            <label>To</label>
            <Vec2Input value={{ x: c.customBounds.maxX, y: c.customBounds.maxY }} step={32} onCommit={(v) => set('Camera limits', { customBounds: { ...c.customBounds!, maxX: v.x, maxY: v.y } })} />
          </>
        )}

        <label htmlFor="cam-res" title="How many pixels tall the game is drawn when played, scaled up with hard edges (lower = chunkier pixels and faster). For the whole game: Play here and exported games.">
          Resolution
        </label>
        <select
          id="cam-res"
          value={resolutionValue}
          data-testid="camera-resolution"
          onChange={(e) => {
            const v = e.target.value;
            edit('Play resolution', (p) => setPlayPixels(p, v === 'editor' ? null : Number(v)));
          }}
        >
          <option value="editor">Not set ({editorPixels ? `${editorPixels} px` : 'sharp'} in Play)</option>
          <option value="0">Sharp (the screen's own pixels)</option>
          {resolutions.map((n) => (
            <option key={n} value={String(n)}>
              {n} pixels tall
            </option>
          ))}
        </select>
      </div>
      <p className="cam-note muted">Resolution is for the whole game (Play and exports; not set: exports are sharp); the rest is this level. Double-click the outline to ask the AI instead.</p>
    </section>
  );
}
