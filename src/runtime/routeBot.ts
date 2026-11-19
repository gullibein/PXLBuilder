/**
 * A bot that plays a level along a route (the route solver's, cell by cell) on the real runtime: it runs, jumps,
 * climbs, swims, pushes crates and pulls levers with the same controls a player has, and says whether it got to the
 * goal. It checks what the
 * level checker and the solver only estimate (the real jump arc, a head bumped mid-jump, landing on the far edge,
 * how a ladder or a spring really behaves). Used by tests of the level builder; not part of play.
 */
import type { ComponentRegistry } from '../core/components/registry';
import { abilityDefinitions } from '../abilities/index';
import type { AbilityBot } from '../abilities/types';
import type { Move } from '../core/levelGen/solver';
import { setRouteBot } from '../core/validation/validators';
import type { Id, Project } from '../core/types';
import { InputState } from './input';
import { Runtime } from './runtime';

export interface BotResult {
  won: boolean;
  /** Not played: the bot can't time a moving platform (said, not counted as a failure). */
  skipped?: string;
  /** How far along the route it got (steps done of all). */
  steps: number;
  of: number;
  /** Where it got stuck (the step it couldn't do), when it didn't win. */
  stuck?: { step: number; move: Move; from: { col: number; row: number }; to: { col: number; row: number } };
  seconds: number;
}

const CELL = 32;
const DT = 1 / 120;
/** The moves the bot plays by itself (the arcade model's). */
const OWN_MOVES: readonly Move[] = ['start', 'walk', 'fall', 'jump', 'climb', 'swim', 'spring', 'teleport', 'push'];
/** The bot part of the ability that makes a move (its definition's: src/abilities), if one plays it. */
const botPartFor = (move: Move): AbilityBot | undefined => abilityDefinitions().find((d) => d.bot?.moves.includes(move))?.bot;
/** The moves the bot can play: its own and those the abilities' definitions play. A route with another isn't played. */
export const botMoves = (): Move[] => [...OWN_MOVES, ...abilityDefinitions().flatMap((d) => d.bot?.moves ?? [])];
/** Seconds a step may take before the bot gives up on it. */
const STEP_TIME = 4;

