import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { clearAILog, useAILog, type AILogEntry } from '../ai/aiLog';
import { DebugPanel, useLevelProblems } from './DebugPanel';

/** Collapsible utility area: change history (AI and manual) and the console. Closed by default. */
export function Tray() {
  const tray = useEditor((s) => s.tray);
  const log = useEditor((s) => s.log);
  const setTray = useEditor((s) => s.setTray);
  const errors = log.filter((l) => l.level === 'error').length;
  const exchanges = useAILog((s) => s.entries.length);
  // Bigger, to read long conversations (remembered while the page is open).
  const [big, setBig] = useState(false);
  const problems = useLevelProblems().filter((p) => p.severity !== 'note').length;

  if (!tray.open) {
    return (
      <div className="tray-chips">
        <button className="tray-chip" data-testid="tray-toggle" aria-label="AI History" title="AI History" onClick={() => setTray({ open: true, tab: 'history' })}>
          <span className="spark-mini" aria-hidden="true">✦</span>
          <span className="chip-label">AI History</span>
          {exchanges > 0 && <span className="count">{exchanges}</span>}
        </button>
        <button className="tray-chip" data-testid="console-toggle" aria-label="Console" title="Console" onClick={() => setTray({ open: true, tab: 'console' })}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="1.5" y="2.5" width="11" height="9" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="m4 6 1.8 1.5L4 9M7.5 9H10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="chip-label">Console</span>
          {errors > 0 && <span className="error-dot" title={`${errors} error(s)`} />}
        </button>
        <button className="tray-chip" data-testid="debug-toggle" aria-label="Debug" title="Debug: problems in this level and what happened in the last play" onClick={() => setTray({ open: true, tab: 'debug' })}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <ellipse cx="7" cy="8" rx="3.2" ry="4" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M7 4V12M3.8 6.5 1.8 5.5M10.2 6.5l2-1M3.8 9.5l-2 1M10.2 9.5l2 1M5.5 4.3 4.6 2.6M8.5 4.3l.9-1.7" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span className="chip-label">Debug</span>
          {problems > 0 && <span className="count warn-count" data-testid="problem-count">{problems}</span>}
        </button>
      </div>
    );
  }
  return (
    <section className={`tray${big ? ' big' : ''}`} data-testid="tray" aria-label="History and console">
      <header className="tray-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tray.tab === 'history'} className={tray.tab === 'history' ? 'on' : ''} onClick={() => setTray({ tab: 'history' })}>
            AI History
          </button>
          <button role="tab" aria-selected={tray.tab === 'console'} className={tray.tab === 'console' ? 'on' : ''} data-testid="tab-console" onClick={() => setTray({ tab: 'console' })}>
            Console{errors > 0 && <span className="error-dot" />}
          </button>
          <button role="tab" aria-selected={tray.tab === 'debug'} className={tray.tab === 'debug' ? 'on' : ''} data-testid="tab-debug" onClick={() => setTray({ tab: 'debug' })}>
            Debug{problems > 0 && <span className="count warn-count">{problems}</span>}
          </button>
        </div>
        <button className="icon-btn" aria-label={big ? 'Make smaller' : 'Make bigger'} title={big ? 'Make smaller' : 'Make bigger'} data-testid="tray-size" onClick={() => setBig(!big)}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            {big ? (
              <path d="M8.5 2.5v3h3M5.5 11.5v-3h-3M8.5 5.5 12 2M5.5 8.5 2 12" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <path d="M8.5 2h3.5v3.5M5.5 12H2V8.5M12 2 8 6M2 12l4-4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
        <button className="icon-btn" aria-label="Close" onClick={() => setTray({ open: false })}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 5.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="tray-body">{tray.tab === 'history' ? <HistoryList /> : tray.tab === 'debug' ? <DebugPanel /> : <ConsoleList />}</div>
    </section>
  );
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * The conversation with the AI in full (newest at the bottom, like a chat):
 * what was asked and where, the AI's whole answer and its changes, and how it
 * ended. "My edits too" adds your own changes from the undo history.
 */
function HistoryList() {
  const entries = useAILog((s) => s.entries);
  const past = useEditor((s) => s.history.past);
  const future = useEditor((s) => s.history.future);
  const [mine, setMine] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const undoneIds = new Set(future.map((t) => t.id));
  const edits = mine ? [...past, ...future].filter((t) => t.source !== 'ai').map((t) => ({ time: t.time, edit: t, undone: undoneIds.has(t.id) })) : [];
  const items = [...entries.map((e) => ({ time: e.time, entry: e })), ...edits].sort((a, b) => a.time - b.time);
  useEffect(() => {
    const body = endRef.current?.closest('.tray-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, [items.length]);
  return (
    <div className="ai-log" data-testid="history-list">
      <div className="ai-log-bar">
        <label className="dialog-check">
          <input type="checkbox" checked={mine} data-testid="history-mine" onChange={(e) => setMine(e.target.checked)} />
          My edits too
        </label>
        {entries.length > 0 && (
          <button className="text-btn" data-testid="history-clear" onClick={clearAILog}>
            Clear
          </button>
        )}
      </div>
      {!items.length && <p className="muted">Your requests to the AI and its answers appear here, in full.</p>}
      {items.map((item) =>
        'entry' in item ? (
          <Exchange key={`ai${item.entry.id}`} entry={item.entry} undone={item.entry.undone || (item.entry.transactionId !== null && undoneIds.has(item.entry.transactionId))} />
        ) : (
          <div key={`me${item.edit.id}`} className={`my-edit${item.undone ? ' undone' : ''}`} data-testid="history-edit">
            <span className="time">{time(item.time)}</span>
            <span>
              {item.edit.label}
              {item.undone && ' (undone)'}
            </span>
          </div>
        ),
      )}
      <div ref={endRef} />
    </div>
  );
}

function Exchange({ entry, undone }: { entry: AILogEntry; undone: boolean }) {
  const status = entry.status === 'error' ? '⚠ Failed' : entry.status === 'message' ? 'Answer' : undone ? '↶ Undone' : '✓ Applied';
  return (
    <article className={`exchange ${entry.status}${undone ? ' undone' : ''}`} data-testid="history-exchange">
      <header className="exchange-head">
        <span className="time">{time(entry.time)}</span>
        <span className="where">{entry.where}</span>
      </header>
      <p className="chat-you">{entry.request}</p>
      <div className={`exchange-ai${entry.warn ? ' warn' : ''}`}>
        <span className="exchange-status">{status}</span>
        {entry.message && <p className="exchange-message">{entry.message}</p>}
        {entry.note && <p className="exchange-message muted">{entry.note}</p>}
        {entry.changes.length > 0 && (
          <ul className="changes">
            {entry.changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function ConsoleList() {
  const log = useEditor((s) => s.log);
  const clearLog = useEditor((s) => s.clearLog);
  const endRef = useRef<HTMLDivElement>(null);
  // Keep the newest message visible by scrolling only the tray itself. (scrollIntoView would also
  // scroll every ancestor, including a page embedding the editor, shoving the whole app out of view.)
  useEffect(() => {
    const body = endRef.current?.closest('.tray-body');
    if (body) body.scrollTop = body.scrollHeight;
  }, [log.length]);
  return (
    <div className="console" data-testid="console">
      {log.length === 0 && <p className="muted">No messages.</p>}
      {log.map((entry) => (
        <div key={entry.id} className={`log-line ${entry.level}`}>
          <span className="time">{time(entry.time)}</span>
          <span>{entry.message}</span>
        </div>
      ))}
      {log.length > 0 && (
        <button className="text-btn" onClick={clearLog}>
          Clear
        </button>
      )}
      <div ref={endRef} />
    </div>
  );
}
