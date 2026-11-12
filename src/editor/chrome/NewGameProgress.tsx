import { useEffect, useRef, useState } from 'react';
import type { AssetRecord, Project } from '../../core/types';
import { stopJob, useJobs } from '../ai/jobs';
import { SpriteImage } from '../SpriteImage';
import { LevelSketchView } from './LevelSketchView';
import { normalizePixelArt, pixelArtToSvg } from '../../core/model/pixelArt';
import { useEditor } from '../store';

/** Seconds each picture is shown while the game is being built. */
const SHOW_EACH = 2;
/** Seconds each line under it is shown: the steps so far and a tip, by turns. */
const LINE_EACH = 6;

/** Tips for the wait: true of the editor, a line each. */
export const BUILD_TIPS = [
  'Click anything in the level and ask the AI about just that one.',
  'Ctrl+K asks the AI about the whole level or the whole game.',
  'The ♪ at the top makes sound effects, music and instruments.',
  'Undo (Ctrl+Z) takes back anything the AI did, one step at a time.',
  'Every rule in the game is a script: open an object\'s Details to read or change it.',
  'Paste or drop a picture into a prompt to show the AI what you mean.',
  'Pick an object in Objects, then draw it into the level with the pen.',
  'The Camera panel can fit the screen exactly to the level\'s height or width.',
  'The sprite size can be changed any time, in the ⋯ menu.',
  'Right-click an object in Objects to ask the AI about it or redraw its sprite.',
  'AI History shows each request, what was sent and what the AI answered.',
  'Sounds at the bottom opens the sound editor: draw a sound note by note.',
];

/** A drawing the AI sent (palette and rows), as a picture to show. */
function svgOf(d: { palette: { key: string; color: string }[]; rows: string[] }): string {
  try {
    return `data:image/svg+xml;utf8,${encodeURIComponent(pixelArtToSvg(normalizePixelArt({ palette: d.palette, rows: d.rows })))}`;
  } catch {
    return '';
  }
}

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
 * another: the sprites the AI has finished drawing, each shown as soon as it is done (read from its answer while it
 * is still being written), or with the engine's sprites the starting objects it builds from.
 * When it is done, the pictures the AI drew are shown together before the editor opens; then the Whole game card
 * shows what was built (or what went wrong, with Retry).
 */
