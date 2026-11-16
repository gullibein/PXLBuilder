/**
 * The precision platformer of the regression suite (Celeste-inspired): the platformer preset with the wall_jump and
 * dash abilities set in its profile; one room: a spiked pit five cells wide, wider than any jump (crossed with a dash at the top of
 * the jump), then a shaft seven rows high (climbed with wall jumps) with the goal at its top. And a bot that plays
 * it by reading the motion snapshot (where it is, what its movement is doing), as validation's simulators will.
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../../core/components/registry';
import { setGameProfile } from '../../core/engine/profile';
import type { Project } from '../../core/types';
import type { Runtime } from '../../runtime/runtime';
import { mapLevel } from './platformers';
import type { Player } from '../harness';

export const PRECISION_ROOM = [
  '......................',
  '................G.....',
  '...............#..#...',
  '...............#..#...',
  '...............#..#...',
  '...............#..#...',
  '...............#..#...',
  '...............#..#...',
  '..P...............#...',
  '#####.....############',
  '#####^^^^^############',
  '######################',
];

/** The room, with the profile's abilities (none: a plain platformer, to show the room needs them). */
export function precisionRoom(registry: ComponentRegistry, abilities: string[] = ['wall_jump', 'dash']): Project {
  return produce(mapLevel(registry, PRECISION_ROOM), (d) => {
    setGameProfile(d, { abilities }, registry);
    // (The room's dash: a little longer than the default, as a game tunes it.)
    const dash = d.definitions.find((x) => x.name === 'Player')!.components.Dash as Record<string, unknown> | undefined;
    if (dash) Object.assign(dash, { speed: 560, duration: 0.22 });
  });
}

/** Plays the room: run, jump at the pit's edge, dash right at the top; walk into the shaft; wall-jump up. */
export function playPrecision(rt: Runtime, pl: Player, seconds: number, sample?: (rt: Runtime) => unknown): { won: boolean; died: boolean } {
  const me = () => rt.entities.find((e) => e.alive && e.controller)!;
  let dashed = false;
  let died = false;
  let toward: 'left' | 'right' = 'right';
  for (let f = 0; f < seconds * 60 && rt.completed === null; f++) {
    const e = me();
    const m = rt.motion(e)!;
    const col = (e.x - 16) / 32;
    const held: ('left' | 'right' | 'jump' | 'fire')[] = [];
    if (col < 15.5) {
      // The pit: jump from its edge, dash right near the top of the jump.
      held.push('right');
      if (m.states.includes('grounded') && col > 3.6 && col < 4.6) held.push('jump');
      if (!m.states.includes('grounded') && !dashed && col > 4 && e.vy > -60) {
        held.push('fire');
        dashed = true;
      }
    } else {
      // The shaft: press into a wall; sliding on it, jump off toward the other.
      held.push(toward);
      if (m.states.includes('grounded') && f % 30 === 0) held.push('jump');
      if (m.states.includes('wallSliding')) {
        held.push('jump');
        toward = toward === 'right' ? 'left' : 'right';
      }
    }
    pl.hold(held);
    pl.play(1 / 60, [], sample, 1);
    if (me().y > 9 * 32) died = true;
  }
  return { won: rt.completed !== null, died };
}
