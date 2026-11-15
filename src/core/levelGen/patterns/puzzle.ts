/**
 * The puzzle platformer's patterns: the way on is worked out, not just jumped. A door walled in across the floor
 * that a lever (or a key) opens; a pressure plate that holds a door open only while a crate stands on it; a wall too
 * high to jump that a crate pushed against it gets the player up; a wall no one gets past, with a teleporter
 * through it. Each puzzle is needed: the level builder checks that the level can't be won without it.
 *
 * Doors here are walled up from their top to the floor's ceiling, so nothing jumps over them, whatever the
 * player's jump.
 */
import { PatternError, Section, type Pattern } from '../pattern';
import type { Role } from '../roles';

/** A door across the floor in section column i (standing on the ground at row e), walled up above it. */
function doorWall(s: Section, i: number, e: number): string {
  const size = s.ctx.roles.door?.cells;
  if (!size || size.w !== 1 || size.h !== 2) throw new PatternError('the game\'s door is not one cell wide and two tall');
  if (e - 3 < s.ctx.band.top) throw new PatternError('no room for a door here');
  const ref = s.ctx.ref('door');
  s.place('door', i, e - 1, ref);
  s.ctx.g.fill('ground', s.col(i), s.ctx.band.top, s.col(i), e - 3);
  return ref;
}

/**
 * Where a lever or a key waits, before the door: on top of a little hill, down in a dip, or up a ladder on a ledge
 * (a dead end above the way on). Builds columns 0..width-1 of `s` from `start`; returns the spot and the ground's
 * row after it.
 */
function spot(s: Section, kind: string, start: number, width: number, e: number): { i: number; row: number } {
  const { lim, band } = s.ctx;
  if (kind === 'hill') {
    if (lim.maxRise < 1 || e - 2 < s.highest || e - 4 < band.top) throw new PatternError('no room for a hill here');
    s.flat(start, start, e);
    s.ground(start + 1, e - 1);
    s.flat(start + 2, start + width - 3, e - 2);
    s.ground(start + width - 2, e - 1);
    s.flat(start + width - 1, start + width - 1, e);
    return { i: start + Math.floor(width / 2), row: e - 3 };
  }
  if (kind === 'pit') {
    // (Down one step, then the floor of the dip; out the other side the same way.)
    if (e + 2 > band.fill || lim.maxRise < 1) throw new PatternError('no room under the ground for a dip here');
    s.flat(start, start, e);
    s.ground(start + 1, e + 1);
    s.flat(start + 2, start + width - 3, e + 2);
    s.ground(start + width - 2, e + 1);
    s.flat(start + width - 1, start + width - 1, e);
    return { i: start + Math.floor(width / 2), row: e + 1 };
  }
  // perch: a ladder up to a ledge three or four rows over the floor, the floor going on under it.
  const k = Math.min(4, e - band.top - 2);
  if (k < 3 || !s.has('ladder')) throw new PatternError('no room for a ledge up a ladder');
  s.flat(start, start + width - 1, e);
  const ledge: Role = s.has('ledge') ? 'ledge' : 'ground';
  for (let i = start + 2; i < start + width; i++) s.put(ledge, i, e - k);
  for (let r = e - k; r <= e - 1; r++) s.put('ladder', start + 1, r);
  return { i: start + width - 1, row: e - k - 1 };
}

const SPOTS = [{ id: 'hill' }, { id: 'pit' }, { id: 'perch', needs: ['ladder'] as Role[] }];

const leverDoor: Pattern = {
  id: 'lever_door',
  version: 1,
  name: 'a door walled in across the way, opened by a lever before it: on a hill, down in a dip, or up a ladder',
  mechanics: ['switch'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground', 'door', 'switch'],
  variants: SPOTS,
  difficulty: [1, 5],
  width: () => [9, 12],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const w = s.w - 4;
    const at = spot(s, ctx.variant, 0, w, e);
    s.flat(w, s.w - 1, e);
    const door = doorWall(s, s.w - 2, e);
    const lever = ctx.ref('lever');
    s.place('switch', at.i, at.row, lever);
    ctx.g.link({ type: 'controls', from: lever, to: door });
    return e;
  },
};

const keyDoor: Pattern = {
  id: 'key_door',
  version: 1,
  name: 'a locked door walled in across the way, its key before it: on a hill, down in a dip, or up a ladder',
  mechanics: ['key'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground', 'door', 'key'],
  variants: SPOTS,
  difficulty: [1, 5],
  width: () => [9, 12],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const w = s.w - 4;
    const at = spot(s, ctx.variant, 0, w, e);
    s.flat(w, s.w - 1, e);
    const door = doorWall(s, s.w - 2, e);
    const key = ctx.ref('key');
    s.place('key', at.i, at.row, key);
    ctx.g.link({ type: 'requires', from: door, to: key });
    return e;
  },
};

/** Cells from a pressure plate to its door: more than the player's longest jump, so stepping off it is too late. */
const plateToDoor = (s: Section) => Math.max(5, s.ctx.reach.gap(0) + 3);

