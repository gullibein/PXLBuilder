/**
 * Patterns that need more than the jump: each requires a capability of the player (a reach description's:
 * core/reach) and sizes itself from that capability's numbers. The builder builds one only for a player that has
 * its capability, and the level then needs it (the route solver finds no way without). They are written against the
 * pattern interface alone: the builder knows nothing of wall jumps or dashes.
 *
 * Two, to prove the way (docs/engine-architecture-proposal.md §22.2); a broad set is the precision-platformer
 * slice's (V1).
 */
import { PatternError, Section, type Pattern } from '../pattern';

/**
 * A gap wider than any jump, crossed with a dash at the top of the jump: wider by one cell at least, and by no more
 * than the dash carries (its `cells`), less a cell of margin below the hardest difficulty.
 */
const dashGap: Pattern = {
  id: 'dash_gap',
  version: 1,
  name: 'a gap too wide to jump: crossed with a dash at the top of the jump',
  mechanics: ['dash'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground'],
  requires: ['dash'],
  variants: [{ id: 'plain' }, { id: 'spikes', needs: ['hazard'], minDifficulty: 2 }],
  difficulty: [1, 5],
  width: (lim, _d, _v, caps) => [lim.gap(0) + 6, lim.gap(0) + (caps.dash?.cells ?? 1) + 8],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const extra = Math.floor(ctx.caps.dash?.cells ?? 0);
    // (What the player crosses without its dash, by everything else it can do; and with it.)
    const jump = ctx.without(['dash']).gap;
    const reach = Math.min(ctx.without([]).gap, ctx.reach.gap(0) + extra);
    if (extra < 1 || jump < 1 || reach <= jump) throw new PatternError("the player's dash doesn't carry it further than it gets without");
    // (Beyond that by a cell at least, as far as the dash carries; the widest only at the top difficulty.)
    // (And no wider than the section has room for, with ground to take off from and to land on.)
    const most = Math.min(Math.max(1, reach - jump - (ctx.difficulty >= 5 ? 0 : 1)), s.w - 4 - jump);
    if (most < 1) throw new PatternError('no room for a gap that wide');
    const g = jump + s.scaled(1, most);
    const lipEnd = Math.max(1, Math.floor((s.w - g - 2) / 2));
    s.flat(0, lipEnd, e);
    if (ctx.variant === 'spikes') {
      // A trench with spikes on its floor (two rows down: the dash goes over them).
      if (e + 2 > ctx.band.fill) throw new PatternError('no room under the ground for a trench here');
      for (let i = lipEnd + 1; i <= lipEnd + g; i++) {
        s.ground(i, e + 2);
        s.put('hazard', i, e + 1);
      }
    }
    s.flat(lipEnd + g + 1, s.w - 1, e);
    return e;
  },
};

/**
 * A shaft up a cliff higher than any jump: a hanging wall facing the cliff, the player walks in under it and kicks
 * from wall to wall up onto the cliff's top. As wide inside as a kick carries (its `away`, two cells at most), as
 * high as the floor has room for.
 */
const wallShaft: Pattern = {
  id: 'wall_shaft',
  version: 1,
  name: 'a cliff too high to jump, with a hanging wall facing it: climbed by wall jumps between the two',
  mechanics: ['wall_jump'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground'],
  requires: ['wall_jump'],
  variants: [{ id: 'plain' }],
  difficulty: [1, 5],
  width: () => [9, 12],
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const kick = ctx.caps.wall_jump;
    if (!kick || kick.rise < 1 || kick.away < 1) throw new PatternError("the player's wall jump gains no height");
    // Higher than the player gets without its wall jump, by everything else it can do (its jump, a dash upward…), as
    // high as the floor allows, more with the difficulty.
    const least = ctx.without(['wall_jump']).rise + 1;
    const room = Math.min(e - s.highest, e - ctx.band.top - 3);
    if (room < least) throw new PatternError('no room for a cliff too high for the player without its wall jump here');
    const h = Math.min(room, least + (ctx.difficulty >= 4 ? 1 : 0));
    const inner = Math.min(2, Math.floor(kick.away));
    const wall = 2;
    const cliff = wall + inner + 1;
    if (cliff + 3 > s.w) throw new PatternError('no room for the shaft and its landing');
    s.flat(0, cliff - 1, e);
    // The hanging wall: from a row over the cliff's top down to head height over the floor (the way in is under it).
    ctx.g.fill('ground', s.col(wall), e - h - 1, s.col(wall), e - 2);
    s.flat(cliff, s.w - 1, e - h);
    return e - h;
  },
};

export const ABILITY_PATTERNS: Pattern[] = [dashGap, wallShaft];
