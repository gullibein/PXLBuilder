/**
 * The classic platformer's patterns: running and jumping, gaps, stairs, floating platforms, enemies, pipes, block
 * rows, springs, moving platforms, hazards, bonus caches, the start and the goal. Every size comes from the
 * player's reach (Limits) and the seed; every variant is a different construction.
 */
import { PatternError, Section, type Pattern, type SectionCtx } from '../pattern';

/** Coins in an arc over columns i0..i1, `above` rows over `row` at the ends and one more in the middle. */
function coinArc(s: Section, i0: number, i1: number, row: number, above = 2): void {
  if (!s.has('coin')) return;
  const mid = (i0 + i1) / 2;
  for (let i = i0; i <= i1; i++) {
    const r = row - above - (Math.abs(i - mid) < (i1 - i0) / 4 + 0.5 ? 1 : 0);
    if (r >= s.ctx.band.top && s.ctx.g.isEmpty(s.col(i), r)) s.put('coin', i, r);
  }
}

/** The floor of a pit: out of the level on the lowest floor, the floor below on others; spikes in it if asked. */
function pitFloor(s: Section, i0: number, i1: number, spikes: boolean): void {
  if (!spikes) return;
  const bottom = s.ctx.band.fill;
  for (let i = i0; i <= i1; i++) {
    s.ctx.g.fill('ground', s.col(i), bottom, s.col(i), bottom);
    s.put('hazard', i, bottom - 1);
  }
}

/** A gap of g cells between a lip at `from` and a landing at `to`, in columns lip..; returns where the landing starts. */
function gapBetween(s: Section, lipEnd: number, g: number, from: number, to: number, spikes = false): number {
  s.flat(0, lipEnd, from);
  pitFloor(s, lipEnd + 1, lipEnd + g, spikes);
  s.flat(lipEnd + g + 1, s.w - 1, to);
  return lipEnd + g + 1;
}

const intro: Pattern = {
  id: 'start',
  version: 1,
  name: 'the start: flat ground to get going',
  mechanics: ['coins'],
  fits: ['intro'],
  needs: ['ground', 'player'],
  variants: [{ id: 'plain' }, { id: 'coins', needs: ['coin'] }],
  difficulty: [1, 5],
  width: () => [4, 7],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    s.flat(0, s.w - 1, e);
    s.put('player', 1, e - 1);
    if (ctx.variant === 'coins' && s.w >= 6) coinArc(s, 3, s.w - 1, e, 1);
    return e;
  },
};

const flat: Pattern = {
  id: 'flat',
  version: 1,
  name: 'a breather: open ground with coins, or a little hill',
  mechanics: ['coins'],
  fits: ['rest', 'teach'],
  needs: ['ground'],
  variants: [{ id: 'coins', needs: ['coin'] }, { id: 'hill' }],
  difficulty: [1, 5],
  width: () => [3, 7],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    s.flat(0, s.w - 1, e);
    if (ctx.variant === 'hill' && s.w >= 4 && e - 1 >= s.highest && ctx.lim.maxRise >= 1) {
      const a = Math.floor(s.w / 2) - 1;
      s.flat(a, a + 1, e - 1);
      if (s.has('coin')) s.put('coin', a, e - 3);
    } else coinArc(s, 1, s.w - 2, e, 1);
    return e;
  },
};

