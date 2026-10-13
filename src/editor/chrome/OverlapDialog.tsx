import { useEditor } from '../store';

/**
 * Placing objects over ones already there (dropping, drawing, stretching a row): Overwrite deletes what was there
 * and puts the new ones in its place; Add puts them on top, both kept. Esc or a click outside: nothing is placed.
 */
export function OverlapDialog() {
  const ask = useEditor((s) => s.overlapAsk);
  if (!ask) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && ask.resolve(null)}>
      <section
        className="dialog overlap-dialog"
        role="dialog"
        aria-label="Overwrite or add"
        data-testid="overlap-dialog"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') ask.resolve(null);
          else if (e.key.toLowerCase() === 'o') ask.resolve('overwrite');
          else if (e.key.toLowerCase() === 'a') ask.resolve('add');
        }}
      >
        <header className="bg-head">
          <span>Something is already there</span>
        </header>
        <p className="small">
          {ask.placing} would go over {ask.covered}.
        </p>
        <p className="muted small">
          <b>Overwrite</b> deletes {ask.count === 1 ? 'it' : `those ${ask.count}`} and puts {ask.placing} in {ask.count === 1 ? 'its' : 'their'} place. <b>Add</b> puts {ask.placing} on top and keeps both. (Undo takes either back.)
        </p>
        <footer className="se-footer">
          <button className="chip-btn" data-testid="overlap-cancel" onClick={() => ask.resolve(null)}>
            Cancel
          </button>
          <span className="grow" />
          <button className="chip-btn" data-testid="overlap-add" onClick={() => ask.resolve('add')} title="Keep what is there too (A)">
            Add
          </button>
          <button className="primary-btn" data-testid="overlap-overwrite" onClick={() => ask.resolve('overwrite')} title="Replace what is there (O)" autoFocus>
            Overwrite
          </button>
        </footer>
      </section>
    </div>
  );
}
