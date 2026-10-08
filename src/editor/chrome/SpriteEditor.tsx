import { useEffect, useMemo, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { createAnimatedPixelArtAsset, MAX_FRAMES } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { suggestedGrid } from '../../core/model/pixelArt';
import {
  addColor,
  addFrame,
  blankDraft,
  clearRect,
  copyRect,
  flipRect,
  inRect,
  moveRect,
  rectBetween,
  stamp,
  type PixelRect,
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

type Tool = 'pencil' | 'eraser' | 'fill' | 'pick' | 'select';

const icon = (d: string, extra?: React.ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
    {extra}
  </svg>
);

const TOOLS: { tool: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { tool: 'pencil', label: 'Pencil', key: 'P', icon: icon('M3 15l1-4 8.5-8.5a1.4 1.4 0 0 1 2 0l1 1a1.4 1.4 0 0 1 0 2L7 14l-4 1zM11 5l2 2') },
  { tool: 'eraser', label: 'Eraser', key: 'E', icon: icon('M7 15h8M3.5 11.5l7-7a1.4 1.4 0 0 1 2 0l2 2a1.4 1.4 0 0 1 0 2L9 14.5H6l-2.5-2.5a.7.7 0 0 1 0-.5zM7 8l3.5 3.5') },
  { tool: 'fill', label: 'Fill', key: 'F', icon: icon('M3 9l6-6 6 6-6 6-6-6zM3 9h12', <path d="M15.5 12.5c.8 1.2 1 2 .6 2.6a.9.9 0 0 1-1.4 0c-.4-.6-.2-1.4.8-2.6z" fill="currentColor" stroke="none" />) },
  { tool: 'pick', label: 'Pick color (or hold Alt)', key: 'I', icon: icon('M10.5 4.5l3 3M4 14l6.5-6.5M12 3l1.6-1.6a1.4 1.4 0 0 1 2 2L14 5l-.5.5-3-3L12 3zM4 14l-1 1') },
  { tool: 'select', label: 'Select (drag to select, drag inside to move)', key: 'S', icon: icon('M3 3h2M7 3h2M11 3h2M15 3v2M15 7v2M15 11v2M15 15h-2M11 15H9M7 15H5M3 15v-2M3 11V9M3 7V5') },
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
      // (The first frame's timestamp can be a moment before `start`.)
      const i = Math.floor((Math.max(0, now - start) / 1000) * d.fps) % d.frames.length;
      const g = c.getContext('2d')!;
      g.clearRect(0, 0, c.width, c.height);
      paint(g, d, d.frames[i], scale);
      c.dataset.frame = String(i + 1);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  // Its size from the start (a canvas is 300×150 until told otherwise).
  const scale = Math.max(1, Math.floor(72 / Math.max(draft.width, draft.height)));
  return <canvas ref={ref} width={draft.width * scale} height={draft.height * scale} className="se-preview" data-testid="se-preview" aria-label="Preview" />;
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
  const [frame, setFrameState] = useState(0);
  // The frame being drawn, also between renders (a click right after "Duplicate frame" draws on the new one).
  const frameRef = useRef(0);
  const setFrame = (i: number) => {
    frameRef.current = i;
    setFrameState(i);
  };
  const [tool, setToolState] = useState<Tool>('pencil');
  // The selected rectangle (Select tool); it stays when switching frames, to copy from one and paste into another.
  const [sel, setSelState] = useState<PixelRect | null>(null);
  const selRef = useRef<PixelRect | null>(null);
  const setSel = (r: PixelRect | null) => {
    selRef.current = r;
    setSelState(r);
  };
  const setTool = (next: Tool) => {
    setToolState(next);
    if (next !== 'select') setSel(null);
  };
  // Held Alt: the color picker, just until it is let go.
  const [alt, setAlt] = useState(false);
  const clipboard = useRef<string[] | null>(null);
  // A selection being dragged out, or moved (from the drawing as it was when the drag began).
  const drag = useRef<{ mode: 'new'; from: { x: number; y: number } } | { mode: 'move'; from: { x: number; y: number }; base: SpriteDraft; rect: PixelRect; at: { x: number; y: number } } | null>(null);
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
    // Alt alone would also move the browser's focus to its menu: kept in the editor.
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        setAlt(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') {
        e.preventDefault();
        setAlt(false);
      }
    };
    const blur = () => setAlt(false);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
    };
  }, []);
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
    if (sel) {
      // The selection: a dashed outline, dark and light so it shows on any color.
      const box = [sel.x * zoom + 0.5, sel.y * zoom + 0.5, sel.w * zoom - 1, sel.h * zoom - 1] as const;
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeStyle = '#000';
      g.strokeRect(...box);
      g.lineDashOffset = 4;
      g.strokeStyle = '#fff';
      g.strokeRect(...box);
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }
    c.dataset.pixels = draft.frames[frame].join('/');
    c.dataset.selection = sel ? `${sel.x},${sel.y},${sel.w},${sel.h}` : '';
  }, [draft, frame, zoom, onion, sel]);

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
    const cur = latest.current;
    if (!past.length || !cur) return;
    const prev = past[past.length - 1];
    setFuture((f) => [cur, ...f]);
    latest.current = prev;
    setDraft(prev);
    setPast((p) => p.slice(0, -1));
  };
  const redo = () => {
    const cur = latest.current;
    if (!future.length || !cur) return;
    const next = future[0];
    setPast((p) => [...p, cur]);
    latest.current = next;
    setDraft(next);
    setFuture((f) => f.slice(1));
  };
  /** Shows a drawing without an undo step (while dragging; the step is made when the drag began). */
  const preview = (d: SpriteDraft) => {
    latest.current = d;
    setDraft(d);
  };

  // Selection commands (also on the keyboard).
  const copySel = () => {
    const r = selRef.current;
    if (r && latest.current) clipboard.current = copyRect(latest.current, frameRef.current, r);
  };
  const deleteSel = () => {
    const r = selRef.current;
    if (r) change((d) => clearRect(d, frameRef.current, r));
  };
  const paste = () => {
    const rows = clipboard.current;
    const d = latest.current;
    if (!rows || !d) return;
    // Where the selection is (or the top left), as a new selection that can be dragged into place.
    const at = selRef.current ?? { x: 0, y: 0 };
    change((cur) => stamp(cur, frameRef.current, rows, at.x, at.y));
    setToolState('select');
    setSel(rectBetween(d, { x: at.x, y: at.y }, { x: at.x + rows[0].length - 1, y: at.y + rows.length - 1 }));
  };
  const nudge = (dx: number, dy: number) => {
    const r = selRef.current;
    if (!r) return;
    change((d) => moveRect(d, frameRef.current, r, dx, dy));
    setSel({ ...r, x: r.x + dx, y: r.y + dy });
  };
  const flipSel = (axis: 'x' | 'y') => {
    const r = selRef.current;
    if (r) change((d) => flipRect(d, frameRef.current, r, axis));
  };

  const pixelAt = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: Math.floor(((e.clientX - r.left) / r.width) * draft!.width), y: Math.floor(((e.clientY - r.top) / r.height) * draft!.height) };
  };
  const down = (e: React.PointerEvent) => {
    const draft = latest.current;
    const frame = frameRef.current;
    if (!draft) return;
    e.preventDefault();
    const { x, y } = pixelAt(e);
    // Holding Alt picks colors, whatever the tool.
    const using: Tool = e.altKey || alt ? 'pick' : tool;
    if (using === 'select' && e.button === 0) {
      (e.target as Element).setPointerCapture(e.pointerId);
      const r = selRef.current;
      if (r && inRect(r, x, y)) {
        // Moving the selected pixels: one undo step for the whole drag.
        setPast((p) => [...p.slice(-99), draft]);
        setFuture([]);
        drag.current = { mode: 'move', from: { x, y }, base: draft, rect: r, at: { x: r.x, y: r.y } };
      } else {
        drag.current = { mode: 'new', from: { x, y } };
        setSel(rectBetween(draft, { x, y }, { x, y }));
      }
      return;
    }
    // Right button erases, whatever the tool.
    const key = e.button === 2 || using === 'eraser' ? '.' : color;
    if (using === 'pick' && e.button !== 2) {
      const k = draft.frames[frame][y]?.[x];
      if (k && k !== '.') setColor(k);
      return;
    }
    if (using === 'fill' && e.button !== 2) {
      change((d) => fill(d, frame, x, y, key));
      return;
    }
    (e.target as Element).setPointerCapture(e.pointerId);
    stroke.current = { x, y, key };
    change((d) => setPixel(d, frame, x, y, key));
  };
  const move = (e: React.PointerEvent) => {
    const g = drag.current;
    if (g && latest.current) {
      const { x, y } = pixelAt(e);
      if (g.mode === 'new') setSel(rectBetween(latest.current, g.from, { x, y }));
      else {
        const dx = x - g.from.x;
        const dy = y - g.from.y;
        preview(moveRect(g.base, frameRef.current, g.rect, dx, dy));
        setSel({ ...g.rect, x: g.rect.x + dx, y: g.rect.y + dy });
      }
      return;
    }
    const s = stroke.current;
    const cur = latest.current;
    const frame = frameRef.current;
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
    drag.current = null;
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
    // The selection: copy, cut, paste, select all, delete, nudge, deselect.
    if (mod && e.key.toLowerCase() === 'c') return (e.preventDefault(), copySel());
    if (mod && e.key.toLowerCase() === 'x') return (e.preventDefault(), copySel(), deleteSel());
    if (mod && e.key.toLowerCase() === 'v') return (e.preventDefault(), paste());
    if (mod && e.key.toLowerCase() === 'a' && latest.current) {
      e.preventDefault();
      setToolState('select');
      return setSel({ x: 0, y: 0, w: latest.current.width, h: latest.current.height });
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selRef.current) return (e.preventDefault(), deleteSel());
    const arrows: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[e.key] && selRef.current) return (e.preventDefault(), nudge(...arrows[e.key]));
    if (e.key === 'Escape') return setSel(null);
    const t = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
    if (t && !mod && !e.altKey) setTool(t.tool);
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
              <div className="se-toolbar" role="toolbar" aria-label="Tools" aria-orientation="vertical">
                {TOOLS.map((t) => {
                  // While Alt is held the picker is the tool in use (the chosen one comes back on release).
                  const on = alt ? t.tool === 'pick' : tool === t.tool;
                  return (
                    <button key={t.tool} className={`se-tool${on ? ' on' : ''}${alt && t.tool === 'pick' ? ' held' : ''}`} data-testid={`se-tool-${t.tool}`} aria-pressed={on} aria-label={t.label} title={`${t.label} (${t.key})`} onClick={() => setTool(t.tool)}>
                      {t.icon}
                    </button>
                  );
                })}
              </div>
              <div className="se-canvas-col">
                <div className="se-canvas-wrap">
                  <canvas
                    ref={canvasRef}
                    className="se-canvas"
                    data-testid="se-canvas"
                    data-tool={alt ? 'pick' : tool}
                    onPointerDown={down}
                    onPointerMove={move}
                    onPointerUp={up}
                    onPointerCancel={up}
                    style={{ cursor: alt || tool === 'pick' ? 'copy' : tool === 'select' ? (sel ? 'move' : 'cell') : 'crosshair' }}
                  />
                </div>
                {tool === 'select' && (
                  <div className="se-sel-bar" data-testid="se-selection-bar">
                    {sel ? (
                      <>
                        <span className="muted small">
                          {sel.w}×{sel.h} selected · drag inside to move, arrows nudge
                        </span>
                        <button className="chip-btn" onClick={() => flipSel('x')} data-testid="se-flip-x" title="Mirror left to right">
                          Flip ↔
                        </button>
                        <button className="chip-btn" onClick={() => flipSel('y')} data-testid="se-flip-y" title="Mirror top to bottom">
                          Flip ↕
                        </button>
                        <button className="chip-btn" onClick={copySel} data-testid="se-copy" title="Copy (Ctrl+C)">
                          Copy
                        </button>
                        <button className="chip-btn" onClick={deleteSel} data-testid="se-delete-sel" title="Delete (Del)">
                          Delete
                        </button>
                      </>
                    ) : (
                      <span className="muted small">Drag over the picture to select part of it (Ctrl+A: all).</span>
                    )}
                    <button className="chip-btn" onClick={paste} disabled={!clipboard.current} data-testid="se-paste" title="Paste (Ctrl+V), also into another frame">
                      Paste
                    </button>
                  </div>
                )}
              </div>
              <div className="se-side">
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
                <p className="muted small">Left button draws, right button erases, hold Alt to pick a color. Stretched to {spriteSize.x}×{spriteSize.y} in the game.</p>
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
                <button className="chip-btn" data-testid="se-duplicate-frame" disabled={draft.frames.length >= MAX_FRAMES} onClick={() => (change((d) => addFrame(d, frameRef.current, true)), setFrame(frameRef.current + 1))} title="A copy of this frame after it, to change a little">
                  Duplicate frame
                </button>
                <button className="chip-btn" data-testid="se-empty-frame" disabled={draft.frames.length >= MAX_FRAMES} onClick={() => (change((d) => addFrame(d, frameRef.current, false)), setFrame(frameRef.current + 1))}>
                  Empty frame
                </button>
                <button className="chip-btn" disabled={frame === 0} onClick={() => (change((d) => moveFrame(d, frameRef.current, -1)), setFrame(Math.max(0, frameRef.current - 1)))} aria-label="Move frame earlier">
                  ◀
                </button>
                <button className="chip-btn" disabled={frame === draft.frames.length - 1} onClick={() => (change((d) => moveFrame(d, frameRef.current, 1)), setFrame(Math.min(latest.current!.frames.length - 1, frameRef.current + 1)))} aria-label="Move frame later">
                  ▶
                </button>
                <button className="chip-btn" data-testid="se-delete-frame" disabled={draft.frames.length <= 1} onClick={() => (change((d) => removeFrame(d, frameRef.current)), setFrame(Math.max(0, frameRef.current - 1)))}>
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
