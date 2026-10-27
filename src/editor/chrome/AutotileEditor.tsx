import { useEffect, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { AUTOTILE_COUNT, autotileIndex, autotileLabel, DEFAULT_AUTOTILE_STYLE, pictureEdges, type AutotileStyle } from '../../core/model/autotile';
import * as m from '../../core/model/mutations';
import type { AssetRecord } from '../../core/types';
import { useEditor } from '../store';
import { AutotileSides } from './SpriteEditor';
import { PromptBox } from '../prompt/PromptBox';

type Art = NonNullable<AssetRecord['pixelArt']>;

/** Paints one picture of pixel art at (x, y), each pixel `scale` canvas pixels. */
function paintArt(g: CanvasRenderingContext2D, palette: Art['palette'], rows: string[], x: number, y: number, scale: number): void {
  const colors = new Map(palette.map((p) => [p.key, p.color]));
  rows.forEach((row, py) => {
    for (let px = 0; px < row.length; px++) {
      const c = colors.get(row[px]);
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(x + px * scale, y + py * scale, scale, scale);
    }
  });
}

/** A level to try the tiles on: ground with a step, a floating platform, a single block, a pillar. */
const PREVIEW = ['..............', '..........#...', '...####...#...', '..........#...', '.#........#...', '..............', '#####...######', '##############'];

/**
 * The Autotile editor: makes a grid object (ground, a platform, a wall) draw each tile with the picture that fits
 * the tiles around it. Its 16 pictures (one for each combination of neighbours above, right, below and left) are
 * made from the object's picture in a chosen style, shown in a 4 × 4 overview, and tried on a small level where
 * tiles can be added and removed; each can be redrawn by hand in the sprite editor.
 */
export function AutotileEditor() {
  const id = useEditor((s) => s.autotileEditor);
  if (!id) return null;
  return <AutotileDialog key={id} definitionId={id} />;
}

function AutotileDialog({ definitionId }: { definitionId: string }) {
  const def = useEditor((s) => s.project.definitions.find((d) => d.id === definitionId));
  const project = useEditor((s) => s.project);
  const sheet = useEditor((s) => {
    const ref = s.project.definitions.find((d) => d.id === definitionId)?.components.Sprite?.autotileSheet;
    return typeof ref === 'string' ? s.project.assets.find((a) => a.id === ref) : undefined;
  });
  const [style, setStyle] = useState<AutotileStyle>(DEFAULT_AUTOTILE_STYLE);
  const sceneId = useEditor((s) => s.activeSceneId);
  const [cells, setCells] = useState(() => PREVIEW.map((r) => [...r].map((c) => c === '#')));
  const close = () => useEditor.getState().setAutotileEditor(null);
  if (!def) return null;
  const on = def.components.Sprite?.autotile === true;
  // Edges painted into the object's own picture (grass on top, a dark bottom…).
  const ownArt = typeof def.components.Sprite?.assetId === 'string' ? project.assets.find((a) => a.id === def.components.Sprite!.assetId)?.pixelArt : undefined;
  const found = ownArt ? pictureEdges({ palette: ownArt.palette, rows: ownArt.rows }) : null;
  const ownEdges = found ? (['top', 'bottom', 'left', 'right'] as const).filter((k) => found[k] > 0).join(', ').replace(/, ([^,]*)$/, ' and $1') : '';
  const art = sheet?.pixelArt?.frames?.length === AUTOTILE_COUNT ? sheet.pixelArt : null;
  const make = () =>
    useEditor.getState().edit(`${art ? 'Make the autotile pictures again for' : 'Autotile'} ${def.name}`, (p) => void m.makeAutotile(p, def.id, style, componentRegistry));
  const toggle = (value: boolean) => {
    if (value && !art) make();
    else useEditor.getState().edit(`${value ? 'Autotile' : 'Stop autotiling'} ${def.name}`, (p) => m.setAutotile(p, def.id, value));
  };
  const editPicture = (i: number) => sheet && useEditor.getState().openSpriteEditor({ definitionId: def.id, assetId: sheet.id, frame: i });
  const choice = <K extends keyof AutotileStyle>(key: K, value: AutotileStyle[K], label: string) => (
    <button className={`seg${style[key] === value ? ' on' : ''}`} data-testid={`at-${key}-${String(value)}`} aria-pressed={style[key] === value} onClick={() => setStyle({ ...style, [key]: value })}>
      {label}
    </button>
  );
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section
        className="dialog autotile-editor"
        role="dialog"
        aria-label="Autotile editor"
        data-testid="autotile-editor"
        onKeyDown={(e) => {
          e.stopPropagation();
          // (Esc in the prompt clears it there, not the editor.)
          if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.at-prompt')) close();
        }}
      >
        <header className="bg-head">
          <span>Autotile · {def.name}</span>
          <button className="icon-btn" aria-label="Close" data-testid="autotile-close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="at-body">
          <div className="at-side">
            <label className="at-on">
              <input type="checkbox" checked={on} data-testid="autotile-on" onChange={(e) => toggle(e.target.checked)} />
              <span>Autotile {def.name}</span>
            </label>
            <p className="muted small">Each tile is drawn with the picture that fits the {def.name} tiles around it: ends, edges and corners where nothing is next to it. In the level and in play.</p>
            <div className="at-style">
              <span className="bg-label">Open sides</span>
              <div className="segmented">
                {choice('edge', 'outline', 'Darker edge')}
                {choice('edge', 'none', 'As the tile')}
              </div>
              <span className="bg-label">Open top</span>
              <div className="segmented">
                {choice('top', 'light', 'Lighter')}
                {choice('top', 'grass', 'Grass')}
                {choice('top', 'none', 'As the sides')}
              </div>
              <label className="at-round">
                <input type="checkbox" checked={style.round} data-testid="at-round" onChange={(e) => setStyle({ ...style, round: e.target.checked })} />
                <span>Round the outside corners</span>
              </label>
            </div>
            <button className="chip-btn primary" data-testid="autotile-make" onClick={make} title={art ? 'Make the 16 pictures again in this style (pictures drawn by hand are replaced; Undo brings them back)' : undefined}>
              {art ? 'Make the 16 pictures again' : 'Make the 16 pictures'}
            </button>
            <p className="muted small">Made from {def.name}'s picture (or its color). Click a picture to draw it by hand.</p>
            {ownEdges && (
              <p className="muted small" data-testid="autotile-own-edges">
                {def.name}'s picture has its own {ownEdges} edge: kept where that side is open, and left out (the middle's pattern continued) where a tile is next to it.
              </p>
            )}
            {/* Ask the AI for a kind of tile ("stone bricks", "ice") or a change ("rounder corners", "moss on top"). */}
            <span className="bg-label">Ask the AI</span>
            <div className="at-prompt">
              <PromptBox ctx={{ kind: 'autotile', sceneId, definitionId: def.id }} placeholder={'e.g. "stone bricks", "moss on top"'} testId="autotile-prompt" />
            </div>
          </div>
          <div className="at-main">
            <span className="bg-label">The 16 pictures</span>
            {art ? (
              <div className="at-grid" data-testid="autotile-grid">
                {art.frames!.map((rows, i) => (
                  <button key={i} className="at-cell" data-testid={`autotile-cell-${i}`} title={`A tile ${autotileLabel(i)}: click to draw it`} onClick={() => editPicture(i)}>
                    <ArtCanvas palette={art.palette} rows={rows} size={44} />
                    <AutotileSides index={i} />
                  </button>
                ))}
              </div>
            ) : (
              <p className="muted small at-empty">None yet: choose a style and make them.</p>
            )}
            <span className="bg-label">Try it {art && <span className="muted">click to add or remove tiles</span>}</span>
            <PreviewLevel art={art} cells={cells} onToggle={(x, y) => setCells(cells.map((r, ry) => (ry === y ? r.map((c, rx) => (rx === x ? !c : c)) : r)))} />
          </div>
        </div>
      </section>
    </div>
  );
}

