/**
 * The grid of cells a level is built in, before it is a level: each cell holds a role (ground, a coin, an enemy…)
 * or nothing, plus the things that don't fit in a cell map (a moving platform's path, a teleporter pair). Written
 * out as the operations every level is made with (one draw_map, then place_instance, add_component,
 * create_relationship), so what the builder makes is an ordinary level: the same objects, editable by hand, one
 * Undo step, checked like any other.
 */
import type { Operation } from '../commands/operations';
import type { Id } from '../types';
import { LEVEL_CELL } from '../model/placement';
import type { Role, Roles } from './roles';

/** The character each role is written with in the map (readable when the map is shown to the AI or a test). */
export const ROLE_CHARS: Record<Role, string> = {
  player: 'P', ground: '#', ledge: '=', oneway: '-', rampRight: '/', rampLeft: '\\', ladder: 'H', hazard: '^', lava: 'L',
  water: '~', deepWater: 'w', enemy: 'E', coin: 'o', key: 'k', heart: 'h', door: 'D', switch: 's', teleporter: 'T',
  goal: 'G', crate: 'C', spring: 'S', block: '?', brick: 'b', pipeTop: 'U', pipe: '|', mover: 'M',
};

/** Something placed outside the map: by itself (a ref, for links), maybe moving along a path. */
export interface Placed {
  role: Role;
  /** Its bottom-left cell. */
  col: number;
  row: number;
  ref: string;
  /** Moving: where its path ends (cells from where it starts), the corners on the way, round or back and forth. */
  path?: { to: { x: number; y: number }; points?: { x: number; y: number }[]; loop?: boolean; speed?: number };
}

/** A connection between two placed things (by their refs). */
export interface Link {
  type: 'teleports_to' | 'controls' | 'requires';
  from: string;
  to: string;
  params?: Record<string, unknown>;
}

export class GridError extends Error {}

export class LevelGrid {
  private cells: (Role | null)[][];
  readonly placed: Placed[] = [];
  readonly links: Link[] = [];

  constructor(
    readonly width: number,
    readonly height: number,
    /** Sizes in cells of the roles' objects (a door 1×2, a pipe 2×1). */
    private readonly roles: Roles,
  ) {
    if (width < 1 || height < 1) throw new GridError(`A level needs at least one cell (asked ${width}×${height})`);
    this.cells = Array.from({ length: height }, () => Array<Role | null>(width).fill(null));
  }

  inside(col: number, row: number): boolean {
    return col >= 0 && row >= 0 && col < this.width && row < this.height;
  }

  get(col: number, row: number): Role | null {
    return this.inside(col, row) ? this.cells[row][col] : null;
  }

  isEmpty(col: number, row: number): boolean {
    return this.inside(col, row) && this.cells[row][col] === null;
  }

  /** The cells a role's object covers with its bottom-left cell here. */
  private footprint(role: Role, col: number, row: number): { col: number; row: number }[] {
    const size = this.roles[role]?.cells ?? { w: 1, h: 1 };
    const out: { col: number; row: number }[] = [];
    for (let dy = 0; dy < size.h; dy++) for (let dx = 0; dx < size.w; dx++) out.push({ col: col + dx, row: row - dy });
    return out;
  }

  /** Whether a role's object fits here (bottom-left cell), on empty cells inside the level. */
  fits(role: Role, col: number, row: number): boolean {
    return this.footprint(role, col, row).every((c) => this.isEmpty(c.col, c.row));
  }

  /**
   * Puts a role's object with its bottom-left cell here (a door fills this cell and the one above). Over cells that
   * are taken, or past the edge: refused (GridError), unless `over` (then it replaces what is there).
   */
  put(role: Role, col: number, row: number, over = false): void {
    if (!this.roles[role]) throw new GridError(`The game has no object for "${role}"`);
    const cells = this.footprint(role, col, row);
    for (const c of cells) {
      if (!this.inside(c.col, c.row)) throw new GridError(`${role} at ${col},${row} goes past the edge of the level`);
      if (!over && this.cells[c.row][c.col] !== null) throw new GridError(`${role} at ${col},${row}: the cell ${c.col},${c.row} has ${this.cells[c.row][c.col]}`);
    }
    for (const c of cells) this.cells[c.row][c.col] = role;
  }

