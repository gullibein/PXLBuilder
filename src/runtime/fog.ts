/**
 * Fog of war (the Fog Of War component, on the player): only what it can see is shown, the squares within its
 * sight radius that no wall hides (a line from its square to theirs passes no solid square); squares it has seen
 * before stay dim (remember), the rest is dark. Creatures (things with health) out of its sight are not drawn at
 * all. Worked out on the level's 32 px squares, again only when the viewer changes square or something solid moved.
 */
import type { RuntimeEntity } from './runtime';

const CELL = 32;
const cellOf = (v: number) => Math.floor(v / CELL);

export class Fog {
  readonly radius: number;
  readonly remember: boolean;
  readonly color: string;
  readonly dim: number;
  /** The squares the fog covers (the level's extent). */
  readonly bounds: { i0: number; j0: number; i1: number; j1: number };
  readonly explored = new Set<string>();
  visible = new Set<string>();
  private seenFrom = '';

  constructor(
    readonly viewer: RuntimeEntity,
    entities: RuntimeEntity[],
    props: Record<string, unknown>,
  ) {
    const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
    this.radius = Math.max(1, Math.min(40, num(props.radius, 6)));
    this.remember = props.remember !== false;
    this.color = typeof props.color === 'string' ? props.color : '#000000';
    this.dim = Math.min(1, Math.max(0, num(props.dim, 0.6)));
    let i0 = Infinity;
    let j0 = Infinity;
    let i1 = -Infinity;
    let j1 = -Infinity;
    for (const e of entities) {
      i0 = Math.min(i0, cellOf(e.x));
      j0 = Math.min(j0, cellOf(e.y));
      i1 = Math.max(i1, cellOf(e.x));
      j1 = Math.max(j1, cellOf(e.y));
    }
    this.bounds = Number.isFinite(i0) ? { i0: i0 - 1, j0: j0 - 1, i1: i1 + 1, j1: j1 + 1 } : { i0: 0, j0: 0, i1: 0, j1: 0 };
  }

  /** Works out what is seen now (when the viewer is on another square, or `force`: something solid moved). */
  update(solidCells: Set<string>, force = false): void {
    if (!this.viewer.alive) return;
    const ci = cellOf(this.viewer.x);
    const cj = cellOf(this.viewer.y);
    const from = `${ci},${cj}`;
    if (!force && from === this.seenFrom) return;
    this.seenFrom = from;
    const seen = new Set<string>([from]);
    const r = Math.ceil(this.radius);
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (di * di + dj * dj > this.radius * this.radius) continue;
        if (this.lineClear(ci, cj, ci + di, cj + dj, solidCells)) seen.add(`${ci + di},${cj + dj}`);
      }
    this.visible = seen;
    for (const k of seen) this.explored.add(k);
  }

  /** No solid square between the two (the ends themselves may be: a wall is seen, not what is behind it). */
  private lineClear(x0: number, y0: number, x1: number, y1: number, solid: Set<string>): boolean {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      if (x === x1 && y === y1) return true;
      if (!(x === x0 && y === y0) && solid.has(`${x},${y}`)) return false;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  sees(x: number, y: number): boolean {
    return this.visible.has(`${cellOf(x)},${cellOf(y)}`);
  }

  /** How dark each square is: 0 seen now, dim seen before (remember), 1 never seen. */
  shade(i: number, j: number): number {
    const k = `${i},${j}`;
    if (this.visible.has(k)) return 0;
    return this.remember && this.explored.has(k) ? this.dim : 1;
  }
}

/** Draws the fog over the level (world coordinates on ctx), one rectangle per run of equally dark squares. */
export function drawFog(ctx: CanvasRenderingContext2D, fog: Fog): void {
  const { i0, j0, i1, j1 } = fog.bounds;
  const before = ctx.globalAlpha;
  ctx.fillStyle = fog.color;
  for (let j = j0; j <= j1; j++) {
    let start = i0;
    let shade = fog.shade(i0, j);
    for (let i = i0 + 1; i <= i1 + 1; i++) {
      const s = i <= i1 ? fog.shade(i, j) : -1;
      if (s === shade) continue;
      if (shade > 0) {
        ctx.globalAlpha = before * shade;
        // (A hair wider, so no seams show between squares when zoomed.)
        ctx.fillRect(start * CELL - 0.25, j * CELL - 0.25, (i - start) * CELL + 0.5, CELL + 0.5);
      }
      start = i;
      shade = s;
    }
  }
  ctx.globalAlpha = before;
}
