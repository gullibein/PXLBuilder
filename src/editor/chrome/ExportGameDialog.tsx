import { useState } from 'react';
import { canExportDesktop, exportDesktop, type DesktopTarget } from '../desktopExport';
import { exportGame } from '../gameExport';
import { useEditor } from '../store';

type Target = 'web' | DesktopTarget;

const TARGETS: { id: Target; label: string; blurb: string }[] = [
  { id: 'web', label: 'Web page (HTML)', blurb: 'One page that plays in any browser, on computers and phones: send it, or put it on a website (itch.io takes it as it is).' },
  { id: 'windows', label: 'Windows app', blurb: 'A zip with the game as a program (.exe) for Windows 10 and 11. Not signed: the first time, players click "More info" → "Run anyway".' },
  { id: 'macos', label: 'macOS app', blurb: 'A zip with the game as an app for macOS 11 or later (Apple silicon and Intel). Not from a registered Apple developer: the first time, players allow it in System Settings → Privacy & Security → "Open Anyway".' },
];

/** Export game: where it is to be played (a web page, Windows, macOS) and the options, then it is saved. */
export function ExportGameDialog() {
  const open = useEditor((s) => s.exportGameOpen);
  const name = useEditor((s) => s.project.name);
  const [touch, setTouch] = useState(true);
  const [target, setTarget] = useState<Target>('web');
  if (!open) return null;
  const targets = canExportDesktop() ? TARGETS : TARGETS.filter((t) => t.id === 'web');
  const close = () => useEditor.getState().setExportGameOpen(false);
  const run = () => {
    const { project, logMessage } = useEditor.getState();
    close();
    const what = target === 'web' ? 'a web page' : target === 'windows' ? 'a Windows app' : 'a macOS app';
    const job = target === 'web' ? exportGame(project, { touchControls: touch }) : exportDesktop(project, target, { touchControls: touch });
    void job.then(
      (r) => logMessage(r === 'failed' ? 'error' : 'info', r === 'saved' ? `Exported "${project.name}" as ${what}${touch ? ' (with touch controls)' : ''}` : r === 'declined' ? 'Export cancelled' : `Couldn't save ${what}`),
      (e) => logMessage('error', `Couldn't export ${what}: ${(e as Error).message}`),
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
        <div className="export-targets" role="radiogroup" aria-label="Play it as">
          {targets.map((t) => (
            <label key={t.id} className={`export-target${target === t.id ? ' on' : ''}`}>
              <input type="radio" name="export-target" checked={target === t.id} data-testid={`export-target-${t.id}`} onChange={() => setTarget(t.id)} />
              <span>
                <span className="style-name">{t.label}</span>
                <span className="muted small export-blurb">{t.blurb}</span>
              </span>
            </label>
          ))}
        </div>
        <label className="se-row">
          <input type="checkbox" checked={touch} data-testid="export-touch" onChange={(e) => setTouch(e.target.checked)} />
          <span>Touch controls for touch screens</span>
        </label>
        <p className="muted small">On-screen arrows, jump, and use / shoot when the game has them. Shown only on touch screens; otherwise the keyboard or a game controller plays.</p>
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