const stairs: Pattern = {
  id: 'stairs',
  version: 2,
  name: 'steps up or down, a hill over and down again, or two step pyramids with a gap between their tops',
  mechanics: ['stairs'],
  fits: ['teach', 'test', 'rest', 'twist'],
  needs: ['ground'],
  variants: [{ id: 'up' }, { id: 'down' }, { id: 'hill' }, { id: 'pyramid_gap', minDifficulty: 2 }],
  difficulty: [1, 5],
  width: (lim, _d, v) => (v === 'pyramid_gap' ? [9, 9 + Math.max(1, lim.gap(0))] : [4, 9]),
  build(ctx) {
    const s = new Section(ctx);
    let r = ctx.entry;
    if (ctx.variant === 'pyramid_gap') {
      const e = r;
      const h = Math.min(2, e - s.highest, ctx.lim.maxRise >= 1 ? 3 : 0);
      if (h < 1) throw new PatternError('no room for step pyramids');
      const g = Math.max(1, Math.min(ctx.lim.gap(0), s.scaled(1, ctx.lim.gap(0)), s.w - 4 - 2 * h));
      if (2 * h + g + 3 > s.w) throw new PatternError('step pyramids: too narrow');
      s.flat(0, 0, e);
      let i = 1;
      for (let k = 1; k <= h; k++) s.ground(i++, e - k);
      i += g;
      for (let k = h; k >= 1; k--) s.ground(i++, e - k);
      s.flat(i, s.w - 1, e);
      return e;
    }
    const room = { up: r - s.highest, down: s.lowest - r };
    let way = ctx.variant;
    if (way === 'up' && (room.up < 1 || ctx.lim.maxRise < 1)) way = 'down';
    if (way === 'down' && room.down < 1) way = room.up >= 1 && ctx.lim.maxRise >= 1 ? 'up' : 'flat';
    if (way === 'hill' && (room.up < 1 || ctx.lim.maxRise < 1)) way = 'flat';
    const stepW = Math.max(2, Math.floor(s.w / 3));
    let i = 0;
    const step = (dir: number) => {
      const most = dir < 0 ? Math.min(ctx.lim.maxRise, r - s.highest) : Math.min(2, s.lowest - r);
      if (most < 1) return;
      r += dir * ctx.rnd.int(1, most);
    };
    while (i < s.w) {
      s.flat(i, Math.min(s.w - 1, i + stepW - 1), r);
      i += stepW;
      if (i >= s.w) break;
      if (way === 'up') step(-1);
      else if (way === 'down') step(1);
      else if (way === 'hill') step(i < s.w / 2 ? -1 : 1);
    }
    return r;
  },
};

const gap: Pattern = {
  id: 'gap',
  version: 2,
  name: 'a gap to jump: level, onto higher or lower ground, over spikes, with coins over it, or two gaps with an island between',
  mechanics: ['gap'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground'],
  variants: [{ id: 'plain' }, { id: 'step_up' }, { id: 'step_down' }, { id: 'spike_pit', needs: ['hazard'], bottomOnly: true, minDifficulty: 2 }, { id: 'coin_arc', needs: ['coin'] }, { id: 'double', minDifficulty: 2 }],
  difficulty: [1, 5],
  width: (lim, _d, v) => (v === 'double' ? [7, 6 + 2 * Math.max(1, lim.gap(0))] : [4, 4 + Math.max(1, lim.gap(-1))]),
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    if (ctx.variant === 'double') {
      // Lip, a gap, an island (1-2 cells), a gap, the landing.
      const most = ctx.lim.gap(0);
      const room = s.w - 4;
      if (most < 1 || room < 3) throw new PatternError('no room for two gaps');
      const g1 = Math.max(1, Math.min(most, s.scaled(1, most), room - 2));
      const g2 = Math.max(1, Math.min(most, s.scaled(1, most), room - g1 - 1));
      const island = Math.max(1, Math.min(2, room - g1 - g2));
      s.flat(0, 0, e);
      s.flat(1 + g1, g1 + island, e);
      s.flat(1 + g1 + island + g2, s.w - 1, e);
      return e;
    }
    let to = e;
    if (ctx.variant === 'step_up' && ctx.lim.maxRise >= 1 && e - 1 >= s.highest) to = e - 1;
    if (ctx.variant === 'step_down' && e + 1 <= s.lowest) to = e + Math.min(2, s.lowest - e);
    const most = Math.min(ctx.lim.gap(e - to), s.w - 3);
    if (most < 1) throw new PatternError('no gap the player can jump fits here');
    const g = s.scaled(1, most);
    const lipEnd = Math.max(0, Math.floor((s.w - g - 2) / 2));
    const landing = gapBetween(s, lipEnd, g, e, to, ctx.variant === 'spike_pit');
    if (ctx.variant === 'coin_arc') coinArc(s, lipEnd + 1, landing - 1, Math.min(e, to), 2);
    return to;
  },
};

