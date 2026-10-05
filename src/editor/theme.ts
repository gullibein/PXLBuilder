/** Canvas-side colors and fonts (the DOM chrome uses the matching CSS tokens in editor.css). */
export const theme = {
  uiFont: "'Figtree', ui-sans-serif, system-ui, sans-serif",
  /** The "active" color: selection, relation arrows, AI context, brush. */
  select: '#8b7bff',
  selectGlow: 'rgba(139, 123, 255, 0.85)',
  handle: '#ffffff',
  hover: 'rgba(255, 255, 255, 0.7)',
  label: '#ffffff',
  labelShadow: 'rgba(20, 16, 50, 0.85)',
  gridDot: 'rgba(255, 255, 255, 0.28)',
  marqueeFill: 'rgba(139, 123, 255, 0.12)',
  marqueeStroke: 'rgba(139, 123, 255, 0.9)',
  erase: '#ff5d73',
  /** Existing connections between objects (relationships). */
  logic: '#ffc65c',
  /** The red connector circles on a switch, and the line dragged from them. */
  connector: '#ff4d5e',
};

/** Mixes a #rrggbb color toward white by `amount` (0..1). */
function lighten(hex: string, amount: number): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  const ch = (v: number) => Math.round(v + (255 - v) * amount);
  return [ch((n >> 16) & 255), ch((n >> 8) & 255), ch(n & 255)];
}

/** Follows the editor accent color (an editor setting): CSS variables for the chrome, theme colors for the canvas. */
export function applyAccent(hex: string): void {
  const color = /^#[0-9a-f]{3}$/i.test(hex) ? `#${[...hex.slice(1)].map((c) => c + c).join('')}` : hex;
  if (!/^#[0-9a-f]{6}/i.test(color)) return;
  document.documentElement.style.setProperty('--accent', color.slice(0, 7));
  const [r, g, b] = lighten(color, 0.12);
  theme.select = `rgb(${r}, ${g}, ${b})`;
  theme.selectGlow = `rgba(${r}, ${g}, ${b}, 0.85)`;
  theme.marqueeFill = `rgba(${r}, ${g}, ${b}, 0.12)`;
  theme.marqueeStroke = `rgba(${r}, ${g}, ${b}, 0.9)`;
}
