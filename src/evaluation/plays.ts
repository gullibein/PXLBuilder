/**
 * The play scripts: what each kind of game must do when played, checked by playing it. Each script drives the game
 * through the keys, time and what the engine itself knows (its menu, its cursor, who is steered, its turns), and
 * judges by what can be observed. Where a requirement cannot be observed by a script yet, the check says "not
 * judged" and why: never a pass.
 *
 * Some checks set a thing in a place first (the character on the goal, the ball on a flipper): the engine's own
 * level check judges whether the place can be reached; the script judges what happens there. Each says so.
 */
import { diagnoseLevel } from '../core/debug/diagnose';
import type { Action } from '../runtime/input';
import { abilityKeys } from '../runtime/movement';
import type { RuntimeEntity } from '../runtime/runtime';
import { solidBoxOf, type Played } from './played';
import { failed, judged, notJudged, passed, type Check } from './verdict';
import { begin, difference, run, sight, twin, type PlayCtx, type SeenThing, type Sight } from './watch';

const P = 'plays' as const;
const KEYS: Action[] = ['jump', 'interact', 'fire', 'up', 'down', 'left', 'right', 'special', 'menu'];
const ACT_KEYS: Action[] = ['jump', 'interact', 'fire'];
const list = (items: string[], most = 4) => (items.length > most ? `${items.slice(0, most).join(', ')} and ${items.length - most} more` : items.join(', '));
const px = (n: number) => `${Math.round(n)} px`;

// ------------------------------------------------------------------------------------------------ characters

/** The keys move the character (and the jump key lifts it, from the side). */
export function characterMoves(ctx: PlayCtx, view: 'side' | 'top' | 'any'): Check[] {
  return run(ctx, (g) => {
    begin(g);
    const who = g.steered()[0];
    const what = view === 'side' ? 'Left and right move the character, and the jump key lifts it off the ground' : 'The arrow keys move the character each way';
    if (!who) return [failed(P, what, 'Nothing in the level is steered by a movement model.')];
    g.until(() => who.grounded || view !== 'side', 2);
    const go = (a: Action) => {
      const [x, y] = [who.x, who.y];
      g.hold(a);
      g.wait(0.6);
      g.hold();
      g.wait(0.25);
      return { dx: who.x - x, dy: who.y - y };
    };
    const right = go('right').dx;
    const left = go('left').dx;
    const sideways = right > 6 || left < -6;
    const said = [`right ${px(right)}`, `left ${px(left)}`];
    if (view === 'side') {
      g.until(() => who.grounded, 2);
      const y0 = who.y;
      let top = y0;
      g.hold('jump');
      for (let n = 0; n < 30; n++) {
        g.step();
        top = Math.min(top, who.y);
      }
      g.hold();
      const landed = g.until(() => who.grounded, 3);
      return [judged(P, what, sideways && y0 - top > 8, `${who.name}: ${said.join(', ')}; the jump key lifted it ${px(y0 - top)}${landed ? ' and it came down again' : ''}.`)];
    }
    const down = go('down').dy;
    const up = go('up').dy;
    said.push(`down ${px(down)}`, `up ${px(up)}`);
    const upDown = down > 6 || up < -6;
    return [judged(P, what, view === 'any' ? sideways || upDown : sideways && upDown, `${who.name}: ${said.join(', ')}.`)];
  });
}

/** The engine's own level check, for every level a character must get through. */
export function levelsCanBeFinished(ctx: PlayCtx): Check[] {
  const out: Check[] = [];
  for (const scene of ctx.project.scenes) {
    if (!scene.entities.length) continue;
    const problems = diagnoseLevel(ctx.project, scene.id, ctx.registry);
    const errors = problems.filter((p) => p.severity === 'error');
    const what = `"${scene.name}" can be got through (the engine's own level check)`;
    if (errors.length) out.push(failed(P, what, list(errors.map((p) => p.text), 2)));
    else out.push(passed(P, what, problems.length ? `No fault; noted: ${list(problems.map((p) => p.text), 2)}` : 'No problem found.'));
  }
  return out;
}

const goalOf = (g: Played): RuntimeEntity | undefined => g.things().find((e) => e.base.components.Goal);

/** Reaching the goal wins the level; with more levels, the next one starts. */
export function goalWins(ctx: PlayCtx, wantNext: boolean): Check[] {
  return run(ctx, (g) => {
    begin(g);
    const who = g.steered()[0];
    const goal = goalOf(g);
    const what = wantNext ? 'Reaching the goal wins the level and the next level starts' : 'Reaching the goal wins the level';
    if (!who || !goal) return [failed(P, what, !who ? 'No character is steered.' : 'Nothing in the level is a goal.')];
    const first = g.level;
    who.x = goal.x;
    who.y = goal.y;
    who.vx = who.vy = 0;
    const won = g.until(() => g.won || g.level !== first, 2);
    const next = wantNext ? g.until(() => g.level !== first, 4) : true;
    const how = '(The character was set on the goal: whether it can get there is the level check\'s matter.)';
    if (!won) return [failed(P, what, `The character on the goal won nothing in two seconds. ${how}`)];
    return [judged(P, what, next, `${wantNext ? (next ? `After "${first}" came "${g.level}".` : `"${first}" was won and no other level started.`) : `"${first}" was won.`} ${how}`)];
  });
}

/** A key of an ability the engine knows (a dash, a roll) sends the character further than without it. */
export function abilityKeyActs(ctx: PlayCtx, does: RegExp, what: string): Check[] {
  let key: Action | null = null;
  const t = twin(
    ctx,
    (g) => {
      begin(g);
      const who = g.steered()[0];
      if (who) g.until(() => who.grounded, 2);
      key = (who ? abilityKeys(who).find((k) => does.test(k.does))?.action : null) ?? null;
      g.hold('right');
      g.wait(0.2);
    },
    (g) => {
      if (key) g.hold('right', key);
      g.wait(0.1);
      g.hold('right');
      g.wait(0.3);
    },
    0,
  );
  if (!key) return [failed(P, what, 'The steered character has no such ability as the engine knows it.')];
  const me = [...t.acted.things.values()].find((s) => s.steered);
  const other = me && t.idle.things.get(me.key);
  if (!me || !other) return [failed(P, what, 'No steered character.')];
  const gain = me.x - other.x;
  return [judged(P, what, gain > 16, `Running right for 0.4 s, the character got ${px(gain)} further with the ${key} key pressed than without.`)];
}

/** A second jump in the air lifts the character again. */
export function secondJumpLifts(ctx: PlayCtx): Check[] {
  const what = 'A second press of the jump key in the air lifts the character again';
  const t = twin(
    ctx,
    (g) => {
      begin(g);
      const who = g.steered()[0];
      if (!who) return;
      g.until(() => who.grounded, 2);
      g.tap('jump', 0.25, 0.2);
    },
    (g) => g.tap('jump', 0.2, 0.1),
    0,
  );
  const me = [...t.acted.things.values()].find((s) => s.steered);
  const other = me && t.idle.things.get(me.key);
  if (!me || !other) return [failed(P, what, 'No steered character.')];
  return [judged(P, what, other.y - me.y > 12, `Pressed again 0.45 s into a jump, the character was ${px(other.y - me.y)} higher 0.3 s later than without the second press.`)];
}

