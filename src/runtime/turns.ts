/**
 * The turn-based kit: what tactics games, RPG battles and menus need, run by the engine so a script only says what
 * it wants (scripts drive it with the statements menu, cursor, highlight, walk_to, start_turns, give_turn, done,
 * end_turn and popup; they read menu_choice, cursor_x, turn_team, my_turn… and hear menu_chosen, cursor_chosen, arrived,
 * turn_started, unit_turn).
 *
 * - A menu: a list of choices in a box on the screen; up and down pick, X / Space / E choose, Esc goes back.
 * - A grid cursor: a square moved over the level's grid squares by the arrow keys; choosing tells its owner.
 * - Highlighted squares: where a unit can walk in so many steps (around walls and other units), or what it can
 *   reach from where it stands (a range), drawn under everything; scripts ask whether a square is in one.
 * - Walking along the shortest way, square by square (walk_to), to a square or as near as it gets.
 * - Turns: teams (tags) take turns; on a team's turn each of its units gets its go (unit_turn), one after another,
 *   or, for a team the player picks from ("pick"), the one chosen with the cursor; a unit's go ends with done.
 *   When every unit of the team has had its go, the next team's turn starts (turn_started).
 * - Numbers that rise and fade over a unit (popup: "-12", "Miss!").
 *
 * While a menu or the cursor is up, the arrow and action keys go to them: nothing else moves by the keys.
 * Its look is drawn as the game's own drawings (in the game's pixel grid), so it fits any game.
 */
import type { InputState } from './input';
import type { RuntimeEntity, ScreenDrawing } from './runtime';

/** The level's grid square size (level pixels). */
export const CELL = 32;
const cellOf = (v: number) => Math.floor(v / CELL);
const centerOf = (i: number) => i * CELL + CELL / 2;
const key = (i: number, j: number) => `${i},${j}`;

type Anchor = ScreenDrawing['anchor'];

/** What the kit needs from the runtime (kept small: tests can give a stand-in). */
export interface KitHost {
  entities: RuntimeEntity[];
  time: number;
  drawings: Map<string, ScreenDrawing>;
  /** The play screen's size (px), for placing the menu. */
  screen: { w: number; h: number };
  solidAtPoint(x: number, y: number): boolean;
  /** Tells an entity's scripts (and rules, and the play log) that something happened to it. */
  emit(type: string, subject: RuntimeEntity | null, other?: RuntimeEntity | null): void;
  report(message: string): void;
}

interface Menu {
  owner: RuntimeEntity;
  title: string;
  items: string[];
  index: number;
  cancel: boolean;
  at: Exclude<Anchor, 'world'>;
}

interface Team {
  tag: string;
  pick: boolean;
}

const KIT = '\u0000kit';
const WALK_SPEED = 160;
/** A unit of a team that plays by itself that hasn't said done after this long: its go is over (and it is said). */
const GO_LIMIT = 20;

export class TurnKit {
  menu: Menu | null = null;
  /** The last choice made in a menu (by its owner), and its place in the list (1 = the first). */
  choice = '';
  choiceNumber = 0;
  cursor: { owner: RuntimeEntity | null; i: number; j: number; held: number } | null = null;
  readonly highlights = new Map<string, { owner: RuntimeEntity; cells: Set<string>; color: string }>();
  readonly walks = new Map<RuntimeEntity, { path: { x: number; y: number }[]; speed: number }>();
  popups: { x: number; y: number; text: string; color: string; t: number }[] = [];
  /** "HERO TURN" across the screen for a moment when a team's turn starts. */
  banner: { text: string; t: number } | null = null;
  turns: { teams: Team[]; index: number; number: number; acting: RuntimeEntity | null; actingSince: number; acted: Set<RuntimeEntity> } | null = null;

  constructor(private readonly host: KitHost) {}

  /** The keys go to a menu or the cursor now (nothing else is steered by them). */
  capturing(): boolean {
    return this.menu !== null || this.cursor !== null;
  }

  // ------------------------------------------------------------------ menu

  openMenu(owner: RuntimeEntity, items: string[], title: string, cancel: boolean, at: Exclude<Anchor, 'world'>): void {
    const list = items.filter((s) => s.trim()).slice(0, 12);
    if (!list.length) return;
    const first = list.findIndex((s) => !s.startsWith('-'));
    this.menu = { owner, title, items: list, index: Math.max(0, first), cancel, at };
  }

  closeMenu(owner?: RuntimeEntity): void {
    if (!owner || this.menu?.owner === owner) this.menu = null;
  }

  // ---------------------------------------------------------------- cursor

