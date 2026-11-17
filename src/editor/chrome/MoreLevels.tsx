import { useEffect, useMemo, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { partLevels } from '../../core/generation/playGenerators';
import { winProblems } from '../../core/model/reachability';
import type { Project } from '../../core/types';
import { startJob, stopJob, useJobs, type PromptJob } from '../ai/jobs';
import { useEditor } from '../store';
import { builderFor } from '../../core/levelGen/build';
import { engineMoreLevels } from '../levelBuild';

/** How many levels are offered after a new game. */
const MORE = 2;

/** The request that builds them (Whole game). */
export const MORE_LEVELS_REQUEST = `Build ${MORE} more levels for this game, after the levels it has (context.level.design.forNewLevels), each a little harder than the one before, with the game's objects, and a make_background for each. Leave the existing levels as they are.`;

/**
 * A game made of levels, with fewer than three, that can be won: one where more levels make sense (not a game with
 * random levels, not an endless one with nothing to finish).
 */
export function wantsMoreLevels(project: Project): boolean {
  const templates = partLevels(project);
  // (Levels made at random as it is played: no levels to build.)
  if (templates.size || project.scenes.some((s) => s.generator)) return false;
  const levels = project.scenes.filter((s) => !templates.has(s.id));
  if (!levels.length || levels.length >= 3) return false;
  return levels.every((s) => !winProblems(project, s.id, componentRegistry).some((p) => p.key === 'win-no-goal'));
}

const id = (j: PromptJob) => `${j.key}:${j.started ?? 0}`;

/**
 * After a new game is built: an offer to build two more levels, which the AI then makes while the user plays and
 * edits the first (its progress, a line at a time, in this card; then a way to go to the new levels).
 */
export function MoreLevels() {
  const jobs = useJobs((s) => s.jobs);
  const project = useEditor((s) => s.project);
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  const [now, setNow] = useState(Date.now());
  // Built by the engine (no AI): the first new level, and what was built.
  const [engine, setEngine] = useState<{ first: string; message: string } | null>(null);
  const all = Object.values(jobs);
  const building = all.find((j) => j.again?.options.moreLevels && j.phase === 'working') ?? null;
  const built = all.find((j) => j.again?.options.moreLevels && j.phase === 'done' && !closed.has(id(j))) ?? null;
  const madeGame = all.find((j) => j.again?.options.newGame && j.phase === 'done' && j.outcome?.status === 'applied' && !closed.has(id(j))) ?? null;
  // (Asked once, right after the game is built: whether the game is made of levels is read then.)
  const fits = useMemo(() => (madeGame ? wantsMoreLevels(project) : false), [madeGame ? id(madeGame) : null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!building) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [building?.key, building?.started]); // eslint-disable-line react-hooks/exhaustive-deps
  // (The new game window, while it is up, comes first.)
  const newGameWindow = all.some((j) => j.again?.options.newGame && j.phase === 'working');
  if (newGameWindow) return null;
  const close = (j: PromptJob) => setClosed((s) => new Set(s).add(id(j)));

  if (engine) {
    const first = project.scenes.find((sc) => sc.id === engine.first);
    return (
      <div className="more-levels" data-testid="more-levels-done">
        <span className="ml-title">The new levels are ready</span>
        <span className="muted small ml-line" data-testid="more-levels-line" title={engine.message}>
          Built by the engine, no AI: {engine.message}
        </span>
        {first && (
          <button
            className="btn-primary"
            data-testid="more-levels-go"
            onClick={() => {
              useEditor.getState().setActiveScene(first.id);
              setEngine(null);
            }}
          >
            Go to {first.name}
          </button>
        )}
        <button className="text-btn" data-testid="more-levels-close" onClick={() => setEngine(null)}>
          ×
        </button>
      </div>
    );
  }
  if (building) {
    const seconds = Math.max(0, Math.round((now - (building.started ?? now)) / 1000));
    const line = building.narration?.doing.at(-1) ?? building.narration?.thoughts.at(-1) ?? building.stage ?? 'Starting';
    return (
      <div className="more-levels" data-testid="more-levels-building">
        <span className="ml-title">✦ Building {MORE} more levels…</span>
        <span className="muted small ml-line" data-testid="more-levels-line">
          {line}
        </span>
        <span className="muted small">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')} · keep playing and editing meanwhile
        </span>
        <button className="text-btn" data-testid="more-levels-stop" onClick={() => stopJob(building.key)}>
          Stop
        </button>
      </div>
    );
  }
  if (built) {
    const ok = built.outcome?.status === 'applied';
    const first = ok ? project.scenes.find((s) => built.outcome?.status === 'applied' && built.outcome.result.createdSceneIds.includes(s.id)) : undefined;
    return (
      <div className="more-levels" data-testid="more-levels-done">
        <span className="ml-title">{ok ? 'The new levels are ready' : "The new levels couldn't be built"}</span>
        {!ok && built.outcome && 'message' in built.outcome && <span className="muted small ml-line">{built.outcome.message}</span>}
        {first && (
          <button
            className="btn-primary"
            data-testid="more-levels-go"
            onClick={() => {
              useEditor.getState().setActiveScene(first.id);
              close(built);
            }}
          >
            Go to {first.name}
          </button>
        )}
        {!ok && (
          <button className="btn-primary" data-testid="more-levels-retry" onClick={() => startJob(built.ctx, MORE_LEVELS_REQUEST, { moreLevels: true })}>
            Try again
          </button>
        )}
        <button className="text-btn" data-testid="more-levels-close" onClick={() => close(built)}>
          ×
        </button>
      </div>
    );
  }
  if (madeGame && fits) {
    const byEngine = !!builderFor(project, componentRegistry);
    return (
      <div className="more-levels" data-testid="more-levels-offer">
        <span className="ml-title">Want {MORE} more levels?</span>
        <span className="muted small ml-line">{byEngine ? 'The engine builds them at once (no AI needed), each a step harder.' : 'The AI builds them while you play and edit this one.'}</span>
        <button
          className="btn-primary"
          data-testid="more-levels-yes"
          onClick={() => {
            close(madeGame);
            // The engine builds them when it can (no AI, at once); else, or if it can't build these, the AI.
            const out = byEngine ? engineMoreLevels(MORE) : null;
            if (out?.ok) setEngine({ first: out.sceneIds[0], message: out.message });
            else {
              if (out) useEditor.getState().logMessage('warn', `The engine couldn't build the levels (${out.message}); the AI builds them instead.`);
              startJob(madeGame.ctx, MORE_LEVELS_REQUEST, { moreLevels: true });
            }
          }}
        >
          Build {MORE} more levels
        </button>
        <button className="text-btn" data-testid="more-levels-no" onClick={() => close(madeGame)}>
          No thanks
        </button>
      </div>
    );
  }
  return null;
}
