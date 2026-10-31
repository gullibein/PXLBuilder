import { useEffect, useRef, useState } from 'react';
import { stopJob, useJobs } from '../ai/jobs';
import { useEditor } from '../store';

/**
 * While the AI builds a game asked for in the New game window: a window of its own (there is nothing to edit yet),
 * with what was asked, what the AI is doing now and how long it has taken. When it is done, the window goes and the
 * Whole game card shows what was built (or what went wrong, with Retry).
 */
export function NewGameProgress() {
  const job = useJobs((s) => Object.values(s.jobs).find((j) => j.again?.options.newGame && j.phase === 'working') ?? null);
  const [now, setNow] = useState(Date.now());
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!job) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [job]);
  // Done: the result is shown on the Whole game card.
  useEffect(() => {
    if (job) shown.current = job.key;
    else if (shown.current) {
      const key = shown.current;
      shown.current = null;
      if (useJobs.getState().jobs[key]) useEditor.getState().setGlobalPrompt(true, 'project');
    }
  }, [job]);
  if (!job) return null;
  const seconds = Math.max(0, Math.round((now - (job.started ?? now)) / 1000));
  const pictures = job.again?.options.images ?? [];
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