  showCursor(owner: RuntimeEntity | null, x: number, y: number): void {
    this.cursor = { owner, i: cellOf(x), j: cellOf(y), held: 0 };
  }

  hideCursor(owner?: RuntimeEntity): void {
    if (!owner || this.cursor?.owner === owner) this.cursor = null;
  }

  cursorAt(): { x: number; y: number } | null {
    return this.cursor ? { x: centerOf(this.cursor.i), y: centerOf(this.cursor.j) } : null;
  }

  /** A unit (something with health) whose middle is on that square, else anything there. */
  thingAt(x: number, y: number, but?: RuntimeEntity): RuntimeEntity | null {
    const i = cellOf(x);
    const j = cellOf(y);
    let any: RuntimeEntity | null = null;
    for (const e of this.host.entities) {
      if (!e.alive || e === but || e.projectile || cellOf(e.x) !== i || cellOf(e.y) !== j) continue;
      if (e.health) return e;
      any ??= e;
    }
    return any;
  }

  // ------------------------------------------------------------ highlights

  /** Squares within `steps` walking steps of `from` (around walls and other units), not counting its own. */
  reach(from: RuntimeEntity, steps: number): Set<string> {
    const { dist } = this.search(from, Math.max(0, Math.min(30, Math.round(steps))));
    const out = new Set<string>();
    for (const [k, d] of dist) if (d > 0 && !this.occupied(k, from)) out.add(k);
    return out;
  }

  /** Squares at least `min` and at most `max` squares away (along the grid, through anything): an attack range. */
  range(from: RuntimeEntity, min: number, max: number): Set<string> {
    const out = new Set<string>();
    const ci = cellOf(from.x);
    const cj = cellOf(from.y);
    const hi = Math.max(0, Math.min(30, Math.round(max)));
    for (let di = -hi; di <= hi; di++)
      for (let dj = -hi; dj <= hi; dj++) {
        const d = Math.abs(di) + Math.abs(dj);
        if (d >= Math.max(1, min) && d <= hi) out.add(key(ci + di, cj + dj));
      }
    return out;
  }

  highlight(id: string, owner: RuntimeEntity, cells: Set<string>, color: string): void {
    this.highlights.set(id, { owner, cells, color });
  }

  clearHighlight(owner: RuntimeEntity, id: string | null): void {
    if (id !== null) this.highlights.delete(id);
    else for (const [k, h] of this.highlights) if (h.owner === owner) this.highlights.delete(k);
  }

  highlighted(id: string, x: number, y: number): boolean {
    return this.highlights.get(id)?.cells.has(key(cellOf(x), cellOf(y))) ?? false;
  }

  // ----------------------------------------------------------------- paths

  private occupied(k: string, but: RuntimeEntity): boolean {
    for (const e of this.host.entities) if (e !== but && e.alive && e.health && !e.projectile && key(cellOf(e.x), cellOf(e.y)) === k) return true;
    return false;
  }

  private blocked(i: number, j: number, but: RuntimeEntity): boolean {
    return this.host.solidAtPoint(centerOf(i), centerOf(j)) || this.occupied(key(i, j), but);
  }