/** Off a wall, in the air, the jump key lifts the character (it is set beside a wall to try). */
export function wallJumpLifts(ctx: PlayCtx): Check[] {
  const what = 'In the air against a wall, the jump key sends the character up and away';
  return run(ctx, (g) => {
    begin(g);
    const who = g.steered()[0];
    if (!who?.collider) return [failed(P, what, 'No steered character.')];
    // A wall: a fixed solid at least three cells tall (stacked tiles count), with open air to its left.
    const solids = g.things().filter((e) => e.body === 'static' && e.collider && !e.collider.trigger && !e.collider.oneWay && !e.collider.slope);
    const at = new Set(solids.map((e) => `${Math.round((e.x - 16) / 32)},${Math.round((e.y - 16) / 32)}`));
    const free = (c: number, r: number) => !at.has(`${c},${r}`);
    let spot: { x: number; y: number } | null = null;
    for (const key of at) {
      const [c, r] = key.split(',').map(Number);
      if (at.has(`${c},${r + 1}`) && at.has(`${c},${r + 2}`) && [0, 1, 2, 3].every((d) => free(c - 1, r + d - 1) && free(c - 2, r + d - 1))) {
        spot = { x: c * 32 - who.collider.hw - 1, y: r * 32 + 48 };
        break;
      }
    }
    if (!spot) return [notJudged(P, what, 'No wall three cells tall with open air beside it was found in the level to try it on.')];
    who.x = spot.x;
    who.y = spot.y;
    who.vx = who.vy = 0;
    g.hold('right');
    g.wait(0.12);
    const y0 = who.y;
    g.hold('right', 'jump');
    g.wait(0.05);
    g.hold();
    let top = y0;
    for (let n = 0; n < 15; n++) {
      g.step();
      top = Math.min(top, who.y);
    }
    return [judged(P, what, y0 - top > 12, `Set in the air against a wall and holding toward it, the jump key lifted the character ${px(y0 - top)}.`)];
  });
}

/** Things move by themselves, with no key pressed: at least `kinds` different objects. */
export function thingsActAlone(ctx: PlayCtx, kinds: number, what: string): Check[] {
  return run(ctx, (g) => {
    begin(g);
    const a = sight(g);
    g.wait(4);
    const d = difference(a, sight(g));
    const moving = new Set([...d.moved.filter((m) => !m.b.steered).map((m) => m.b.def ?? m.b.name), ...d.more.map((m) => m.def ?? m.name)]);
    const names = [...new Set([...d.moved.filter((m) => !m.b.steered).map((m) => m.b.name), ...d.more.map((m) => m.name)])];
    return [judged(P, what, moving.size >= kinds, moving.size ? `In four seconds with no key pressed: ${list(names)} moved or appeared (${moving.size} kind${moving.size === 1 ? '' : 's'} of thing).` : 'In four seconds with no key pressed, nothing but the character moved or appeared.')];
  });
}

/** A door stays shut without its key and opens with it (the character is set at the door, then at each thing to pick up). */
export function doorNeedsKey(ctx: PlayCtx): Check[] {
  const what = 'A locked door stays shut without the key and opens with it';
  return run(ctx, (g) => {
    begin(g);
    const who = g.steered()[0];
    const doors = g.things().filter((e) => e.base.components.Openable);
    if (!who) return [failed(P, what, 'No steered character.')];
    if (!doors.length) return [failed(P, what, 'Nothing in the level opens (no door as the engine knows one).')];
    const beside = (e: RuntimeEntity) => {
      who.x = e.x - (e.collider?.hw ?? 16) - (who.collider?.hw ?? 14) - 1;
      who.y = e.y;
      who.vx = who.vy = 0;
      g.hold('right');
      g.wait(0.4);
      g.tap('interact', 0.05, 0.3);
      g.hold();
    };
    const shut = doors.filter((d) => !d.open);
    if (!shut.length) return [failed(P, what, 'Every door is open from the start.')];
    const door = shut[0];
    const isOpen = () => door.open === true;
    beside(door);
    if (isOpen()) return [failed(P, what, `${door.name} opened for a character carrying nothing.`)];
    const pickups = g.things().filter((e) => e.base.components.Collectible);
    for (const k of pickups) {
      who.x = k.x;
      who.y = k.y;
      g.wait(0.15);
    }
    beside(door);
    const how = '(The character was set at the door and on each thing to pick up; the level check judges the way between.)';
    const opened = isOpen();
    return [judged(P, what, opened, opened ? `${door.name} stayed shut for a character carrying nothing and opened once it had picked up ${pickups.length} thing${pickups.length === 1 ? '' : 's'}. ${how}` : `${door.name} stayed shut even after the character picked up everything there is to pick up (${pickups.length}). ${how}`)];
  });
}

// ------------------------------------------------------------------------------------------------ falling pieces

interface Falling {
  keys: string[];
  box: { l: number; r: number; t: number; b: number };
}
/** The things that fell between two sights (a falling piece), and the box round them in the later one. */
function fallingBetween(a: Sight, b: Sight): Falling | null {
  const fell = difference(a, b).moved.filter((m) => !m.b.steered && m.dy > 4);
  if (!fell.length) return null;
  const xs = fell.map((m) => m.b.x);
  const ys = fell.map((m) => m.b.y);
  return { keys: fell.map((m) => m.b.key), box: { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) } };
}
const boxOfKeys = (s: Sight, keys: string[]) => {
  const ts = keys.map((k) => s.things.get(k)).filter((t): t is SeenThing => !!t);
  return ts.length ? { l: Math.min(...ts.map((t) => t.x)), r: Math.max(...ts.map((t) => t.x)), t: Math.min(...ts.map((t) => t.y)), b: Math.max(...ts.map((t) => t.y)) } : null;
};

/** A falling-piece puzzle: pieces fall by themselves, are steered and turned, land and are followed by the next; rows (or groups) clear. */
export function fallingPieces(ctx: PlayCtx, clears: string): Check[] {
  const out: Check[] = [];
  const lead = (g: Played) => {
    begin(g);
    g.wait(0.6);
  };
  // Falls by itself.
  const piece = run(ctx, (g) => {
    lead(g);
    const a = sight(g);
    g.wait(1.2);
    return fallingBetween(a, sight(g));
  });
  out.push(judged(P, 'A piece falls by itself', !!piece, piece ? `${piece.keys.length} thing${piece.keys.length === 1 ? '' : 's'} came down together with no key pressed.` : 'Nothing came down in 1.2 s with no key pressed.'));
  if (!piece) return [...out, notJudged(P, 'Left and right move the falling piece', 'No falling piece was seen.'), notJudged(P, 'A key turns the falling piece', 'No falling piece was seen.'), notJudged(P, clears, 'No falling piece was seen.')];
  const shift = (key: Action) => {
    const t = twin(ctx, lead, (g) => g.tap(key, 0.05, 0.1), 0.1);
    const a = boxOfKeys(t.idle, piece.keys);
    const b = boxOfKeys(t.acted, piece.keys);
    return a && b ? { dx: (b.l + b.r - a.l - a.r) / 2, turned: Math.abs(b.r - b.l - (a.r - a.l)) > 8 || Math.abs(b.b - b.t - (a.b - a.t)) > 8 } : null;
  };
  const [l, r] = [shift('left'), shift('right')];
  out.push(judged(P, 'Left and right move the falling piece', !!l && !!r && l.dx < -8 && r.dx > 8, `A press of left moved it ${px(l?.dx ?? 0)}, a press of right ${px(r?.dx ?? 0)} (against the same moment with no key).`));
  const turnKey = (['up', 'jump', 'interact', 'fire', 'special'] as Action[]).find((k) => shift(k)?.turned);
  out.push(judged(P, 'A key turns the falling piece', !!turnKey, turnKey ? `The ${turnKey} key changed the piece's shape on the board (wide for tall).` : 'No key (up, jump, interact, fire, special) changed the shape the piece takes up.'));
  // Lands, and the next comes; clears (seen only if the unskilled stacking happens to fill a row).
  const stacked = run(ctx, (g) => {
    lead(g);
    const start = g.things().length;
    let most = start;
    let cleared = 0;
    let last = start;
    for (let n = 0; n < 60 * 90 && !g.stopped && !g.won; n++) {
      // A column at a time: left a varying number of presses, then held down.
      const phase = Math.floor(n / 90);
      const t = n % 90;
      const side: Action = phase % 2 ? 'right' : 'left';
      if (t < (phase % 5) * 6 && t % 6 < 3) g.hold(side);
      else g.hold('down');
      g.step();
      const now = g.things().length;
      if (last - now >= 3) cleared++;
      most = Math.max(most, now);
      last = now;
    }
    return { start, most, cleared };
  });
  out.push(judged(P, 'A piece that lands stays, and the next one comes', stacked.most - stacked.start >= piece.keys.length * 2, `In 90 s of stacking by a script, the board went from ${stacked.start} things to ${stacked.most} at most.`));
  if (stacked.cleared) out.push(passed(P, clears, `Seen ${stacked.cleared} time${stacked.cleared === 1 ? '' : 's'} in 90 s of stacking: three or more things went at once and the game went on.`));
  else out.push(notJudged(P, clears, 'In 90 s of stacking without skill, the script filled nothing that cleared. A script that fills a row on purpose in a game it has not seen is not written yet.'));
  return out;
}

