import { useState } from 'react';
import { exportGame } from '../gameExport';
import { useEditor } from '../store';

/** Export game: the options (on-screen buttons for phones), then the game's web page is saved. */
export function ExportGameDialog() {
  const open = useEditor((s) => s.exportGameOpen);
  const name = useEditor((s) => s.project.name);
  const [touch, setTouch] = useState(true);
  if (!open) return null;
  const close = () => useEditor.getState().setExportGameOpen(false);
  const run = () => {
    const { project, logMessage } = useEditor.getState();
    close();
    void exportGame(project, { touchControls: touch }).then((r) =>
      logMessage(r === 'failed' ? 'error' : 'info', r === 'saved' ? `Exported "${project.name}" as a web page${touch ? ' (with touch controls)' : ''}` : r === 'declined' ? 'Export cancelled' : "Couldn't save the game's page"),
    );
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog" role="dialog" aria-label="Export game" data-testid="export-game-dialog" onKeyDown={(e) => e.stopPropagation()}>
        <header className="bg-head">
          <span>
            Export game <span className="muted">· {name}</span>
          </span>
        </header>
        <p className="muted small">One web page that plays the game in any browser: send it, or put it on a website. No editor, server or internet needed.</p>
        <label className="se-row">
          <input type="checkbox" checked={touch} data-testid="export-touch" onChange={(e) => setTouch(e.target.checked)} />
          <span>Touch controls for phones and tablets</span>
        </label>
        <p className="muted small">On-screen arrows, jump, and use / shoot when the game has them. Shown only on touch screens; on a computer the keyboard plays as usual.</p>
        <footer className="se-footer">
          <span className="grow" />
          <button className="chip-btn" onClick={close}>
            Cancel
          </button>
          <button className="primary-btn" data-testid="export-game-confirm" onClick={run} autoFocus>
            Export
          </button>
        </footer>
      </section>
    </div>
  );
}