  /** Walking distances (in squares) from where `from` stands, up to `limit`, and the way back from each. */
  private search(from: RuntimeEntity, limit: number): { dist: Map<string, number>; back: Map<string, string> } {
    const start = key(cellOf(from.x), cellOf(from.y));
    const dist = new Map([[start, 0]]);
    const back = new Map<string, string>();
    let frontier = [[cellOf(from.x), cellOf(from.y)]];
    for (let d = 1; d <= limit && frontier.length; d++) {
      const next: number[][] = [];
      for (const [i, j] of frontier)
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const k = key(i + di, j + dj);
          if (dist.has(k) || this.blocked(i + di, j + dj, from)) continue;
          dist.set(k, d);
          back.set(k, key(i, j));
          next.push([i + di, j + dj]);
        }
      frontier = next;
    }
    return { dist, back };
  }

  /** How many steps it takes `from` to walk to that square (-1: it can't get there within 30). */
  stepsTo(from: RuntimeEntity, x: number, y: number): number {
    return this.search(from, 30).dist.get(key(cellOf(x), cellOf(y))) ?? -1;
  }

  /**
   * Walks `who` toward a square along the shortest way, square by square, at most `steps` squares: to the square,
   * or (taken, or out of reach) to the reachable square nearest to it. "arrived" when it stops (also at once when
   * it can't move at all).
   */
  walkTo(who: RuntimeEntity, x: number, y: number, steps: number, speed = WALK_SPEED): void {
    const { dist, back } = this.search(who, 30);
    const ti = cellOf(x);
    const tj = cellOf(y);
    let best = key(cellOf(who.x), cellOf(who.y));
    let bestScore = Infinity;
    for (const [k, d] of dist) {
      if (d > 0 && this.occupied(k, who)) continue;
      const [i, j] = k.split(',').map(Number);
      // Nearest to the target first, then the fewest steps.
      const score = (Math.abs(i - ti) + Math.abs(j - tj)) * 1000 + d;
      if (score < bestScore) {
        bestScore = score;
        best = k;
      }
    }
    const path: { x: number; y: number }[] = [];
    for (let k: string | undefined = best; k && back.has(k); k = back.get(k)) {
      const [i, j] = k.split(',').map(Number);
      path.unshift({ x: centerOf(i), y: centerOf(j) });
    }
    const limit = Math.max(0, Math.round(steps));
    this.walks.set(who, { path: path.slice(0, limit), speed: speed > 0 ? speed : WALK_SPEED });
  }

  walking(who: RuntimeEntity): boolean {
    return this.walks.has(who);
  }

  // ----------------------------------------------------------------- turns

  /** Turns begin (once: asked again while they run, nothing changes). */
  startTurns(tags: string[], pick: string[]): void {
    if (this.turns) return;
    const teams = tags.filter((t) => t.trim()).map((tag) => ({ tag, pick: pick.includes(tag) }));
    if (!teams.length) return;
    this.turns = { teams, index: -1, number: 0, acting: null, actingSince: 0, acted: new Set() };
    this.nextTeam();
  }

  team(): Team | null {
    return this.turns && this.turns.index >= 0 ? this.turns.teams[this.turns.index] : null;
  }

  private unitsOf(tag: string): RuntimeEntity[] {
    // In reading order (top row first, left to right): the same every time.
    return this.host.entities.filter((e) => e.alive && !e.projectile && e.tags.includes(tag)).sort((a, b) => a.y - b.y || a.x - b.x);
  }

  /** The next team's turn (skipping teams with no one left). */
  nextTeam(): void {
    const t = this.turns;
    if (!t) return;
    for (let tries = 0; tries < t.teams.length; tries++) {
      t.index = (t.index + 1) % t.teams.length;
      if (t.index === 0) t.number++;
      if (this.unitsOf(t.teams[t.index].tag).length) break;
      if (tries === t.teams.length - 1) {
        // Nobody left at all.
        t.acting = null;
        return;
      }
    }
    t.acted = new Set();
    t.acting = null;
    const team = t.teams[t.index];
    this.banner = { text: `${team.tag.toUpperCase()} TURN`, t: this.host.time };
    for (const e of this.host.entities) if (e.alive && e.scripts.length) this.host.emit('turn_started', e);
    if (team.pick) {
      const first = this.unitsOf(team.tag)[0];
      this.showCursor(null, first.x, first.y);
    } else this.giveNext();
  }

  /** The next unit of a team that plays by itself gets its go; when all have had theirs, the next team's turn. */
  private giveNext(): void {
    const t = this.turns!;
    const team = this.team()!;
    const next = this.unitsOf(team.tag).find((e) => !t.acted.has(e));
    if (next) this.giveTurn(next);
    else this.nextTeam();
  }

  giveTurn(unit: RuntimeEntity): void {
    const t = this.turns;
    if (!t || !unit.alive) return;
    t.acting = unit;
    t.actingSince = this.host.time;
    if (this.cursor?.owner === null) this.cursor = null;
    this.host.emit('unit_turn', unit);
  }

  /** `unit`'s go is over. */
  done(unit: RuntimeEntity): void {
    const t = this.turns;
    if (!t) return;
    t.acted.add(unit);
    if (t.acting === unit) t.acting = null;
    this.closeMenu(unit);
    this.hideCursor(unit);
    this.clearHighlight(unit, null);
    const team = this.team();
    if (!team) return;
    const left = this.unitsOf(team.tag).filter((e) => !t.acted.has(e));
    if (!left.length) this.nextTeam();
    else if (team.pick) this.showCursor(null, unit.x, unit.y);
    else this.giveNext();
  }

  endTurn(): void {
    if (!this.turns) return;
    this.menu = null;
    if (this.cursor?.owner === null || this.cursor?.owner === this.turns.acting) this.cursor = null;
    this.nextTeam();
  }

  isActing(e: RuntimeEntity): boolean {
    return this.turns?.acting === e;
  }

  hasActed(e: RuntimeEntity): boolean {
    return this.turns?.acted.has(e) ?? false;
  }

  // ----------------------------------------------------------------- popup

  popup(at: RuntimeEntity, text: string, color: string): void {
    if (this.popups.length > 30) this.popups.shift();
    this.popups.push({ x: at.x, y: at.y - CELL / 2, text: text.slice(0, 24), color, t: this.host.time });
  }

  // ---------------------------------------------------------------- update

  /** Each step, before scripts run: the keys for the menu or cursor, walking, and units that never finished. */
  update(dt: number, input: InputState): void {
    if (this.menu) this.steerMenu(input);
    else if (this.cursor) this.steerCursor(dt, input);
    for (const [who, walk] of this.walks) {
      if (!who.alive) {
        this.walks.delete(who);
        continue;
      }
      if (who.moveTarget) continue;
      const next = walk.path.shift();
      if (next) {
        if (next.x !== who.x) who.facing = next.x < who.x ? -1 : 1;
        who.moveTarget = { x: next.x, y: next.y, speed: walk.speed };
      } else {
        this.walks.delete(who);
        this.host.emit('arrived', who);
      }
    }
    const t = this.turns;
    if (t?.acting) {
      // Gone, or (playing by itself) taking far too long: its go is over.
      if (!t.acting.alive) this.done(t.acting);
      else if (!this.team()?.pick && this.host.time - t.actingSince > GO_LIMIT && !this.walks.has(t.acting)) {
        this.host.report(`${t.acting.name}'s turn went on for ${GO_LIMIT} s without "done": its turn was ended`);
        this.done(t.acting);
      }
    }
    // A team with no unit left in the middle of its turn: on to the next.
    const team = this.team();
    if (t && team && !t.acting && !this.unitsOf(team.tag).some((e) => !t.acted.has(e))) this.nextTeam();
    this.popups = this.popups.filter((p) => this.host.time - p.t < 0.9);
    this.draw();
  }

  private steerMenu(input: InputState): void {
    const m = this.menu!;
    const move = (d: number) => {
      for (let k = 1; k <= m.items.length; k++) {
        const i = (m.index + d * k + m.items.length * 12) % m.items.length;
        if (!m.items[i].startsWith('-')) {
          m.index = i;
          return;
        }
      }
    };
    if (input.wasPressed('up') || input.wasPressed('left')) move(-1);
    if (input.wasPressed('down') || input.wasPressed('right')) move(1);
    if (input.wasPressed('interact') || input.wasPressed('jump') || input.wasPressed('fire')) {
      const item = m.items[m.index];
      if (item.startsWith('-')) return;
      this.choice = item;
      this.choiceNumber = m.index + 1;
      this.menu = null;
      this.host.emit('menu_chosen', m.owner);
    } else if (input.wasPressed('menu') && m.cancel) {
      this.menu = null;
      this.host.emit('menu_cancelled', m.owner);
    }
  }

  private steerCursor(dt: number, input: InputState): void {
    const c = this.cursor!;
    const dirs: [Parameters<InputState['isDown']>[0], number, number][] = [
      ['left', -1, 0],
      ['right', 1, 0],
      ['up', 0, -1],
      ['down', 0, 1],
    ];
    let held = false;
    for (const [a, di, dj] of dirs) {
      if (input.wasPressed(a)) {
        c.i += di;
        c.j += dj;
        c.held = 0;
      } else if (input.isDown(a)) {
        held = true;
        // Held: it keeps moving, a square every tenth of a second after a short wait.
        c.held += dt;
        if (c.held > 0.3) {
          c.i += di;
          c.j += dj;
          c.held = 0.2;
        }
      }
    }
    if (!held && !dirs.some(([a]) => input.wasPressed(a))) c.held = 0;
    if (input.wasPressed('interact') || input.wasPressed('jump') || input.wasPressed('fire')) {
      const at = this.cursorAt()!;
      if (c.owner) this.host.emit('cursor_chosen', c.owner, this.thingAt(at.x, at.y));
      else {
        // The team's own cursor: a unit of the team that hasn't had its go gets it.
        const team = this.team();
        const unit = team ? this.unitsOf(team.tag).find((e) => !this.turns!.acted.has(e) && cellOf(e.x) === c.i && cellOf(e.y) === c.j) : undefined;
        if (unit) this.giveTurn(unit);
      }
    } else if (input.wasPressed('menu') && c.owner) this.host.emit('cursor_cancelled', c.owner);
  }

  // ------------------------------------------------------------------ look

  /** The kit's look, as the game's own drawings (redone each step). */
  private draw(): void {
    const d = this.host.drawings;
    for (const k of [...d.keys()]) if (k.startsWith(KIT)) d.delete(k);
    let order = 100000;
    const put = (id: string, v: Omit<ScreenDrawing, 'owner' | 'order' | 'object' | 'text' | 'size'> & Partial<Pick<ScreenDrawing, 'text' | 'size'>>) =>
      d.set(`${KIT}${id}`, { owner: KIT, object: null, text: '', size: 12, order: order++, ...v });
    for (const [id, h] of this.highlights)
      for (const k of h.cells) {
        const [i, j] = k.split(',').map(Number);
        put(`h${id}:${k}`, { shape: 'rect', anchor: 'world', x: centerOf(i), y: centerOf(j), w: CELL - 2, h: CELL - 2, color: h.color, alpha: 0.4, under: true });
      }
    if (this.cursor) {
      const x = centerOf(this.cursor.i);
      const y = centerOf(this.cursor.j);
      const a = 0.6 + 0.4 * Math.abs(Math.sin(this.host.time * 5));
      const s = CELL / 2;
      put('c1', { shape: 'rect', anchor: 'world', x, y: y - s + 1, w: CELL, h: 2, color: '#ffffff', alpha: a });
      put('c2', { shape: 'rect', anchor: 'world', x, y: y + s - 1, w: CELL, h: 2, color: '#ffffff', alpha: a });
      put('c3', { shape: 'rect', anchor: 'world', x: x - s + 1, y, w: 2, h: CELL, color: '#ffffff', alpha: a });
      put('c4', { shape: 'rect', anchor: 'world', x: x + s - 1, y, w: 2, h: CELL, color: '#ffffff', alpha: a });
    }
    for (const [n, p] of this.popups.entries()) {
      const age = (this.host.time - p.t) / 0.9;
      put(`p${n}`, { shape: 'text', anchor: 'world', x: p.x, y: p.y - age * 20, w: 0, h: 0, text: p.text, size: 12, color: p.color, alpha: Math.min(1, 2 - 2 * age) });
    }
    if (this.banner && this.host.time - this.banner.t < 1.2) {
      const age = (this.host.time - this.banner.t) / 1.2;
      put('bn', { shape: 'text', anchor: 'center', x: 0, y: -60, w: 0, h: 0, text: this.banner.text, size: 28, color: '#ffffff', alpha: age < 0.75 ? 1 : (1 - age) * 4 });
    }
    if (this.menu) {
      const m = this.menu;
      const { w: W, h: H } = this.host.screen;
      const lines = [...(m.title ? m.title.split('\n') : []), ...m.items];
      const line = 18;
      const pad = 10;
      const w = Math.min(W - 32, Math.max(90, Math.max(...lines.map((l) => l.replace(/^-/, '').length)) * 9 + 2 * pad + 14));
      const h = lines.length * line + 2 * pad;
      const [sx, sy] = ({ top_left: [0, 0], top: [0.5, 0], top_right: [1, 0], left: [0, 0.5], center: [0.5, 0.5], right: [1, 0.5], bottom_left: [0, 1], bottom: [0.5, 1], bottom_right: [1, 1] } as const)[m.at];
      // Its top left corner: 16 px in from the screen's edges, on the side it is anchored to.
      const left = sx === 0 ? 16 : sx === 1 ? W - 16 - w : (W - w) / 2;
      const top = sy === 0 ? 16 : sy === 1 ? H - 16 - h : (H - h) / 2;
      put('mb', { shape: 'rect', anchor: 'top_left', x: left - 2, y: top - 2, w: w + 4, h: h + 4, color: '#e8ecff', alpha: 1 });
      put('mf', { shape: 'rect', anchor: 'top_left', x: left, y: top, w, h, color: '#1b2266', alpha: 1 });
      const titled = m.title ? m.title.split('\n').length : 0;
      lines.forEach((l, n) => {
        const item = n - titled;
        const off = item >= 0 && l.startsWith('-');
        const y = top + pad + n * line + 2;
        put(`mt${n}`, { shape: 'text', anchor: 'top_left', x: left + pad + (item >= 0 ? 14 : 0), y, w: 0, h: 0, text: l.replace(/^-/, ''), size: 14, color: item < 0 ? '#ffd166' : off ? '#7a80a8' : '#ffffff', alpha: 1 });
        if (item === m.index) put('mc', { shape: 'text', anchor: 'top_left', x: left + pad, y, w: 0, h: 0, text: '>', size: 14, color: '#ffffff', alpha: 1 });
      });
    }
  }
}
