import { useEffect, useRef, useState } from 'react';
import { renameProject } from '../../core/model/mutations';
import { PROJECT_FILE_EXTENSION, saveProjectToFile, slugify } from '../persistence';
import { useEditor } from '../store';

/** Save: the game's name (renamed if changed, one Undo step), then the file is saved under it. */
export function SaveDialog() {
  const open = useEditor((s) => s.saveDialog);
  const name = useEditor((s) => s.project.name);
  const [text, setText] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setText(name);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [open]);
  if (!open) return null;
  const close = () => useEditor.getState().setSaveDialog(false);
  const save = () => {
    const next = text.trim();
    if (!next) return;
    if (next !== name) useEditor.getState().edit(`Rename game to ${next}`, (p) => renameProject(p, next));
    close();
    void saveProjectToFile();
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog" role="dialog" aria-label="Save game" data-testid="save-dialog" onKeyDown={(e) => e.stopPropagation()}>
        <header className="bg-head">
          <span>Save game</span>
        </header>
        <label className="se-row">
          <span>Name</span>
          <input
            ref={inputRef}
            value={text}
            maxLength={80}
            data-testid="save-name"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              else if (e.key === 'Escape') close();
            }}
          />
        </label>
        <p className="muted small">
          Saved as <code data-testid="save-filename">{(slugify(text.trim()) || 'project') + PROJECT_FILE_EXTENSION}</code>. Renaming here renames the game too.
        </p>
        <footer className="se-footer">
          <span className="grow" />
          <button className="chip-btn" onClick={close}>
            Cancel
          </button>
          <button className="primary-btn" data-testid="save-confirm" disabled={!text.trim()} onClick={save}>
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}
