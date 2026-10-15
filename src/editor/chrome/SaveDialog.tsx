import { useEffect, useRef, useState } from 'react';
import { renameProject } from '../../core/model/mutations';
import { withoutUnused } from '../../core/model/unused';
import { canReplaceFiles, PROJECT_FILE_EXTENSION, savedFileName, saveProjectToFile, slugify } from '../persistence';
import { useEditor } from '../store';

const DROP_KEY = 'pxlbuilder.saveDropUnused';
function readDrop(): boolean {
  try {
    return localStorage.getItem(DROP_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Save: the game's name (renamed if changed, one Undo step), whether to leave
 * out unused objects, then the file is saved under it (over the file it was
 * saved to before, where the browser allows it).
 */
export function SaveDialog() {
  const open = useEditor((s) => s.saveDialog);
  const name = useEditor((s) => s.project.name);
  const project = useEditor((s) => s.project);
  const [text, setText] = useState(name);
  const [dropUnused, setDropUnused] = useState(readDrop);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setText(name);
    requestAnimationFrame(() => inputRef.current?.select());
  }, [open]);
  if (!open) return null;
  const unused = withoutUnused(project).objects;
  const replaces = savedFileName(project.id);
  const close = () => useEditor.getState().setSaveDialog(false);
  const save = (asNew = false) => {
    const next = text.trim();
    if (!next) return;
    if (next !== name) useEditor.getState().edit(`Rename game to ${next}`, (p) => renameProject(p, next));
    close();
    void saveProjectToFile({ dropUnused: dropUnused && unused.length > 0, asNew });
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
          {replaces ? (
            <>
              Saves over <code data-testid="save-replaces">{replaces}</code> (the file you saved it to). Renaming here renames the game too.
            </>
          ) : (
            <>
              Saved as <code data-testid="save-filename">{(slugify(text.trim()) || 'project') + PROJECT_FILE_EXTENSION}</code>
              {canReplaceFiles() ? ' (you choose where; the next Save writes over it)' : ''}. Renaming here renames the game too.
            </>
          )}
        </p>
        <label className="save-check" title={unused.length ? `Not placed in any level and not used by anything that is: ${unused.join(', ')}` : undefined}>
          <input
            type="checkbox"
            checked={dropUnused}
            data-testid="save-drop-unused"
            onChange={(e) => {
              setDropUnused(e.target.checked);
              try {
                localStorage.setItem(DROP_KEY, e.target.checked ? '1' : '0');
              } catch {
                // Not remembered; fine.
              }
            }}
          />
          <span>
            Leave out objects no level uses{' '}
            <span className="muted" data-testid="save-unused-count">
              ({unused.length ? `${unused.length}: ${unused.slice(0, 4).join(', ')}${unused.length > 4 ? '…' : ''}` : 'none'})
            </span>
            <br />
            <span className="muted small">Only in the file: they stay in the editor. Objects that scripts create are kept.</span>
          </span>
        </label>
        <footer className="se-footer">
          <span className="grow" />
          <button className="chip-btn" onClick={close}>
            Cancel
          </button>
          {replaces && (
            <button className="chip-btn" data-testid="save-as-new" disabled={!text.trim()} onClick={() => save(true)}>
              Save as new file…
            </button>
          )}
          <button className="primary-btn" data-testid="save-confirm" disabled={!text.trim()} onClick={() => save()}>
            Save
          </button>
        </footer>
      </section>
    </div>
  );
}