const floating: Pattern = {
  id: 'floating',
  version: 2,
  name: 'a pit crossed on floating platforms, each a jump from the last; or platforms rising to higher ground',
  mechanics: ['floating', 'gap'],
  fits: ['test', 'twist'],
  needs: ['ground'],
  variants: [{ id: 'ledges', needs: ['ledge'] }, { id: 'oneways', needs: ['oneway'] }, { id: 'bricks', needs: ['brick'] }, { id: 'rising', needs: ['ledge'], minDifficulty: 2 }],
  difficulty: [2, 5],
  width: (lim) => [6, 7 + 2 * Math.max(1, lim.gap(0))],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    if (ctx.variant === 'rising') {
      // Each platform a row higher, then higher ground.
      const top = Math.max(s.highest, e - 2);
      if (top >= e || ctx.lim.maxRise < 1 || ctx.lim.gap(1) < 1) throw new PatternError('no room to rise here');
      s.flat(0, 0, e);
      let pos = 0;
      let r = e;
      while (r > top) {
        const gx = Math.max(1, Math.min(ctx.lim.gap(1), s.scaled(1, ctx.lim.gap(1))));
        r -= 1;
        const at = pos + gx + 1;
        if (at >= s.w - 2) throw new PatternError('rising platforms: too narrow');
        s.put('ledge', at, r);
        pos = at;
      }
      const gf = Math.max(1, Math.min(ctx.lim.gap(0), s.w - 2 - pos));
      if (pos + gf + 1 > s.w - 1) throw new PatternError('rising platforms: no room to land');
      s.flat(pos + gf + 1, s.w - 1, r);
      return r;
    }
    const role = ctx.variant === 'oneways' ? 'oneway' : ctx.variant === 'bricks' ? 'brick' : 'ledge';
    const landingAt = s.w - 2;
    s.flat(0, 0, e);
    s.flat(landingAt, s.w - 1, e);
    let pos = 0; // the last column the player can stand in
    let r = e;
    for (let guard = 0; guard < 20; guard++) {
      const toLanding = landingAt - pos - 1;
      if (toLanding <= ctx.lim.gap(r - e)) return e;
      // The next platform: a little higher or lower, a jump away, leaving room to go on.
      const up = ctx.lim.maxRise >= 1 && r - 1 >= Math.max(s.highest, e - 2) && r - 1 - 3 >= ctx.band.top;
      const next = ctx.rnd.pick([r, r, up ? r - 1 : r, Math.min(e, r + 1)]);
      const most = Math.min(ctx.lim.gap(r - next), toLanding - 1);
      if (most < 1) throw new PatternError('floating platforms: no jump fits');
      const gx = s.scaled(1, most);
      const lw = Math.min(ctx.rnd.int(1, 2), landingAt - (pos + gx + 1));
      if (lw < 1) throw new PatternError('floating platforms: no room for the next one');
      for (let k = 0; k < lw; k++) s.put(role, pos + gx + 1 + k, next);
      pos = pos + gx + lw;
      r = next;
    }
    throw new PatternError('floating platforms: too far across');
  },
};

const enemy: Pattern = {
  id: 'enemy',
  version: 2,
  name: 'enemies: on open ground, guarding a landing, on both sides of a bump, up on a rise, or down in a dip',
  mechanics: ['enemy'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground', 'enemy'],
  variants: [{ id: 'flat' }, { id: 'guarded_gap' }, { id: 'pincer', minDifficulty: 2 }, { id: 'on_rise' }, { id: 'in_dip' }],
  difficulty: [1, 5],
  width: (lim, _d, v) => (v === 'guarded_gap' ? [6, 7 + Math.max(1, lim.gap(0))] : v === 'flat' ? [5, 9] : [7, 10]),
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    if (ctx.variant === 'on_rise' || ctx.variant === 'in_dip') {
      // A stretch of ground a row up (or down) with an enemy patrolling it.
      const dr = ctx.variant === 'on_rise' ? -1 : 1;
      const r = e + dr;
      // (A dip goes down into the ground under the floor, as a pool does; not past its bottom row.)
      if (r < s.highest || r > ctx.band.fill - 1 || (dr < 0 && ctx.lim.maxRise < 1)) throw new PatternError('no room for a rise or a dip here');
      s.flat(0, 1, e);
      s.flat(2, s.w - 3, r);
      s.flat(s.w - 2, s.w - 1, e);
      s.put('enemy', Math.floor(s.w / 2), r - 1);
      return e;
    }
    if (ctx.variant === 'guarded_gap') {
      const most = Math.min(ctx.lim.gap(0), s.w - 4);
      if (most < 1) throw new PatternError('no gap fits before the guard');
      const g = s.scaled(1, most);
      const landing = gapBetween(s, 0, g, e, e);
      s.put('enemy', Math.min(s.w - 1, landing + 1), e - 1);
      return e;
    }
    s.flat(0, s.w - 1, e);
    if (ctx.variant === 'pincer') {
      const mid = Math.floor(s.w / 2);
      if (e - 1 >= s.highest && ctx.lim.maxRise >= 1) s.flat(mid - 1, mid, e - 1);
      s.put('enemy', 2, e - 1);
      s.put('enemy', s.w - 2, e - 1);
      return e;
    }
    const n = ctx.difficulty >= 3 && s.w >= 7 ? 2 : 1;
    for (let k = 0; k < n; k++) s.put('enemy', 2 + Math.floor(((s.w - 3) * k) / n) + (n === 1 ? Math.floor((s.w - 3) / 2) : 0), e - 1);
    return e;
  },
};

