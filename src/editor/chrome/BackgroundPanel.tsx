import { useEffect, useRef, useState } from 'react';
import { createImageAsset } from '../../core/model/factory';
import { addAsset, setBackground, setWorldSettings } from '../../core/model/mutations';
import { baseName, readImageFile } from '../imageFiles';
import { DEFAULT_IMAGE_WORKER, generateImage, imageWorkerUrl, pixelateTo, setImageWorkerUrl, validWorkerUrl } from '../imageWorker';
import { limitsBox, pictureBox, pixelsFor, placeBackground, rememberOriginal, type PictureSize } from '../background';
import { PromptBox } from '../prompt/PromptBox';
import { getActiveScene, useEditor } from '../store';

const SWATCHES = [
  { name: 'Dark (default)', color: '#1d2330' },
  { name: 'Day sky', color: '#8ecdf2' },
  { name: 'Sunset', color: '#f6a46b' },
  { name: 'Dusk', color: '#6b5b95' },
  { name: 'Night', color: '#1b1f3b' },
  { name: 'Forest', color: '#2f5d3a' },
  { name: 'Cave', color: '#3a3330' },
  { name: 'Snow', color: '#e8f1f8' },
  { name: 'Black', color: '#000000' },
];

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
      const img = await readImageFile(file, { maxSide: 2048 });
      const asset = createImageAsset(baseName(file.name), img.data, img.width, img.height, img.ext);
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

      <GenerateBackground sceneId={sid} />

      {asset && (
        <div className="bg-section">
          <span className="bg-label">Fit</span>
          <div className="segmented" role="radiogroup" aria-label="Image fit" data-testid="bg-fit">
            {(
              [
                ['cover', 'Fill'],
                ['tile', 'Repeat'],
                ['placed', 'Placed'],
              ] as const
            ).map(([fit, label]) => (
              <button
                key={fit}
                role="radio"
                aria-checked={bg.fit === fit}
                className={bg.fit === fit ? 'on' : ''}
                title={fit === 'placed' ? 'One picture at a place in the level: move it and resize it there with the mouse while this card is open' : undefined}
                onClick={() => {
                  if (fit === 'placed' && !bg.rect) void placeBackground(sid, limitsBox(useEditor.getState().project, scene), `${sid}.bg-fit`);
                  else edit('Set background fit', (p) => setBackground(p, sid, { fit }));
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {bg.fit === 'placed' && <span className="bg-hint">Drag it in the level to move it, its corners and sides to resize it.</span>}
          <label className="bg-label" htmlFor="bg-movement">
            Movement
          </label>
          <select
            id="bg-movement"
            data-testid="bg-movement"
            value={bg.parallax >= 1 ? 'level' : bg.parallax <= 0 ? 'screen' : 'depth'}
            onChange={(e) => {
              const parallax = e.target.value === 'level' ? 1 : e.target.value === 'screen' ? 0 : 0.5;
              edit('Set background movement', (p) => setBackground(p, sid, { parallax }));
            }}
          >
            <option value="level">Moves with the level</option>
            <option value="depth">Moves slower (far away)</option>
            <option value="screen">Stays on the screen</option>
          </select>
          {bg.parallax > 0 && bg.parallax < 1 && (
            <>
              <label className="bg-label" htmlFor="bg-parallax">
                How much it moves <span className="muted">{Math.round(bg.parallax * 100)}%</span>
              </label>
              <input
                id="bg-parallax"
                type="range"
                min={1}
                max={99}
                value={Math.round(bg.parallax * 100)}
                data-testid="bg-parallax"
                onChange={(e) => edit('Set background movement', (p) => setBackground(p, sid, { parallax: Number(e.target.value) / 100 }), { coalesceKey: `${sid}.parallax` })}
              />
            </>
          )}
        </div>
      )}

      <div className="bg-prompt">
        <div className="bg-ai" aria-hidden="true" />
        <PromptBox key={sid} ctx={{ kind: 'background', sceneId: sid }} placeholder="Ask the AI" testId="background-prompt" onEscape={() => setBackgroundOpen(false)} />
      </div>
    </section>
  );
}

/** Generate: a picture from the user's own image generator, brought down to the game's pixels and set as the background. */
function GenerateBackground({ sceneId }: { sceneId: string }) {
  const [prompt, setPrompt] = useState('');
  // How big the picture is: the camera limits box (Level), what the camera shows (Screen), or a size of one's own.
  const [sizeMode, setSizeMode] = useState<PictureSize>('level');
  const [size, setSize] = useState(() => {
    const { project } = useEditor.getState();
    const scene = project.scenes.find((x) => x.id === sceneId) ?? project.scenes[0];
    return pixelsFor(project, limitsBox(project, scene));
  });
  const project = useEditor((s) => s.project);
  const sceneNow = project.scenes.find((x) => x.id === sceneId) ?? project.scenes[0];
  const target = pictureBox(project, sceneNow, sizeMode, size);
  const targetKey = `${target.x},${target.y},${target.w},${target.h}`;
  // The box shows in the level while this card is open: where the new picture goes, and how big it is.
  useEffect(() => {
    useEditor.getState().setBackgroundTarget(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);
  useEffect(() => () => useEditor.getState().setBackgroundTarget(null), []);
  const [url, setUrl] = useState(imageWorkerUrl);
  const [settings, setSettings] = useState(false);
  const [state, setState] = useState<{ busy: boolean; message: string | null; error: boolean }>({ busy: false, message: null, error: false });
  const run = async () => {
    const what = prompt.trim();
    if (!what || state.busy) return;
    setState({ busy: true, message: 'Making the picture… (this can take half a minute)', error: false });
    try {
      const { w, h } = target.pixels;
      // Not "pixel art": image generators draw that as big fake pixels, many real pixels each, which come out far too
      // coarse once the picture is brought down to the game's pixels. A finely detailed picture, brought down here,
      // becomes pixel art at the game's own resolution (a small star one or two game pixels).
      const blob = await generateImage(backgroundPrompt(what), { width: w, height: h });
      const { project, edit, logMessage } = useEditor.getState();
      const scene = project.scenes.find((x) => x.id === sceneId) ?? project.scenes[0];
      const img = await pixelateTo(blob, w, h);
      const asset = createImageAsset(what.slice(0, 40), img.data, img.width, img.height, 'png');
      rememberOriginal(asset.id, blob);
      // In the box shown in the level, each picture pixel one game pixel.
      const box = pictureBox(project, scene, sizeMode, size);
      edit('Generate background', (p) => {
        addAsset(p, asset);
        setBackground(p, sceneId, { imageAssetId: asset.id, fit: 'placed', parallax: 1, rect: { x: box.x, y: box.y, w: box.w, h: box.h } });
      });
      logMessage('info', `Background made: "${what}" (${img.width}×${img.height}, the game's own pixels).`);
      setState({ busy: false, message: `Done: ${img.width}×${img.height} pixels. Drag it in the level to move it, its edges to resize it; Undo takes it back.`, error: false });
    } catch (e) {
      setState({ busy: false, message: (e as Error).message, error: true });
    }
  };
  return (
    <div className="bg-section" data-testid="bg-generate">
      <span className="bg-label">
        Image generator
        <button className="link small" data-testid="bg-gen-settings" onClick={() => setSettings(!settings)}>
          {settings ? 'hide settings' : 'settings'}
        </button>
      </span>
      {settings && (
        <div className="bg-gen-settings">
          <label className="small muted" htmlFor="bg-gen-url">
            The image generator&apos;s address (a Cloudflare Worker). PXLBuilder&apos;s own unless you set another; yours is kept in this browser only.
          </label>
          <div className="bg-gen-row">
            <input id="bg-gen-url" type="url" placeholder="https://….workers.dev" value={url} data-testid="bg-gen-url" onChange={(e) => setUrl(e.target.value)} />
            <button className="chip-btn" data-testid="bg-gen-url-default" disabled={url === DEFAULT_IMAGE_WORKER} title="Use PXLBuilder's own image generator" onClick={() => (setUrl(DEFAULT_IMAGE_WORKER), setImageWorkerUrl(''), setSettings(false))}>
              Default
            </button>
            <button
              className="chip-btn"
              data-testid="bg-gen-url-save"
              disabled={!validWorkerUrl(url)}
              onClick={() => {
                setImageWorkerUrl(url);
                setSettings(false);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
      <div className="segmented" role="radiogroup" aria-label="Picture size" data-testid="bg-gen-size-mode">
        {(
          [
            ['level', 'Level', 'The camera limits box'],
            ['screen', 'Screen', 'What the camera shows (the game screen)'],
            ['custom', 'User defined', 'A size of your own, in game pixels'],
          ] as const
        ).map(([mode, label, title]) => (
          <button
            key={mode}
            role="radio"
            aria-checked={sizeMode === mode}
            className={sizeMode === mode ? 'on' : ''}
            title={title}
            data-testid={`bg-gen-size-${mode}`}
            onClick={() => {
              // Your own size starts from the one shown now.
              if (mode === 'custom' && sizeMode !== 'custom') setSize(target.pixels);
              setSizeMode(mode);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="bg-gen-row bg-gen-size">
        {sizeMode === 'custom' ? (
          <>
            <input type="number" min={8} max={2048} value={size.w} aria-label="Width in game pixels" data-testid="bg-gen-w" onChange={(e) => setSize({ ...size, w: Number(e.target.value) })} />
            <span className="small muted">×</span>
            <input type="number" min={8} max={2048} value={size.h} aria-label="Height in game pixels" data-testid="bg-gen-h" onChange={(e) => setSize({ ...size, h: Number(e.target.value) })} />
            <span className="small muted">pixels</span>
          </>
        ) : (
          <span className="small muted" data-testid="bg-gen-size">
            {target.pixels.w} × {target.pixels.h} pixels (the box in the level)
          </span>
        )}
      </div>
      <div className="bg-gen-row">
        <input
          placeholder="Describe the picture…"
          value={prompt}
          aria-label="Describe the background picture"
          data-testid="bg-gen-prompt"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void run()}
        />
        <button className="chip-btn" data-testid="bg-gen-go" disabled={!prompt.trim() || state.busy || !validWorkerUrl(imageWorkerUrl())} onClick={() => void run()}>
          {state.busy ? 'Making…' : 'Generate'}
        </button>
      </div>
      {state.message && (
        <p className={`small ${state.error ? 'warn' : 'muted'}`} data-testid="bg-gen-status">
          {state.message}
        </p>
      )}
    </div>
  );
}

/** What is sent to the image generator for a background described as `what`. */
export function backgroundPrompt(what: string): string {
  return `${what}, video game background scenery, finely detailed digital painting with small crisp details, flat even lighting, no characters, no text`;
}
