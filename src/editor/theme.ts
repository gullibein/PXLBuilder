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
  /** Connection arrows and their labels: a light yellow. */
  link: '#ffe08f',
  /** Dark "ink" outlines for the blueprint-style annotations (connections and their labels). */
  ink: '#141a33',
  /** The red connector circles on a switch, and the line dragged from them. */
  connector: '#ff4d5e',
  /** Faint lines every few grid cells (drafting paper), or null for dots only. */
  gridMajor: null as string | null,
  /** Wireframe view: the ground and the line colors by kind of object. */
  wire: {
    ground: '#151a2b',
    solid: '#c9d1ff',
    character: '#8b7bff',
    danger: '#ff6b81',
    item: '#ffd166',
    trigger: '#7fd6c2',
    fill: 0.07,
    glow: 0,
    dash: false,
  },
  /** Font of the object name under a selection. */
  labelFont: "700 10px 'Figtree', ui-sans-serif, system-ui, sans-serif",
};

/** What each editor style changes on the canvas (the chrome follows `data-style` in styles.css). */
const STYLE_CANVAS: Record<string, Partial<typeof theme>> = {
  classic: {},
  blueprint: {
    gridDot: 'rgba(170, 200, 255, 0.3)',
    gridMajor: 'rgba(140, 185, 255, 0.09)',
    label: '#9fe0ff',
    labelShadow: 'rgba(5, 11, 32, 0.9)',
    labelFont: "700 10px 'JetBrains Mono', ui-monospace, monospace",
    ink: '#0a1230',
    wire: { ground: '#0f1d44', solid: '#e9f2ff', character: '#5cc8ff', danger: '#ff9f9f', item: '#ffe08f', trigger: '#9fe0ff', fill: 0.06, glow: 0, dash: false },
  },
  arcade: {
    gridDot: 'rgba(255, 60, 200, 0.35)',
    label: '#7ff6ff',
    labelShadow: 'rgba(255, 60, 200, 0.8)',
    labelFont: "400 10px 'Silkscreen', ui-monospace, monospace",
    connector: '#ff3cc8',
    wire: { ground: '#07060f', solid: '#00f0ff', character: '#ff3cc8', danger: '#ff3cc8', item: '#fff36b', trigger: '#7c5cff', fill: 0.05, glow: 8, dash: false },
  },
  paper: {
    gridDot: 'rgba(255, 255, 255, 0.22)',
    wire: { ground: '#f3eddf', solid: '#3b3424', character: '#5a4bd6', danger: '#c0392b', item: '#b7791f', trigger: '#6b8f71', fill: 0.05, glow: 0, dash: true },
  },
  amber: {
    gridDot: 'rgba(255, 176, 0, 0.3)',
    label: '#ffb000',
    labelShadow: 'rgba(255, 140, 0, 0.75)',
    labelFont: "400 15px 'VT323', ui-monospace, monospace",
    hover: 'rgba(255, 196, 80, 0.75)',
    link: '#ffc94d',
    connector: '#ff7a1a',
    wire: { ground: '#0b0803', solid: '#ffb000', character: '#ffd277', danger: '#ff7a1a', item: '#ffe3a1', trigger: '#b98516', fill: 0.05, glow: 7, dash: false },
  },
};

/** Styles with their own active color instead of the editor accent. */
const STYLE_SELECT: Record<string, string> = { amber: '#ffb000' };

const CANVAS_DEFAULTS = { ...theme };

/** Switches the editor style: CSS for the chrome (`data-style` on the page), theme values for the canvas. */
export function applyStyle(style: string): void {
  document.documentElement.dataset.style = style;
  const accentKeys = ['select', 'selectGlow', 'marqueeFill', 'marqueeStroke'] as const;
  const accent = Object.fromEntries(accentKeys.map((k) => [k, theme[k]]));
  Object.assign(theme, CANVAS_DEFAULTS, STYLE_CANVAS[style] ?? {}, accent);
  const own = STYLE_SELECT[style];
  if (own) {
    const [r, g, b] = lighten(own, 0);
    Object.assign(theme, { select: own, selectGlow: `rgba(${r}, ${g}, ${b}, 0.85)`, marqueeFill: `rgba(${r}, ${g}, ${b}, 0.12)`, marqueeStroke: `rgba(${r}, ${g}, ${b}, 0.9)` });
  }
}

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