/** A pipe h rows tall standing on `ground` in columns i, i+1. */
function pipeAt(s: Section, i: number, ground: number, h: number): void {
  s.put('pipeTop', i, ground - h);
  for (let r = ground - h + 1; r <= ground - 1; r++) {
    if (s.has('pipe')) s.put('pipe', i, r);
    else s.put('pipeTop', i, r);
  }
}

const pipes: Pattern = {
  id: 'pipes',
  version: 2,
  name: 'pipes to jump onto: one, rising steps of them, an enemy between two, or a pit to jump from pipe to pipe',
  mechanics: ['pipe'],
  fits: ['teach', 'test', 'twist', 'rest'],
  needs: ['ground', 'pipeTop'],
  variants: [{ id: 'single' }, { id: 'steps', minDifficulty: 2 }, { id: 'enemy_between', needs: ['enemy'] }, { id: 'pipe_gap', minDifficulty: 2 }],
  difficulty: [1, 5],
  width: (l, _d, v) => (v === 'single' ? [4, 6] : v === 'steps' ? [7, 10] : v === 'pipe_gap' ? [7, 7 + Math.max(1, l.gap(0))] : [8, 11]),
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    if (ctx.lim.maxRise < 1) throw new PatternError("the player can't jump onto a pipe");
    s.flat(0, s.w - 1, e);
    const room = Math.max(1, e - ctx.band.top - 3);
    const h1 = Math.max(1, Math.min(ctx.lim.maxRise, room, ctx.rnd.int(1, 2)));
    if (ctx.variant === 'pipe_gap') {
      // Two pipes with a pit between them: from one top to the other.
      const g = Math.max(1, Math.min(ctx.lim.gap(0), s.scaled(1, ctx.lim.gap(0)), s.w - 6));
      pipeAt(s, 1, e, h1);
      for (let i = 3; i < 3 + g; i++) s.ctx.g.clear(s.col(i), ctx.band.top, s.col(i), ctx.band.fill);
      pipeAt(s, 3 + g, e, h1);
      return e;
    }
    if (ctx.variant === 'single') pipeAt(s, Math.floor((s.w - 2) / 2), e, h1);
    else if (ctx.variant === 'steps') {
      pipeAt(s, 1, e, h1);
      const h2 = Math.min(room, h1 + Math.min(ctx.lim.maxRise, 1));
      pipeAt(s, 4, e, h2);
      if (s.w >= 10) pipeAt(s, 7, e, Math.min(room, h2 + (ctx.difficulty >= 4 ? 1 : 0)));
    } else {
      pipeAt(s, 1, e, h1);
      pipeAt(s, s.w - 3, e, h1);
      s.put('enemy', Math.floor(s.w / 2), e - 1);
    }
    return e;
  },
};