// ------------------------------------------------------------------------------------------------ shooting, digging

export function shooting(ctx: PlayCtx): Check[] {
  const out: Check[] = [];
  let flew = 0;
  const t = twin(
    ctx,
    begin,
    (g) => {
      g.hold('fire');
      g.wait(0.3);
      g.hold();
      const a = sight(g);
      g.wait(0.2);
      flew = difference(a, sight(g)).moved.filter((m) => !m.b.steered && !m.b.fixed).length;
    },
    0,
  );
  const shots = t.caused.more;
  out.push(judged(P, 'The fire key sends a shot flying', shots.length > 0 && flew > 0, shots.length ? `Holding fire for 0.3 s made ${shots.length} more thing${shots.length === 1 ? '' : 's'} (${list([...new Set(shots.map((s) => s.name))])}) than the same moment without; they ${flew ? 'were flying' : 'did not move'}.` : 'Holding fire made nothing appear that was not there without it.'));
  // A longer fight: firing while moving from side to side, against the same time doing nothing.
  const fight = twin(
    ctx,
    begin,
    (g) => {
      for (let s = 0; s < 20 && !g.stopped; s++) {
        g.hold('fire', s % 2 ? 'left' : 'right');
        g.wait(1);
      }
      g.hold();
    },
    0,
  );
  const shotKinds = new Set(shots.map((s) => s.def ?? s.name));
  const downed = fight.caused.fewer.filter((s) => !s.steered && !shotKinds.has(s.def ?? s.name));
  const score = Math.max(0, ...fight.acted.numbers) > Math.max(0, ...fight.idle.numbers);
  const what = 'A shot that hits an enemy does away with it (or scores)';
  if (downed.length || score) out.push(passed(P, what, `After 20 s of firing while moving from side to side${downed.length ? `, ${downed.length} thing${downed.length === 1 ? '' : 's'} there without firing ${downed.length === 1 ? 'was' : 'were'} gone (${list([...new Set(downed.map((s) => s.name))])})` : ''}${score ? `, and a number shown was higher (${Math.max(0, ...fight.acted.numbers)} against ${Math.max(0, ...fight.idle.numbers)})` : ''}.`));
  else out.push(notJudged(P, what, 'In 20 s of firing while moving from side to side, nothing was seen to be hit: no thing was gone that was there without firing, no number shown was higher.'));
  return out;
}

