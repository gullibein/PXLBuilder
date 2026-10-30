/**
 * Before a game opens: one made with an older version of the app says what updating it changes ("Update and
 * open"), one that doesn't load as it is offers to be fixed ("Try to fix it": what is broken is left out), and a
 * fixed one says what was left out. The file itself is never changed: saving writes the updated game.
 */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { openGameText, repairGameText } from '../persistence';
import { useEditor } from '../store';

export function FileFixDialog() {
  const fix = useEditor((s) => s.fileFix);
  const close = () => useEditor.getState().setFileFix(null);
  useEffect(() => {
    if (!fix) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      useEditor.getState().setFileFix(null);
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [fix]);
  if (!fix) return null;
  const title = fix.kind === 'update' ? 'Update this game?' : fix.kind === 'repair' ? "This game doesn't open" : 'Game fixed';
  return createPortal(
    <div className="dialog-backdrop confirm-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()} onClick={(e) => e.stopPropagation()}>
      <section className="dialog file-fix" role="alertdialog" aria-label={title} data-testid="file-fix" data-kind={fix.kind}>
        <header className="bg-head">
          <span>{title}</span>
        </header>
        {fix.kind === 'update' && (
          <>
            <p className="dialog-text">“{fix.from}” was made with an earlier version of PXLBuilder. To open it, it is updated for this version, which changes:</p>
            <ul className="file-fix-list" data-testid="file-fix-lines">
              {fix.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="dialog-text muted small">The file itself stays as it is until you save the game.</p>
          </>
        )}
        {fix.kind === 'repair' && (
          <>
            <p className="dialog-text">“{fix.from}” can't be opened as it is:</p>
            <ul className="file-fix-list" data-testid="file-fix-lines">
              {fix.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="dialog-text">PXLBuilder can try to fix it: the parts that don't work with this version are left out (it says which), and everything else opens as it was. The file itself stays as it is until you save the game.</p>
          </>
        )}
        {fix.kind === 'fixed' && (
          <>
            <p className="dialog-text">{fix.lines.length ? `“${fix.from}” is open. To make it open, this was left out:` : `“${fix.from}” is open: nothing needed to be left out.`}</p>
            {fix.lines.length > 0 && (
              <ul className="file-fix-list" data-testid="file-fix-lines">
                {fix.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </>
        )}
        <footer className="se-footer">
          <span className="grow" />
          {fix.kind === 'fixed' ? (
            <button className="btn-primary" data-testid="file-fix-ok" onClick={close} autoFocus>
              OK
            </button>
          ) : (
            <>
              <button className="chip-btn" data-testid="file-fix-cancel" onClick={close} autoFocus>
                Cancel
              </button>
              <button
                className="btn-primary"
                data-testid="file-fix-go"
                onClick={() => {
                  close();
                  if (fix.kind === 'update') openGameText(fix.text, fix.from, true);
                  else repairGameText(fix.text, fix.from);
                }}
              >
                {fix.kind === 'update' ? 'Update and open' : 'Try to fix it'}
              </button>
            </>
          )}
        </footer>
      </section>
    </div>,
    document.body,
  );
}