const blocks: Pattern = {
  id: 'blocks',
  version: 3,
  name: 'a row of ? blocks and bricks overhead to bump, bricks with coins (on top when the player can get up there, else under them), or brick steps',
  mechanics: ['blocks', 'coins'],
  fits: ['teach', 'rest', 'test'],
  needs: ['ground'],
  variants: [{ id: 'row', needs: ['brick'] }, { id: 'question', needs: ['block'] }, { id: 'steps', needs: ['brick'] }, { id: 'coin_row', needs: ['brick', 'coin'] }],
  difficulty: [1, 5],
  width: () => [5, 9],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    s.flat(0, s.w - 1, e);
    if (ctx.variant === 'steps') {
      if (ctx.lim.maxRise < 1) throw new PatternError("the player can't climb brick steps");
      const mid = Math.floor(s.w / 2);
      for (let i = 1; i < s.w - 1; i++) {
        const h = Math.max(0, Math.min(ctx.lim.maxRise * 2, mid - Math.abs(i - mid), e - ctx.band.top - 3));
        for (let k = 1; k <= h; k++) s.put('brick', i, e - k);
      }
      return e;
    }
    const row = e - 3;
    if (row < ctx.band.top) throw new PatternError('no room for blocks overhead');
    const hasQ = s.has('block');
    const hasB = s.has('brick');
    for (let i = 2; i <= s.w - 3; i++) {
      const q = ctx.variant === 'question' ? !hasB || i % 2 === 0 : ctx.variant !== 'coin_row' && hasQ && ctx.rnd.chance(0.3);
      s.put(q ? 'block' : 'brick', i, row);
      // (Coins on top only for a player that can get up there; else under them, taken when bumping them.)
      if (ctx.variant === 'coin_row') {
        if (ctx.lim.maxRise >= 3 && row - 1 >= ctx.band.top) s.put('coin', i, row - 1);
        else s.put('coin', i, row + 1);
      }
    }
    return e;
  },
};

/** How high a spring has to send the player here: more than a jump, within a launch and the floor's room. */
function springHeight(ctx: SectionCtx, most: number): number {
  const lo = ctx.lim.maxRise + 1;
  const hi = Math.min(ctx.lim.springRows, most);
  if (hi < lo) throw new PatternError('no height here that needs a spring and is within its launch');
  return ctx.rnd.int(lo, hi);
}

const spring: Pattern = {
  id: 'spring',
  version: 1,
  name: 'a spring: up to a ledge of coins, or the only way up a wall',
  mechanics: ['spring'],
  fits: ['teach', 'test', 'twist', 'rest'],
  needs: ['ground', 'spring'],
  variants: [{ id: 'bonus' }, { id: 'route' }],
  difficulty: [1, 5],
  width: (_l, _d, v) => (v === 'route' ? [5, 7] : [5, 8]),
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    if (ctx.variant === 'route') {
      const k = springHeight(ctx, e - s.highest);
      s.flat(0, 2, e);
      s.put('spring', 1, e - 1);
      s.flat(3, s.w - 1, e - k);
      return e - k;
    }
    const k = springHeight(ctx, e - ctx.band.top - 3);
    s.flat(0, s.w - 1, e);
    s.put('spring', 1, e - 1);
    const role = s.has('oneway') ? 'oneway' : 'ledge';
    if (!s.has(role)) throw new PatternError('no ledge to spring up to');
    const from = role === 'oneway' ? 1 : 2;
    for (let i = from; i < Math.min(s.w - 1, from + 3); i++) s.put(role, i, e - k);
    for (let i = from; i < Math.min(s.w - 1, from + 3); i++) if (s.has('coin')) s.put('coin', i, e - k - 1);
    return e;
  },
};

const mover: Pattern = {
  id: 'mover',
  version: 1,
  name: 'a pit too wide to jump, crossed on a moving platform',
  mechanics: ['mover', 'gap'],
  fits: ['test', 'twist'],
  needs: ['ground'],
  variants: [{ id: 'plain' }, { id: 'over_spikes', needs: ['hazard'], bottomOnly: true, minDifficulty: 3 }],
  difficulty: [2, 5],
  width: (lim) => [Math.max(1, lim.gap(0)) + 5, Math.max(1, lim.gap(0)) + 8],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const role = s.has('mover') ? 'mover' : s.has('ledge') ? 'ledge' : s.has('oneway') ? 'oneway' : null;
    if (!role) throw new PatternError('nothing to make a moving platform of');
    s.flat(0, 1, e);
    s.flat(s.w - 2, s.w - 1, e);
    const pit = s.w - 4;
    pitFloor(s, 2, 1 + pit, ctx.variant === 'over_spikes');
    // (Level with the ground; it carries the player across and back.)
    s.place(role, 2, e, ctx.ref('lift'), { to: { x: pit - 1, y: 0 }, speed: 50 + 10 * ctx.difficulty });
    return e;
  },
};

