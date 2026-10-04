import { useRef } from 'react';
import { createImageAsset } from '../../core/model/factory';
import { addAsset, setBackground, setWorldSettings } from '../../core/model/mutations';
import { PromptBox } from '../prompt/PromptBox';
import { getActiveScene, useEditor } from '../store';

const SWATCHES = [
  { name: 'Day sky', color: '#8ecdf2' },
  { name: 'Sunset', color: '#f6a46b' },
  { name: 'Dusk', color: '#6b5b95' },
  { name: 'Night', color: '#1b1f3b' },
  { name: 'Forest', color: '#2f5d3a' },
  { name: 'Cave', color: '#3a3330' },
  { name: 'Snow', color: '#e8f1f8' },
  { name: 'Black', color: '#000000' },
];

const MAX_SIDE = 2048;

/** Reads an image file; very large images are scaled down so the project stays light. */
async function readImage(file: File): Promise<{ data: string; width: number; height: number; ext: string }> {
  const data = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const img = new Image();
  img.src = data;
  await img.decode();
  const ext = file.type === 'image/jpeg' ? 'jpg' : file.type.split('/')[1]?.replace('svg+xml', 'svg') || 'png';
  const big = Math.max(img.naturalWidth, img.naturalHeight);
  if (big <= MAX_SIDE || ext === 'svg') return { data, width: img.naturalWidth, height: img.naturalHeight, ext };
  const k = MAX_SIDE / big;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * k);
  canvas.height = Math.round(img.naturalHeight * k);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  const jpeg = ext === 'jpg';
  return { data: canvas.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9), width: canvas.width, height: canvas.height, ext: jpeg ? 'jpg' : 'png' };
}

/**
 * The level background: color, image, how the image fits and moves, and a
 * prompt for anything else ("make the background move with the level").
 */
export function BackgroundPanel() {
  const open = useEditor((s) => s.backgroundOpen);
  const scene = useEditor(getActiveScene);
  const asset = useEditor((s) => s.project.assets.find((a) => a.id === getActiveScene(s).world.background.imageAssetId));
  const fileRef = useRef<HTMLInputElement>(null);
  if (!open) return null;
  const { edit, setBackgroundOpen, logMessage } = useEditor.getState();
  const sid = scene.id;
  const bg = scene.world.background;

  const upload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      logMessage('error', `${file.name} is not an image`);
      return;
    }
    try {
      const img = await readImage(file);
      const asset = createImageAsset(file.name.replace(/\.[^.]+$/, ''), img.data, img.width, img.height, img.ext);
      edit('Set background image', (p) => {
        addAsset(p, asset);
        setBackground(p, sid, { imageAssetId: asset.id });
      });
    } catch (e) {
      logMessage('error', `Could not read ${file.name}: ${(e as Error).message}`);
    }
  };

  return (
    <section className="background-panel" data-testid="background-panel" aria-label="Background">
      <header className="bg-head">
        <span>
          <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
            <rect x="2.2" y="3.2" width="13.6" height="11.6" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
            <path d="m3 13 4-4.2 3 3 1.8-1.8L15 13.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
          Background
        </span>
        <button className="icon-btn" aria-label="Close background" onClick={() => setBackgroundOpen(false)}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="bg-section">
        <span className="bg-label">Color</span>
        <div className="swatches" role="radiogroup" aria-label="Background color">
          {SWATCHES.map((s) => (
            <button
              key={s.color}
              role="radio"
              aria-checked={scene.world.backgroundColor.toLowerCase() === s.color}
              title={s.name}
              aria-label={s.name}
              className="swatch-btn"
              style={{ background: s.color }}
              onClick={() => edit('Set background color', (p) => setWorldSettings(p, sid, { backgroundColor: s.color }))}
            />
          ))}
          <label className="swatch-btn custom" title="Pick any color">
            <input
              type="color"
              aria-label="Custom background color"
              data-testid="bg-color"
              value={/^#[0-9a-f]{6}$/i.test(scene.world.backgroundColor) ? scene.world.backgroundColor : '#000000'}
              onChange={(e) => edit('Set background color', (p) => setWorldSettings(p, sid, { backgroundColor: e.target.value }), { coalesceKey: `${sid}.background` })}
            />
          </label>
        </div>
      </div>

      <div className="bg-section">
        <span className="bg-label">Image</span>
        {asset ? (
          <div className="bg-image">
            <img src={asset.data} alt="" />
            <div className="bg-image-meta">
              <span className="grow">{asset.name}</span>
              <span className="muted">
                {asset.width}×{asset.height}
              </span>
            </div>
            <div className="bg-image-actions">
              <button className="chip-btn" onClick={() => fileRef.current?.click()}>
                Replace
              </button>
              <button className="chip-btn" data-testid="bg-remove" onClick={() => edit('Remove background image', (p) => setBackground(p, sid, { imageAssetId: null }))}>
                Remove
              </button>
            </div>
          </div>
        ) : (
          <button className="upload" data-testid="bg-upload" onClick={() => fileRef.current?.click()}>
            Upload an image…
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          data-testid="bg-file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
        />
      </div>

      {asset && (
        <div className="bg-section">
          <span className="bg-label">Fit</span>
          <div className="segmented" role="radiogroup" aria-label="Image fit">
            {(
              [
                ['cover', 'Fill'],
                ['tile', 'Repeat'],
              ] as const
            ).map(([fit, label]) => (
              <button key={fit} role="radio" aria-checked={bg.fit === fit} className={bg.fit === fit ? 'on' : ''} onClick={() => edit('Set background fit', (p) => setBackground(p, sid, { fit }))}>
                {label}
              </button>
            ))}
          </div>
          <label className="bg-label" htmlFor="bg-parallax">
            Moves with the level <span className="muted">{Math.round(bg.parallax * 100)}%</span>
          </label>
          <input
            id="bg-parallax"
            type="range"
            min={0}
            max={100}
            value={Math.round(bg.parallax * 100)}
            data-testid="bg-parallax"
            onChange={(e) => edit('Set background movement', (p) => setBackground(p, sid, { parallax: Number(e.target.value) / 100 }), { coalesceKey: `${sid}.parallax` })}
          />
          <span className="bg-hint">0% stays put on screen · 100% scrolls with the level</span>
        </div>
      )}

      <div className="bg-prompt">
        <PromptBox key={sid} ctx={{ kind: 'background', sceneId: sid }} placeholder="Describe the background…" testId="background-prompt" onEscape={() => setBackgroundOpen(false)} />
      </div>
    </section>
  );
}
