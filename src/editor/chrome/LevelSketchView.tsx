import { useEffect, useRef, useState } from 'react';
import type { LevelSketch, StreamedDrawing } from '../../core/ai/streamDrawings';
import { normalizePixelArt, pixelArtToSvg } from '../../core/model/pixelArt';
import type { Project } from '../../core/types';

/** The widest and tallest the drawing gets (CSS px). */
const MAX_W = 400;
const MAX_H = 230;

/** A guess at what a character stands for, by the object's name (or the character itself): a color and a shape. */
function guess(char: string, object: string): { color: string; shape: 'block' | 'ladder' | 'dot' | 'thing' | 'liquid' | 'plank' | 'rampR' | 'rampL' | 'flag' } {
  const n = `${object} ${char}`.toLowerCase();
  if (/lava|fire/.test(n)) return { color: '#e2552b', shape: 'liquid' };
  if (/water|acid|liquid|~/.test(n)) return { color: '#3b82c4', shape: 'liquid' };
  if (/ladder|vine|rope|chain/.test(n) || char === 'H') return { color: '#a0703f', shape: 'ladder' };
  if (/ramp left|slope ?left/.test(n) || char === '\\') return { color: '#6b8f4e', shape: 'rampL' };
  if (/ramp|slope/.test(n) || char === '/') return { color: '#6b8f4e', shape: 'rampR' };
  if (/bridge|plank|jump.?through|cloud|bar\b/.test(n) || char === '-') return { color: '#b07a43', shape: 'plank' };
  if (/coin|gem|star|key|diamond|crystal|heart/.test(n)) return { color: '#f2c94c', shape: 'dot' };
  if (/goal|flag|exit|door/.test(n) || char === 'G') return { color: '#8fe388', shape: 'flag' };
  if (/player|hero/.test(n) || char === 'P') return { color: '#4fa3ff', shape: 'thing' };
  if (/enemy|slime|bat|monster|ghost|spider|guard|blob|frog/.test(n) || char === 'E') return { color: '#e5534b', shape: 'thing' };
  if (/crate|barrel|box/.test(n) || char === 'B') return { color: '#b07a43', shape: 'thing' };
  if (/spike|hazard/.test(n) || char === '^') return { color: '#c2c3c7', shape: 'thing' };
  if (/teleport|portal/.test(n) || char === 'T') return { color: '#b77cff', shape: 'thing' };
  return { color: '#7b8496', shape: 'block' };
}

const imageCache = new Map<string, HTMLImageElement>();

/**
 * The level the AI is drawing (its draw_map, row by row as the answer comes in), drawn small: each object as its
 * picture (the AI's drawing of it as soon as there is one, else the game's own) or, until then, a shape that says
 * what it is. The row being written is marked.
 */
export function LevelSketchView({ sketch, drawings, project }: { sketch: LevelSketch; drawings: StreamedDrawing[]; project: Project }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(0);
  const cols = Math.max(1, ...sketch.rows.map((r) => [...r].length));
  // (The rows so far and one more: it grows downward as rows come.)
  const shownRows = sketch.rows.length + 1;
  const cell = Math.max(3, Math.min(16, Math.floor(Math.min(MAX_W / cols, MAX_H / shownRows))));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cols * cell * dpr;
    canvas.height = shownRows * cell * dpr;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cols * cell, shownRows * cell);
    const legend = new Map(sketch.legend.map((l) => [[...l.char][0], l.object]));
    const pictureOf = (object: string): string | null => {
      const name = (sketch.names[object] ?? object).toLowerCase();
      const d = drawings.find((x) => x.id === object || x.name.toLowerCase() === name || x.name.toLowerCase() === object.toLowerCase());
      if (d) {
        try {
          return `data:image/svg+xml;utf8,${encodeURIComponent(pixelArtToSvg(normalizePixelArt({ palette: d.palette, rows: d.rows })))}`;
        } catch {
          return null;
        }
      }
      const def = project.definitions.find((x) => x.id === object || x.name.toLowerCase() === name);
      const assetId = def?.components.Sprite?.assetId;
      const asset = typeof assetId === 'string' ? project.assets.find((a) => a.id === assetId) : undefined;
      return asset?.data ?? null;
    };
    sketch.rows.forEach((row, j) => {
      [...row].forEach((ch, i) => {
        const object = legend.get(ch);
        if (!object || ch === '.' || ch === ' ') return;
        const x = i * cell;
        const y = j * cell;
        const url = pictureOf(object);
        if (url) {
          let img = imageCache.get(url);
          if (!img) {
            img = new Image();
            img.onload = () => setLoaded((n) => n + 1);
            img.src = url;
            imageCache.set(url, img);
          }
          if (img.complete && img.naturalWidth) {
            g.drawImage(img, x, y, cell, cell);
            return;
          }
        }
        const { color, shape } = guess(ch, object);
        g.fillStyle = color;
        if (shape === 'block' || shape === 'liquid') g.fillRect(x, y, cell, cell);
        else if (shape === 'plank') g.fillRect(x, y, cell, Math.max(1, cell / 4));
        else if (shape === 'ladder') {
          g.fillRect(x + cell * 0.2, y, Math.max(1, cell / 8), cell);
          g.fillRect(x + cell * 0.7, y, Math.max(1, cell / 8), cell);
          g.fillRect(x + cell * 0.2, y + cell * 0.45, cell * 0.6, Math.max(1, cell / 8));
        } else if (shape === 'rampR' || shape === 'rampL') {
          g.beginPath();
          g.moveTo(shape === 'rampR' ? x : x + cell, y + cell);
          g.lineTo(shape === 'rampR' ? x + cell : x, y);
          g.lineTo(shape === 'rampR' ? x + cell : x, y + cell);
          g.fill();
        } else if (shape === 'dot') g.fillRect(x + cell * 0.3, y + cell * 0.3, cell * 0.4, cell * 0.4);
        else if (shape === 'flag') {
          g.fillRect(x + cell * 0.25, y + cell * 0.1, Math.max(1, cell / 8), cell * 0.9);
          g.fillRect(x + cell * 0.25, y + cell * 0.1, cell * 0.5, cell * 0.35);
        } else g.fillRect(x + cell * 0.15, y + cell * 0.15, cell * 0.7, cell * 0.85);
        if (shape === 'liquid') {
          g.globalAlpha = 0.35;
          g.fillStyle = '#ffffff';
          g.fillRect(x, y, cell, Math.max(1, cell / 6));
          g.globalAlpha = 1;
        }
      });
    });
    // The pen: under the last row written, while more are coming.
    g.fillStyle = 'rgba(160, 140, 255, 0.85)';
    g.fillRect(0, sketch.rows.length * cell, cols * cell, Math.max(1, cell / 5));
  }, [sketch, drawings, project, cols, cell, shownRows, loaded]);

  return (
    <figure className="ngp-sketch" data-testid="new-game-sketch" data-rows={sketch.rows.length}>
      <canvas ref={ref} style={{ width: cols * cell, height: shownRows * cell }} />
      <figcaption>The level, as the AI draws it ({sketch.rows.length} rows so far)</figcaption>
    </figure>
  );
}