const hazard: Pattern = {
  id: 'spikes',
  version: 2,
  name: 'spikes on the floor to jump over: one row, two, or a long bed with a stepping block in it',
  mechanics: ['hazard'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground', 'hazard'],
  variants: [{ id: 'run' }, { id: 'double', minDifficulty: 2 }, { id: 'stepping', minDifficulty: 2 }],
  difficulty: [1, 5],
  width: (lim, _d, v) => (v === 'double' || v === 'stepping' ? [8, 6 + 2 * Math.max(1, lim.spikeCells)] : [4, 4 + Math.max(1, lim.spikeCells)]),
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    if (ctx.lim.spikeCells < 1) throw new PatternError("the player can't jump over spikes");
    s.flat(0, s.w - 1, e);
    const run = (from: number, room: number) => {
      const n = Math.min(room, s.scaled(1, ctx.lim.spikeCells));
      for (let k = 0; k < n; k++) s.put('hazard', from + k, e - 1);
      return from + n;
    };
    if (ctx.variant === 'stepping') {
      // A bed of spikes too long to clear, with a raised block in its middle to hop onto.
      if (ctx.lim.maxRise < 1 || e - 1 < s.highest) throw new PatternError('no stepping block possible here');
      const first = run(2, Math.floor((s.w - 5) / 2));
      s.ground(first, e - 1);
      run(first + 1, s.w - 2 - (first + 1));
    } else if (ctx.variant === 'double') {
      const first = run(2, Math.floor((s.w - 6) / 2));
      run(first + 2, s.w - 2 - (first + 2));
    } else run(2, s.w - 4);
    return e;
  },
};

const bonus: Pattern = {
  id: 'bonus',
  version: 1,
  name: 'a cache of coins up off the way: up a spring, or up floating steps',
  mechanics: ['coins'],
  fits: ['rest'],
  needs: ['ground', 'coin'],
  variants: [{ id: 'spring_cache', needs: ['spring'] }, { id: 'steps_cache', needs: ['ledge'] }],
  difficulty: [1, 5],
  width: () => [5, 7],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    s.flat(0, s.w - 1, e);
    if (ctx.variant === 'spring_cache') return spring.build({ ...ctx, variant: 'bonus' });
    if (ctx.lim.maxRise < 1) throw new PatternError("the player can't climb steps");
    let r = e;
    let i = 1;
    for (; i < s.w - 1 && r - ctx.lim.maxRise - 3 >= ctx.band.top; i++) {
      r -= Math.min(ctx.lim.maxRise, 1);
      s.put('ledge', i, r);
    }
    if (i === 1) throw new PatternError('no room for steps up');
    s.put(ctx.rnd.chance(0.5) && s.has('heart') ? 'heart' : 'coin', i - 1, r - 1);
    return e;
  },
};

const finale: Pattern = {
  id: 'goal',
  version: 1,
  name: 'the goal: on open ground, past a last enemy and gap, or up on a rise',
  mechanics: [],
  fits: ['finale'],
  needs: ['ground', 'goal'],
  variants: [{ id: 'pad' }, { id: 'gauntlet', needs: ['enemy'], minDifficulty: 2 }, { id: 'raised' }],
  difficulty: [1, 5],
  width: (lim, _d, v) => (v === 'gauntlet' ? [8, 9 + Math.max(1, lim.gap(0))] : v === 'raised' ? [5, 8] : [3, 6]),
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    let r = e;
    if (ctx.variant === 'gauntlet') {
      const g = Math.max(1, Math.min(ctx.lim.gap(0), s.w - 7, s.scaled(1, ctx.lim.gap(0))));
      gapBetween(s, 0, g, e, e);
      s.put('enemy', g + 2, e - 1);
    } else if (ctx.variant === 'raised' && ctx.lim.maxRise >= 1 && e - 1 >= s.highest) {
      const up = Math.min(ctx.lim.maxRise, e - s.highest, 2);
      s.flat(0, 1, e);
      s.flat(2, s.w - 1, e - up);
      r = e - up;
    } else s.flat(0, s.w - 1, e);
    s.put('goal', s.w - 2, r - 1);
    return r;
  },
};

/** The far end of a hub's key branch: the key, on open ground. */
const keyEnd: Pattern = {
  id: 'key_end',
  version: 1,
  name: 'the key, at the end of a branch',
  mechanics: [],
  fits: [],
  needs: ['ground', 'key'],
  variants: [{ id: 'pad' }],
  difficulty: [1, 5],
  width: () => [3, 5],
  build(ctx) {
    const s = new Section(ctx);
    s.flat(0, s.w - 1, ctx.entry);
    s.place('key', s.w - 2, ctx.entry - 1, 'key');
    return ctx.entry;
  },
};

