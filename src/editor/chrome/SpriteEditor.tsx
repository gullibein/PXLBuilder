import { useEffect, useMemo, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { createAnimatedPixelArtAsset, MAX_FRAMES } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { suggestedGrid } from '../../core/model/pixelArt';
import {
  addColor,
  addFrame,
  blankDraft,
  draftFromAsset,
  draftFromPixels,
  drawLine,
  fill,
  moveFrame,
  recolor,
  removeFrame,
  resize,
  setPixel,
  usedPalette,
  type SpriteDraft,
} from '../../core/model/spriteDraft';
import { whenImageReady } from '../images';
import { useEditor } from '../store';

type Tool = 'pencil' | 'eraser' | 'fill' | 'pick';
const TOOLS: { tool: Tool; label: string; key: string }[] = [
  { tool: 'pencil', label: 'Pencil', key: 'P' },
  { tool: 'eraser', label: 'Eraser', key: 'E' },
  { tool: 'fill', label: 'Fill', key: 'F' },
  { tool: 'pick', label: 'Pick color', key: 'I' },
];

/** Draws one frame of a draft: each pixel a `scale`-sized square. */
function paint(g: CanvasRenderingContext2D, d: SpriteDraft, rows: string[], scale: number, alpha = 1): void {
  const colors = new Map(d.palette.map((p) => [p.key, p.color]));
  g.globalAlpha = alpha;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = colors.get(row[x]);
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(x * scale, y * scale, scale, scale);
    }
  });
  g.globalAlpha = 1;
}

