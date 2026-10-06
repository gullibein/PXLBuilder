import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { contextKey, type AIContext } from '../../core/ai/context';
import { produce } from 'immer';
import { applyOperations, isEditorOperation, type ApplyResult } from '../../core/commands/operations';
import { componentRegistry } from '../../core/components/builtin';
import { frameEntities } from '../actions';
import { cardOpened, clearJob, setJobOutcome, startJob, stopJob, useJobs } from '../ai/jobs';
import { applyAIOperations, type PromptOutcome } from '../ai/runPrompt';
import { resolveSceneEntities } from '../selectors';
import { useEditor } from '../store';

type RunState = { phase: 'idle' } | { phase: 'working'; request: string } | { phase: 'done'; request: string; outcome: PromptOutcome };

/**
 * The prompt run for one context. The run itself lives in the job list
 * (ai/jobs.ts), so it carries on when the card closes; the card shows it.
 */
function usePromptRunner(ctx: AIContext, onApplied?: (outcome: Extract<PromptOutcome, { status: 'applied' }>) => void) {
  const key = contextKey(ctx);
  const job = useJobs((s) => s.jobs[key]);
  const state: RunState = !job ? { phase: 'idle' } : job.phase === 'working' ? { phase: 'working', request: job.request } : { phase: 'done', request: job.request, outcome: job.outcome! };

  // While this card is on screen, what finishes here counts as seen.
  useEffect(() => cardOpened(key), [key]);

  // Tell the owner about an applied change once (also one that finished while the card was closed).
  const told = useRef<PromptOutcome | null>(null);
  useEffect(() => {
    if (state.phase === 'done' && state.outcome.status === 'applied' && told.current !== state.outcome) {
      told.current = state.outcome;
      onApplied?.(state.outcome);
    }
  }, [state.phase === 'done' ? state.outcome : null]);

  // A pending proposal is drawn on the level (new things highlighted, removed things faded) until applied or cancelled.
  const proposal = state.phase === 'done' && state.outcome.status === 'proposal' ? state.outcome : null;
  useEffect(() => {
    if (!proposal || proposal.operations.some(isEditorOperation)) return;
    const { project, activeSceneId, setAIPreview } = useEditor.getState();
    const operations = proposal.operations;
    let result: ApplyResult | null = null;
    let next = project;
    try {
      next = produce(project, (d) => {
        result = applyOperations(d, operations, componentRegistry);
      });
    } catch {
      return; // Invalid proposals are reported when applied.
    }
    const r = result as ApplyResult | null;
    if (!r || (!r.createdEntityIds.length && !r.removedEntityIds.length)) return;
    setAIPreview({ project: next, sceneId: activeSceneId, created: r.createdEntityIds, removed: r.removedEntityIds });
    // A big change (a generated level) is framed so it can be seen whole.
    if (r.createdEntityIds.length >= 10) {
      const created = new Set(r.createdEntityIds);
      frameEntities(resolveSceneEntities(next, activeSceneId).filter((e) => created.has(e.id)));
    }
    return () => setAIPreview(null);
  }, [proposal]);

  return {
    state,
    submit(request: string) {
      startJob(ctx, request);
    },
    stop() {
      stopJob(key);
    },
    apply() {
      if (state.phase !== 'done' || state.outcome.status !== 'proposal') return;
      const { message, changes, operations } = state.outcome;
      setJobOutcome(key, applyAIOperations(state.request, message, changes, operations));
    },
    reset() {
      clearJob(key);
    },
  };
}

export interface PromptBoxProps {
  ctx: AIContext;
  placeholder?: string;
  autoFocus?: boolean;
  testId?: string;
  /** Shows a small control that opens the detailed view of the context. */
  onDetails?: () => void;
  onApplied?: (outcome: Extract<PromptOutcome, { status: 'applied' }>) => void;
  /** Extra content shown under an applied result (e.g. the new object to drag in). */
  renderApplied?: (outcome: Extract<PromptOutcome, { status: 'applied' }>) => React.ReactNode;
  onEscape?: () => void;
  /** Shows a close (×) button on the card. */
  onClose?: () => void;
  /** Optional small title above the input (e.g. "World", "Enemy → Door"). Objects themselves need none. */
  header?: React.ReactNode;
}

