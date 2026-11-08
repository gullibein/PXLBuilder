import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { addLibraryItem, libraryItemOf, type LibraryItem, type LibraryKind } from '../../core/model/audioLibrary';
import type { Id } from '../../core/types';
import { deleteFromLibrary, loadLibrary, saveToLibrary, useAudioLibrary } from '../audioLibrary';
import { playSound } from '../audio/synth';
import { useEditor } from '../store';

const LABEL: Record<LibraryKind, { one: string; many: string }> = {
  sound: { one: 'sound', many: 'sounds' },
  instrument: { one: 'instrument', many: 'instruments' },
  song: { one: 'song', many: 'songs' },
};

/**
 * Save the open sound, instrument or song to the user's library (to use in other games), and open the library to
 * add one of theirs to this game. `current`: the one open now (read when clicked); `onAdded`: open what was added.
 */
export function LibraryButtons({ kind, current, onAdded }: { kind: LibraryKind; current: () => Id | null; onAdded: (id: Id) => void }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2500);
    return () => clearTimeout(t);
  }, [note]);
  const save = async () => {
    const id = current();
    if (!id) return setNote(`Open a ${LABEL[kind].one} first`);
    const item = libraryItemOf(useEditor.getState().project, id);
    if (!item) return setNote(`This ${LABEL[kind].one} can't be saved`);
    // (One of the same name is replaced: saving again keeps the library up to date.)
    if (!useAudioLibrary.getState().where) await loadLibrary();
    const same = useAudioLibrary.getState().items.find((x) => x.kind === kind && x.name.toLowerCase() === item.name.toLowerCase());
    const r = await saveToLibrary(same ? { ...item, id: same.id } : item);
    setNote(r.ok ? `Saved “${item.name}” to your library` : `Not saved: ${r.error}`);
  };
  return (
    <>
      <button className="icon-btn library-btn" title={`Save this ${LABEL[kind].one} to your library, to use it in your other games`} aria-label={`Save to my library`} data-testid={`library-save-${kind}`} onClick={() => void save()}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 2.5h8l2 2v9H3z M5.5 2.5v3.5h5V2.5 M5 13.5V9.5h6v4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
      </button>
      <button className="icon-btn library-btn" title={`Your library: ${LABEL[kind].many} you saved, to add to this game`} aria-label={`My library`} data-testid={`library-open-${kind}`} onClick={() => setOpen(true)}>
        <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 2.5h3v11h-3z M6.5 2.5h3v11h-3z M10.3 3.2l2.8-.8 2.4 10.6-2.8.8z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </svg>
      </button>
      {note && (
        <span className="library-note" role="status" data-testid="library-note">
          {note}
        </span>
      )}
      {open && <LibraryWindow kind={kind} onClose={() => setOpen(false)} onAdded={onAdded} />}
    </>
  );
}

function LibraryWindow({ kind, onClose, onAdded }: { kind: LibraryKind; onClose: () => void; onAdded: (id: Id) => void }) {
  const { items, where, loading, error } = useAudioLibrary();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    void loadLibrary();
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, []);
  const mine = items.filter((x) => x.kind === kind).sort((a, b) => a.name.localeCompare(b.name));
  const add = (item: LibraryItem) => {
    let id: Id | null = null;
    try {
      useEditor.getState().edit(`Add ${LABEL[kind].one} ${item.name} from your library`, (p) => void (id = addLibraryItem(p, item)));
    } catch (e) {
      setProblem(`“${item.name}” couldn't be added: ${(e as Error).message}`);
      return;
    }
    onClose();
    if (id) onAdded(id);
  };
  const play = (item: LibraryItem) => {
    try {
      playSound(JSON.parse(item.json));
    } catch {
      /* (a sound that can't be read plays nothing) */
    }
  };
  return createPortal(
    <div className="dialog-backdrop" style={{ zIndex: 90 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dialog audio-library" role="dialog" aria-label={`Your ${LABEL[kind].many}`} data-testid="audio-library">
        <header className="bg-head">
          <span>Your {LABEL[kind].many}</span>
          <button className="icon-btn" aria-label="Close" data-testid="audio-library-close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="al-body">
          <p className="muted small">
            {where === 'browser' ? 'Kept in this browser, for all the games you make in it.' : where === 'account' ? 'Kept with your claude.ai account: there in every game you make here.' : ' '} Add one to
            this game, or save the one open with the save button next to the library button.
          </p>
          {loading && !mine.length && <p className="muted small">Loading…</p>}
          {error && <p className="form-error">Your library couldn't be read ({error}).</p>}
          {problem && <p className="form-error">{problem}</p>}
          {!loading && !error && !mine.length && (
            <p className="muted small" data-testid="audio-library-empty">
              No {LABEL[kind].many} saved yet.
            </p>
          )}
          <ul className="al-list" data-testid="audio-library-list">
            {mine.map((item) => (
              <li key={item.id} className="al-row" data-testid={`library-item-${item.name}`}>
                {kind === 'sound' && (
                  <button className="icon-btn" title="Play" aria-label={`Play ${item.name}`} onClick={() => play(item)}>
                    ▶
                  </button>
                )}
                <span className="al-name">
                  {item.name}
                  {item.description && <span className="muted small"> · {item.description}</span>}
                </span>
                {deleting === item.id ? (
                  <>
                    <button className="chip-btn small danger" data-testid="library-delete-yes" onClick={() => void deleteFromLibrary(item.id).then(() => setDeleting(null), (e) => setProblem(`Not deleted: ${(e as Error).message}`))}>
                      Delete
                    </button>
                    <button className="chip-btn small" onClick={() => setDeleting(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <>
                    <button className="chip-btn small" data-testid="library-add" onClick={() => add(item)}>
                      Add to this game
                    </button>
                    <button className="icon-btn" title="Delete from your library" aria-label={`Delete ${item.name} from your library`} data-testid="library-delete" onClick={() => setDeleting(item.id)}>
                      🗑
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>,
    document.body,
  );
}