function FrameCanvas({ draft, rows, size }: { draft: SpriteDraft; rows: string[]; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = Math.max(1, Math.floor(size / Math.max(draft.width, draft.height)));
  useEffect(() => {
    const c = ref.current!;
    c.width = draft.width * scale;
    c.height = draft.height * scale;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    paint(g, draft, rows, scale);
  }, [draft, rows, scale]);
  return <canvas ref={ref} className="se-thumb" aria-hidden="true" />;
}

/** The animation playing at its speed. */
function Preview({ draft }: { draft: SpriteDraft }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const latest = useRef(draft);
  latest.current = draft;
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const d = latest.current;
      const c = ref.current;
      if (!c) return;
      const scale = Math.max(1, Math.floor(72 / Math.max(d.width, d.height)));
      if (c.width !== d.width * scale || c.height !== d.height * scale) {
        c.width = d.width * scale;
        c.height = d.height * scale;
      }
      const i = Math.floor(((now - start) / 1000) * d.fps) % d.frames.length;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      paint(g, d, d.frames[i], scale);
      c.dataset.frame = String(i + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="se-preview" data-testid="se-preview" aria-label="Preview" />;
}

/**
 * The sprite editor: draws pixel art for an object, as a still picture or an
 * animation (frames that play at a speed). It edits a sprite the object
 * already has (every object using that sprite then shows the new drawing) or
 * draws a new one, used as the object's look or for a situation (while
 * running, jumping…). Saving is one undoable step; the editor has its own
 * Undo for the strokes while drawing.
 */
export function SpriteEditor() {
  const target = useEditor((s) => s.spriteEditor);
  if (!target) return null;
  return <SpriteEditorDialog key={`${target.definitionId}:${target.assetId ?? 'new'}`} definitionId={target.definitionId} assetId={target.assetId} />;
}

function SpriteEditorDialog({ definitionId, assetId }: { definitionId: string; assetId: string | null }) {
  const def = useEditor((s) => s.project.definitions.find((d) => d.id === definitionId));
  const asset = useEditor((s) => (assetId ? s.project.assets.find((a) => a.id === assetId) : undefined));
  const close = () => useEditor.getState().openSpriteEditor(null);
  const spriteSize = { x: Number(def?.components.Sprite?.width) || 32, y: Number(def?.components.Sprite?.height) || 32 };
  const [draft, setDraft] = useState<SpriteDraft | null>(() => {
    if (asset) return draftFromAsset(asset);
    const g = suggestedGrid(spriteSize);
    return blankDraft(g.width, g.height);
  });
  const [error, setError] = useState<string | null>(null);
  const [past, setPast] = useState<SpriteDraft[]>([]);
  const [future, setFuture] = useState<SpriteDraft[]>([]);
  const [frame, setFrame] = useState(0);
  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('a');
  const [onion, setOnion] = useState(true);
  const [name, setName] = useState(asset?.name ?? `${def?.name ?? 'Sprite'} sprite`);
  const [use, setUse] = useState('');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const stroke = useRef<{ x: number; y: number; key: string } | null>(null);
  // The latest drawing, also between renders: two quick clicks must both land on it.
  const latest = useRef(draft);
  latest.current = draft;

  // An imported picture (not pixel art yet): read its pixels.
  useEffect(() => {
    if (draft || !asset) return;
    if (asset.kind === 'spritesheet') {
      setError('Sprite sheets are edited in your drawing program; the sprite editor edits pixel art and single small pictures.');
      return;
    }
    return whenImageReady(asset.id, asset.data, (source, width, height) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(source, 0, 0);
      const d = draftFromPixels(g.getImageData(0, 0, width, height).data, width, height);
      if ('error' in d) setError(`This picture can't be edited here: ${d.error}.`);
      else setDraft(d);
    });
  }, [draft, asset]);

  useEffect(() => dialogRef.current?.focus(), []);
  useEffect(() => {
    if (draft && !draft.palette.some((p) => p.key === color)) setColor(draft.palette[0]?.key ?? '.');
  }, [draft, color]);

  const zoom = draft ? Math.max(4, Math.floor(Math.min(448 / draft.width, 384 / draft.height))) : 8;

  // The canvas: the frame being drawn, the one before it faintly (onion skin), and a pixel grid.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !draft) return;
    c.width = draft.width * zoom;
    c.height = draft.height * zoom;
    const g = c.getContext('2d')!;
    for (let y = 0; y < draft.height; y++) {
      for (let x = 0; x < draft.width; x++) {
        g.fillStyle = (x + y) % 2 ? '#4a4660' : '#55516d';
        g.fillRect(x * zoom, y * zoom, zoom, zoom);
      }
    }
    if (onion && frame > 0) paint(g, draft, draft.frames[frame - 1], zoom, 0.3);
    paint(g, draft, draft.frames[frame], zoom);
    if (zoom >= 6) {
      g.strokeStyle = 'rgba(255,255,255,0.08)';
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 1; x < draft.width; x++) {
        g.moveTo(x * zoom + 0.5, 0);
        g.lineTo(x * zoom + 0.5, c.height);
      }
      for (let y = 1; y < draft.height; y++) {
        g.moveTo(0, y * zoom + 0.5);
        g.lineTo(c.width, y * zoom + 0.5);
      }
      g.stroke();
    }
    c.dataset.pixels = draft.frames[frame].join('/');
  }, [draft, frame, zoom, onion]);

  const situations = useMemo(() => Object.keys(componentRegistry.get('SpriteStates')?.fields ?? {}), []);

  if (!def) return null;

  /** An edit that can be undone in the editor, made on the latest drawing. */
  const change = (edit: SpriteDraft | ((d: SpriteDraft) => SpriteDraft)) => {
    const cur = latest.current;
    if (!cur) return;
    const next = typeof edit === 'function' ? edit(cur) : edit;
    if (next === cur) return;
    setPast((p) => [...p.slice(-99), cur]);
    setFuture([]);
    latest.current = next;
    setDraft(next);
  };
  const undo = () => {
    if (!past.length || !draft) return;
    setFuture((f) => [draft, ...f]);
    setDraft(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    if (!future.length || !draft) return;
    setPast((p) => [...p, draft]);
    setDraft(future[0]);
    setFuture((f) => f.slice(1));
  };

  const pixelAt = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * draft!.width), y: Math.floor(((e.clientY - r.top) / r.height) * draft!.height) };
  };
  const down = (e: React.PointerEvent) => {
    const draft = latest.current;
    if (!draft) return;
    e.preventDefault();
    const { x, y } = pixelAt(e);
    // Right button erases, whatever the tool.
    const key = e.button === 2 || tool === 'eraser' ? '.' : color;
    if (tool === 'pick' && e.button !== 2) {
      const k = draft.frames[frame][y]?.[x];
      if (k && k !== '.') setColor(k);
      return;
    }
    if (tool === 'fill' && e.button !== 2) {
      change((d) => fill(d, frame, x, y, key));
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    stroke.current = { x, y, key };
    change((d) => setPixel(d, frame, x, y, key));
  };
  const move = (e: React.PointerEvent) => {
    const s = stroke.current;
    const cur = latest.current;
    if (!s || !cur) return;
    const { x, y } = pixelAt(e);
    if (x === s.x && y === s.y) return;
    // Part of the same stroke: one undo step for the whole drag.
    const next = drawLine(cur, frame, s.x, s.y, x, y, s.key);
    latest.current = next;
    setDraft(next);
    stroke.current = { ...s, x, y };
  };
  const up = () => {
    stroke.current = null;
  };

  const onKey = (e: React.KeyboardEvent) => {
    // Keys pressed in the editor stay in it (Delete, W, I… would otherwise act on the level behind it).
    e.stopPropagation();
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.stopPropagation();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      e.stopPropagation();
      redo();
      return;
    }
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t && !mod) {
      e.stopPropagation();
      setTool(t.tool);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
    }
  };

  const save = () => {
    if (!draft) return;
    const palette = usedPalette(draft);
    const title = name.trim() || 'Sprite';
    const ok = useEditor.getState().edit(asset ? `Edit sprite ${title}` : `Draw sprite for ${def.name}`, (p) => {
      if (asset) {
        m.updatePixelArtAsset(p, asset.id, palette.length ? palette : draft.palette.slice(0, 1), draft.frames, draft.fps);
        p.assets.find((a) => a.id === asset.id)!.name = title;
        return;
      }
      const made = createAnimatedPixelArtAsset(title, palette.length ? palette : draft.palette.slice(0, 1), draft.frames, draft.fps);
      m.addAsset(p, made);
      if (!use) m.useDefinitionSprite(p, def.id, { assetId: made.id, frame: 1 }, componentRegistry);
      else {
        if (!p.definitions.find((d) => d.id === def.id)!.components.SpriteStates) m.addDefinitionComponent(p, def.id, 'SpriteStates', componentRegistry);
        m.setDefinitionComponentField(p, def.id, 'SpriteStates', use, made.id, componentRegistry);
        m.addDefinitionSprite(p, def.id, { assetId: made.id, frame: 1 });
      }
    });
    if (ok) close();
  };

  const swatch = draft?.palette.find((p) => p.key === color);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && undefined}>
      <section ref={dialogRef} tabIndex={-1} className="dialog sprite-editor" role="dialog" aria-label="Sprite editor" data-testid="sprite-editor" onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
        <header className="bg-head">
          <span>
            {asset ? 'Edit sprite' : 'Draw a sprite'} <span className="muted">· {def.name}</span>
          </span>
          <button className="icon-btn" aria-label="Close without saving" data-testid="se-close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {error && <p className="form-error">{error}</p>}
        {draft && (
          <>
            <div className="se-body">
              <div className="se-side">
                <div className="se-tools" role="toolbar" aria-label="Tools">
                  {TOOLS.map((t) => (
                    <button key={t.tool} className={`chip-btn${tool === t.tool ? ' on' : ''}`} data-testid={`se-tool-${t.tool}`} title={`${t.label} (${t.key})`} onClick={() => setTool(t.tool)}>
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="se-palette" data-testid="se-palette">
                  {draft.palette.map((p) => (
                    <button key={p.key} className={`se-swatch${p.key === color ? ' on' : ''}`} style={{ background: p.color }} title={p.color} data-testid={`se-color-${p.key}`} onClick={() => setColor(p.key)} />
                  ))}
                  <label className="se-add" title="Add a color">
                    +
                    <input
                      type="color"
                      data-testid="se-add-color"
                      onChange={(e) => {
                        const r = addColor(draft, e.target.value);
                        if ('error' in r) return setError(r.error);
                        change(r.draft);
                        setColor(r.key);
                        setTool('pencil');
                      }}
                    />
                  </label>
                </div>
                {swatch && (
                  <label className="se-row">
                    <span>This color</span>
                    <input type="color" value={swatch.color} data-testid="se-recolor" onChange={(e) => change(recolor(draft, swatch.key, e.target.value))} />
                  </label>
                )}
                <label className="se-row">
                  <input type="checkbox" checked={onion} onChange={(e) => setOnion(e.target.checked)} /> <span>Show the frame before</span>
                </label>
                <div className="se-row">
                  <span>Size</span>
                  <input type="number" min={1} max={64} value={draft.width} data-testid="se-width" onChange={(e) => change(resize(draft, Number(e.target.value), draft.height))} />
                  ×
                  <input type="number" min={1} max={64} value={draft.height} data-testid="se-height" onChange={(e) => change(resize(draft, draft.width, Number(e.target.value)))} />
                </div>
                <div className="se-row">
                  <button className="chip-btn" data-testid="se-undo" disabled={!past.length} onClick={undo} title="Undo (Ctrl+Z)">
                    Undo
                  </button>
                  <button className="chip-btn" disabled={!future.length} onClick={redo} title="Redo (Ctrl+Shift+Z)">
                    Redo
                  </button>
                </div>
                <p className="muted small">Left button draws, right button erases. Stretched to {spriteSize.x}×{spriteSize.y} in the game.</p>
              </div>
              <div className="se-canvas-wrap">
                <canvas ref={canvasRef} className="se-canvas" data-testid="se-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} style={{ cursor: tool === 'pick' ? 'copy' : 'crosshair' }} />
              </div>
            </div>
            <div className="se-frames">
              <div className="se-strip" data-testid="se-frames">
                {draft.frames.map((rows, i) => (
                  <button key={i} className={`se-frame${i === frame ? ' on' : ''}`} data-testid={`se-frame-${i + 1}`} onClick={() => setFrame(i)} title={`Frame ${i + 1}`}>
                    <FrameCanvas draft={draft} rows={rows} size={40} />
                    <span>{i + 1}</span>
                  </button>
                ))}
              </div>
              <div className="se-frame-actions">
                <button className="chip-btn" data-testid="se-duplicate-frame" disabled={draft.frames.length >= MAX_FRAMES} onClick={() => (change(addFrame(draft, frame, true)), setFrame(frame + 1))} title="A copy of this frame after it, to change a little">
                  Duplicate frame
                </button>
                <button className="chip-btn" disabled={draft.frames.length >= MAX_FRAMES} onClick={() => (change(addFrame(draft, frame, false)), setFrame(frame + 1))}>
                  Empty frame
                </button>
                <button className="chip-btn" disabled={frame === 0} onClick={() => (change(moveFrame(draft, frame, -1)), setFrame(frame - 1))} aria-label="Move frame earlier">
                  ◀
                </button>
                <button className="chip-btn" disabled={frame === draft.frames.length - 1} onClick={() => (change(moveFrame(draft, frame, 1)), setFrame(frame + 1))} aria-label="Move frame later">
                  ▶
                </button>
                <button className="chip-btn" data-testid="se-delete-frame" disabled={draft.frames.length <= 1} onClick={() => (change(removeFrame(draft, frame)), setFrame(Math.max(0, frame - 1)))}>
                  Delete frame
                </button>
                {draft.frames.length > 1 && (
                  <label className="se-row">
                    <span>Frames per second</span>
                    <input type="number" min={1} max={60} value={draft.fps} data-testid="se-fps" onChange={(e) => change({ ...draft, fps: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
                  </label>
                )}
              </div>
              {draft.frames.length > 1 && <Preview draft={draft} />}
            </div>
            <footer className="se-footer">
              <label className="se-row">
                <span>Name</span>
                <input value={name} data-testid="se-name" onChange={(e) => setName(e.target.value)} />
              </label>
              {!asset && (
                <label className="se-row">
                  <span>Use as</span>
                  <select value={use} data-testid="se-use" onChange={(e) => setUse(e.target.value)}>
                    <option value="">Normal look</option>
                    {situations.map((s) => (
                      <option key={s} value={s}>
                        While: {s}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="grow" />
              <button className="chip-btn" onClick={close}>
                Cancel
              </button>
              <button className="primary-btn" data-testid="se-save" onClick={save}>
                {asset ? 'Save' : 'Save and use'}
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