/** The far end of a hub's goal branch: a door that needs the key, the goal behind it. */
const lockedGoal: Pattern = {
  id: 'locked_goal',
  version: 1,
  name: 'the goal behind a door that needs the key',
  mechanics: [],
  fits: [],
  needs: ['ground', 'goal', 'door', 'key'],
  variants: [{ id: 'pad' }],
  difficulty: [1, 5],
  width: () => [5, 6],
  build(ctx) {
    const s = new Section(ctx);
    s.flat(0, s.w - 1, ctx.entry);
    s.place('door', s.w - 4, ctx.entry - 1, 'door');
    s.put('goal', s.w - 2, ctx.entry - 1);
    return ctx.entry;
  },
};

const slopes: Pattern = {
  id: 'slopes',
  version: 1,
  name: 'ramps: a rise, a drop, a hill over, or a valley through',
  mechanics: ['ramp'],
  fits: ['teach', 'test', 'rest', 'twist'],
  needs: ['ground', 'rampRight', 'rampLeft'],
  variants: [{ id: 'up' }, { id: 'down' }, { id: 'hill' }, { id: 'valley' }],
  difficulty: [1, 5],
  width: () => [5, 10],
  build(ctx) {
    const s = new Section(ctx);
    // (Rising in the way the player goes: ◢ going right, ◣ going left.)
    const rise = ctx.dir > 0 ? 'rampRight' : 'rampLeft';
    const fall = ctx.dir > 0 ? 'rampLeft' : 'rampRight';
    let r = ctx.entry;
    let i = 0;
    const flat = () => i < s.w && (s.ground(i++, r), true);
    const up = () => {
      if (i >= s.w || r - 1 < s.highest) return flat();
      s.ground(i, r);
      s.put(rise, i++, r - 1);
      r -= 1;
      return true;
    };
    const down = () => {
      if (i >= s.w || r + 1 > s.lowest) return flat();
      s.ground(i, r + 1);
      s.put(fall, i++, r);
      r += 1;
      return true;
    };
    const k = ctx.rnd.int(1, 2);
    const steps: (() => boolean)[] = [flat];
    if (ctx.variant === 'up') steps.push(...Array(k).fill(up));
    else if (ctx.variant === 'down') steps.push(...Array(k).fill(down));
    else if (ctx.variant === 'hill') steps.push(...Array(k).fill(up), flat, flat, ...Array(k).fill(down));
    else steps.push(...Array(k).fill(down), flat, flat, ...Array(k).fill(up));
    for (const step of steps) if (i < s.w) step();
    while (i < s.w) flat();
    return r;
  },
};

const pool: Pattern = {
  id: 'pool',
  version: 1,
  name: 'a pool too wide to jump: swim across (coins over it)',
  mechanics: ['water'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground', 'water'],
  variants: [{ id: 'swim' }, { id: 'coins', needs: ['coin'] }],
  difficulty: [1, 5],
  width: (lim) => [Math.max(6, lim.gap(0) + 5), Math.max(8, lim.gap(0) + 8)],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const depth = Math.min(3, ctx.band.fill - e);
    if (depth < 2) throw new PatternError('no room under the ground for a pool here');
    s.flat(0, 1, e);
    s.flat(s.w - 2, s.w - 1, e);
    for (let i = 2; i <= s.w - 3; i++) {
      s.ctx.g.fill('ground', s.col(i), e + depth, s.col(i), ctx.band.fill);
      // The surface level with the banks; deep water under it.
      s.put('water', i, e);
      for (let r = e + 1; r < e + depth; r++) s.put(s.has('deepWater') ? 'deepWater' : 'water', i, r);
    }
    if (ctx.variant === 'coins') coinArc(s, 3, s.w - 4, e, 1);
    return e;
  },
};

