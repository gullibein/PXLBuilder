import { EDITOR_STYLES, type EditorStyle } from '../layout/settings';
import { useEditor } from '../store';

const STYLE_INFO: Record<EditorStyle, { name: string; blurb: string }> = {
  classic: { name: 'Classic', blurb: 'The default: dark and calm, soft shadows.' },
  blueprint: { name: 'Blueprint', blurb: 'A technical drawing: ink outlines, hard shadows, paper cards.' },
  arcade: { name: 'Arcade', blurb: 'Neon on black, pixel-font headings.' },
  paper: { name: 'Paper', blurb: 'A light, warm editor.' },
  amber: { name: 'Amber terminal', blurb: 'An old monitor: amber glow on black, scanlines.' },
};

/**
 * Picks the editor's look. Only the editor changes (bars, panels, prompt
 * cards, the grid); the game looks the same in every style. Saved in this
 * browser like the other editor settings, with the editor's own undo.
 */
export function StylePicker() {
  const open = useEditor((s) => s.stylePickerOpen);
  const setOpen = useEditor((s) => s.setStylePickerOpen);
  const current = useEditor((s) => s.layout.editorStyle);
  const setLayout = useEditor((s) => s.setLayout);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <section className="dialog style-dialog" role="dialog" aria-label="Editor style" data-testid="style-picker">
        <header className="bg-head">
          <span>Editor style</span>
          <button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <div className="style-grid" role="radiogroup" aria-label="Editor style">
          {EDITOR_STYLES.map((s) => (
            <button key={s} role="radio" aria-checked={current === s} className={`style-card${current === s ? ' on' : ''}`} data-testid={`style-${s}`} onClick={() => setLayout({ editorStyle: s })}>
              <span className={`style-preview preview-${s}`} aria-hidden="true">
                <span className="pv-bar" />
                <span className="pv-panel" />
                <span className="pv-card" />
                <span className="pv-play" />
              </span>
              <span className="style-name">{STYLE_INFO[s].name}</span>
              <span className="style-blurb">{STYLE_INFO[s].blurb}</span>
            </button>
          ))}
        </div>
        <p className="muted small">Only the editor changes; your game looks the same. You can also ask the ✦ Editor prompt, e.g. "make the editor look like a blueprint".</p>
      </section>
    </div>
  );
}