export function PromptBox(props: PromptBoxProps) {
  const runner = usePromptRunner(props.ctx, props.onApplied);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const undo = useEditor((s) => s.undo);
  const undoLayout = useEditor((s) => s.undoLayout);
  const working = runner.state.phase === 'working';
  const [expanded, setExpanded] = useState(false);
  const lastId = useEditor((s) => s.history.past.at(-1)?.id);
  const applied = runner.state.phase === 'done' && runner.state.outcome.status === 'applied' ? runner.state.outcome : null;
  // Editor changes have their own undo; a game change only while nothing else came after it.
  const canUndo = !!applied && (applied.editor === true || applied.transactionId === undefined || applied.transactionId === lastId);

  // Auto-grow up to four lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 4 * 20 + 14)}px`;
    // Re-measure when work starts/ends: while working, the request is shown as the placeholder.
  }, [text, working]);

  useEffect(() => {
    if (props.autoFocus) inputRef.current?.focus();
  }, [props.autoFocus]);

  const submit = () => {
    const request = text.trim();
    if (!request || working) return;
    runner.submit(request);
    setText('');
  };

  return (
    <div className={`prompt${working ? ' is-working' : ''}${props.header ? ' has-header' : ''}`} data-testid={props.testId}>
      {props.onClose && (
        <button className="prompt-close" title="Close (Esc)" aria-label="Close" data-testid="prompt-close" onClick={props.onClose}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      )}
      {props.header && <div className="prompt-header">{props.header}</div>}
      <div className="prompt-field">
        <span className="spark" aria-hidden="true">
          ✦
        </span>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={working ? runner.state.phase === 'working' ? runner.state.request : '' : (props.placeholder ?? 'Type a command…')}
          readOnly={working}
          aria-label="Describe a change"
          data-testid="prompt-input"
          onChange={(e) => {
            setText(e.target.value);
            if (runner.state.phase === 'done' && runner.state.outcome.status !== 'proposal') runner.reset();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              if (text) setText('');
              else {
                inputRef.current?.blur();
                props.onEscape?.();
              }
            }
          }}
        />
        {props.onDetails && (
          <button className="prompt-icon" title="Details" aria-label="Open details" data-testid="prompt-details" onClick={props.onDetails}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 4h10M2 10h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              <circle cx="5" cy="4" r="1.6" fill="var(--surface)" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="9" cy="10" r="1.6" fill="var(--surface)" stroke="currentColor" strokeWidth="1.3" />
            </svg>
          </button>
        )}
        <button className="send-btn" aria-label="Send" data-testid="prompt-send" disabled={!text.trim() || working} onClick={submit}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {working && (
        <>
          <div className="prompt-progress" aria-label="Working" />
          <div className="prompt-busy">
            <span className="muted small">Working on it… you can keep editing.</span>
            <button className="text-btn" data-testid="prompt-stop" onClick={runner.stop}>
              Stop
            </button>
          </div>
        </>
      )}
      {runner.state.phase === 'done' && <Outcome outcome={runner.state.outcome} onApply={runner.apply} onCancel={runner.reset} onUndo={() => {
            const o = runner.state.phase === 'done' ? runner.state.outcome : null;
            if (o?.status === 'applied' && o.editor) undoLayout();
            else undo();
            runner.reset();
          }} canUndo={canUndo} renderApplied={props.renderApplied} selectedIds={'entityIds' in props.ctx ? props.ctx.entityIds : []} onExpand={() => setExpanded(true)} />}
      {expanded &&
        runner.state.phase === 'done' &&
        createPortal(
          <div
            className="dialog-backdrop result-backdrop"
            onMouseDown={(e) => e.target === e.currentTarget && setExpanded(false)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                setExpanded(false);
              }
            }}
          >
            <section className="dialog result-dialog" role="dialog" aria-label="AI result" data-testid="result-dialog" tabIndex={-1} ref={(el) => el?.focus()}>
              <header className="bg-head">
                <span className="result-dialog-title">{props.header ?? 'AI result'}</span>
                <button className="icon-btn" aria-label="Close" data-testid="result-dialog-close" onClick={() => setExpanded(false)}>
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </header>
              <p className="result-dialog-request">
                <span className="muted">You asked:</span> {runner.state.request}
              </p>
              <div className="result-dialog-body">
                <Outcome
                  full
                  outcome={runner.state.outcome}
                  onApply={() => {
                    setExpanded(false);
                    runner.apply();
                  }}
                  onCancel={() => {
                    setExpanded(false);
                    runner.reset();
                  }}
                  onUndo={() => {
                    setExpanded(false);
                    const o = runner.state.phase === 'done' ? runner.state.outcome : null;
                    if (o?.status === 'applied' && o.editor) undoLayout();
                    else undo();
                    runner.reset();
                  }}
                  canUndo={canUndo}
                  selectedIds={'entityIds' in props.ctx ? props.ctx.entityIds : []}
                />
              </div>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Changes listed on the card; the rest are a click away (the result dialog). */
