import { useMemo, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { diagnoseLevel, type Problem } from '../../core/debug/diagnose';
import type { PlayEvent, PlayReport } from '../../core/debug/playReport';
import { eventRegistry } from '../../core/logic/vocabulary';
import type { Id } from '../../core/types';
import { contextKey } from '../../core/ai/context';
import { startJob, useJobs } from '../ai/jobs';
import { getActiveScene, useEditor } from '../store';

/** Problems in the level as set up (errors and warnings; notes are informational). */
export function useLevelProblems(): Problem[] {
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.activeSceneId);
  return useMemo(() => diagnoseLevel(project, sceneId, componentRegistry), [project, sceneId]);
}

/** Sends a question or a fix request to the AI for the level, and shows its card. */
function askLevel(request: string): void {
  const { activeSceneId, setGlobalPrompt } = useEditor.getState();
  startJob({ kind: 'level', sceneId: activeSceneId, point: null }, request);
  setGlobalPrompt(true, 'level');
}

/**
 * The Debug tab: what can't work in this level as set up (with "Fix with
 * AI"), and what happened the last time it was played (with questions to ask
 * the AI about it).
 */
export function DebugPanel() {
  const problems = useLevelProblems();
  const lastPlay = useEditor((s) => s.lastPlay);
  const scene = useEditor(getActiveScene);
  const project = useEditor((s) => s.project);
  const selectEntities = useEditor((s) => s.selectEntities);
  const report = lastPlay && lastPlay.report.sceneId === scene.id ? lastPlay.report : null;
  const show = (ids: Id[]) => {
    const here = ids.filter((id) => scene.entities.some((e) => e.id === id));
    if (here.length) selectEntities(here);
  };

  return (
    <div className="debug" data-testid="debug-panel">
      <section>
        <h4 className="debug-head">Problems in {scene.name}</h4>
        {problems.length === 0 && <p className="muted">Nothing found that can't work as set up.</p>}
        <ul className="problems">
          {problems.map((p) => (
            <li key={p.key} className={`problem ${p.severity}`} data-testid="problem">
              <span className="problem-mark" aria-label={p.severity}>
                {p.severity === 'error' ? '●' : p.severity === 'warning' ? '▲' : 'i'}
              </span>
              <span className="grow">{p.text}</span>
              <span className="problem-actions">
                {p.entityIds.length > 0 && (
                  <button className="text-btn" onClick={() => show(p.entityIds)}>
                    Show
                  </button>
                )}
                {p.severity !== 'note' && <FixButton problem={p} sceneId={scene.id} />}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h4 className="debug-head">
          Last play
          {report && (
            <span className="muted">
              {' '}
              · {Math.round(report.duration)} s{report.restarts ? ` · restarted ${report.restarts}×` : ''}
              {lastPlay!.project !== project ? ' · the game changed since' : ''}
            </span>
          )}
        </h4>
        {report ? <PlayLog report={report} onShow={show} /> : <p className="muted">Play the level (▶) and stop: what happened shows up here, and the AI can explain it.</p>}
      </section>
    </div>
  );
}

/** Questions worth asking about this session. */
function questionsFor(report: PlayReport): string[] {
  const q: string[] = [];
  const any = (pred: (e: PlayEvent) => boolean) => report.events.find(pred);
  if (any((e) => e.type === 'respawned' && e.detail?.reason === 'died')) q.push('Why did the player die?');
  if (any((e) => e.type === 'respawned' && e.detail?.reason === 'fell')) q.push('Why did the player fall out of the level?');
  const locked = any((e) => e.type === 'locked');
  if (locked) q.push(`Why didn't ${locked.subject} open?`);
  const err = report.scriptErrors[0];
  if (err) q.push(`What's wrong with ${err.entity}'s script "${err.script}"?`);
  q.push('Did anything not work as it should?');
  return q;
}

function eventLine(e: PlayEvent): string {
  const phrase = eventRegistry.get(e.type)?.phrase;
  let text = phrase ? phrase.replace('{subject}', e.subject ?? 'something').replace('{other}', e.other ?? 'something') : `${e.type} ${e.subject ?? ''}`;
  if (e.type === 'respawned' && e.detail?.reason) text += ` (${e.detail.reason === 'fell' ? 'fell out of the level' : e.detail.reason})`;
  if (e.type === 'damaged' && typeof e.detail?.health === 'number') text += ` (health ${e.detail.health})`;
  if (e.type === 'locked' && e.detail?.needs) text += ` (needs ${String(e.detail.needs)})`;
  if (e.type === 'script_error' && e.detail?.message) text += `: ${String(e.detail.message)}`;
  if (e.type === 'collected' && e.detail?.item) text += ` (${String(e.detail.item)})`;
  return text;
}

const NOTABLE = new Set(['died', 'damaged', 'respawned', 'locked', 'script_error', 'opened', 'closed', 'collected', 'switch_activated', 'stomped', 'teleported', 'level_started']);

function PlayLog({ report, onShow }: { report: PlayReport; onShow: (ids: Id[]) => void }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => {
    const list = report.events.filter((e) => (all ? e.type !== 'touch_ended' : NOTABLE.has(e.type)));
    return list.slice(-300);
  }, [report, all]);
  const hidden = report.events.length - rows.length;
  return (
    <>
      <div className="ask-row">
        {questionsFor(report).map((q) => (
          <button key={q} className="ask-chip" data-testid="ask-why" onClick={() => askLevel(q)}>
            ✦ {q}
          </button>
        ))}
      </div>
      <ol className="play-log" data-testid="play-log">
        {rows.map((e, i) => (
          <li key={i} className={`play-event ${e.type}`}>
            <button className="history-row" onClick={() => onShow([e.subjectId, e.otherId].filter((x): x is string => !!x))} title="Select what it is about">
              <span className="time">{e.time.toFixed(1)}s</span>
              <span className="grow">{eventLine(e)}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && <li className="muted">Nothing notable happened.</li>}
      </ol>
      <label className="check-row">
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show every event (touches, signals, timers…){!all && hidden > 0 ? ` · ${hidden} more` : ''}
      </label>
    </>
  );
}

/** The request each problem's fix was sent with (so its row can follow that fix). */
const fixRequests = new Map<string, string>();

/**
 * Fix with AI, and what became of it: working, a fix to review, or still
 * there after an applied fix (then "Try again" tells the AI its fix missed).
 * A fixed problem simply disappears from the list.
 */
function FixButton({ problem, sceneId }: { problem: Problem; sceneId: string }) {
  const job = useJobs((s) => s.jobs[contextKey({ kind: 'level', sceneId, point: null })]);
  const sent = fixRequests.get(problem.key);
  const mine = job && sent && job.request === sent ? job : null;
  const fix = (again: boolean) => {
    const request = again
      ? `Fix this problem. Your previous fix did not solve it: the level checker still finds it after the change was applied. Look again at the cause. Problem: ${problem.text}`
      : `Fix this problem: ${problem.text}`;
    fixRequests.set(problem.key, request);
    askLevel(request);
  };
  if (mine?.phase === 'working') {
    return (
      <button className="text-btn ai" data-testid="fix-with-ai" disabled>
        Fixing…
      </button>
    );
  }
  const status = mine?.outcome?.status;
  if (status === 'proposal' || status === 'choice') {
    return (
      <button className="text-btn ai" data-testid="fix-review" onClick={() => useEditor.getState().setGlobalPrompt(true, 'level')}>
        ✦ Review the fix
      </button>
    );
  }
  if (status === 'applied' || sent) {
    // Still listed after a fix was applied (or tried): it didn't solve it.
    return (
      <>
        <span className="fix-note" data-testid="fix-missed">
          {status === 'applied' ? 'Still there after the AI\'s fix.' : status === 'error' || status === 'message' ? 'The AI couldn\'t fix it.' : 'Not fixed yet.'}
        </span>
        <button className="text-btn ai" data-testid="fix-with-ai" onClick={() => fix(true)}>
          ✦ Try again
        </button>
      </>
    );
  }
  return (
    <button className="text-btn ai" data-testid="fix-with-ai" onClick={() => fix(false)}>
      ✦ Fix
    </button>
  );
}
