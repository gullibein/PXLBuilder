/**
 * An object's own editor panel (core/model/panels.ts), beside the selected copy whenever one is selected: sliders,
 * knobs or number fields for the settings the user chose with the AI ("Jump height", "Run speed"). Moving one
 * changes the object (every copy) as one undoable step. "Add panel…" (right-click) opens it with its prompt to
 * describe what it shows; ✦ on it opens that prompt again to change it. Never part of the game.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { componentRegistry } from '../../core/components/builtin';
import { contextKey, type AIContext } from '../../core/ai/context';
import { panelOf, panelValue, setPanelValue, type PanelControl } from '../../core/model/panels';
import { CHROME_INSETS } from '../viewport/Viewport';
import { useEditor } from '../store';
import { subscribeAnchor } from './anchor';
import { PromptBox } from './PromptBox';

export function ObjectPanel() {
  const selected = useEditor((s) => (s.selectedEntityIds.length === 1 ? s.selectedEntityIds[0] : null));
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.activeSceneId);
  const panelAsk = useEditor((s) => s.panelAsk);
  const panelOpen = useEditor((s) => s.panelOpen);
  const objectDrag = useEditor((s) => s.objectDrag);
  const entity = useMemo(() => (selected ? project.scenes.find((s) => s.id === sceneId)?.entities.find((e) => e.id === selected) : undefined), [project, sceneId, selected]);
  const def = entity?.definitionId ? project.definitions.find((d) => d.id === entity.definitionId) : undefined;
  const panel = panelOf(def);
  const asking = !!def && panelAsk === def.id;
  const ref = useRef<HTMLDivElement>(null);
  const anchorKey = selected ? contextKey({ kind: 'entity', sceneId, entityIds: [selected] }) : null;
  // Shown when its panel icon opened it (or while it is being described to the AI), not just because it is selected.
  const shown = !!def && ((panel && panelOpen === def.id) || asking) && !objectDrag;
  // Its prompt and the panel close when the object isn't the one selected any more (selected again: the panel icon opens it).
  useEffect(() => {
    if (panelAsk && panelAsk !== def?.id) useEditor.getState().setPanelAsk(null);
    if (panelOpen && panelOpen !== def?.id) useEditor.getState().setPanelOpen(null);
  }, [panelAsk, panelOpen, def?.id]);

  useEffect(() => {
    if (!shown || !anchorKey) return;
    const el = ref.current;
    if (!el) return;
    return subscribeAnchor((a) => {
      if (!a || !a.visible || a.key !== anchorKey) {
        el.style.visibility = 'hidden';
        return;
      }
      // Beside it, on the right (on the left when there's no room), level with it.
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const gap = 28;
      const x = a.rect.maxX + gap + w <= a.view.w - 12 ? a.rect.maxX + gap : Math.max(12, a.rect.minX - gap - w);
      const top = CHROME_INSETS.top + 12;
      const y = Math.min(Math.max(top, (a.rect.minY + a.rect.maxY) / 2 - h / 2), Math.max(top, a.view.h - CHROME_INSETS.bottom - 12 - h));
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      el.style.visibility = 'visible';
    });
  }, [shown, anchorKey, panel?.controls.length, asking]);

  if (!shown || !def) return null;
  const ctx: AIContext = { kind: 'object', sceneId, definitionId: def.id, panel: true };
  const set = (c: PanelControl, value: number) =>
    useEditor.getState().edit(`Change ${c.label}`, (p) => setPanelValue(p, def.id, c, round(value, c.step), componentRegistry), { coalesceKey: `panel.${def.id}.${c.label}` });
  return (
    <div ref={ref} className={`object-panel${asking ? ' asking' : ''}`} data-testid="object-panel" data-movable={`object-panel:${def.id}`} data-prompt-keep style={{ visibility: 'hidden' }} onPointerDown={(e) => e.stopPropagation()}>
      <header className="object-panel-head">
        <span data-testid="object-panel-title">{panel?.title ?? `${def.name}: new panel`}</span>
        <button
          className={`icon-btn${asking ? ' on' : ''}`}
          title={asking ? 'Close the prompt' : 'Change this panel (ask the AI)'}
          data-testid="object-panel-ask"
          onClick={() => useEditor.getState().setPanelAsk(asking ? null : def.id)}
        >
          ✦
        </button>
        <button
          className="icon-btn"
          title="Close the panel (the panel icon above the object opens it again)"
          aria-label="Close the panel"
          data-testid="object-panel-close"
          onClick={() => {
            useEditor.getState().setPanelAsk(null);
            useEditor.getState().setPanelOpen(null);
          }}
        >
          <svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true">
            <path d="m3.5 3.5 7 7m0-7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>
      {panel && (
        <div className="object-panel-controls">
          {panel.controls.map((c) => {
            const value = panelValue(def, c, componentRegistry);
            return (
              <div key={c.label} className={`panel-control ${c.control}`} data-testid={`panel-control-${c.label}`} data-kind={c.control}>
                <span className="panel-label">{c.label}</span>
                {value === null ? (
                  <span className="muted small">(gone)</span>
                ) : c.control === 'knob' ? (
                  <Knob control={c} value={value} onChange={(v) => set(c, v)} />
                ) : c.control === 'number' ? (
                  <NumberField control={c} value={value} onChange={(v) => set(c, v)} />
                ) : (
                  <>
                    <input type="range" min={c.min} max={c.max} step={c.step} value={value} data-testid="panel-slider" aria-label={c.label} onChange={(e) => set(c, Number(e.target.value))} />
                    <span className="panel-value" data-testid="panel-value">
                      {round(value, c.step)}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {asking && (
        <div className="object-panel-prompt">
          <PromptBox ctx={ctx} autoFocus placeholder={panel ? 'Change the panel: "make them knobs", "add gravity"…' : 'Which settings? "Jump height and run speed"'} testId="panel-prompt" onEscape={() => useEditor.getState().setPanelAsk(null)} />
        </div>
      )}
    </div>
  );
}

/**
 * The panel icon (a small square of sliders) above a selected object that has an editor panel, left of the AI ✦:
 * clicking it opens the object's panel, or closes it. Only one object selected, and not while it is dragged.
 */
