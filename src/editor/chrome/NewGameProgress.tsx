import { useEffect, useRef, useState } from 'react';
import type { AssetRecord, Project } from '../../core/types';
import { stopJob, useJobs } from '../ai/jobs';
import { SpriteImage } from '../SpriteImage';
import { useEditor } from '../store';

/** Seconds each picture is shown while the game is being built. */
const SHOW_EACH = 2;

/** The game's objects that have a picture: their name and picture (what can be shown while the AI works). */
function objectPictures(project: Project): { name: string; asset: AssetRecord }[] {
  const out: { name: string; asset: AssetRecord }[] = [];
  for (const d of project.definitions) {
    const id = d.components.Sprite?.assetId;
    const asset = typeof id === 'string' ? project.assets.find((a) => a.id === id && (a.kind === 'image' || a.kind === 'spritesheet')) : undefined;
    if (asset && d.components.Sprite?.visible !== false && !out.some((o) => o.asset.id === asset.id)) out.push({ name: d.name, asset });
  }
  return out;
}

/**
 * While the AI builds a game asked for in the New game window: a window of its own (there is nothing to edit yet),
 * with what was asked, what the AI is doing now and how long it has taken, and the game's pieces shown one after
 * another (the starting objects it builds from: the AI's answer, with its drawings, comes all at once at the end).
 * When it is done, the pictures the AI drew are shown together before the editor opens; then the Whole game card
 * shows what was built (or what went wrong, with Retry).
 */
export function NewGameProgress() {
  const job = useJobs((s) => Object.values(s.jobs).find((j) => j.again?.options.newGame && j.phase === 'working') ?? null);
  const project = useEditor((s) => s.project);
  const [now, setNow] = useState(Date.now());
  const shown = useRef<string | null>(null);
  const [drawn, setDrawn] = useState<{ name: string; asset: AssetRecord }[] | null>(null);
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job]);
  const finish = (key: string) => {
    if (useJobs.getState().jobs[key]) useEditor.getState().setGlobalPrompt(true, 'project');
  };
  const doneKey = useRef<string | null>(null);
  useEffect(() => {
    if (job) {
      shown.current = job.key;
    } else if (shown.current) {
      const key = shown.current;
      shown.current = null;
      // Done: what the AI drew, together, before the editor (none drawn, or it failed: straight to the result).
      // (The pictures its answer made: not those of another starter it moved the game to.)
      const outcome = useJobs.getState().jobs[key]?.outcome;
      const made = new Set(outcome?.status === 'applied' ? outcome.result.createdAssetIds : []);
      const fresh = objectPictures(useEditor.getState().project).filter((p) => made.has(p.asset.id));
      if (fresh.length) {
        doneKey.current = key;
        setDrawn(fresh);
      } else finish(key);
    }
  }, [job]);

  if (drawn) {
    const close = () => {
      setDrawn(null);
      if (doneKey.current) finish(doneKey.current);
      doneKey.current = null;
    };
    return (
      <div className="dialog-backdrop">
        <section className="dialog new-game-progress" role="dialog" aria-label="Your game is ready" data-testid="new-game-drawn">
          <header className="bg-head">
            <span>Your game is ready</span>
          </header>
          <div className="ngp-body">
            <p className="muted small">The AI drew these for it:</p>
            <div className="ngp-drawn">
              {drawn.map((p) => (
                <figure key={p.asset.id} className="ngp-piece">
                  <SpriteImage asset={p.asset} size={56} />
                  <figcaption>{p.name}</figcaption>
                </figure>
              ))}
            </div>
          </div>
          <footer className="ngp-foot">
            <button className="btn-primary" data-testid="new-game-open" autoFocus onClick={close}>
              Open the game
            </button>
          </footer>
        </section>
      </div>
    );
  }
  if (!job) return null;
  const seconds = Math.max(0, Math.round((now - (job.started ?? now)) / 1000));
  const pictures = job.again?.options.images ?? [];
  const pieces = objectPictures(project);
  const piece = pieces.length ? pieces[Math.floor(seconds / SHOW_EACH) % pieces.length] : null;
  return (
    <div className="dialog-backdrop">
      <section className="dialog new-game-progress" role="dialog" aria-label="Building your game" data-testid="new-game-progress">
        <header className="bg-head">
          <span>Building your game</span>
        </header>
        <div className="ngp-body">
          {pictures.length > 0 && (
            <div className="ngp-pictures">
              {pictures.map((p, i) => (
                <img key={i} src={`data:${p.mediaType};base64,${p.data}`} alt={p.name} />
              ))}
            </div>
          )}
          <p className="chat-you">{job.again?.asked ?? job.request}</p>
          {piece && (
            // (One piece after another; key: each comes in with its own little animation.)
            <figure className="ngp-show" key={piece.asset.id} data-testid="new-game-piece">
              <SpriteImage asset={piece.asset} size={72} />
              <figcaption>{piece.name}</figcaption>
            </figure>
          )}
          <div className="prompt-progress" aria-label="Working" />
          <p className="ngp-stage" data-testid="new-game-stage">
            {job.stage ?? 'Starting'}…
          </p>
          <p className="muted small">
            {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · A whole game takes the AI one to four minutes: it plans the game, writes its rules and draws its sprites.
          </p>
        </div>
        <footer className="ngp-foot">
          <button className="text-btn" data-testid="new-game-stop" onClick={() => stopJob(job.key)}>
            Stop
          </button>
        </footer>
      </section>
    </div>
  );
}
