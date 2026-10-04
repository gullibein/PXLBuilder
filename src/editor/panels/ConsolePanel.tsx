import { useEffect, useRef } from 'react';
import { useEditor } from '../store';

/** Bottom panel: editor messages (load/save results, rejected edits, warnings). */
export function ConsolePanel() {
  const log = useEditor((s) => s.log);
  const clearLog = useEditor((s) => s.clearLog);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => endRef.current?.scrollIntoView({ block: 'end' }), [log.length]);
  return (
    <div className="panel console">
      <div className="panel-title">
        Console
        <button className="icon-btn" title="Clear" onClick={clearLog}>
          ⌫
        </button>
      </div>
      <div className="panel-body console-body" data-testid="console">
        {log.length === 0 && <div className="muted">No messages.</div>}
        {log.map((entry) => (
          <div key={entry.id} className={`log-line ${entry.level}`}>
            <span className="time">{new Date(entry.time).toLocaleTimeString()}</span>
            <span>{entry.message}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
