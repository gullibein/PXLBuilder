import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { contextKey, type AIContext } from '../../core/ai/context';
import { frameEntities } from '../actions';
import { cardOpened, setJobOutcome, startJob, startNewChat, stopJob, useJobs } from '../ai/jobs';
import { chatEntries, useAILog, type AILogEntry } from '../ai/aiLog';
import { applyObjectChoice, type PromptOutcome } from '../ai/runPrompt';
import { resolveSceneEntities } from '../selectors';
import { useEditor } from '../store';
import { playRecipe } from '../audio/synth';

type RunState = { phase: 'idle' } | { phase: 'working'; request: string } | { phase: 'done'; request: string; outcome: PromptOutcome };

/**
 * The prompt run for one context. The run itself lives in the job list
 * (ai/jobs.ts), so it carries on when the card closes; the card shows it.
 */
function usePromptRunner(ctx: AIContext, onApplied?: (outcome: Extract<PromptOutcome, { status: 'applied' }>) => void) {
  const key = contextKey(ctx);
  const job = useJobs((s) => s.jobs[key]);
  const state: RunState = !job ? { phase: 'idle' } : job.phase === 'working' ? { phase: 'working', request: job.request } : { phase: 'done', request: job.request, outcome: job.outcome! };
  // The conversation so far (from the AI History log; kept when the card closes and across reloads),
  // without the exchange shown below it with its buttons.
  const entries = useAILog((s) => s.entries);
  const starts = useAILog((s) => s.starts);
  const thread: AILogEntry[] = useMemo(() => {
    const all = chatEntries({ entries, starts }, key);
    return job?.phase === 'done' && job.logId !== undefined ? all.filter((e) => e.id !== job.logId) : all;
  }, [entries, starts, key, job]);

  // While this card is on screen, what finishes here counts as seen.
  useEffect(() => cardOpened(key), [key]);

  // Tell the owner about an applied change once (also one that finished while the card was closed).
  const told = useRef<PromptOutcome | null>(null);
  useEffect(() => {
    if (state.phase === 'done' && state.outcome.status === 'applied' && told.current !== state.outcome) {
      told.current = state.outcome;
      onApplied?.(state.outcome);
      // A big change (a generated level) is framed so it can be seen whole.
      const created = state.outcome.result.createdEntityIds;
      if (created.length >= 10) {
        const { project, activeSceneId } = useEditor.getState();
        const ids = new Set(created);
        frameEntities(resolveSceneEntities(project, activeSceneId).filter((e) => ids.has(e.id)));
      }
    }
  }, [state.phase === 'done' ? state.outcome : null]);


  return {
    state,
    thread,
    submit(request: string) {
      startJob(ctx, request);
    },
    stop() {
      stopJob(key);
    },
    /** "New chat": start the conversation about this again. */
    newChat() {
      startNewChat(key);
    },
    /** The change went to the object (every copy): make it a new object instead (undo it, apply it as a new one). */
    asNew() {
      if (state.phase !== 'done' || state.outcome.status !== 'applied' || !state.outcome.asNew) return;
      const change = state.outcome.asNew;
      useEditor.getState().undo();
      setJobOutcome(key, applyObjectChoice(state.request, change, 'new'));
    },
    /** The change was undone from the card: it stays in the chat, marked. */
    markUndone() {
      if (state.phase === 'done' && state.outcome.status === 'applied') setJobOutcome(key, { ...state.outcome, undone: true });
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
  // In the header's corner; on a card without a header, at the end of the input row.
  const close = props.onClose;
  const closeButton = close && (
    <button className="prompt-close" title="Close (Esc)" aria-label="Close" data-testid="prompt-close" onClick={close}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </button>
  );
  const lastId = useEditor((s) => s.history.past.at(-1)?.id);
  const applied = runner.state.phase === 'done' && runner.state.outcome.status === 'applied' ? runner.state.outcome : null;
  // Editor changes have their own undo; a game change only while nothing else came after it.
  const canUndo = !!applied && !applied.undone && (applied.editor === true || applied.transactionId === undefined || applied.transactionId === lastId);

  // Auto-grow up to four lines.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${Math.min(el.scrollHeight, 4 * 20 + 14)}px`;
  }, [text, working]);

  // The newest exchange stays in view.
  const chatRef = useRef<HTMLDivElement>(null);
  const chatSize = runner.thread.length;
  useLayoutEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatSize, runner.state.phase, runner.state.phase === 'done' ? runner.state.outcome : null]);
  const undoThis = () => {
    const o = runner.state.phase === 'done' ? runner.state.outcome : null;
    if (o?.status === 'applied' && o.editor) undoLayout();
    else undo();
    runner.markUndone();
  };

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
      {props.onClose && props.header && closeButton}
      {props.header && <div className="prompt-header">{props.header}</div>}
      {(runner.thread.length > 0 || runner.state.phase !== 'idle') && (
        <div className="prompt-chat" ref={chatRef} data-testid="prompt-chat">
          <div className="chat-bar">
            <button className="link-btn" data-testid="prompt-new-chat" title="Start a new conversation about this (the AI forgets the one above; AI History keeps it)" disabled={working} onClick={runner.newChat}>
              New chat
            </button>
          </div>
          {runner.thread.map((entry) => (
            <div className="chat-turn past" key={entry.id} data-testid="chat-past">
              <p className="chat-you">{entry.request}</p>
              <PastOutcome entry={entry} />
            </div>
          ))}
          <div className="chat-turn">
            <p className="chat-you" data-testid="chat-request">
              {runner.state.phase === 'idle' ? '' : runner.state.request}
            </p>
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
            {runner.state.phase === 'done' && (
              <Outcome
                outcome={runner.state.outcome}
                onAsNew={runner.asNew}
                onUndo={undoThis}
                canUndo={canUndo}
                renderApplied={props.renderApplied}
                selectedIds={'entityIds' in props.ctx ? props.ctx.entityIds : []}
                onExpand={() => setExpanded(true)}
              />
            )}
          </div>
        </div>
      )}
      <div className="prompt-field">
        <span className="spark" aria-hidden="true">
          ✦
        </span>
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={working ? 'Working on it…' : runner.state.phase === 'done' ? 'Reply or ask something else…' : (props.placeholder ?? 'Type a command…')}
          readOnly={working}
          aria-label="Describe a change"
          data-testid="prompt-input"
          onChange={(e) => setText(e.target.value)}
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
        {!props.header && closeButton}
      </div>
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
                  onAsNew={() => {
                    setExpanded(false);
                    runner.asNew();
                  }}
                  onUndo={() => {
                    setExpanded(false);
                    undoThis();
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

/** Play buttons for sounds an answer made, to hear them right away. */
function MadeSounds({ ids }: { ids: string[] }) {
  const assets = useEditor((s) => s.project.assets);
  const sounds = assets.filter((a) => a.kind === 'sound' && a.synth && ids.includes(a.id));
  if (!sounds.length) return null;
  return (
    <p className="made-sounds">
      {sounds.map((a) => (
        <button key={a.id} className="sound-btn" data-testid="play-sound" title={a.description ?? `Play ${a.name}`} onClick={() => playRecipe(a.synth!)}>
          ▶ {a.name}
        </button>
      ))}
    </p>
  );
}

/** An earlier exchange in the card's chat: what the AI said and did, without the buttons. */
function PastOutcome({ entry: outcome }: { entry: AILogEntry }) {
  const undoneLater = useEditor((s) => outcome.transactionId !== null && s.history.future.some((t) => t.id === outcome.transactionId));
  if (outcome.status !== 'applied') {
    return (
      <div className={`chat-ai${outcome.warn ? ' warn' : ''}`}>
        <p className="result-message">{outcome.message}</p>
      </div>
    );
  }
  return (
    <div className="chat-ai">
      <p className="chat-status">{outcome.undone || undoneLater ? <span className="muted">↶ Undone</span> : <span className="ok">✓ Applied</span>}</p>
      <p className="result-message">{outcome.message}</p>
      {outcome.changes.length > 0 && (
        <ul className="changes">
          {outcome.changes.slice(0, 3).map((c, i) => (
            <li key={i}>{c}</li>
          ))}
          {outcome.changes.length > 3 && <li className="more">+{outcome.changes.length - 3} more</li>}
        </ul>
      )}
    </div>
  );
}

/** Changes listed on the card; the rest are a click away (the result dialog). */
const MAX_CHANGES = 5;

function Outcome(props: {
  outcome: PromptOutcome;
  /** Make an object change a new object instead. */
  onAsNew: () => void;
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
  // (A change to the selected copy's own object is not "elsewhere", even though every copy got it.)
  const elsewhere =
    outcome.status === 'applied' &&
    !outcome.editor &&
    (outcome.asNew ? outcome.asNew.choice.switchIds.length === 0 : (outcome.touched ?? []).some((t) => !t.entityIds.length || t.entityIds.some((id) => !props.selectedIds.includes(id))));
  switch (outcome.status) {
    case 'applied':
      return (
        <div className="prompt-result applied" data-testid="prompt-result" data-status="applied">
          <div className="result-head">
            {outcome.undone ? <span className="muted" data-testid="result-undone">↶ Undone</span> : <span className="ok">✓ Applied</span>}
            {outcome.undone ? null : props.canUndo ? (
              <button className="icon-text-btn" data-testid="result-undo" aria-label="Undo" title="Undo this change" onClick={props.onUndo}>
                <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5.5 3.5 2.5 6.5l3 3M3 6.5h6.5a3.5 3.5 0 0 1 0 7H7.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ) : (
              <span className="muted small" title="Other changes came after it: undo them first, or use the AI History">in history</span>
            )}
          </div>
          {outcome.message && (
            <p className="result-message" data-testid="result-message">
              {outcome.message}
            </p>
          )}
          {elsewhere && (
            <p className="result-where" data-testid="result-where">
              Changed: {outcome.touched!.map((t) => t.label).join(', ')}
            </p>
          )}
          {outcome.note && (
            <p className="result-where" data-testid="result-note">
              {outcome.note}
            </p>
          )}
          {outcome.changes.length > 0 && list(outcome.changes, 'changes')}
          {outcome.asNew && props.canUndo && (
            <p className="as-new" data-testid="result-as-new-row">
              {!elsewhere && (outcome.asNew.choice.copies > 1 ? `Changed every ${outcome.asNew.choice.objectName} (${outcome.asNew.choice.copies} placed). ` : `Changed the ${outcome.asNew.choice.objectName} object. `)}
              <button className="link-btn" data-testid="result-as-new" title={`Keep the ${outcome.asNew.choice.objectName}s as they were and make a new object with this change instead`} onClick={props.onAsNew}>
                Make it a new object instead
              </button>
            </p>
          )}
          <MadeSounds ids={outcome.result.createdAssetIds} />
          {props.renderApplied?.(outcome)}
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
