import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';

/** Collapsible utility area: change history (AI and manual) and the console. Closed by default. */
export function Tray() {
  const tray = useEditor((s) => s.tray);
  const past = useEditor((s) => s.history.past);
  const log = useEditor((s) => s.log);
  const setTray = useEditor((s) => s.setTray);
  const errors = log.filter((l) => l.level === 'error').length;

  if (!tray.open) {
    return (
      <div className="tray-chips">
        <button className="tray-chip" data-testid="tray-toggle" onClick={() => setTray({ open: true, tab: 'history' })}>
          <span className="spark-mini" aria-hidden="true">✦</span>
          AI History
          {past.length > 0 && <span className="count">{past.length}</span>}
        </button>
        <button className="tray-chip" data-testid="console-toggle" onClick={() => setTray({ open: true, tab: 'console' })}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="1.5" y="2.5" width="11" height="9" rx="1.8" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="m4 6 1.8 1.5L4 9M7.5 9H10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          Console
          {errors > 0 && <span className="error-dot" title={`${errors} error(s)`} />}
        </button>
      </div>
    );
  }
  return (
    <section className="tray" data-testid="tray" aria-label="History and console">
      <header className="tray-head">
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tray.tab === 'history'} className={tray.tab === 'history' ? 'on' : ''} onClick={() => setTray({ tab: 'history' })}>
            AI History
          </button>
          <button role="tab" aria-selected={tray.tab === 'console'} className={tray.tab === 'console' ? 'on' : ''} data-testid="tab-console" onClick={() => setTray({ tab: 'console' })}>
            Console{errors > 0 && <span className="error-dot" />}
          </button>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={() => setTray({ open: false })}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 5.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      <div className="tray-body">{tray.tab === 'history' ? <HistoryList /> : <ConsoleList />}</div>
    </section>
  );
}

const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

function HistoryList() {
  const past = useEditor((s) => s.history.past);
  const future = useEditor((s) => s.history.future);
  const [open, setOpen] = useState<number | null>(null);
  if (!past.length && !future.length) return <p className="muted">Changes you make, and changes the AI makes, appear here.</p>;
  return (
    <ol className="history" data-testid="history-list">
      {[...past].reverse().map((t) => (
        <li key={t.id} className={t.source}>
          <button className="history-row" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>
            <span className="time">{time(t.time)}</span>
            <span className="grow">{t.label}</span>
          </button>
          {open === t.id && t.changes.length > 0 && (
            <ul className="changes">
              {t.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
      {future.map((t) => (
        <li key={t.id} className={`${t.source} undone`} title="Undone (redo with Ctrl+Shift+Z)">
          <span className="history-row">
            <span className="time">{time(t.time)}</span>
            <span className="grow">{t.label}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function ConsoleList() {
  const log = useEditor((s) => s.log);
  const clearLog = useEditor((s) => s.clearLog);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [log.length]);
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