/** Digging: a key takes ground away where the character is, and the character gets into where it was. */
export function digging(ctx: PlayCtx, loose: boolean): Check[] {
  const out: Check[] = [];
  const tries: Action[][] = [['down'], ['down', 'interact'], ['down', 'fire'], ['interact'], ['fire'], ['right'], ['right', 'interact'], ['right', 'fire']];
  let found: { keys: Action[]; t: ReturnType<typeof twin> } | null = null;
  for (const keys of tries) {
    const t = twin(
      ctx,
      begin,
      (g) => {
        g.hold(...keys);
        g.wait(2.5);
        g.hold();
      },
      0.5,
    );
    if (t.caused.fewer.some((s) => !s.steered)) {
      found = { keys, t };
      break;
    }
  }
  out.push(judged(P, 'Digging takes the ground away', !!found, found ? `Holding ${found.keys.join(' and ')} for 2.5 s: ${found.t.caused.fewer.length} thing${found.t.caused.fewer.length === 1 ? '' : 's'} gone that stayed without it (${list([...new Set(found.t.caused.fewer.map((s) => s.name))])}).` : `No key or pair of keys tried (${tries.map((k) => k.join('+')).join(', ')}) took anything away.`));
  if (!found) return out;
  const me = [...found.t.acted.things.values()].find((s) => s.steered);
  const other = me && found.t.idle.things.get(me.key);
  if (me && other) out.push(judged(P, 'The character gets into where the ground was', Math.hypot(me.x - other.x, me.y - other.y) > 24, `It ended ${px(Math.hypot(me.x - other.x, me.y - other.y))} from where it stays without digging.`));
  if (loose) {
    const fell = found.t.caused.moved.filter((m) => !m.b.steered && m.dy > 16);
    const what = 'A boulder with nothing under it falls';
    if (fell.length) out.push(passed(P, what, `${list([...new Set(fell.map((m) => m.b.name))])} came down ${px(Math.max(...fell.map((m) => m.dy)))} after the ground was dug, and stays up without the digging.`));
    else out.push(notJudged(P, what, 'Nothing loose was above where the script dug in 2.5 s, so nothing was seen to fall.'));
    const more = Math.max(0, ...found.t.acted.numbers) !== Math.max(0, ...found.t.idle.numbers);
    out.push(more ? passed(P, 'What is collected is counted on the screen', `A number shown differs from the same time without digging (${found.t.acted.numbers.join(', ')} against ${found.t.idle.numbers.join(', ')}).`) : notJudged(P, 'What is collected is counted on the screen', 'Nothing was collected where the script dug.'));
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ boards

/** A game of marks on a board against the computer (three in a row). */
export function marksOnABoard(ctx: PlayCtx): Check[] {
  const out: Check[] = [];
  let place: Action | null = null;
  let t: ReturnType<typeof twin> | null = null;
  for (const key of ACT_KEYS) {
    t = twin(ctx, begin, (g) => g.tap(key, 0.05, 0.1), 2.5);
    if (t.caused.more.length) {
      place = key;
      break;
    }
  }
  out.push(judged(P, 'The action key puts a mark on the square chosen', !!place, place ? `The ${place} key made ${list(t!.caused.more.map((m) => m.name))} appear.` : 'No action key (jump, interact, fire) made anything appear on the board.'));
  if (!place || !t) return [...out, notJudged(P, 'The computer answers with a mark of its own', 'No mark could be placed.'), notJudged(P, 'A square taken cannot be taken again', 'No mark could be placed.'), notJudged(P, 'The game ends and says how', 'No mark could be placed.')];
  const kinds = new Set(t.caused.more.map((m) => m.def ?? m.name));
  out.push(judged(P, 'The computer answers with a mark of its own', t.caused.more.length >= 2 && kinds.size >= 2, `2.5 s after the player's mark there were ${t.caused.more.length} new things on the board, of ${kinds.size} kind${kinds.size === 1 ? '' : 's'}.`));
  const again = twin(
    ctx,
    (g) => {
      begin(g);
      g.tap(place!, 0.05, 2.5);
    },
    (g) => g.tap(place!, 0.05, 0.1),
    2.5,
  );
  out.push(judged(P, 'A square taken cannot be taken again', !again.caused.more.length, again.caused.more.length ? `Pressing ${place} again on the same square made ${list(again.caused.more.map((m) => m.name))} appear.` : 'Pressing the key again on the same square put nothing there.'));
  const ended = run(ctx, (g) => {
    begin(g);
    const start = g.things().length;
    const END = /\b(win|wins|won|draw|drawn|tie|tied|lose|loses|lost|over)\b/i;
    // (From any square, over all nine: to a corner first, then row by row.)
    g.tap('left', 0.05, 0.1);
    g.tap('left', 0.05, 0.1);
    g.tap('up', 0.05, 0.1);
    g.tap('up', 0.05, 0.1);
    const steps: Action[] = ['right', 'right', 'down', 'left', 'left', 'down', 'right', 'right', 'up'];
    for (let n = 0; n < 12 && !END.test(g.screen()); n++) {
      g.tap(place!, 0.05, 2);
      if (END.test(g.screen())) break;
      g.tap(steps[n % steps.length], 0.05, 0.15);
    }
    return { said: g.texts().find((x) => END.test(x)) ?? null, marks: g.things().length - start };
  });
  const what = 'The game ends and says how';
  if (ended.said) out.push(passed(P, what, `After ${ended.marks} marks the screen said "${ended.said}".`));
  else if (ended.marks >= 9) out.push(failed(P, what, `${ended.marks} marks were on the board and nothing on the screen said how it ended.`));
  else out.push(notJudged(P, what, `The script got ${ended.marks} marks onto the board in twelve tries and no ending was said.`));
  return out;
}

interface Board {
  i0: number;
  j0: number;
  cols: number;
  rows: number;
}
const cellOf = (v: number) => Math.floor(v / 32);
/** Which things are pieces on a board of squares: of an object that stands on few squares (the squares' own object covers most). */
function boardOf(g: Played): { board: Board; pieceAt: (i: number, j: number) => RuntimeEntity | null; pieces: () => RuntimeEntity[] } | null {
  const cells = new Map<string, Set<string>>();
  for (const e of g.things()) {
    const kind = e.definitionId ?? e.name;
    if (!cells.has(kind)) cells.set(kind, new Set());
    cells.get(kind)!.add(`${cellOf(e.x)},${cellOf(e.y)}`);
  }
  const solid = new Set(g.things().filter((e) => e.collider && !e.collider.trigger && e.body === 'static').map((e) => e.definitionId ?? e.name));
  // (The squares: an object on two dozen cells or more that blocks nothing; a solid frame round the board is not one.)
  const squareKinds = [...cells].filter(([k, s]) => s.size >= 24 && !solid.has(k)).map(([k]) => k);
  if (!squareKinds.length) return null;
  const all = squareKinds.flatMap((k) => [...cells.get(k)!]).map((c) => c.split(',').map(Number));
  // (The squares' own extent: a frame round the board is of another object, or is left out by being outside the cursor's reach.)
  const count = (vals: number[]) => {
    const m = new Map<number, number>();
    for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
    const full = Math.max(...m.values());
    return [...m].filter(([, n]) => n >= full * 0.75).map(([v]) => v);
  };
  const is = count(all.map((c) => c[0]));
  const js = count(all.map((c) => c[1]));
  const board = { i0: Math.min(...is), j0: Math.min(...js), cols: Math.max(...is) - Math.min(...is) + 1, rows: Math.max(...js) - Math.min(...js) + 1 };
  const isPiece = (e: RuntimeEntity) => !squareKinds.includes(e.definitionId ?? e.name) && (cells.get(e.definitionId ?? e.name)?.size ?? 99) <= 16 && cellOf(e.x) >= board.i0 && cellOf(e.x) < board.i0 + board.cols && cellOf(e.y) >= board.j0 && cellOf(e.y) < board.j0 + board.rows;
  const pieces = () => g.things().filter((e) => isPiece(e) && !solid.has(e.definitionId ?? e.name) && !e.scripts.some((s) => s.script.handlers.length >= 4));
  return { board, pieces, pieceAt: (i, j) => pieces().find((e) => cellOf(e.x) === i && cellOf(e.y) === j) ?? null };
}

/** Chess, played through the engine's menu and cursor. */
export function chess(ctx: PlayCtx): Check[] {
  const asked = [
    'A pawn asked to go two squares forward from its start goes there',
    'A rook asked to jump over its own pawn stays where it is',
    'A piece moved onto an enemy piece takes it: one piece fewer',
    'Against the computer, the other side moves by itself',
  ];
  const strength = notJudged(P, 'The weakest and the strongest setting play differently', 'Comparing settings needs several games played out by a script; not written yet.');
  /** Past the menus, choosing by the words given first, else the first item. */
  const start = (g: Played, prefer: RegExp) => {
    g.wait(0.5);
    for (let n = 0; n < 5 && g.menu(); n++) if (!g.pick(prefer)) g.tap('jump', 0.05, 0.3);
    g.wait(0.3);
  };
  const move = (g: Played, from: [number, number], to: [number, number]) => {
    if (!g.cursorTo(from[0], from[1])) return false;
    g.tap('jump', 0.05, 0.2);
    if (!g.cursorTo(to[0], to[1])) return false;
    g.tap('jump', 0.05, 0.6);
    return true;
  };
  const TWO = /2 ?player|two ?player|human|friend|hot ?seat|pass/i;
  const ONE = /computer|cpu|\bai\b|1 ?player|one ?player|single/i;
  const probe = run(ctx, (g) => {
    start(g, TWO);
    return { cursor: !!g.cursor(), b: boardOf(g)?.board ?? null, pieces: boardOf(g)?.pieces().length ?? 0 };
  });
  if (!probe.cursor || !probe.b) {
    const why = !probe.cursor ? 'The game does not use the engine\'s grid cursor, so a script cannot pick squares in it.' : 'No board of squares with pieces on it was found.';
    return [...asked.map((a) => notJudged(P, a, why)), strength];
  }
  const { i0, j0, rows } = probe.b;
  const bottom = j0 + rows - 1;
  const out: Check[] = [];
  out.push(
    run(ctx, (g) => {
      start(g, TWO);
      const b = boardOf(g)!;
      const from: [number, number] = [i0 + 4, bottom - 1];
      const pawn = b.pieceAt(...from);
      if (!pawn) return failed(P, asked[0], `No piece stands on the fifth square of the second row from the bottom (${probe.pieces} pieces on the board).`);
      const ok = move(g, from, [i0 + 4, bottom - 3]);
      const there = b.pieceAt(i0 + 4, bottom - 3);
      return judged(P, asked[0], ok && !!there && !b.pieceAt(...from), there ? `${there.name} now stands two squares forward, and its square is empty.` : `After choosing it and the square two forward, ${pawn.name} ${b.pieceAt(...from) ? 'still stands where it was' : 'is on neither square'}.`);
    }),
  );
  out.push(
    run(ctx, (g) => {
      start(g, TWO);
      const b = boardOf(g)!;
      const from: [number, number] = [i0, bottom];
      const rook = b.pieceAt(...from);
      if (!rook) return failed(P, asked[1], 'No piece stands in the bottom left corner.');
      move(g, from, [i0, bottom - 2]);
      return judged(P, asked[1], !!b.pieceAt(...from) && !b.pieceAt(i0, bottom - 2), b.pieceAt(i0, bottom - 2) ? `${rook.name} went over the pawn in front of it.` : `${rook.name} is still in its corner.`);
    }),
  );
  out.push(
    run(ctx, (g) => {
      start(g, TWO);
      const b = boardOf(g)!;
      const before = b.pieces().length;
      // The king's pawn two forward, the other side's queen's pawn two forward, the first takes the second.
      move(g, [i0 + 4, bottom - 1], [i0 + 4, bottom - 3]);
      move(g, [i0 + 3, j0 + 1], [i0 + 3, j0 + 3]);
      move(g, [i0 + 4, bottom - 3], [i0 + 3, j0 + 3]);
      g.wait(0.5);
      const after = b.pieces().length;
      return judged(P, asked[2], after === before - 1, `${before} pieces before; after a pawn was moved onto a pawn of the other side, ${after}.`);
    }),
  );
  out.push(
    run(ctx, (g) => {
      start(g, ONE);
      const b = boardOf(g);
      if (!g.cursor() || !b) return notJudged(P, asked[3], 'No menu item for playing the computer led to a board with a cursor.');
      const top = () => b.pieces().filter((e) => cellOf(e.y) <= j0 + 1).map((e) => `${cellOf(e.x)},${cellOf(e.y)}`).sort().join(' ');
      const was = top();
      move(g, [i0 + 4, bottom - 1], [i0 + 4, bottom - 3]);
      const replied = g.until(() => top() !== was, 30);
      return judged(P, asked[3], replied, replied ? `After the player's move a piece of the other side had moved ${g.seconds.toFixed(0)} s into the game.` : 'In 30 s after the player\'s move, no piece of the other side moved.');
    }),
  );
  return [...out, strength];
}

// ------------------------------------------------------------------------------------------------ turns

/**
 * A bot that takes its turns through the engine's menu and cursor, by a plain plan: each unit moves a square toward
 * the nearest foe if it can, attacks one beside it (or at once, where there is no moving), and otherwise waits.
 */
function takeTurns(g: Played, seconds: number, stop: () => boolean, plan: 'fight' | 'wait' = 'fight'): void {
  const until = g.seconds + seconds;
  const has = (m: { items: string[] }, re: RegExp) => m.items.some((x) => re.test(x) && !x.startsWith('-'));
  const MOVE = /move|walk/i;
  const ATTACK = /attack|fight|strike|hit/i;
  const WAIT = /wait|end|done|pass|defend|guard|stay/i;
  let who: unknown = null;
  let menus = 0;
  let last: 'move' | 'attack' | 'other' = 'other';
  let attacked = false;
  const foesOf = (tag: string | null) => g.things().filter((e) => e.health && e.health.current > 0 && (tag ? !e.tags.includes(tag) : true));
  const nearest = (from: { x: number; y: number }, list: RuntimeEntity[]) => [...list].sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y))[0];
  while (g.seconds < until && !g.stopped && !stop()) {
    const t = g.rt.kit.turns;
    const acting = t?.acting ?? t?.index ?? null;
    if (acting !== who) [who, menus, last, attacked] = [acting, 0, 'other', false];
    const team = t ? t.teams[t.index].tag : null;
    const unit = t?.acting ?? null;
    const m = g.menu();
    if (m) {
      const foe = unit ? nearest(unit, foesOf(team).filter((e) => e !== unit)) : undefined;
      const beside = !!unit && !!foe && Math.abs(cellOf(foe.x) - cellOf(unit.x)) + Math.abs(cellOf(foe.y) - cellOf(unit.y)) <= 1;
      const canMove = has(m, MOVE);
      if (plan === 'wait' && has(m, WAIT) && g.pick(WAIT)) last = 'other';
      else if (canMove && menus === 0 && !beside && g.pick(MOVE)) last = 'move';
      else if (has(m, ATTACK) && !attacked && (beside || !canMove) && g.pick(ATTACK)) [last, attacked] = ['attack', true];
      else if (has(m, WAIT) && g.pick(WAIT)) last = 'other';
      else {
        // (None of the words: its open items in turn.)
        const open = m.items.map((x, i) => (x.startsWith('-') ? -1 : i)).filter((i) => i >= 0);
        const want = open[menus % Math.max(1, open.length)] ?? 0;
        for (let n = 0; n < m.items.length && g.rt.kit.menu && g.rt.kit.menu.index !== want; n++) g.tap('down', 0.03, 0.03);
        g.tap('jump', 0.05, 0.25);
        last = 'other';
      }
      menus++;
      continue;
    }
    const c = g.cursor();
    if (c) {
      const owner = g.rt.kit.cursor?.owner ?? null;
      if (!owner && t) {
        // The side's own cursor: to a unit of it that has not had its go.
        const next = g.things().find((e) => e.tags.includes(t.teams[t.index].tag) && e.health && !t.acted.has(e));
        if (next) g.cursorTo(cellOf(next.x), cellOf(next.y));
      } else if (owner) {
        const foe = nearest(owner, foesOf(team).filter((e) => e !== owner));
        if (foe && last === 'move') {
          const [di, dj] = [Math.sign(cellOf(foe.x) - cellOf(owner.x)), Math.sign(cellOf(foe.y) - cellOf(owner.y))];
          // One square toward it (not onto it).
          const [i, j] = di !== 0 && !(cellOf(owner.x) + di === cellOf(foe.x) && cellOf(owner.y) === cellOf(foe.y)) ? [cellOf(owner.x) + di, cellOf(owner.y)] : [cellOf(owner.x), cellOf(owner.y) + (dj || 1)];
          g.cursorTo(i, j);
        } else if (foe) g.cursorTo(cellOf(foe.x), cellOf(foe.y));
      }
      g.tap('jump', 0.05, 0.35);
      continue;
    }
    g.wait(0.2);
  }
}

