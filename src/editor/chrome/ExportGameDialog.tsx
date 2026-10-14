import { useState } from 'react';
import { canExportDesktop, exportDesktop, type DesktopTarget } from '../desktopExport';
import { exportGame, exportItch } from '../gameExport';
import { useEditor } from '../store';

type Target = 'web' | 'itch' | DesktopTarget;

const TARGETS: { id: Target; label: string; blurb: string }[] = [
  { id: 'web', label: 'Web page (HTML)', blurb: 'One page that plays in any browser, on computers and phones: send it, or put it on your own website.' },
  { id: 'itch', label: 'itch.io (web game)', blurb: 'The web page in a zip, ready to upload to itch.io, where people play it in the browser. Free, and no download warnings for your players.' },
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
  const targets = canExportDesktop() ? TARGETS : TARGETS.filter((t) => t.id === 'web' || t.id === 'itch');
  const close = () => useEditor.getState().setExportGameOpen(false);
  const run = () => {
    const { project, logMessage } = useEditor.getState();
    close();
    const what = target === 'web' ? 'a web page' : target === 'itch' ? 'a zip for itch.io' : target === 'windows' ? 'a Windows app' : 'a macOS app';
    const options = { touchControls: touch };
    const job = target === 'web' ? exportGame(project, options) : target === 'itch' ? exportItch(project, options) : exportDesktop(project, target, options);
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
        {target === 'itch' && <ItchGuide touch={touch} />}
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

/** How to put the exported zip on itch.io, step by step. */
function ItchGuide({ touch }: { touch: boolean }) {
  return (
    <div className="itch-guide" data-testid="itch-guide">
      <p className="style-name">Putting it on itch.io</p>
      <ol>
        <li>Click Export below: it saves a zip (keep it zipped).</li>
        <li>
          Sign in at{' '}
          <a href="https://itch.io/game/new" target="_blank" rel="noopener noreferrer">
            itch.io
          </a>{' '}
          (a free account) and choose <b>Upload new project</b> (in the menu under your name, or on your Dashboard: <b>Create new project</b>).
        </li>
        <li>
          Give it a title, and set <b>Kind of project</b> to <b>HTML</b>.
        </li>
        <li>
          Under <b>Uploads</b>, upload the zip and tick <b>This file will be played in the browser</b>.
        </li>
        <li>
          Under <b>Embed options</b>, set the size (for example 960 × 600) and tick <b>Fullscreen button</b>
          {touch ? (
            <>
              , and <b>Mobile friendly</b> (the touch controls are in)
            </>
          ) : null}
          .
        </li>
        <li>
          Leave <b>Visibility</b> on <b>Draft</b> and save: <b>View page</b> lets you try it. When it works, set it to <b>Public</b> and save again, then share the page's link.
        </li>
      </ol>
      <p className="muted small">To update the game later: export again and upload the new zip on the same project (remove the old file).</p>
    </div>
  );
}
