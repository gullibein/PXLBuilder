import { useEffect, useState } from 'react';
import { ACTION_LABELS, CONTROL_ACTIONS, DEFAULT_CONTROLS, controlsOf, keyLabel, type ControlAction, type Controls } from '../../core/model/controls';
import * as m from '../../core/model/mutations';
import { useEditor } from '../store';

/**
 * The game's controls: which keys do what (move, jump, action, fire, menu). Each action's keys are shown as chips:
 * × takes one off, "+ Key" waits for the next key pressed (a key another action had moves here). Saved in the game,
 * as one undoable step each; Play, exported games and the key hints use them. (The AI changes them with set_controls.)
 */
export function ControlsDialog() {
  const open = useEditor((s) => s.controlsOpen);
  const own = useEditor((s) => s.project.settings.controls);
  const [listening, setListening] = useState<ControlAction | null>(null);
  const close = () => {
    setListening(null);
    useEditor.getState().setControlsOpen(false);
  };
  const save = (next: Controls, label: string) => useEditor.getState().edit(label, (p) => m.setControls(p, next));
  const keys = controlsOf(own);

  /** The game's controls with `action` given these keys (a key another action had is taken off it). */
  const withKeys = (action: ControlAction, list: string[]): Controls => {
    const all: Record<string, string[]> = { ...keys, [action]: list };
    for (const a of CONTROL_ACTIONS) if (a !== action) all[a] = keys[a].filter((k) => !list.includes(k));
    // Only what differs from the engine's keys is kept in the game (later engine changes still reach the rest).
    const next: Controls = {};
    for (const a of CONTROL_ACTIONS) if (all[a].length && all[a].join() !== DEFAULT_CONTROLS[a].join()) next[a] = all[a];
    return next;
  };

  useEffect(() => {
    if (!listening) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const code = e.code;
      if (!code) return;
      const now = keys[listening];
      if (!now.includes(code)) save(withKeys(listening, [...now, code].slice(-4)), `Controls: ${keyLabel(code)} for ${ACTION_LABELS[listening].split(' (')[0]}`);
      setListening(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!open) return null;
  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="dialog controls-dialog" role="dialog" aria-label="Controls" data-testid="controls-dialog" onKeyDown={(e) => !listening && e.key === 'Escape' && close()}>
        <header className="bg-head">
          <span>Controls</span>
          <button className="icon-btn" aria-label="Close" data-testid="controls-close" onClick={close}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </header>
        <p className="muted small">Which keys do what in this game, in Play and in exported games. Game controllers and touch buttons stay as they are. You can also ask the AI ("use WASD to move and J to jump").</p>
        <div className="controls-list">
          {CONTROL_ACTIONS.map((a) => (
            <div key={a} className="controls-row" data-testid={`controls-${a}`}>
              <span className="controls-action">{ACTION_LABELS[a]}</span>
              <span className="controls-keys">
                {keys[a].map((k) => (
                  <span key={k} className="chip-btn on controls-key" data-testid="controls-key">
                    {keyLabel(k)}
                    {keys[a].length > 1 && (
                      <button className="controls-remove" aria-label={`Remove ${keyLabel(k)}`} data-testid="controls-remove" onClick={() => save(withKeys(a, keys[a].filter((x) => x !== k)), `Controls: no ${keyLabel(k)} for ${ACTION_LABELS[a].split(' (')[0]}`)}>
                        ×
                      </button>
                    )}
                  </span>
                ))}
                {keys[a].length < 4 && (
                  <button className={`chip-btn${listening === a ? ' listening' : ''}`} data-testid="controls-add" onClick={() => setListening(listening === a ? null : a)}>
                    {listening === a ? 'Press a key…' : '+ Key'}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
        <footer className="controls-foot">
          <button className="text-btn" data-testid="controls-reset" disabled={!own} onClick={() => save({}, "Controls: the engine's keys")}>
            Back to the engine's keys
          </button>
          <button className="btn-primary" onClick={close}>
            Done
          </button>
        </footer>
      </section>
    </div>
  );
}
