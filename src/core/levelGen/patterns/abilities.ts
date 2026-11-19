/**
 * Patterns that need more than the jump: each requires a capability of the player (a reach description's:
 * core/reach) and sizes itself from that capability's numbers. The builder builds one only for a player that has
 * its capability, and the level then needs it (the route solver finds no way without). They are written against the
 * pattern interface alone: the builder knows nothing of wall jumps or dashes.
 *
 * Six, each a different thing to do (docs/engine-architecture-proposal.md §22.2, §24.6): a dash across (dash_gap), a
 * dash upward (dash_rise), a climb between two walls (wall_shaft), a kick back onto a ledge (kick_back), and two that
 * need both abilities: a dash upward to catch the walls of a shaft that start out of reach (dash_shaft), and a dash
 * across a pit to catch a cliff's face, with a kick back onto a ledge (dash_cling).
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
  version: 2,
  name: 'a cliff too high to jump, with a hanging wall facing it: climbed by wall jumps between the two',
  mechanics: ['wall_jump'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground'],
  requires: ['wall_jump'],
  variants: [{ id: 'plain' }],
  difficulty: [1, 5],
  width: () => [10, 13],
  climbs: (_lim, _caps, without) => without(['wall_jump']).rise + 1,
  build(ctx) {
    const s = new Section(ctx);
    const kick = ctx.caps.wall_jump;
    if (!kick || kick.rise < 1 || kick.away < 1) throw new PatternError("the player's wall jump gains no height");
    // Higher than the player gets without its wall jump, by everything else it can do (its jump, a dash upward…), as
    // high as the floor allows, more with the difficulty.
    const least = ctx.without(['wall_jump']).rise + 1;
    // (From the entry's floor where it has the room to rise; else down in a drop first, and up out of the pit.)
    const { floor: f, from } = footing(s, least);
    const h = Math.min(roomUp(s, f), least + (ctx.difficulty >= 4 ? 1 : 0));
    const inner = Math.min(2, Math.floor(kick.away));
    const wall = from + 2;
    const cliff = wall + inner + 1;
    if (cliff + 3 > s.w) throw new PatternError('no room for the shaft and its landing');
    s.flat(from, cliff - 1, f);
    // The hanging wall: from a row over the cliff's top down to head height over the floor (the way in is under it).
    ctx.g.fill('ground', s.col(wall), f - h - 1, s.col(wall), f - 2);
    s.flat(cliff, s.w - 1, f - h);
    return f - h;
  },
};

/** How high a floor at row `floor` has room to rise in this section's band, with headroom over what is built on top. */
const roomUp = (s: Section, floor: number) => Math.min(floor - s.highest, floor - s.ctx.band.top - 3);

/**
 * Where a climb `h` rows high starts from. The entry's own floor, when it has room to rise that much. Else a drop
 * first: two cells of ground to walk off, then the floor as much lower as it takes (no lower than the band's base),
 * so the climb is out of a pit. `floor`: the row of the ground the climb starts on; `from`: the section's column it
 * is built from. (After one climb the ground is as high as it may go: without the drop no second climb fits.)
 */
function footing(s: Section, h: number): { floor: number; from: number } {
  const e = s.ctx.entry;
  if (roomUp(s, e) >= h) return { floor: e, from: 0 };
  const floor = Math.min(s.lowest, e + (h - roomUp(s, e)));
  if (floor <= e || roomUp(s, floor) < h) throw new PatternError('no room for a climb that high here');
  s.flat(0, 1, e);
  return { floor, from: 2 };
}

/**
 * A cliff too high to jump, got up with a dash upward at the top of the jump: higher than the player gets without
 * its dash by a row at least, as high as the dash lifts it (its `up`). Two constructions: a cliff up onto higher
 * ground, or a wall to get over and down again.
 */