export function tactics(ctx: PlayCtx): Check[] {
  const asked = ['It is played in turns, one side after the other', 'A unit of the player\'s side acts by the cursor and the menu', 'When the player\'s side is done, the other side acts by itself, and the player\'s turn comes again'];
  return run(ctx, (g) => {
    begin(g);
    g.wait(1.5);
    const t = g.rt.kit.turns;
    if (!t) return asked.map((a) => notJudged(P, a, 'The game does not use the engine\'s turns, so whose turn it is and which side a thing is on cannot be read by a script.'));
    const out = [passed(P, asked[0], `Sides: ${t.teams.map((x) => x.tag).join(', ')}; it is the turn of ${t.teams[t.index].tag}.`)];
    const mine = t.teams[t.index].tag;
    const state = () => g.things().filter((e) => e.health).map((e) => `${e.name}:${Math.round(e.x)},${Math.round(e.y)},${e.health!.current}`).join(' ');
    const was = state();
    const foesWas = g.things().filter((e) => e.health && !e.tags.includes(mine)).map((e) => `${Math.round(e.x)},${Math.round(e.y)}`).join(' ');
    const round = t.number;
    // A unit of the side whose turn it is: chosen with the cursor, told to move (or, where there is no moving, to
    // attack), and a square beside it chosen.
    const unit = g.things().find((e) => e.tags.includes(mine) && e.health);
    let did = '';
    if (unit && g.cursor()) {
      const [ui, uj] = [cellOf(unit.x), cellOf(unit.y)];
      g.cursorTo(ui, uj);
      g.tap('jump', 0.05, 0.4);
      const order = g.menu()?.items.find((x) => /move|walk/i.test(x) && !x.startsWith('-')) ?? g.menu()?.items.find((x) => /attack|fight/i.test(x) && !x.startsWith('-')) ?? null;
      if (order) {
        g.pick(new RegExp(order.replace(/[^\w ]/g, '.'), 'i'));
        for (const [di, dj] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
          if (state() !== was || !g.cursor()) break;
          g.cursorTo(ui + di, uj + dj);
          g.tap('jump', 0.05, 1.2);
        }
        did = order;
      }
    }
    out.push(judged(P, asked[1], state() !== was, state() !== was ? `${unit?.name} was chosen with the cursor and told "${did}" from its menu with a square beside it: a unit had moved or been hurt.` : unit ? `${unit.name} was chosen with the cursor${did ? `, told "${did}" and given each square beside it in turn` : ' and no menu with an order came'}: nothing moved and nobody was hurt.` : 'The side whose turn it is has no unit.'));
    takeTurns(g, 60, () => (g.rt.kit.turns?.number ?? round) > round, 'wait');
    const again = (g.rt.kit.turns?.number ?? round) > round;
    const foes = g.things().filter((e) => e.health && !e.tags.includes(mine)).map((e) => `${Math.round(e.x)},${Math.round(e.y)}`).join(' ');
    out.push(judged(P, asked[2], again, again ? `Round ${g.rt.kit.turns?.number} began${foes !== foesWas ? '; the other side had moved meanwhile' : ''}.` : 'In 60 s of the script taking its turns, no second round began.'));
    return out;
  });
}