/** Plays the level `sceneId` along `path` (the cells the player stands in, from the solver, with how it gets there). */
export function playRoute(project: Project, sceneId: Id, path: { col: number; row: number; move: Move; mode?: number }[], registry: ComponentRegistry, onTick?: (step: number, p: { x: number; y: number; vx: number; vy: number; grounded: boolean }, held: string[]) => void, maxSeconds = Infinity): BotResult {
  const playable = botMoves();
  const unknown = path.find((p) => !playable.includes(p.move));
  if (unknown) return { won: false, skipped: `it can't play a ${unknown.move} move`, steps: 0, of: path.length - 1, seconds: 0 };
  const rt = new Runtime(project, sceneId, registry);
  // (Riding moving platforms takes timing the bot doesn't have.)
  if (rt.entities.some((e) => e.alive && e.beh.mover)) return { won: false, skipped: 'it has moving platforms', steps: 0, of: path.length - 1, seconds: 0 };
  const input = new InputState();
  const player = () => rt.entities.find((e) => e.alive && e.controller)!;
  let t = 0;
  const cellOf = () => {
    const p = player();
    return { col: Math.floor(p.x / CELL), row: Math.floor((p.y + 8) / CELL) };
  };
  let stepNow = 0;
  // (A lever it stands at that is still off: pulled, with Interact, as a player would.)
  let pulling = false;
  const tick = () => {
    if (pulling) {
      input.release('interact');
      pulling = false;
    } else {
      const p = rt.entities.find((e) => e.alive && e.controller);
      const lever = p && [...p.touching].map((id) => rt.byId(id)).find((o) => o?.alive && o.switch?.activation === 'interact' && !o.switch.on);
      if (lever) {
        input.press('interact');
        pulling = true;
      }
    }
    rt.update(DT, input);
    t += DT;
    if (onTick) {
      const p = player();
      onTick(stepNow, { x: p.x, y: p.y, vx: p.vx, vy: p.vy, grounded: p.grounded }, (['left', 'right', 'up', 'down', 'jump'] as const).filter((a) => input.isDown(a)));
    }
  };
  // Springs in the level (by their script), and how fast the player's own jump is (a launch is faster).
  const springs = rt.entities.filter((e) => e.alive && e.scripts.some((sc) => sc.script.name === 'Spring')).map((e) => e.x);
  const springNear = (col: number): number | null => {
    const c = col * CELL + CELL / 2;
    const near = springs.filter((x) => Math.abs(x - c) <= CELL * 1.6).sort((a, b) => Math.abs(a - c) - Math.abs(b - c));
    return near[0] ?? null;
  };
  const jumpSpeed = Number(player().controller?.jumpForce ?? 350);
  // (A moment to settle on the ground.)
  for (let i = 0; i < 30; i++) tick();
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    stepNow = i;
    const toX = to.col * CELL + CELL / 2;
    const fromX = from.col * CELL + CELL / 2;
    let jumped = false;
    // (An ability's step keeps what it needs to remember here: empty when the step begins.)
    const mem: Record<string, unknown> = {};
    let pressedAt = 0;
    // (Off the ground since the jump: only then does landing count.)
    let airborne = false;
    let done = false;
    const began = t;
    const hold = (a: 'left' | 'right' | 'up' | 'down' | 'jump', on: boolean) => (on ? input.press(a) : input.release(a));
    // (Its time budget, in the game's own seconds: the same on every machine, so the same level every time.)
    if (t > maxSeconds) return { won: false, skipped: `over its time budget (${maxSeconds} s of play)`, steps: i - 1, of: path.length - 1, seconds: t };
    while (t - began < STEP_TIME) {
      if (rt.completed !== null) return { won: true, steps: i, of: path.length - 1, seconds: t };
      const p = player();
      const here = cellOf();
      // Arrived: in the cell, and standing (or on a ladder, or swimming), near its middle when stopping matters.
      // (In water, swimming; on a spring, bouncing: there all the same.)
      const onSpring = springNear(to.col) !== null && Math.abs(springNear(to.col)! - toX) < 8;
      // (Or as an ability says: holding the wall a step ends on.)
      const held = abilityDefinitions().some((d) => d.bot?.settled?.({ rt, p, to }));
      const settled = p.grounded || p.climbing || !!p.inLiquid || onSpring || held;
      // (Before another jump the same way, no stopping in the middle: the run-up speed is kept.)
      const next = path[i + 1];
      const onward = !!next && (next.move === 'jump' || next.move === 'walk') && Math.sign(next.col - to.col) === Math.sign(to.col - from.col) && to.col !== from.col;
      if (here.col === to.col && here.row === to.row && settled && (Math.abs(p.x - toX) < 12 || to.move === 'walk' || to.move === 'fall' || onward)) {
        done = true;
        break;
      }
      // (Stepping onto a teleporter takes the player on at once: already where the step after goes.)
      if (next?.move === 'teleport' && here.col === next.col && Math.abs(here.row - next.row) <= 1) {
        i++;
        done = true;
        break;
      }
      const dir = Math.sign(toX - p.x);
      // (The side of the wall it holds now, and of the one it goes to: -1 left, 1 right.)
      const wallOf = (mode?: number) => (mode === 1 ? -1 : mode === 2 ? 1 : 0);
      // A move an ability makes: played by that ability's own step (its definition's bot part: src/abilities).
      const part = botPartFor(to.move);
      if (part) {
        part.step({ rt, p, input, from, to, here, fromX, toX, dir, t, began, dt: DT, hold, tick, wallSide: wallOf, mem });
        tick();
        continue;
      }
      if (to.move === 'climb') {
        // Onto the ladder's middle, then up or down; off its top to the side.
        const onLadderCol = here.col === from.col;
        if (to.col !== from.col && to.row <= from.row) {
          hold('up', here.row > to.row);
          hold('right', dir > 0 && here.row <= to.row);
          hold('left', dir < 0 && here.row <= to.row);
        } else {
          hold('right', !onLadderCol ? fromX > p.x : toX - p.x > 4);
          hold('left', !onLadderCol ? fromX < p.x : p.x - toX > 4);
          hold('up', to.row < here.row);
          hold('down', to.row > here.row);
        }
        tick();
        continue;
      }
      hold('up', false);
      hold('down', false);
      if (to.move === 'spring') {
        // Hop onto the spring (beside or under where it stands), Jump held: landing on it launches; then steer.
        const spring = springNear(from.col);
        const launched = !p.grounded && p.vy < -1.15 * jumpSpeed;
        if (launched) jumped = true;
        if (!jumped && spring !== null) {
          const off = spring - p.x;
          const onIt = Math.abs(off) < 8;
          hold('jump', onIt || Math.abs(off) < CELL * 1.3);
          hold('right', off > 3);
          hold('left', off < -3);
          // (Down on the spring again without a launch: let go, so the next press counts.)
          if (p.grounded && onIt && t - began > 0.3 && Math.floor(t * 4) % 2 === 0) hold('jump', false);
        } else {
          hold('jump', true);
          hold('right', dir > 0 && Math.abs(toX - p.x) > 3);
          hold('left', dir < 0 && Math.abs(toX - p.x) > 3);
        }
        tick();
        continue;
      }
      if (to.move === 'jump') {
        // (Out of water, at a pool's bank: there is no ground to take off from. Strokes up, steering onto the bank.)
        if (p.inLiquid && !p.grounded && !p.climbing && !jumped) {
          hold('right', dir > 0);
          hold('left', dir < 0);
          hold('jump', Math.floor(t * 6) % 2 === 0);
          tick();
          continue;
        }
        // A run up to the take-off, then the jump, Jump held all the way; steering toward the landing.
        if (!jumped) {
          // (Running through the take-off cell and off near its far edge, at speed, as a player jumps a gap; a
          // jump straight up, or a short hop, from its middle.)
          const jdir = Math.sign(to.col - from.col);
          const long = Math.abs(to.col - from.col) >= 2;
          const edge = fromX + jdir * (long ? 11 : 0);
          // (Or pressed against a wall in the take-off cell: jump from there.)
          const blocked = here.col === from.col && jdir !== 0 && Math.abs(p.vx) < 5 && t - began > 0.1;
          const atTakeoff = here.col === from.col && (jdir === 0 ? Math.abs(p.x - fromX) < 6 : jdir * (p.x - edge) >= -3 || blocked);
          if ((p.grounded || p.climbing) && atTakeoff && !input.isDown('jump')) {
            hold('jump', true);
            jumped = true;
            pressedAt = t;
          } else {
            const back = here.col !== from.col ? Math.sign(fromX - p.x) : jdir === 0 ? Math.sign(fromX - p.x) : jdir;
            hold('right', back > 0);
            hold('left', back < 0);
          }
        }
        if (jumped) {
          if (!p.grounded) airborne = true;
          // (Still standing a moment after Jump: held back by a ceiling's corner over the take-off; let go, again.)
          else if (!airborne && !p.climbing && t - pressedAt > 0.1) {
            hold('jump', false);
            jumped = false;
          }
          // (Onto a wall: pressing into it, to hold it and slide.)
          const wallSide = wallOf(to.mode);
          hold('right', wallSide > 0 || (!wallSide && dir > 0 && Math.abs(toX - p.x) > 3));
          hold('left', wallSide < 0 || (!wallSide && dir < 0 && Math.abs(toX - p.x) > 3));
          // (Landed somewhere else: let go of Jump; from the take-off cell, jump again.)
          if (airborne && p.grounded && p.vy >= 0 && !(here.col === to.col && here.row === to.row)) {
            hold('jump', false);
            airborne = false;
            if (here.col === from.col && here.row === from.row) jumped = false;
          }
        }
        tick();
        continue;
      }
      if (to.move === 'swim') {
        hold('right', dir > 0 && Math.abs(toX - p.x) > 3);
        hold('left', dir < 0 && Math.abs(toX - p.x) > 3);
        // (Strokes up when the next cell is higher.)
        if (to.row < here.row) hold('jump', Math.floor(t * 4) % 2 === 0);
        else hold('jump', false);
        tick();
        continue;
      }
      // Walking (and falling off an edge); off the top of a ladder, climbing out first; in water, strokes to stay up.
      hold('jump', !!p.inLiquid && to.row <= here.row && Math.floor(t * 5) % 2 === 0);
      if (p.climbing) hold('up', to.row <= here.row);
      hold('right', dir > 0 && Math.abs(toX - p.x) > 2);
      hold('left', dir < 0 && Math.abs(toX - p.x) > 2);
      tick();
    }
    for (const a of ['left', 'right', 'up', 'down', 'jump', 'fire'] as const) input.release(a);
    if (!done) {
      if (rt.completed !== null) return { won: true, steps: i, of: path.length - 1, seconds: t };
      return { won: false, steps: i - 1, of: path.length - 1, stuck: { step: i, move: to.move, from, to }, seconds: t };
    }
  }
  // At the goal's cell: a moment for it to count.
  for (let i = 0; i < 60 && rt.completed === null; i++) tick();
  return { won: rt.completed !== null, steps: path.length - 1, of: path.length - 1, seconds: t };
}

// The route bot is the route_bot validator's simulator (core/validation/validators.ts): it plays a route there too.
setRouteBot((project, sceneId, route, registry, maxSeconds) => playRoute(project, sceneId, route, registry, undefined, maxSeconds));