const dashRise: Pattern = {
  id: 'dash_rise',
  version: 1,
  name: 'a cliff too high to jump: got up with a dash upward at the top of the jump',
  mechanics: ['dash'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground'],
  requires: ['dash'],
  variants: [{ id: 'cliff' }, { id: 'wall' }],
  difficulty: [1, 5],
  // (Not for a dash that only goes sideways: never picked.)
  width: (_lim, _d, _v, caps) => ((caps.dash?.up ?? 0) < 1 ? [Infinity, Infinity] : [7, 10]),
  build(ctx) {
    const s = new Section(ctx);
    const e = ctx.entry;
    const up = Math.floor(ctx.caps.dash?.up ?? 0);
    // (What the player gets up without its dash, by everything else it can do; and with it.)
    const jump = ctx.without(['dash']).rise;
    const reach = Math.min(ctx.without([]).rise, ctx.reach.maxRise + up);
    if (up < 1 || reach <= jump) throw new PatternError("the player's dash doesn't lift it higher than it gets without");
    if (ctx.variant === 'wall') {
      // (A wall to get over may stand higher than the ground may rise: only its top needs the room.)
      const room = e - ctx.band.top - 3;
      if (room < jump + 1) throw new PatternError('no room for a wall too high for the player without its dash here');
      const h = Math.min(room, reach, jump + 1 + (ctx.difficulty >= 4 ? 1 : 0));
      const foot = Math.max(2, Math.floor(s.w / 2) - 1);
      s.flat(0, foot, e);
      // Two or three cells thick (a place to land on top), then down again.
      const thick = Math.min(3, Math.max(2, s.w - foot - 4));
      s.flat(foot + 1, foot + thick, e - h);
      s.flat(foot + thick + 1, s.w - 1, e);
      return e;
    }
    // (From the entry's floor where it has the room to rise; else down in a drop first, and up out of the pit.)
    const { floor: f, from } = footing(s, jump + 1);
    // (A row over what it gets up without; the highest only at the harder difficulties.)
    const h = Math.min(roomUp(s, f), reach, jump + 1 + (ctx.difficulty >= 4 ? 1 : 0));
    const foot = from + Math.max(2, Math.floor((s.w - from) / 2) - 1);
    if (foot + 3 > s.w) throw new PatternError('no room for the cliff and its landing');
    s.flat(from, foot, f);
    s.flat(foot + 1, s.w - 1, f - h);
    return f - h;
  },
};

/**
 * A cliff too high to jump, with a ledge hanging behind the player: a jump onto the cliff's face, a kick off it back
 * and up onto the ledge, and from the ledge a jump onto the cliff's top. The ledge is where one kick lands (the
 * jump's rise and the kick's above the floor, as far from the wall as the kick carries); the cliff, one jump above
 * the ledge. Built only where that is higher than the player gets without its wall jump.
 */
const kickBack: Pattern = {
  id: 'kick_back',
  version: 1,
  name: 'a cliff too high to jump with a ledge hanging behind: a jump onto the cliff face, a kick back up onto the ledge, a jump from it onto the top',
  mechanics: ['wall_jump'],
  fits: ['teach', 'test', 'twist'],
  needs: ['ground'],
  requires: ['wall_jump'],
  variants: [{ id: 'block' }, { id: 'oneway', needs: ['oneway'] }],
  difficulty: [1, 5],
  // (Not for a player that gets up a cliff that high without its wall jump, with a dash upward: never picked.)
  width: (lim, _d, _v, caps, without) => (without && 2 * lim.maxRise + Math.floor(caps.wall_jump?.rise ?? 0) <= without(['wall_jump']).rise ? [Infinity, Infinity] : [10, 12]),
  climbs: (lim, caps) => 2 * lim.maxRise + Math.floor(caps.wall_jump?.rise ?? 0),
  build(ctx) {
    const s = new Section(ctx);
    const kick = ctx.caps.wall_jump;
    const jump = ctx.reach.maxRise;
    if (!kick || kick.rise < 1 || kick.away < 1 || jump < 1) throw new PatternError("the player's wall jump gains no height");
    const rise = Math.floor(kick.rise);
    const away = Math.min(2, Math.floor(kick.away));
    // The ledge: a jump and a kick above the floor. The cliff's top: a jump above the ledge.
    const ledge = jump + rise;
    const h = ledge + jump;
    if (h <= ctx.without(['wall_jump']).rise) throw new PatternError('the player gets up a cliff that high without its wall jump');
    // (The ledge's cells are over the player's head as it walks up to the wall: a row of room under them.)
    if (ledge < 2) throw new PatternError('the ledge would be in the way of walking up to the wall');
    const { floor: f, from } = footing(s, h);
    const cliff = Math.max(from + away + 3, s.w - 4);
    if (cliff + 3 > s.w) throw new PatternError('no room for the cliff and its landing');
    s.flat(from, cliff - 1, f);
    s.flat(cliff, s.w - 1, f - h);
    // (Its cells: where a kick lands, one to `away` cells from the wall; a cell free beside the wall to jump up in.)
    for (let k = 1; k <= away; k++) {
      if (ctx.variant === 'oneway') s.put('oneway', cliff - 1 - k, f - ledge);
      else ctx.g.fill('ground', s.col(cliff - 1 - k), f - ledge, s.col(cliff - 1 - k), f - ledge);
    }
    return f - h;
  },
};

/**
 * A shaft whose walls start out of reach: the hanging wall facing the cliff ends too high over the floor for a jump
 * and a kick to get onto it, so the climb starts with a dash upward that catches a wall; from there, wall jumps to
 * the cliff's top. It needs both: without the dash the walls are never reached; without wall jumps the dash alone
 * doesn't get to the top (the cliff is higher than a dash lifts).
 */
const dashShaft: Pattern = {
  id: 'dash_shaft',
  version: 1,
  name: 'a shaft whose walls start out of reach: a dash upward to catch a wall, then wall jumps to the top',
  mechanics: ['dash', 'wall_jump'],
  fits: ['test', 'twist'],
  needs: ['ground'],
  requires: ['dash', 'wall_jump'],
  variants: [{ id: 'plain' }],
  difficulty: [2, 5],
  width: (_lim, _d, _v, caps) => ((caps.dash?.up ?? 0) < 1 ? [Infinity, Infinity] : [10, 13]),
  climbs: (lim, caps, without) => Math.max(without(['wall_jump']).rise, lim.maxRise + Math.floor(caps.dash?.up ?? 0)) + 1,
  build(ctx) {
    const s = new Section(ctx);
    const kick = ctx.caps.wall_jump;
    const up = Math.floor(ctx.caps.dash?.up ?? 0);
    const jump = ctx.reach.maxRise;
    if (!kick || kick.rise < 1 || kick.away < 1 || up < 1 || jump < 1) throw new PatternError("the player's dash doesn't go up, or its wall jump gains no height");
    const rise = Math.floor(kick.rise);
    // The cliff: higher than the dash alone lifts the player (what it gets up without its wall jump).
    const least = Math.max(ctx.without(['wall_jump']).rise, jump + up) + 1;
    // (From the entry's floor where it has the room to rise; else down in a drop first, and up out of the pit.)
    const { floor: f, from } = footing(s, least);
    const h = Math.min(roomUp(s, f), least + (ctx.difficulty >= 5 ? 1 : 0));
    // The hanging wall: its lowest row over what a jump onto the cliff face and a kick off it get to (so not without
    // the dash), and no higher than a kick off the cliff face gets to from where the dash catches it.
    const lowest = f - jump - rise - 2;
    const top = f - h - 2;
    if (top < ctx.band.top || lowest - top < 1) throw new PatternError('no room for the hanging wall');
    const inner = Math.min(2, Math.floor(kick.away));
    const wall = from + Math.max(2, Math.min(4, s.w - from - inner - 5));
    const cliff = wall + inner + 1;
    if (cliff + 3 > s.w) throw new PatternError('no room for the shaft and its landing');
    s.flat(from, cliff - 1, f);
    ctx.g.fill('ground', s.col(wall), top, s.col(wall), lowest);
    s.flat(cliff, s.w - 1, f - h);
    return f - h;
  },
};

/**
 * A pit too wide to jump, with nothing on its far side but a cliff's face and a ledge hanging before it: a dash
 * across catches the face, a kick off it goes back and up onto the ledge, and a jump from the ledge gets onto the
 * cliff's top. It needs both: the face is further than any jump reaches it, and the ledge and the top are higher
 * than a dash gets to across a pit.
 */
const dashCling: Pattern = {
  id: 'dash_cling',
  version: 1,
  name: 'a pit too wide to jump with only a cliff face beyond: a dash across to catch the face, a kick back up onto a hanging ledge, a jump from it onto the top',
  mechanics: ['dash', 'wall_jump'],
  fits: ['test', 'twist'],
  needs: ['ground', 'oneway'],
  requires: ['dash', 'wall_jump'],
  variants: [{ id: 'pit', bottomOnly: true }, { id: 'spikes', needs: ['hazard'] }],
  difficulty: [2, 5],
  width: (lim, _d, _v, caps) => [lim.gap(0) + 12, lim.gap(0) + (caps.dash?.cells ?? 1) + 13],
  climbs: (lim, caps) => 2 * lim.maxRise + Math.floor(caps.wall_jump?.rise ?? 0),
  build(ctx) {
    const s = new Section(ctx);
    const kick = ctx.caps.wall_jump;
    const cells = Math.floor(ctx.caps.dash?.cells ?? 0);
    const jump = ctx.reach.maxRise;
    if (!kick || kick.rise < 1 || kick.away < 1 || cells < 1 || jump < 1) throw new PatternError("the player's dash carries it no further, or its wall jump gains no height");
    const rise = Math.floor(kick.rise);
    const away = Math.min(2, Math.floor(kick.away));
    // The face is caught a jump's rise over the lip; the ledge is a kick above that; the top, a jump above the ledge.
    const ledge = jump + rise;
    const h = ledge + jump;
    // (From the entry's floor where it has the room to rise; else down in a drop first.)
    const { floor: f, from } = footing(s, h);
    // The pit (its last cell is where the face is caught): wider than any jump reaches the face across, and no
    // wider than a dash at that height carries.
    const least = ctx.reach.gap(0) + 2;
    const most = Math.min(ctx.reach.gap(jump) + cells + 1, s.w - from - 6);
    if (most < least) throw new PatternError("the player's dash doesn't reach a wall further than its jump does, or there is no room for the pit");
    const pit = Math.min(most, least + (ctx.difficulty >= 4 ? 1 : 0));
    const lip = s.w - pit - 4;
    if (lip < from + 2) throw new PatternError('no room for a run-up before the pit');
    const cliff = lip + pit + 1;
    s.flat(from, lip, f);
    if (ctx.variant === 'spikes') {
      // A trench with spikes on its floor instead of a drop out of the level.
      if (f + 2 > ctx.band.fill) throw new PatternError('no room under the ground for a trench here');
      for (let i = lip + 1; i < cliff; i++) {
        s.ground(i, f + 2);
        s.put('hazard', i, f + 1);
      }
    }
    s.flat(cliff, s.w - 1, f - h);
    for (let k = 1; k <= away; k++) s.put('oneway', cliff - 1 - k, f - ledge);
    return f - h;
  },
};

export const ABILITY_PATTERNS: Pattern[] = [dashGap, wallShaft, dashRise, kickBack, dashShaft, dashCling];
