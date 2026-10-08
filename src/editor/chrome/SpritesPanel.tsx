import { useEffect, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { createImageAsset } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { cellCount, cellRect, detectGrid, validateGrid } from '../../core/model/spriteGrid';
import type { AssetRecord, ObjectDefinition, SpriteGrid } from '../../core/types';
import { whenImageReady } from '../images';
import { baseName, readImageFile } from '../imageFiles';
import { SpriteImage } from '../SpriteImage';
import { useEditor } from '../store';

/**
 * Sprites for one object: the images it can be drawn with. Import a single
 * image, or a sprite sheet that is cut into numbered cells (detected
 * automatically, adjustable by hand). Whatever is chosen is stretched to the
 * object's sprite size.
 */
export function SpritesPanel() {
  const defId = useEditor((s) => s.spritesFor);
  const def = useEditor((s) => s.project.definitions.find((d) => d.id === s.spritesFor));
  const assets = useEditor((s) => s.project.assets);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const sheetInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setSheetId(null);
    setError(null);
  }, [defId]);
  if (!def) return null;

  const { edit, openSprites } = useEditor.getState();
  const active = def.components.Sprite;
  const listed = m.getDefinitionSprites(def);
  // The picture in use is always shown, also when it was never added to the list (built-in objects' drawings).
  const current = typeof active?.assetId === 'string' ? { assetId: active.assetId, frame: typeof active.frame === 'number' ? active.frame : 1 } : null;
  const refs = current && !listed.some((r) => r.assetId === current.assetId && r.frame === current.frame) ? [current, ...listed] : listed;
  const isActive = (assetId: string, frame: number) => active?.assetId === assetId && (assets.find((a) => a.id === assetId)?.kind !== 'spritesheet' || active?.frame === frame);
  const sheet = assets.find((a) => a.id === sheetId && a.kind === 'spritesheet');
  const boxColor = typeof active?.color === 'string' && /^#[0-9a-f]{6}$/i.test(active.color) ? active.color : '#888888';

  const importImage = async (file: File) => {
    setError(null);
    try {
      const img = await readImageFile(file);
      const asset = createImageAsset(baseName(file.name), img.data, img.width, img.height, img.ext);
      edit(`Add sprite to ${def.name}`, (p) => {
        m.addAsset(p, asset);
        m.useDefinitionSprite(p, def.id, { assetId: asset.id, frame: 1 }, componentRegistry);
      });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const importSheet = async (file: File) => {
    setError(null);
    try {
      const img = await readImageFile(file);
      const asset = createImageAsset(baseName(file.name), img.data, img.width, img.height, img.ext);
      const grid = detectGrid(img.pixels());
      const ok = edit(`Import sprite sheet ${asset.name}`, (p) => {
        m.addAsset(p, asset);
        m.setAssetGrid(p, asset.id, grid);
      });
      if (ok) setSheetId(asset.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="sprites-panel" data-testid="sprites-panel" aria-label={`Sprites for ${def.name}`}>
      <header className="bg-head">
        <span>
          Sprites <span className="muted">· {def.name}</span>
        </span>
        <button className="icon-btn" aria-label="Close sprites" onClick={() => openSprites(null)}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="sprite-list" data-testid="sprite-list">
        <button
          className={`sprite-choice${!active?.assetId ? ' on' : ''}`}
          title="Show this object as a plain colored box instead of a picture (choose the color below)"
          data-testid="sprite-plain-box"
          onClick={() =>
            edit(`Use a plain box for ${def.name}`, (p) => {
              // Keep the picture in the list, so it can be chosen again.
              if (current && p.assets.some((a) => a.id === current.assetId)) m.addDefinitionSprite(p, def.id, current);
              m.setDefinitionComponentField(p, def.id, 'Sprite', 'assetId', null, componentRegistry);
            })
          }
          disabled={!active}
        >
          <span className="color-chip" style={{ background: boxColor }} />
          <span className="sprite-cap">Plain box</span>
        </button>
        {refs.map((r) => {
          const asset = assets.find((a) => a.id === r.assetId);
          if (!asset) return null;
          const on = isActive(r.assetId, r.frame);
          return (
            <div key={`${r.assetId}#${r.frame}`} className={`sprite-choice${on ? ' on' : ''}`}>
              <button className="sprite-use" title={on ? 'In use' : 'Use this sprite'} onClick={() => edit(`Use sprite for ${def.name}`, (p) => m.useDefinitionSprite(p, def.id, r, componentRegistry))}>
                <SpriteImage asset={asset} frame={r.frame} size={44} />
                <span className="sprite-cap">{asset.kind === 'spritesheet' ? `${asset.name} #${r.frame}` : asset.name}</span>
              </button>
              <button
                className="sprite-remove"
                aria-label="Remove from this object's sprites"
                onClick={() =>
                  edit(`Remove sprite from ${def.name}`, (p) => {
                    m.removeDefinitionSprite(p, def.id, r);
                    if (on) m.setDefinitionComponentField(p, def.id, 'Sprite', 'assetId', null, componentRegistry);
                  })
                }
              >
                ×
              </button>
              {asset.kind === 'spritesheet' && (
                <button className="sprite-sheet-link" onClick={() => setSheetId(asset.id)}>
                  Sheet
                </button>
              )}
            </div>
          );
        })}
      </div>

      {active && (
        <label className="box-color-row">
          <input
            type="color"
            aria-label="Box color"
            data-testid="sprite-box-color"
            value={boxColor}
            onChange={(e) => edit(`Set ${def.name} box color`, (p) => m.setDefinitionComponentField(p, def.id, 'Sprite', 'color', e.target.value, componentRegistry), { coalesceKey: `${def.id}.boxColor` })}
          />
          <span>
            Box color <span className="muted">{active.assetId ? '(used when Plain box is chosen)' : ''}</span>
          </span>
        </label>
      )}

      <div className="sprite-actions">
        <button className="upload" data-testid="import-image" onClick={() => imageInput.current?.click()}>
          Import image
        </button>
        <button className="upload" data-testid="import-sheet" onClick={() => sheetInput.current?.click()}>
          Import sprite sheet
        </button>
        <input ref={imageInput} type="file" accept="image/*" hidden data-testid="sprite-image-file" onChange={(e) => (e.target.files?.[0] && void importImage(e.target.files[0]), (e.target.value = ''))} />
        <input ref={sheetInput} type="file" accept="image/*" hidden data-testid="sprite-sheet-file" onChange={(e) => (e.target.files?.[0] && void importSheet(e.target.files[0]), (e.target.value = ''))} />
      </div>
      <p className="bg-hint">Sprites stretch to the object's size ({String(active?.width ?? 32)}×{String(active?.height ?? 32)}). Change it in the Inspector.</p>
      {error && <p className="form-error">{error}</p>}

      {sheet && <SheetEditor key={sheet.id} sheet={sheet} def={def} isActive={isActive} />}
    </section>
  );
}

const GRID_FIELDS: [keyof SpriteGrid, string][] = [
  ['columns', 'Columns'],
  ['rows', 'Rows'],
  ['cellWidth', 'Cell width'],
  ['cellHeight', 'Cell height'],
  ['offsetX', 'Offset X'],
  ['offsetY', 'Offset Y'],
  ['spacingX', 'Spacing X'],
  ['spacingY', 'Spacing Y'],
];

/** A sprite sheet with its numbered grid. Click a cell to use it; adjust the grid if detection got it wrong. */
function SheetEditor({ sheet, def, isActive }: { sheet: AssetRecord; def: ObjectDefinition; isActive: (assetId: string, frame: number) => boolean }) {
  const grid = sheet.grid!;
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(GRID_FIELDS.map(([k]) => [k, String(grid[k])])));
  useEffect(() => setDraft(Object.fromEntries(GRID_FIELDS.map(([k]) => [k, String(grid[k])]))), [grid]);
  const { edit } = useEditor.getState();
  const candidate = Object.fromEntries(GRID_FIELDS.map(([k]) => [k, Number(draft[k])])) as unknown as SpriteGrid;
  const problems = validateGrid(candidate, sheet.width, sheet.height);

  const commit = (next: SpriteGrid) => {
    if (!validateGrid(next, sheet.width, sheet.height).length) edit(`Adjust sprite grid of ${sheet.name}`, (p) => m.setAssetGrid(p, sheet.id, next), { coalesceKey: `grid:${sheet.id}` });
  };
  const detect = () => {
    whenImageReady(sheet.id, sheet.data, (source) => {
      const c = document.createElement('canvas');
      c.width = sheet.width;
      c.height = sheet.height;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(source, 0, 0);
      commit(detectGrid(g.getImageData(0, 0, sheet.width, sheet.height)));
    });
  };

  // Display scale: fit ~500px wide, whole-number zoom for small pixel art.
  const fit = 500 / sheet.width;
  const scale = fit >= 1 ? Math.max(1, Math.floor(Math.min(fit, 360 / sheet.height))) : Math.min(fit, 360 / sheet.height);
  const shown = problems.length ? grid : candidate;

  return (
    <div className="sheet-editor" data-testid="sheet-editor">
      <div className="sheet-head">
        <strong>{sheet.name}</strong>
        <span className="muted">
          {sheet.width}×{sheet.height} · {cellCount(shown)} sprites
        </span>
        <button className="chip-btn" data-testid="detect-grid" onClick={detect}>
          Detect grid
        </button>
      </div>
      <div className="sheet-view" style={{ width: sheet.width * scale, height: sheet.height * scale }}>
        <img src={sheet.data} alt={sheet.name} style={{ width: sheet.width * scale, height: sheet.height * scale }} />
        {Array.from({ length: cellCount(shown) }, (_, i) => {
          const r = cellRect(shown, i + 1);
          const on = isActive(sheet.id, i + 1);
          return (
            <button
              key={i}
              className={`sheet-cell${on ? ' on' : ''}`}
              data-testid={`cell-${i + 1}`}
              title={`Use sprite #${i + 1} for ${def.name}`}
              style={{ left: r.x * scale, top: r.y * scale, width: r.w * scale, height: r.h * scale }}
              onClick={() => edit(`Use sprite #${i + 1} for ${def.name}`, (p) => m.useDefinitionSprite(p, def.id, { assetId: sheet.id, frame: i + 1 }, componentRegistry))}
            >
              <span>{i + 1}</span>
            </button>
          );
        })}
      </div>
      <div className="grid-fields">
        {GRID_FIELDS.map(([k, label]) => (
          <label key={k}>
            <span>{label}</span>
            <input
              type="number"
              min={k === 'columns' || k === 'rows' ? 1 : 0}
              value={draft[k]}
              data-testid={`grid-${k}`}
              onChange={(e) => {
                const next = { ...draft, [k]: e.target.value };
                setDraft(next);
                commit(Object.fromEntries(GRID_FIELDS.map(([f]) => [f, Number(next[f])])) as unknown as SpriteGrid);
              }}
            />
          </label>
        ))}
      </div>
      {problems.length > 0 && <p className="form-error">The grid doesn't fit: {problems[0]}.</p>}
    </div>
  );
}