export function rolePlaying(ctx: PlayCtx): Check[] {
  const asked = ['Meeting a monster on the map starts a battle', 'In the battle, a command chosen from the menu hurts the enemy', 'A battle won leads back to the map'];
  return run(ctx, (g) => {
    begin(g);
    const map = g.level;
    const who = g.steered()[0];
    // What might be a monster to meet: one of each kind of thing that is no wall and not the character.
    const kinds = new Map<string, RuntimeEntity>();
    for (const e of g.things()) if (!e.controller && (e.scripts.length || e.beh.wander || e.beh.patrol) && !kinds.has(e.definitionId ?? e.name)) kinds.set(e.definitionId ?? e.name, e);
    if (!who || !kinds.size) return asked.map((a) => notJudged(P, a, !who ? 'No character is steered on the map.' : 'Nothing on the map has a script or goes about, so there is nothing to meet.'));
    const inBattle = () => g.level !== map || !!g.rt.kit.turns || !!g.menu();
    let met = '';
    for (const [, foe] of [...kinds].slice(0, 6)) {
      if (!foe.alive || inBattle()) break;
      who.x = foe.x - 20;
      who.y = foe.y;
      g.hold('right');
      if (g.until(inBattle, 1.5)) met = foe.name;
      g.hold();
    }
    const battle = inBattle();
    const out = [judged(P, asked[0], battle, battle ? `Walking into ${met || 'a thing on the map'}, the game went to ${g.level !== map ? `"${g.level}"` : 'a battle'}. (The character was set beside it; the map's layout is not judged.)` : `Walking into each kind of thing on the map (${list([...kinds.values()].map((e) => e.name))}), nothing began.`)];
    if (!battle) return [...out, ...asked.slice(1).map((a) => notJudged(P, a, 'No battle began.'))];
    g.wait(1);
    const health = () => g.things().filter((e) => e.health).reduce((n, e) => n + e.health!.current, 0);
    const was = health();
    takeTurns(g, 25, () => health() < was);
    out.push(judged(P, asked[1], health() < was, health() < was ? 'After a command from the menu, health in the battle had gone down.' : 'In 25 s of choosing commands, nobody in the battle lost health.'));
    takeTurns(g, 90, () => g.level === map && !g.rt.kit.turns);
    out.push(g.level === map && !g.rt.kit.turns ? passed(P, asked[2], `Back on "${map}" after ${g.seconds.toFixed(0)} s.`) : notJudged(P, asked[2], 'The battle was not over in 90 s of a script choosing its commands.'));
    return out;
  });
}

/** A level built anew at each play: another seed gives another level, the same seed the same. */
export function newLevelEachPlay(ctx: PlayCtx): Check[] {
  const layout = (seed: number) =>
    run({ ...ctx, seed }, (g) => {
      g.wait(0.3);
      return g.things().filter((e) => e.body === 'static').map((e) => `${Math.round(e.x)},${Math.round(e.y)}`).sort().join(' ');
    });
  const [a, b, c, a2] = [layout(11), layout(12), layout(13), layout(11)];
  const differ = new Set([a, b, c]).size;
  return [
    judged(P, 'Each play builds another level', differ >= 2, `Three plays with different chance gave ${differ} different layout${differ === 1 ? '' : 's'} of walls.`),
    judged(P, 'The same chance gives the same level (it can be played again)', a === a2, a === a2 ? 'The same seed built the same walls twice.' : 'The same seed built different walls.'),
  ];
}

/** An open world: at least two kinds of thing go about by themselves, and a vehicle can be taken. */
export function vehicleCanBeTaken(ctx: PlayCtx): Check[] {
  const what = 'The character can get into a vehicle and go faster in it';
  return run(ctx, (g) => {
    begin(g);
    const who = g.steered()[0];
    if (!who) return [failed(P, what, 'No steered character.')];
    const speed = () => {
      const x = who.x;
      const y = who.y;
      let far = 0;
      for (const a of ['right', 'down', 'left', 'up'] as Action[]) {
        const [x0, y0] = [who.x, who.y];
        g.hold(a);
        g.wait(0.7);
        g.hold();
        far = Math.max(far, Math.hypot(who.x - x0, who.y - y0));
      }
      void x;
      void y;
      return far / 0.7;
    };
    const onFoot = speed();
    // One of each object that moves by itself and is no character: a vehicle is one of them, if there is one.
    const a = sight(g);
    g.wait(1.5);
    const movers = new Map<string, RuntimeEntity>();
    for (const m of difference(a, sight(g)).moved) if (!m.b.steered && !movers.has(m.b.def ?? m.b.name)) movers.set(m.b.def ?? m.b.name, m.b.e);
    for (const e of g.things()) if (!e.controller && e.body !== 'static' && e.scripts.length && !movers.has(e.definitionId ?? e.name)) movers.set(e.definitionId ?? e.name, e);
    let best = { name: '', speed: 0 };
    for (const [, e] of [...movers].slice(0, 6)) {
      if (!e.alive) continue;
      who.x = e.x + (e.collider?.hw ?? 16) + (who.collider?.hw ?? 12) + 2;
      who.y = e.y;
      g.wait(0.1);
      g.tap('interact', 0.05, 0.3);
      const s = speed();
      if (s > best.speed) best = { name: e.name, speed: s };
      g.tap('interact', 0.05, 0.3);
    }
    if (!movers.size) return [notJudged(P, what, 'Nothing but the character moves or has a script: no vehicle to try.')];
    return [judged(P, what, best.speed > onFoot * 1.3, `On foot ${Math.round(onFoot)} px/s. Set beside each kind of thing that goes about (${movers.size}) and pressing the use key: fastest after ${best.name}, ${Math.round(best.speed)} px/s. (The character was set beside each.)`)];
  });
}

// ------------------------------------------------------------------------------------------------ a table with a ball