export function PanelIcon() {
  const selected = useEditor((s) => (s.selectedEntityIds.length === 1 ? s.selectedEntityIds[0] : null));
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.activeSceneId);
  const panelOpen = useEditor((s) => s.panelOpen);
  const objectDrag = useEditor((s) => s.objectDrag);
  const entity = useMemo(() => (selected ? project.scenes.find((s) => s.id === sceneId)?.entities.find((e) => e.id === selected) : undefined), [project, sceneId, selected]);
  const def = entity?.definitionId ? project.definitions.find((d) => d.id === entity.definitionId) : undefined;
  const has = !!panelOf(def) && !objectDrag;
  const anchorKey = selected ? contextKey({ kind: 'entity', sceneId, entityIds: [selected] }) : null;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!has || !anchorKey) return;
    return subscribeAnchor((a) => {
      const el = ref.current;
      if (!el) return;
      if (!a || !a.visible || a.key !== anchorKey) {
        el.style.visibility = 'hidden';
        return;
      }
      // Where the ✦ is (ContextPrompt's AIStar), one button to its left.
      const x = a.star?.x ?? (a.rect.minX + a.rect.maxX) / 2;
      const above = (a.star?.y ?? a.rect.minY) - 28;
      const y = above < CHROME_INSETS.top ? a.rect.maxY + 10 : above;
      el.style.transform = `translate(${Math.round(x - 9 - 24)}px, ${Math.round(y)}px)`;
      el.style.visibility = 'visible';
    });
  }, [has, anchorKey]);
  if (!has || !def) return null;
  const open = panelOpen === def.id;
  return (
    <div className="context-layer">
      <button
        ref={ref}
        className={`ai-star panel-icon${open ? ' on' : ''}`}
        style={{ visibility: 'hidden' }}
        title={open ? 'Close the panel' : 'Open the panel'}
        aria-label={open ? 'Close the panel' : 'Open the panel'}
        aria-pressed={open}
        data-testid="panel-icon"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          const s = useEditor.getState();
          if (open) {
            s.setPanelAsk(null);
            s.setPanelOpen(null);
          } else s.setPanelOpen(def.id);
        }}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <rect x="0.75" y="0.75" width="8.5" height="8.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </button>
    </div>
  );
}

/** A value kept to the control's step (no 0.30000000000000004). */
function round(v: number, step: number): number {
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step)) + (step % 1 ? 1 : 0)));
  return Number((Math.round(v / step) * step).toFixed(decimals));
}

/** A plain number field: what is typed, when it is a number. */
function NumberField({ control, value, onChange }: { control: PanelControl; value: number; onChange: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      className="panel-number"
      step={control.step}
      value={text ?? String(round(value, control.step))}
      aria-label={control.label}
      data-testid="panel-number"
      onChange={(e) => {
        setText(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n)) onChange(n);
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** A knob: drag up or down (or scroll, or the arrow keys) to turn it; from 7 o'clock (min) to 5 o'clock (max). */
function Knob({ control, value, onChange }: { control: PanelControl; value: number; onChange: (v: number) => void }) {
  const { min, max, step } = control;
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const t = (clamp(value) - min) / (max - min);
  const angle = -135 + t * 270;
  const drag = useRef<{ y: number; from: number } | null>(null);
  const nudge = (steps: number) => onChange(clamp(round(value + steps * step, step)));
  return (
    <span className="knob-wrap">
      <svg
        className="knob"
        width="40"
        height="40"
        viewBox="-20 -20 40 40"
        role="slider"
        tabIndex={0}
        aria-label={control.label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        data-testid="panel-knob"
        onPointerDown={(e) => {
          (e.currentTarget as Element).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, from: clamp(value) };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          // 150 px of dragging turns it all the way.
          onChange(clamp(round(drag.current.from + ((drag.current.y - e.clientY) / 150) * (max - min), step)));
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => nudge(e.deltaY < 0 ? 1 : -1)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(1);
          else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(-1);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <path d={arc(-135, 135)} className="knob-track" />
        <circle r="14" className="knob-body" />
        <path d={arc(-135, angle)} className="knob-fill" />
        <line x1="0" y1="0" x2={Math.sin((angle * Math.PI) / 180) * 10} y2={-Math.cos((angle * Math.PI) / 180) * 10} className="knob-pointer" />
      </svg>
      <span className="panel-value" data-testid="panel-value">
        {round(value, step)}
      </span>
    </span>
  );
}

/** The ring from one angle to another (degrees, 0 = up, clockwise). */
function arc(from: number, to: number): string {
  const r = 18;
  const p = (a: number) => `${(Math.sin((a * Math.PI) / 180) * r).toFixed(2)} ${(-Math.cos((a * Math.PI) / 180) * r).toFixed(2)}`;
  return to - from < 0.5 ? '' : `M ${p(from)} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`;
}