const plateDoor: Pattern = {
  id: 'plate_door',
  version: 1,
  name: 'a pressure plate in a notch in the floor that holds a door further on open: push the crate into it (along the floor, or off a step)',
  mechanics: ['crate', 'switch'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground', 'door', 'plate', 'crate'],
  variants: [{ id: 'push' }, { id: 'drop', minDifficulty: 2 }],
  difficulty: [1, 5],
  width: (lim) => [Math.max(5, lim.gap(0) + 5) + 7, Math.max(5, lim.gap(0) + 5) + 9],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const plateAt = ctx.variant === 'drop' ? 4 : ctx.rnd.int(3, 4);
    const doorAt = plateAt + 1 + plateToDoor(s);
    if (doorAt + 2 > s.w) throw new PatternError('too narrow for a plate and its door');
    s.flat(0, s.w - 1, e);
    // The plate at the near end of a notch two cells wide and one deep: a crate pushed along drops into it as soon as
    // it is past the edge (no lining up to the pixel), onto the plate, level with the floor, and can't be pushed on
    // (or out again); the player walks on over it (the notch's far cell: a dip a step deep).
    if (e + 1 > ctx.band.fill) throw new PatternError('no room under the ground for a plate\'s notch here');
    s.ctx.g.clear(s.col(plateAt), e, s.col(plateAt), e);
    s.ctx.g.clear(s.col(plateAt + 1), e, s.col(plateAt + 1), e);
    if (ctx.variant === 'drop') {
      // A step up with the crate on it; pushed off its far edge, the crate drops onto the plate.
      if (e - 3 < ctx.band.top || e - 1 < s.highest) throw new PatternError('no room for a step here');
      s.flat(2, 3, e - 1);
      s.put('crate', 3, e - 2);
    } else s.put('crate', 1, e - 1);
    const plate = ctx.ref('plate');
    s.place('plate', plateAt, e, plate);
    const door = doorWall(s, doorAt, e);
    ctx.g.link({ type: 'controls', from: plate, to: door });
    return e;
  },
};

const crateStep: Pattern = {
  id: 'crate_step',
  version: 1,
  name: 'a wall a row higher than the player jumps: push the crate up against it and climb (the crate near it, or further back)',
  mechanics: ['crate'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground', 'crate'],
  variants: [{ id: 'near' }, { id: 'far', minDifficulty: 2 }],
  difficulty: [1, 5],
  width: (_lim, _d, v) => (v === 'far' ? [10, 13] : [7, 9]),
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const h = ctx.reach.maxRise + 1;
    if (h > ctx.reach.maxRise + ctx.reach.crateRows || ctx.reach.crateRows < 1) throw new PatternError('a crate is not enough to climb a wall the player can\'t jump');
    if (e - h < s.highest || e - h - 2 < ctx.band.top) throw new PatternError('no room for a high wall here');
    const wallAt = s.w - 3;
    s.flat(0, wallAt - 1, e);
    s.flat(wallAt, s.w - 1, e - h);
    // (Far back: a long push; near: a few cells. Never against the wall already, or there is nothing to work out.)
    const crateAt = ctx.variant === 'far' ? 1 : Math.max(1, wallAt - ctx.rnd.int(3, 4));
    s.put('crate', crateAt, e - 1);
    if (s.has('coin')) s.put('coin', s.w - 2, e - h - 1);
    return e - h;
  },
};

const teleport: Pattern = {
  id: 'teleport',
  version: 1,
  name: 'a wall from the floor to the ceiling with a teleporter through it; or a teleporter up onto ground too high to reach',
  mechanics: ['teleporter'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground', 'teleporter'],
  variants: [{ id: 'wall' }, { id: 'up' }],
  difficulty: [1, 5],
  width: () => [7, 10],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const a = ctx.ref('tele');
    const b = ctx.ref('tele');
    if (ctx.variant === 'wall') {
      const wall = Math.floor(s.w / 2);
      s.flat(0, s.w - 1, e);
      ctx.g.fill('ground', s.col(wall), ctx.band.top, s.col(wall), e);
      s.place('teleporter', wall - 2, e - 1, a);
      s.place('teleporter', wall + 2, e - 1, b);
      ctx.g.link({ type: 'teleports_to', from: a, to: b });
      return e;
    }
    // up: the ground ahead rises higher than the player jumps; the teleporter puts it on top.
    const h = Math.min(e - s.highest, Math.max(ctx.reach.maxRise + 2, 3));
    if (h <= ctx.reach.maxRise + (s.has('crate') ? ctx.reach.crateRows : 0) || e - h - 2 < ctx.band.top) throw new PatternError('no room for ground too high to jump here');
    const rise = Math.floor(s.w / 2);
    s.flat(0, rise - 1, e);
    s.flat(rise, s.w - 1, e - h);
    s.place('teleporter', rise - 2, e - 1, a);
    s.place('teleporter', rise + 1, e - h - 1, b);
    ctx.g.link({ type: 'teleports_to', from: a, to: b });
    return e - h;
  },
};

export const PUZZLE_PATTERNS: Pattern[] = [leverDoor, keyDoor, plateDoor, crateStep, teleport];