/** A pinball table. The ball and the flippers are found by what they do, not by name. */
export function pinball(ctx: PlayCtx): Check[] {
  const out: Check[] = [];
  const asked = {
    launch: 'A key sends the ball up into the table (the plunger)',
    bounce: 'The ball comes off what it hits with speed (it does not stop dead)',
    swings: 'A key swings a flipper',
    thrown: 'A ball lying on a flipper is thrown when the flipper swings',
    arm: 'The flipper throws as a turning arm does: hardly at the end it turns about, hardest at its tip',
    touch: 'The flipper throws only a ball it touches (a ball clear of it is left alone)',
    score: 'The score shown goes up as the ball strikes things on the table',
    drain: 'A ball lost through the bottom costs a ball',
    over: 'After the last ball the game says it is over',
  };
  // The plunger: a key that sends some loose thing far up.
  let launch: Action | null = null;
  let ballKey = '';
  let rise = 0;
  for (const key of ['jump', 'down', 'fire', 'interact', 'up', 'special'] as Action[]) {
    const t = twin(
      ctx,
      begin,
      (g) => {
        g.hold(key);
        g.wait(1);
        g.hold();
      },
      0.6,
    );
    const up = t.caused.moved.filter((m) => !m.b.fixed && m.dy < -64).sort((a, b) => a.dy - b.dy)[0];
    if (up) {
      launch = key;
      ballKey = up.b.key;
      rise = -up.dy;
      break;
    }
  }
  out.push(judged(P, asked.launch, !!launch, launch ? `Holding ${launch} for a second and letting go sent a thing ${px(rise)} up that stays put without it.` : 'No key (jump, down, fire, interact, up, special) sent anything up the table.'));
  if (!launch) return [...out, ...Object.values(asked).slice(1).map((a) => notJudged(P, a, 'No ball could be launched, so nothing was seen of it.'))];
  const ballOf = (g: Played) => sight(g).things.get(ballKey)?.e;
  const shoot = (g: Played) => {
    begin(g);
    g.hold(launch!);
    g.wait(1);
    g.hold();
  };

  // Bounces: the ball's speed turns round from one frame to the next and it keeps moving.
  const flight = run(ctx, (g) => {
    shoot(g);
    const ball = ballOf(g)!;
    const first = Math.max(0, ...g.numbers());
    let turns = 0;
    let [px0, py0, vx0, vy0] = [ball.x, ball.y, 0, 0];
    for (let n = 0; n < 60 * 12 && !g.stopped; n++) {
      g.step();
      const [vx, vy] = [(ball.x - px0) * 60, (ball.y - py0) * 60];
      if ((vx * vx0 < 0 && Math.abs(vx) > 40 && Math.abs(vx0) > 40) || (vy * vy0 < 0 && Math.abs(vy) > 40 && Math.abs(vy0) > 40)) turns++;
      [px0, py0, vx0, vy0] = [ball.x, ball.y, vx, vy];
    }
    return { turns, first, last: Math.max(0, ...g.numbers()) };
  });
  out.push(judged(P, asked.bounce, flight.turns >= 2, `In 12 s after the launch the ball's speed turned round ${flight.turns} time${flight.turns === 1 ? '' : 's'} between one frame and the next while it kept moving faster than 40 px/s.`));

  // Flippers: things a key turns or moves that are not the ball.
  const flippers: { key: Action; thing: string }[] = [];
  for (const key of ['left', 'right', 'interact', 'fire'] as Action[]) {
    const t = twin(ctx, begin, (g) => (g.hold(key), g.wait(0.2)), 0);
    for (const m of t.caused.moved) if (m.b.key !== ballKey && (Math.abs(m.turned) > 5 || Math.hypot(m.dx, m.dy) > 4)) flippers.push({ key, thing: m.b.key });
  }
  out.push(judged(P, asked.swings, flippers.length > 0, flippers.length ? `${list(flippers.map((f) => `${f.key} turns or moves a thing`))}.` : 'No key (left, right, interact, fire) turned or moved anything but the ball.'));
  if (!flippers.length) out.push(notJudged(P, asked.thrown, 'No flipper was found.'), notJudged(P, asked.arm, 'No flipper was found.'), notJudged(P, asked.touch, 'No flipper was found.'));
  else {
    const f = flippers[0];
    /** The ball set at a place over the flipper (`along`: -1 one end, 0 the middle, 1 the other; `clear` px above it), then the key or not. */
    const tryAt = (along: number, clear: number) => {
      const t = twin(
        ctx,
        (g) => {
          begin(g);
          const s = sight(g);
          const ball = s.things.get(ballKey)?.e;
          const flip = s.things.get(f.thing)?.e;
          const box = flip && solidBoxOf(flip);
          if (!ball || !flip || !box) return;
          ball.x = box.x + along * (box.hw - 6);
          ball.y = box.y - box.hh - (ball.collider?.hh ?? 8) - 1 - clear;
          ball.vx = ball.vy = 0;
          g.wait(clear ? 0.02 : 0.25);
        },
        (g) => (g.hold(f.key), g.wait(0.12), g.hold()),
        0.1,
      );
      const a = t.acted.things.get(ballKey);
      const b = t.idle.things.get(ballKey);
      return a && b ? b.y - a.y : 0;
    };
    const lifts = [-1, 0, 1].map((along) => tryAt(along, 0));
    const thrown = Math.max(...lifts);
    out.push(judged(P, asked.thrown, thrown > 24, `The ball was set lying on the flipper (one end, the middle, the other end) and the key pressed: 0.2 s later it was ${lifts.map((l) => px(l)).join(', ')} higher than without the key. (The ball was set there.)`));
    // A flipper is an arm turning about one end: what lies at the tip is thrown hardest, in the middle half as hard,
    // at the end it turns about hardly at all. The same throw all along it is a fixed kick given by a script.
    const [weak, strong] = [Math.min(lifts[0], lifts[2]), Math.max(lifts[0], lifts[2])];
    const asArm = thrown > 24 && strong > lifts[1] * 1.3 && weak < lifts[1];
    out.push(
      thrown > 24
        ? judged(P, asked.arm, asArm, asArm ? `Thrown ${px(weak)} at one end, ${px(lifts[1])} in the middle, ${px(strong)} at the other.` : `Thrown ${px(lifts[0])} at one end, ${px(lifts[1])} in the middle and ${px(lifts[2])} at the other: not weakest at one end and hardest at the other with the middle between, as an arm turning about its end would throw. The ball is given a set speed when the key is down and it is on the flipper.`)
        : notJudged(P, asked.arm, 'The flipper threw nothing.'),
    );
    const clear = [-1, 1].map((along) => tryAt(along, 48));
    const bothEnds = clear.every((c) => c > 16);
    out.push(
      judged(
        P,
        asked.touch,
        !bothEnds,
        bothEnds
          ? `The ball was set 48 px clear above each end of the flipper and the key pressed: it was thrown all the same (${clear.map((c) => px(c)).join(' and ')} higher than without the key 0.2 s later), also over the end the flipper turns about, which hardly moves. The throw goes by the ball being near while the key is down, not by the flipper striking it.`
          : `The ball was set 48 px clear above each end of the flipper and the key pressed: ${clear.map((c) => px(c)).join(' and ')} higher than without the key 0.2 s later.`,
      ),
    );
  }
  out.push(flight.last > flight.first ? passed(P, asked.score, `A number shown went from ${flight.first} to ${flight.last} in 12 s of the ball on the table.`) : notJudged(P, asked.score, 'In 12 s of the ball on the table no number shown went up.'));

  // The drain: with no flipper pressed, the ball is lost and a count shown goes down; in the end the game says it is over.
  const lost = run(ctx, (g) => {
    begin(g);
    const counts = () => g.numbers().join(',');
    const first = g.numbers();
    let down: { from: number; to: number } | null = null;
    let over: string | null = null;
    for (let n = 0; n < 40 && !over && !g.stopped; n++) {
      g.hold(launch!);
      g.wait(1);
      g.hold();
      const was = counts();
      g.until(() => counts() !== was && g.numbers().some((v, i) => v < (first[i] ?? v)), 6);
      const now = g.numbers();
      now.forEach((v, i) => {
        if (!down && first[i] !== undefined && v < first[i]) down = { from: first[i], to: v };
      });
      over = g.texts().find((x) => /game over|no balls|out of balls/i.test(x)) ?? null;
    }
    return { down: down as { from: number; to: number } | null, over, seconds: g.seconds };
  });
  out.push(lost.down ? passed(P, asked.drain, `With no flipper pressed, a count shown went from ${lost.down.from} to ${lost.down.to}.`) : notJudged(P, asked.drain, `In ${Math.round(lost.seconds)} s of launching and never pressing a flipper, no count shown went down.`));
  out.push(lost.over ? passed(P, asked.over, `The screen said "${lost.over}" after ${Math.round(lost.seconds)} s.`) : notJudged(P, asked.over, `In ${Math.round(lost.seconds)} s of losing balls the screen never said the game was over.`));
  return out;
}

// ------------------------------------------------------------------------------------------------ cards

/** The cards shown: the things drawn in the commonest card shape (taller than wide), and how many there are. */
function cardsShown(g: Played): { size: string; n: number } | null {
  const sizes = new Map<string, number>();
  const add = (w: number, h: number) => {
    if (h >= 24 && w >= 12 && h > w * 1.15 && h < w * 2.2) sizes.set(`${Math.round(w)}x${Math.round(h)}`, (sizes.get(`${Math.round(w)}x${Math.round(h)}`) ?? 0) + 1);
  };
  for (const d of g.rt.drawings.values()) if ((d.shape === 'rect' || d.shape === 'sprite') && d.alpha > 0) add(d.w, d.h);
  for (const e of g.things()) {
    const s = e.base.components.Sprite as { width?: number; height?: number } | undefined;
    if (s?.width && s.height && e.body !== 'static') add(s.width * Math.abs(e.base.transform.scale.x), s.height * Math.abs(e.base.transform.scale.y));
  }
  const best = [...sizes].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? { size: best[0], n: best[1] } : null;
}