export function NewGameProgress() {
  const job = useJobs((s) => Object.values(s.jobs).find((j) => j.again?.options.newGame && j.phase === 'working') ?? null);
  const project = useEditor((s) => s.project);
  const [now, setNow] = useState(Date.now());
  const shown = useRef<string | null>(null);
  const [drawn, setDrawn] = useState<{ name: string; asset: AssetRecord }[] | null>(null);
  // The app's own steps so far (what it really did: planning, reading a guide, moving to a starter, fixing…).
  const [steps, setSteps] = useState<string[]>([]);
  const tipStart = useRef(Math.floor(Math.random() * BUILD_TIPS.length));
  // When each of the AI's drawings came (a new one is shown at once, then they take turns).
  const arrived = useRef(new Map<string, number>());
  const stepsFor = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    // (Before its first stage it is only starting: not a step of its own.)
    const now = job.stage;
    if (stepsFor.current !== job.key) {
      // The first step: the request as the app sent it.
      stepsFor.current = job.key;
      const o = job.again?.options;
      const res = useEditor.getState().project.settings.spriteResolution ?? 32;
      const pics = o?.images?.length ?? 0;
      const sent = `Sent your request: ${res}×${res} sprites, ${o?.sprites === 'engine' ? "the engine's sprites" : 'drawn by the AI'}${pics ? `, ${pics} picture${pics === 1 ? '' : 's'}` : ''}`;
      setSteps(now ? [sent, now] : [sent]);
    } else if (now) setSteps((s) => (s.at(-1) === now ? s : [...s, now]));
  }, [job?.key, job?.stage]);
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
    // (Per job, not per update: updates come many times a second while the answer is written.)
  }, [job?.key]);
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
  // What is shown: with the engine's sprites, the game's own pieces; else ONLY the sprites the AI has finished (from
  // the answers back so far: none while it plans the first one).
  const engine = job.again?.options.sprites === 'engine' && !pictures.length;
  const pieces: { key: string; name: string; asset?: AssetRecord; svg?: string }[] = engine
    ? objectPictures(project).map((p) => ({ key: p.asset.id, name: p.name, asset: p.asset }))
    : (job.drawings ?? []).map((d) => ({ key: `ai:${d.name}`, name: d.name, svg: svgOf(d) }));
  for (const p of pieces) if (!arrived.current.has(p.key)) arrived.current.set(p.key, Date.now());
  const newest = pieces.reduce<(typeof pieces)[number] | null>((a, p) => (!a || (arrived.current.get(p.key) ?? 0) > (arrived.current.get(a.key) ?? 0) ? p : a), null);
  const fresh = !engine && newest && now - (arrived.current.get(newest.key) ?? 0) < SHOW_EACH * 1000 ? newest : null;
  const piece = fresh ?? (pieces.length ? pieces[Math.floor(seconds / SHOW_EACH) % pieces.length] : null);
  // Under the picture: a tip, a new one every few seconds.
  const tip = BUILD_TIPS[(tipStart.current + Math.floor(seconds / LINE_EACH)) % BUILD_TIPS.length];
  const narration = job.narration;
  const doing = narration?.doing ?? [];
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
          {/* The AI's idea and plan, as it writes them (before it builds anything). */}
          {(narration?.idea || (narration?.plan.length ?? 0) > 0) && (
            <div className="ngp-idea" data-testid="new-game-idea">
              {narration?.idea && <p>{narration.idea}</p>}
              {(narration?.plan.length ?? 0) > 0 && (
                <ul data-testid="new-game-plan">
                  {narration!.plan.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {/* The level as the AI draws it, row by row (once it has begun the map). */}
          {job.sketch && <LevelSketchView sketch={job.sketch} drawings={job.drawings ?? []} project={project} />}
          {piece ? (
            // (One piece after another; key: each comes in with its own little animation.)
            <figure className="ngp-show" key={piece.key} data-testid="new-game-piece" data-source={engine ? 'engine' : 'ai'}>
              {piece.asset ? <SpriteImage asset={piece.asset} size={72} /> : <img src={piece.svg} alt="" width={72} height={72} />}
              <figcaption>{piece.name}</figcaption>
              {!engine && (
                <span className="muted small" data-testid="new-game-drawn-count">
                  {pieces.length} drawn so far
                </span>
              )}
            </figure>
          ) : (
            <p className="ngp-waiting muted small" data-testid="new-game-no-pieces">
              The AI&apos;s sprites show here as soon as it has drawn them.
            </p>
          )}
          {doing.length > 0 ? (
            // What it is doing, a line per step it has finished writing (the newest last, bold).
            <ol className="ngp-doing" data-testid="new-game-doing">
              {doing.slice(-4).map((line, i, shown) => (
                <li key={`${doing.length - shown.length + i}`} className={i === shown.length - 1 ? 'now' : ''}>
                  {line}
                </li>
              ))}
            </ol>
          ) : (
            <p className="ngp-tip" key={`tip:${tip}`} data-testid="new-game-tip">
              <span className="ngp-tip-label">Tip</span> {tip}
            </p>
          )}
          <div className="prompt-progress" aria-label="Working" />
          {/* At the bottom: the steps done so far, then the one going on now. */}
          <ol className="ngp-steps" data-testid="new-game-steps">
            {(steps.at(-1) === job.stage ? steps.slice(0, -1) : steps).map((st, i) => (
              <li key={i} className="done">
                {st}
              </li>
            ))}
          </ol>
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