  /** Fills a rectangle (both corners included) with a one-cell role, over what is there. */
  fill(role: Role, col0: number, row0: number, col1: number, row1: number): void {
    if (!this.roles[role]) throw new GridError(`The game has no object for "${role}"`);
    for (let r = Math.max(0, Math.min(row0, row1)); r <= Math.min(this.height - 1, Math.max(row0, row1)); r++)
      for (let c = Math.max(0, Math.min(col0, col1)); c <= Math.min(this.width - 1, Math.max(col0, col1)); c++) this.cells[r][c] = role;
  }

  /** Empties a rectangle (both corners included). */
  clear(col0: number, row0: number, col1: number, row1: number): void {
    for (let r = Math.max(0, Math.min(row0, row1)); r <= Math.min(this.height - 1, Math.max(row0, row1)); r++)
      for (let c = Math.max(0, Math.min(col0, col1)); c <= Math.min(this.width - 1, Math.max(col0, col1)); c++) this.cells[r][c] = null;
  }

  /** Something placed by itself (not in the map), with a ref for links. */
  place(p: Placed): void {
    if (!this.roles[p.role]) throw new GridError(`The game has no object for "${p.role}"`);
    if (this.placed.some((q) => q.ref === p.ref)) throw new GridError(`Two things placed with the ref "${p.ref}"`);
    this.placed.push(p);
  }

  link(l: Link): void {
    const known = (ref: string) => this.placed.some((p) => p.ref === ref);
    if (!known(l.from) || !known(l.to)) throw new GridError(`A ${l.type} link between things not placed (${l.from} → ${l.to})`);
    this.links.push(l);
  }

  /** The map as text, top row first (empty: "."). */
  rows(): string[] {
    return this.cells.map((r) => r.map((c) => (c ? ROLE_CHARS[c] : '.')).join(''));
  }

  /**
   * The operations that make this the level: its map (clearing what was in that area; the player is kept and moved
   * to its start), then what is placed by itself, moving paths, links. `col`, `row`: where the grid's top-left cell
   * goes in the level.
   */
  toOperations(sceneId: Id, col = 0, row = 0): Operation[] {
    const used = new Set<Role>(this.cells.flat().filter((c): c is Role => c !== null));
    const legend = [...used].map((r) => ({ char: ROLE_CHARS[r], object: this.roles[r]!.id }));
    const ops: Operation[] = [{ op: 'draw_map', sceneId, col, row, legend, rows: this.rows(), clear: true }];
    for (const p of this.placed) {
      const obj = this.roles[p.role]!;
      // (Placed by its middle: its bottom on the bottom of its cell.)
      const x = (col + p.col + obj.cells.w / 2) * LEVEL_CELL;
      const y = (row + p.row + 1 - obj.cells.h / 2) * LEVEL_CELL;
      ops.push({ op: 'place_instance', sceneId, definitionRef: obj.id, x, y, name: null, ref: p.ref, onTop: null });
      if (p.path) {
        const px = (v: { x: number; y: number }) => ({ x: v.x * LEVEL_CELL, y: v.y * LEVEL_CELL });
        const fields: Record<string, unknown> = { offset: px(p.path.to), points: (p.path.points ?? []).map(px), loop: !!p.path.loop, ...(p.path.speed ? { speed: p.path.speed } : {}) };
        if (p.role === 'mover') for (const [field, v] of Object.entries(fields)) ops.push({ op: 'set_component_field', target: 'instance', id: p.ref, component: 'MovingPlatform', field, valueJson: JSON.stringify(v) });
        else ops.push({ op: 'add_component', target: 'instance', id: p.ref, component: 'MovingPlatform', propsJson: JSON.stringify(fields) });
      }
    }
    for (const l of this.links)
      ops.push({ op: 'create_relationship', sceneId, relationshipJson: JSON.stringify({ type: l.type, source: { kind: 'entity', id: l.from }, target: { kind: 'entity', id: l.to }, params: l.params ?? {}, conditions: [] }) });
    return ops;
  }
}