/**
 * A card game against the computer. The hand is read from what is drawn: the commonest card-shaped thing on the
 * screen. `handAsked`: the cards each player starts with; `beyond`: how many the hand must be able to hold.
 */
export function cardGame(ctx: PlayCtx, handAsked: number, beyond: number): Check[] {
  const out: Check[] = [];
  const asked = {
    hand: `The player's hand is shown as cards, ${handAsked} to begin with`,
    play: 'A card that fits can be played, and leaves the hand',
    refuse: 'A card that does not fit is refused, and the game says so',
    draw: 'Drawing adds a card to the hand',
    big: `The hand can hold more than ${handAsked} cards (drawn up to ${beyond})`,
    computer: 'The computer plays in its turn, by itself',
    end: 'A hand emptied ends the game',
    special: 'Cards that skip a turn, turn the order round and make the next player draw two do so',
  };
  const lead = (g: Played) => {
    begin(g);
    g.wait(0.6);
  };
  const first = run(ctx, (g) => (lead(g), cardsShown(g)));
  out.push(first ? judged(P, asked.hand, first.n === handAsked, `${first.n} cards of the same shape (${first.size} px) are drawn.`) : failed(P, asked.hand, 'No three things of one card shape (taller than wide) are drawn on the screen.'));
  if (!first) return [...out, ...Object.values(asked).slice(1).map((a) => notJudged(P, a, 'The hand could not be found on the screen, so what happens to it cannot be read.'))];

  /** What a sequence of keys does to the number of cards shown, against the same time with no key (and whether the text shown differs). */
  const count = (keys: Action[], moves: number): { acted: number; idle: number; said: boolean } => {
    let acted = 0;
    let idle = 0;
    let textsA = '';
    let textsI = '';
    run(ctx, (g) => {
      lead(g);
      for (let n = 0; n < moves; n++) g.tap('right', 0.05, 0.1);
      const from = g.frames;
      keys.forEach((k) => g.tap(k, 0.05, 0.25));
      const took = g.frames - from;
      g.wait(0.3);
      acted = cardsShown(g)?.n ?? 0;
      textsA = g.screen();
      run(ctx, (h) => {
        lead(h);
        for (let n = 0; n < moves; n++) h.tap('right', 0.05, 0.1);
        for (let n = took; n > 0; n--) h.step();
        h.wait(0.3);
        idle = cardsShown(h)?.n ?? 0;
        textsI = h.screen();
      });
    });
    return { acted, idle, said: textsA !== textsI };
  };
  const single: Action[][] = KEYS.filter((k) => k !== 'left' && k !== 'right').map((k) => [k]);
  // (Two keys: choose, then lay. Three: choose, to the pile, lay.)
  const pairs: Action[][] = [...ACT_KEYS.flatMap((a) => ACT_KEYS.filter((b) => b !== a).map((b) => [a, b])), ...ACT_KEYS.flatMap((a) => (['up', 'down'] as Action[]).map((mid) => [a, mid, a]))];
  let playKeys: Action[] | null = null;
  let playAt = 0;
  let drawKeys: Action[] | null = null;
  let refused: { at: number; said: boolean } | null = null;
  for (const keys of [...single, ...pairs]) {
    if (!drawKeys) {
      const c = count(keys, 0);
      if (c.acted === c.idle + 1) drawKeys = keys;
      else if (c.acted === c.idle - 1 && !playKeys) [playKeys, playAt] = [keys, 0];
    }
    if (playKeys && drawKeys) break;
  }
  // The card under the pointer may not fit: each card of the hand in turn, with every way of playing tried.
  for (let at = 0; at < first.n && !(playKeys && refused); at++) {
    for (const keys of playKeys ? [playKeys] : [...single, ...pairs]) {
      if (drawKeys && keys.join() === drawKeys.join()) continue;
      const c = count(keys, at);
      if (c.acted === c.idle - 1) {
        if (!playKeys) [playKeys, playAt] = [keys, at];
      } else if (playKeys && c.acted === c.idle && !refused) refused = { at, said: c.said };
    }
  }
  out.push(judged(P, asked.play, !!playKeys, playKeys ? `With the pointer on card ${playAt + 1}, ${playKeys.join(' then ')} left one card fewer in the hand than the same moment without.` : `No key or pair of keys, on any of the ${first.n} cards, left one card fewer in the hand.`));
  if (!playKeys) out.push(notJudged(P, asked.refuse, 'No card could be played, so a card that does not fit cannot be told from a key that does nothing.'));
  else if (!refused) out.push(notJudged(P, asked.refuse, 'Every card in the hand could be played at the first turn: none was there to be refused.'));
  else out.push(judged(P, asked.refuse, refused.said, refused.said ? `Card ${refused.at + 1} stayed in the hand and the text on the screen changed.` : `Card ${refused.at + 1} stayed in the hand, and nothing written on the screen changed to say why.`));
  out.push(judged(P, asked.draw, !!drawKeys, drawKeys ? `${drawKeys.join(' then ')} put one card more in the hand than the same moment without.` : 'No key or pair of keys put one card more in the hand.'));

  // A hand bigger than it began: draw, and wait out the computer, until `beyond` cards are shown or twenty draws are made.
  {
    const grown = run(ctx, (g) => {
      lead(g);
      let most = cardsShown(g)?.n ?? 0;
      let draws = 0;
      // (No key found that draws: every key in turn, in case drawing is only allowed at some moment.)
      const ways: Action[][] = drawKeys ? [drawKeys] : single;
      for (; draws < 24 && most < beyond && !g.stopped; draws++) {
        ways[draws % ways.length].forEach((k) => g.tap(k, 0.05, 0.25));
        g.wait(drawKeys ? 2.5 : 1);
        most = Math.max(most, cardsShown(g)?.n ?? 0);
      }
      return { most, draws, texts: g.texts().slice(0, 6) };
    });
    out.push(
      judged(
        P,
        asked.big,
        grown.most >= beyond,
        grown.most >= beyond
          ? `After ${grown.draws} draws the hand showed ${grown.most} cards.`
          : `${drawKeys ? `After ${grown.draws} draws, each followed by 2.5 s for the computer,` : `No key was found that draws; after ${grown.draws} presses of every key in turn`} the hand never showed more than ${grown.most} cards (${beyond} asked). The screen then read: ${grown.texts.map((x) => `"${x}"`).join(', ')}.`,
      ),
    );
  }

  // The computer: after the player's go, something written on the screen changes with no key pressed.
  const go = playKeys ?? drawKeys;
  if (!go) out.push(notJudged(P, asked.computer, 'The player could neither play nor draw, so the computer\'s turn never came.'));
  else {
    const after = run(ctx, (g) => {
      lead(g);
      for (let n = 0; n < (playKeys ? playAt : 0); n++) g.tap('right', 0.05, 0.1);
      go.forEach((k) => g.tap(k, 0.05, 0.25));
      const a = g.screen();
      const cards = cardsShown(g)?.n ?? 0;
      g.wait(5);
      return { changed: g.screen() !== a, from: a.split('\n').slice(0, 3), to: g.texts().slice(0, 3), cards, cardsAfter: cardsShown(g)?.n ?? 0 };
    });
    out.push(judged(P, asked.computer, after.changed, after.changed ? `In 5 s after the player's go, with no key pressed, the screen went from ${after.from.map((x) => `"${x}"`).join(', ')} to ${after.to.map((x) => `"${x}"`).join(', ')}.` : 'In 5 s after the player\'s go nothing written on the screen changed.'));
  }
  out.push(notJudged(P, asked.end, 'A script that plays a hand out to its last card is not written yet.'));
  out.push(notJudged(P, asked.special, 'Which card is which is drawn as a picture or a sign the script does not read yet, so it cannot pick a skip, a turn-round or a draw-two to play.'));
  return out;
}
