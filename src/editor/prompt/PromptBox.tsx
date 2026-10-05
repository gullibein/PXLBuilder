import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AIContext } from '../../core/ai/context';
import { produce } from 'immer';
import { applyOperations, isEditorOperation, type ApplyResult } from '../../core/commands/operations';
import { componentRegistry } from '../../core/components/builtin';
import { frameEntities } from '../actions';
import { applyAIOperations, runPrompt, type PromptOutcome } from '../ai/runPrompt';
import { resolveSceneEntities } from '../selectors';
import { useEditor } from '../store';

type RunState = { phase: 'idle' } | { phase: 'working'; request: string } | { phase: 'done'; request: string; outcome: PromptOutcome };

/** Runs prompts for one context. Each context gets a fresh runner (the component is keyed by context). */
function usePromptRunner(ctx: AIContext, onApplied?: (outcome: Extract<PromptOutcome, { status: 'applied' }>) => void) {
  const [state, setState] = useState<RunState>({ phase: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  const finish = (request: string, outcome: PromptOutcome) => {
    setState({ phase: 'done', request, outcome });
    if (outcome.status === 'applied') onApplied?.(outcome);
  };

  // A pending proposal is drawn on the level (new things highlighted, removed things faded) until applied or cancelled.
  useEffect(() => {
    if (state.phase !== 'done' || state.outcome.status !== 'proposal' || state.outcome.operations.some(isEditorOperation)) return;
    const { project, activeSceneId, setAIPreview } = useEditor.getState();
    const operations = state.outcome.operations;
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
  }, [state]);

  return {
    state,
    submit(request: string) {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ phase: 'working', request });
      runPrompt(ctx, request, controller.signal).then(
        (outcome) => !controller.signal.aborted && finish(request, outcome),
        (e) => {
          if ((e as Error).name !== 'AbortError') finish(request, { status: 'error', message: (e as Error).message });
        },
      );
    },
    apply() {
      if (state.phase !== 'done' || state.outcome.status !== 'proposal') return;
      const { message, changes, operations } = state.outcome;
      finish(state.request, applyAIOperations(state.request, message, changes, operations));
    },
    reset() {
      setState({ phase: 'idle' });
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
      {working && <div className="prompt-progress" aria-label="Working" />}
      {runner.state.phase === 'done' && <Outcome outcome={runner.state.outcome} onApply={runner.apply} onCancel={runner.reset} onUndo={() => {
            const o = runner.state.phase === 'done' ? runner.state.outcome : null;
            if (o?.status === 'applied' && o.editor) undoLayout();
            else undo();
            runner.reset();
          }} renderApplied={props.renderApplied} />}
    </div>
  );
}

function Outcome(props: {
  outcome: PromptOutcome;
  onApply: () => void;
  onCancel: () => void;
  onUndo: () => void;
  renderApplied?: PromptBoxProps['renderApplied'];
}) {
  const { outcome } = props;
  switch (outcome.status) {
    case 'applied':
      return (
        <div className="prompt-result applied" data-testid="prompt-result" data-status="applied">
          <div className="result-head">
            <span className="ok">✓ Applied</span>
            <button className="text-btn" data-testid="result-undo" onClick={props.onUndo}>
              Undo
            </button>
          </div>
          {outcome.changes.length > 0 && (
            <ul className="changes">
              {outcome.changes.slice(0, 5).map((c, i) => (
                <li key={i}>{c}</li>
              ))}
              {outcome.changes.length > 5 && <li className="more">+{outcome.changes.length - 5} more</li>}
            </ul>
          )}
          {props.renderApplied?.(outcome)}
        </div>
      );
    case 'proposal':
      return (
        <div className="prompt-result proposal" data-testid="prompt-result" data-status="proposal">
          <p className="result-message">{outcome.message}</p>
          <ul className="changes proposed">
            {outcome.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
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
