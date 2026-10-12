import { useEffect, useMemo, useRef, useState } from 'react';
import { atlasJson, fileBase, packSheet, sheetAssets, usedAssetIds, type SheetLayout } from '../../core/model/spriteSheet';
import { whenImageReady } from '../images';
import { offerFile, offerTextFile } from '../persistence';
import { useEditor } from '../store';

const SCALES = [1, 2, 4, 8] as const;

/** Draws a packed sheet `scale` times bigger, pixel-sharp (resolves once every picture has loaded). */
export function drawSheet(layout: SheetLayout, scale: number): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = layout.width * scale;
  canvas.height = layout.height * scale;
  const g = canvas.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  return Promise.all(
    layout.items.map(
      (it) =>
        new Promise<void>((resolve) => {
          // A picture that never loads (a broken file) leaves its place empty rather than holding up the rest.
          const timer = setTimeout(resolve, 3000);
          whenImageReady(it.asset.id, it.asset.data, (source) => {
            clearTimeout(timer);
            g.drawImage(source, it.x * scale, it.y * scale, it.asset.width * scale, it.asset.height * scale);
            resolve();
          });
        }),
    ),
  ).then(() => canvas);
}

/**
 * "Export sprites": the game's pictures (or one sprite's) as a sprite sheet: a PNG, and a JSON atlas saying
 * where each picture, sprite-sheet cell and animation frame is (with pixel art as data too).
 */
export function SpriteExport() {
  const target = useEditor((s) => s.spriteExport);
  const projectAssets = useEditor((s) => s.project.assets);
  const projectName = useEditor((s) => s.project.name);
  const [scale, setScale] = useState<number>(4);
  const [status, setStatus] = useState<string | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const project = useEditor((s) => s.project);
  // The game's pictures: by default only those it uses (not the other sizes after a sprite-size change, nor unused imports).
  const [onlyUsed, setOnlyUsed] = useState(true);
  const assets = useMemo(() => {
    if (target?.assets) return sheetAssets(target.assets);
    const used = usedAssetIds(project);
    return sheetAssets(onlyUsed ? projectAssets.filter((a) => used.has(a.id)) : projectAssets);
  }, [target, projectAssets, project, onlyUsed]);
  const layout = useMemo(() => packSheet(assets), [assets]);
  const base = fileBase(target?.name ?? projectName);

  useEffect(() => {
    if (!target) return;
    setStatus(null);
    let gone = false;
    // The preview: the sheet at 1× scaled up on screen (crisp).
    void drawSheet(layout, 1).then((c) => {
      if (gone || !previewRef.current) return;
      c.className = 'export-sheet';
      c.setAttribute('data-testid', 'export-preview');
      previewRef.current.replaceChildren(c);
    });
    return () => {
      gone = true;
    };
  }, [target, layout]);

  if (!target) return null;
  const close = () => useEditor.getState().openSpriteExport(null);
  const pngName = `${base}${scale > 1 ? `@${scale}x` : ''}.png`;
  const savePng = async () => {
    const canvas = await drawSheet(layout, scale);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) return setStatus("The PNG couldn't be made.");
    const r = await offerFile(pngName, blob);
    setStatus(r === 'saved' ? `Saved ${pngName}` : r === 'declined' ? 'Not saved.' : "Couldn't save the PNG.");
  };
  const saveJson = async () => {
    const name = `${base}${scale > 1 ? `@${scale}x` : ''}.json`;
    const r = await offerTextFile(name, JSON.stringify(atlasJson(layout, pngName, scale), null, 2));
    setStatus(r === 'saved' ? `Saved ${name}` : r === 'declined' ? 'Not saved.' : "Couldn't save the JSON.");
  };
  const empty = !assets.length;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog export-dialog" role="dialog" aria-label="Export sprites" data-testid="sprite-export">
        <header className="bg-head">
          <span>
            Export sprites <span className="muted" data-testid="export-count">· {target.assets ? target.name : `${assets.length} pictures`}</span>
          </span>
          <button className="icon-btn" aria-label="Close" data-testid="export-close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {empty ? (
          <p className="muted">There are no pictures to export yet.</p>
        ) : (
          <>
            <div className="export-preview-wrap" ref={previewRef} />
            <div className="se-row">
              <span>Scale</span>
              {SCALES.map((s) => (
                <button key={s} className={`chip-btn${s === scale ? ' on' : ''}`} aria-pressed={s === scale} data-testid={`export-scale-${s}`} onClick={() => setScale(s)}>
                  {s}×
                </button>
              ))}
              <span className="muted small" data-testid="export-size">
                {layout.width * scale}×{layout.height * scale} px
              </span>
            </div>
            {!target.assets && (
              <label className="se-row">
                <input type="checkbox" checked={onlyUsed} data-testid="export-only-used" onChange={(e) => setOnlyUsed(e.target.checked)} /> <span>Only pictures the game uses</span>
              </label>
            )}
            <p className="muted small">
              The PNG is every picture on one sheet (pixel-sharp at any scale). The JSON says where each picture, sprite-sheet cell and animation frame is on it (the usual atlas
              format game engines read), with the pixel-art pictures as data too.
            </p>
            <footer className="se-footer">
              {status && (
                <span className="muted small" data-testid="export-status">
                  {status}
                </span>
              )}
              <span className="grow" />
              <button className="chip-btn" data-testid="export-json" onClick={() => void saveJson()}>
                Save JSON
              </button>
              <button className="primary-btn" data-testid="export-png" onClick={() => void savePng()}>
                Save PNG
              </button>
            </footer>
          </>
        )}
      </section>
    </div>
  );
}
