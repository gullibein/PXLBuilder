/**
 * The digging game of the regression suite (Lode Runner-inspired): bricks that can be dug (tagged "diggable") and
 * fill in again, from the F3 geometry's cells. The player digs the square ahead of it and down (Fire); a guard walks
 * at it blindly, drops into the hole and is caught when the brick fills in; then the way to the gold and the goal is
 * clear. And a bot that plays it.
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../../core/components/registry';
import { setScript } from '../../core/script/mutations';
import type { Project } from '../../core/types';
import type { Runtime } from '../../runtime/runtime';
import { mapLevel } from './platformers';
import type { Player } from '../harness';

export const DIG_ROOM = [
  '................',
  '..P.......E...oG',
  '################',
  '################',
];

/** The square the player digs (ahead of it, one down), and how long a hole stays open. */
export const DIG_CELL = { col: 3, row: 2 };
export const REFILL_SECONDS = 4;

export function digRoom(registry: ComponentRegistry): Project {
  return produce(mapLevel(registry, DIG_ROOM), (d) => {
    d.definitions.find((x) => x.name === 'Platform')!.tags.push('diggable');
    const player = d.definitions.find((x) => x.name === 'Player')!;
    setScript(d, { target: 'definition', id: player.id }, {
      name: 'Digger',
      description: 'Fire digs the brick ahead of it and down; the hole fills in again.',
      vars: [],
      handlers: [{ when: { on: 'key', key: 'fire', edge: 'pressed' }, if: null, do: [{ do: 'dig', x: 'self.x + self.facing * 32', y: 'self.y + 32', seconds: String(REFILL_SECONDS), tag: 'diggable' }] }],
    } as never);
    // The guard walks straight at the player, holes or not (no patrol: Lode Runner's guards fall in).
    const guard = d.definitions.find((x) => x.name === 'Enemy')!;
    delete guard.components.Patrol;
    setScript(d, { target: 'definition', id: guard.id }, {
      name: 'Guard',
      description: 'Walks left.',
      vars: [],
      handlers: [{ when: { on: 'tick' }, if: null, do: [{ do: 'velocity', x: '-60', y: null }] }],
    } as never);
  });
}

/** Plays it: step right to the hole's edge, dig as the guard comes, wait for the brick to fill in, walk to the goal. */
export function playDig(rt: Runtime, pl: Player, seconds: number, sample?: (rt: Runtime) => unknown): { won: boolean; trapped: boolean; died: boolean } {
  const me = () => rt.entities.find((e) => e.alive && e.controller);
  const guard = () => rt.entities.find((e) => e.tags.includes('enemy'))!;
  const holeX = DIG_CELL.col * 32 + 16;
  let dug = false;
  let died = false;
  for (let f = 0; f < seconds * 60 && rt.completed === null; f++) {
    const e = me();
    if (!e) break;
    if (e.health && e.health.current < e.health.max) died = true;
    if (!dug && e.x < holeX - 34) pl.play(1 / 60, [{ at: 0, hold: ['right'] }], sample, 1);
    else if (!dug && guard().x < holeX + 70) {
      pl.tap('fire', sample);
      dug = true;
    } else if (dug && guard().alive) pl.play(1 / 60, [{ at: 0, hold: [] }], sample, 1);
    else if (dug) pl.play(1 / 60, [{ at: 0, hold: ['right'] }], sample, 1);
    else pl.play(1 / 60, [{ at: 0, hold: [] }], sample, 1);
  }
  return { won: rt.completed !== null, trapped: !guard().alive, died };
}
