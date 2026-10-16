import { useEffect, useState } from 'react';
import { deleteCloudSave, listCloudSaves, readCloudSave, type CloudSave } from '../cloudSaves';
import { openGameText, sizeText } from '../persistence';
import { useEditor } from '../store';
import { openFromComputer } from './TopBar';

/** Open (in the published app on claude.ai): the games saved with the app, most recent first, or a file from the computer. */
export function OpenDialog() {
  const open = useEditor((s) => s.openDialog);
  const currentId = useEditor((s) => s.project.id);
  const [saves, setSaves] = useState<CloudSave[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setSaves(null);
    setError(null);
    setConfirm(null);
    listCloudSaves().then(setSaves, (e) => setError(String((e as { code?: string })?.code ?? (e as Error)?.message ?? e)));
  }, [open]);
  if (!open) return null;
  const close = () => useEditor.getState().setOpenDialog(false);
  const pick = async (save: CloudSave) => {
    try {
      const text = await readCloudSave(save);
      close();
      openGameText(text, `the save of ${save.name}`);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog open-dialog" role="dialog" aria-label="Open a game" data-testid="open-dialog" onKeyDown={(e) => e.key === 'Escape' && close()}>
        <header className="bg-head">
          <span>Open a game</span>
          <button className="icon-btn" aria-label="Close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        {error && <p className="dialog-text warn">Could not read the saved games ({error}).</p>}
        {!saves && !error && <p className="muted small">Loading saved games…</p>}
        {saves && saves.length === 0 && <p className="muted small" data-testid="open-none">No saved games yet: the Save button at the top saves the game here.</p>}
        {saves && saves.length > 0 && (
          <ul className="open-list" data-testid="open-list">
            {saves.map((s) => (
              <li key={s.gameId} className="open-row">
                <button className="open-pick" data-testid="open-save" onClick={() => void pick(s)}>
                  <span className="open-name">
                    {s.name}
                    {s.gameId === currentId && <span className="muted small"> (open now)</span>}
                  </span>
                  <span className="muted small">
                    {new Date(s.savedAt).toLocaleString()} · {sizeText(s.bytes)}
                  </span>
                </button>
                {confirm === s.gameId ? (
                  <button
                    className="chip-btn danger"
                    data-testid="open-delete-confirm"
                    onClick={async () => {
                      await deleteCloudSave(s).catch(() => undefined);
                      setSaves((list) => list?.filter((x) => x.gameId !== s.gameId) ?? null);
                    }}
                  >
                    Delete save
                  </button>
                ) : (
                  <button className="icon-btn" aria-label={`Delete the save of ${s.name}`} title="Delete this save" data-testid="open-delete" onClick={() => setConfirm(s.gameId)}>
                    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                      <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 8.5h5.6l.7-8.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                    </svg>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <footer className="se-footer">
          <button
            className="chip-btn"
            data-testid="open-from-file"
            onClick={() => {
              close();
              void openFromComputer();
            }}
          >
            From a file on this computer…
          </button>
          <span className="grow" />
          <button className="chip-btn" onClick={close}>
            Cancel
          </button>
        </footer>
      </section>
    </div>
  );
}