const cliff: Pattern = {
  id: 'cliff',
  version: 1,
  name: 'a cliff too high to jump, climbed by a ladder; or a ladder up to a ledge of coins',
  mechanics: ['ladder'],
  fits: ['teach', 'test', 'twist', 'rest'],
  needs: ['ground', 'ladder'],
  variants: [{ id: 'route' }, { id: 'cache', needs: ['coin'] }],
  difficulty: [1, 5],
  width: () => [5, 8],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    if (ctx.variant === 'route') {
      const lo = Math.max(2, ctx.lim.maxRise + 1);
      const hi = Math.min(4, e - s.highest);
      if (hi < lo) throw new PatternError('no room for a cliff here');
      const k = ctx.rnd.int(lo, hi);
      s.flat(0, 2, e);
      s.flat(3, s.w - 1, e - k);
      for (let r = e - k; r <= e - 1; r++) s.put('ladder', 2, r);
      return e - k;
    }
    const k = Math.min(4, e - ctx.band.top - 2);
    if (k < 2) throw new PatternError('no room for a ledge up a ladder');
    s.flat(0, s.w - 1, e);
    const role = s.has('oneway') ? 'oneway' : 'ledge';
    if (!s.has(role)) throw new PatternError('no ledge to climb up to');
    for (let i = 3; i < Math.min(s.w, 6); i++) {
      s.put(role, i, e - k);
      s.put('coin', i, e - k - 1);
    }
    for (let r = e - k; r <= e - 1; r++) s.put('ladder', 2, r);
    return e;
  },
};

const split: Pattern = {
  id: 'split',
  version: 1,
  name: 'two ways at once: a high way of platforms with coins over a low way with an enemy (choice); or a pit with a slow safe way down and up, and a risky way across at the limit of a jump (risky_shortcut)',
  mechanics: ['floating', 'enemy'],
  fits: ['test', 'twist'],
  needs: ['ground', 'oneway'],
  variants: [{ id: 'choice' }, { id: 'risky_shortcut', minDifficulty: 2 }],
  difficulty: [2, 5],
  width: () => [10, 14],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    if (ctx.lim.maxRise < 1) throw new PatternError('the player can jump onto nothing here');
    if (ctx.variant === 'choice') {
      // Low: the ground, with an enemy (or spikes). High: jump-through steps up to a row of platforms three rows up.
      if (e - 5 < ctx.band.top) throw new PatternError('no room for a high way here');
      s.flat(0, s.w - 1, e);
      const lane = e - 3;
      let i = 1;
      for (let r = e - 1; r > lane; r--) s.put('oneway', i++, r);
      while (i <= s.w - 3) {
        s.put('oneway', i, lane);
        if (s.has('coin')) s.put('coin', i, lane - 1);
        const gx = ctx.rnd.chance(0.4) ? Math.min(ctx.lim.gap(0), 1) : 0;
        i += 1 + gx;
      }
      const mid = Math.floor(s.w / 2);
      if (s.has('enemy')) s.put('enemy', mid, e - 1);
      else if (s.has('hazard') && ctx.lim.spikeCells >= 1) s.put('hazard', mid, e - 1);
      return e;
    }
    // risky_shortcut: a pit two rows deep, steps down and up (safe, slow), jump-through platforms across its top (fast).
    const depth = Math.min(2, ctx.band.fill - e);
    if (depth < 1) throw new PatternError('no room under the ground for a pit here');
    s.flat(0, 0, e);
    let i = 1;
    for (let k = 1; k <= depth; k++) s.ground(i++, e + k);
    const floorEnd = s.w - 2 - depth;
    for (; i <= floorEnd; i++) s.ground(i, e + depth);
    for (let k = depth - 1; k >= 0; k--) s.ground(i++, e + k);
    for (; i < s.w; i++) s.ground(i, e);
    if (ctx.difficulty >= 3 && s.has('enemy')) s.put('enemy', Math.floor(s.w / 2), e + depth - 1);
    // (Across the top: platforms a long jump apart, coins over them.)
    const g = Math.max(1, ctx.lim.gap(0));
    for (let x = 1 + g; x < s.w - 1 - g + 1; x += g + 1) {
      if (!s.ctx.g.isEmpty(s.col(x), e)) continue;
      s.put('oneway', x, e);
      if (s.has('coin') && s.ctx.g.isEmpty(s.col(x), e - 1)) s.put('coin', x, e - 1);
    }
    return e;
  },
};

export const CLASSIC_PATTERNS: Pattern[] = [intro, flat, stairs, gap, floating, enemy, pipes, blocks, spring, mover, hazard, bonus, slopes, pool, cliff, split, finale, keyEnd, lockedGoal];