const MAX_CHANGES = 5;

function Outcome(props: {
  outcome: PromptOutcome;
  onApply: () => void;
  onCancel: () => void;
  onUndo: () => void;
  /** The change is still the latest one (so Undo undoes exactly it). */
  canUndo: boolean;
  renderApplied?: PromptBoxProps['renderApplied'];
  /** What the prompt is about; a change made elsewhere is pointed out. */
  selectedIds: readonly string[];
  /** Show everything (in the dialog) instead of the first few changes. */
  full?: boolean;
  /** Opens the dialog with everything. */
  onExpand?: () => void;
}) {
  const { outcome } = props;
  const list = (changes: string[], className: string) => {
    const shown = props.full ? changes : changes.slice(0, MAX_CHANGES);
    return (
      <ul className={className}>
        {shown.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
        {shown.length < changes.length && (
          <li>
            <button className="more-btn" data-testid="result-more" onClick={props.onExpand}>
              +{changes.length - shown.length} more
            </button>
          </li>
        )}
      </ul>
    );
  };
  // The AI may put a change on another object than the one asked about (a mushroom's behavior goes on the Mushroom, not the player).
  const elsewhere = outcome.status === 'applied' && !outcome.editor && (outcome.touched ?? []).some((t) => !t.entityIds.length || t.entityIds.some((id) => !props.selectedIds.includes(id)));
  switch (outcome.status) {
    case 'applied':
      return (
        <div className="prompt-result applied" data-testid="prompt-result" data-status="applied">
          <div className="result-head">
            <span className="ok">✓ Applied</span>
            {props.canUndo ? (
              <button className="icon-text-btn" data-testid="result-undo" aria-label="Undo" title="Undo this change" onClick={props.onUndo}>
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5.5 3.5 2.5 6.5l3 3M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="muted small" title="Other changes came after it: undo them first, or use the AI History">in history</span>
            )}
          </div>
          {elsewhere && (
            <>
              <p className="result-message" data-testid="result-message">
                {outcome.message}
              </p>
              <p className="result-where" data-testid="result-where">
                Changed: {outcome.touched!.map((t) => t.label).join(', ')}
              </p>
            </>
          )}
          {outcome.changes.length > 0 && list(outcome.changes, 'changes')}
          {props.renderApplied?.(outcome)}
        </div>
      );
    case 'proposal':
      return (
        <div className="prompt-result proposal" data-testid="prompt-result" data-status="proposal">
          <p className="result-message">{outcome.message}</p>
          {list(outcome.changes, 'changes proposed')}
          <div className="result-actions">
            <button className="btn-primary" data-testid="proposal-apply" onClick={props.onApply}>
              Apply
            </button>
            <button className="text-btn" data-testid="proposal-cancel" onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      );
    case 'message':
      return (
        <div className={`prompt-result note ${outcome.tone}`} data-testid="prompt-result" data-status="message">
          <p className="result-message">{outcome.message}</p>
        </div>
      );
    case 'error':
      return (
        <div className="prompt-result note warn" data-testid="prompt-result" data-status="error">
          <p className="result-message">{outcome.message}</p>
        </div>
      );
  }
}
