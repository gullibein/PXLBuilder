import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * PXLBuilder's own color picker (the browser's has no OK or Cancel): a
 * saturation/brightness square, a hue bar, the color as hex and as compact
 * R, G, B fields, the old and new color side by side, an eyedropper where
 * the browser has one, and OK / Cancel. Nothing changes until OK.
 */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})/i.exec(hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex);
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const d = max - Math.min(R, G, B);
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return [((h * 60) + 360) % 360, max ? d / max : 0, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

interface Props {
  /** The color now ("#rrggbb"). */
  value: string;
  /** OK: the chosen color ("#rrggbb"). */
  onPick(color: string): void;
  /** What opens it: shown as the button (a swatch, "+"). */
  children: ReactNode;
  className?: string;
  title?: string;
  ariaLabel?: string;
  testId?: string;
  style?: React.CSSProperties;
}

/** A button that opens the color picker. */
export function ColorButton(props: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button type="button" ref={ref} className={props.className} title={props.title} aria-label={props.ariaLabel} data-testid={props.testId} style={props.style} onClick={() => setOpen(!open)}>
        {props.children}
      </button>
      {open && ref.current && (
        <ColorPicker
          anchor={ref.current}
          value={props.value}
          onCancel={() => setOpen(false)}
          onOk={(c) => {
            setOpen(false);
            props.onPick(c);
          }}
        />
      )}
    </>
  );
}

type EyeDropperCtor = new () => { open(): Promise<{ sRGBHex: string }> };

function ColorPicker({ anchor, value, onOk, onCancel }: { anchor: HTMLElement; value: string; onOk(c: string): void; onCancel(): void }) {
  const [hsv, setHsv] = useState(() => rgbToHsv(...hexToRgb(value)));
  const [hexText, setHexText] = useState(value.slice(0, 7));
  const sqRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const rgb = hsvToRgb(...hsv);
  const color = rgbToHex(...rgb);
  useEffect(() => setHexText(color), [color]);
  // Placed under its button (above it when there is no room below), kept on the screen.
  const r = anchor.getBoundingClientRect();
  const W = 232;
  const H = 300;
  const left = clamp(r.left, 8, window.innerWidth - W - 8);
  const top = r.bottom + 6 + H < window.innerHeight ? r.bottom + 6 : Math.max(8, r.top - H - 6);
  useEffect(() => boxRef.current?.focus(), []);
  // A click outside cancels (as Esc does).
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onCancel();
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [anchor, onCancel]);
  const pickSquare = (e: React.PointerEvent) => {
    const b = sqRef.current!.getBoundingClientRect();
    setHsv([hsv[0], clamp((e.clientX - b.left) / b.width, 0, 1), 1 - clamp((e.clientY - b.top) / b.height, 0, 1)]);
  };
  const setRgb = (i: number, v: number) => {
    const next = [...rgb] as [number, number, number];
    next[i] = clamp(Math.round(v) || 0, 0, 255);
    setHsv(rgbToHsv(...next));
  };
  const Dropper = (window as { EyeDropper?: EyeDropperCtor }).EyeDropper;
  return createPortal(
    <div
      ref={boxRef}
      className="color-picker"
      role="dialog"
      aria-label="Pick a color"
      data-testid="color-picker"
      tabIndex={-1}
      style={{ left, top, width: W }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onCancel();
        else if (e.key === 'Enter') onOk(color);
      }}
    >
      <div
        ref={sqRef}
        className="cp-square"
        data-testid="cp-square"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv[0]} 100% 50%))` }}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          pickSquare(e);
        }}
        onPointerMove={(e) => e.buttons & 1 && pickSquare(e)}
      >
        <span className="cp-knob" style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }} />
      </div>
      <input className="cp-hue" type="range" min={0} max={359} value={Math.round(hsv[0])} aria-label="Hue" data-testid="cp-hue" onChange={(e) => setHsv([Number(e.target.value), hsv[1], hsv[2]])} />
      <div className="cp-row">
        <span className="cp-compare" title="Before · now">
          <span style={{ background: value.slice(0, 7) }} />
          <span style={{ background: color }} data-testid="cp-new" />
        </span>
        <input
          className="cp-hex"
          value={hexText}
          aria-label="Hex"
          data-testid="cp-hex"
          spellCheck={false}
          onChange={(e) => {
            setHexText(e.target.value);
            if (/^#?[0-9a-f]{6}$/i.test(e.target.value.trim())) setHsv(rgbToHsv(...hexToRgb(e.target.value.trim().replace(/^#?/, '#'))));
          }}
        />
        {Dropper && (
          <button
            type="button"
            className="icon-btn cp-dropper"
            title="Pick a color from the screen"
            aria-label="Pick a color from the screen"
            onClick={async () => {
              try {
                const res = await new Dropper().open();
                setHsv(rgbToHsv(...hexToRgb(res.sRGBHex)));
              } catch {
                // Cancelled.
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10.5 2.5a1.8 1.8 0 0 1 2.6 2.6L11.5 6.7l.8.8-1.1 1.1-.8-.8-5.2 5.2H3.3v-1.9l5.2-5.2-.8-.8L8.8 4l.8.8z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </div>
      <div className="cp-rgb">
        {(['R', 'G', 'B'] as const).map((c, i) => (
          <label key={c}>
            <input type="number" min={0} max={255} value={rgb[i]} aria-label={c} data-testid={`cp-${c.toLowerCase()}`} onChange={(e) => setRgb(i, Number(e.target.value))} />
            <span>{c}</span>
          </label>
        ))}
      </div>
      <footer className="cp-actions">
        <button type="button" className="chip-btn" data-testid="cp-cancel" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" data-testid="cp-ok" onClick={() => onOk(color)}>
          OK
        </button>
      </footer>
    </div>,
    document.body,
  );
}