function ArtCanvas({ palette, rows, size }: { palette: Art['palette']; rows: string[]; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const scale = Math.max(1, Math.floor(size / Math.max(rows[0].length, rows.length)));
    c.width = rows[0].length * scale;
    c.height = rows.length * scale;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    paintArt(g, palette, rows, 0, 0, scale);
  }, [palette, rows, size]);
  return <canvas ref={ref} aria-hidden="true" />;
}

/** A small level of tiles drawn with the autotile pictures; a click adds or removes a tile. */
function PreviewLevel({ art, cells, onToggle }: { art: Art | null; cells: boolean[][]; onToggle: (x: number, y: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const tile = 28;
  const rows = cells.length;
  const cols = cells[0].length;
  useEffect(() => {
    const c = ref.current!;
    c.width = cols * tile;
    c.height = rows * tile;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.imageSmoothingEnabled = false;
    const has = (x: number, y: number) => !!cells[y]?.[x];
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        if (!cells[y][x]) continue;
        if (!art) {
          g.fillStyle = '#8a8f9c';
          g.fillRect(x * tile, y * tile, tile, tile);
          continue;
        }
        const i = autotileIndex((dx, dy) => has(x + dx, y + dy));
        const frame = art.frames![i];
        const scale = tile / Math.max(frame[0].length, frame.length);
        paintArt(g, art.palette, frame, x * tile, y * tile, scale);
      }
    c.dataset.tiles = String(cells.flat().filter(Boolean).length);
  }, [art, cells, rows, cols]);
  return (
    <canvas
      ref={ref}
      className="at-preview"
      data-testid="autotile-preview"
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onToggle(Math.floor(((e.clientX - r.left) / r.width) * cols), Math.floor(((e.clientY - r.top) / r.height) * rows));
      }}
    />
  );
}
