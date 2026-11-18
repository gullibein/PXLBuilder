/**
 * Movement scenarios for the golden traces of F2 (docs/engine-architecture-proposal.md §16.3): every movement the
 * engine does, played with inputs on small levels, each traced frame by frame (position, speed, standing, climbing,
 * hanging). Recorded before the movement code moved behind the movement models; replayed after, they must match.
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../core/components/registry';
import { applyOperations, type Operation } from '../core/commands/operations';
import { projectFromPreset } from '../core/engine/profile';
import { instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import type { Project } from '../core/types';
import { Runtime } from '../runtime/runtime';
import { mapLevel } from './games/platformers';
import { Player, type InputStep } from './harness';

export interface Scenario {
  name: string;
  project: (registry: ComponentRegistry) => Project;
  steps: InputStep[];
  seconds: number;
}

const withComponents = (p: Project, comps: Record<string, Record<string, unknown>>, registry: ComponentRegistry): Project =>
  produce(p, (d) => {
    const player = d.definitions.find((x) => x.name === 'Player')!;
    for (const [type, props] of Object.entries(comps)) player.components[type] = registry.createDefault(type, props);
  });

const scripted = (p: Project, part: 'running' | 'jumping' | 'climbing' | 'ledge_grab', registry: ComponentRegistry): Project =>
  produce(p, (d) => {
    const id = d.definitions.find((x) => x.name === 'Player')!.id;
    applyOperations(d, [{ op: 'use_script_for', target: 'definition', id, part, scriptJson: null } as unknown as Operation], registry);
  });

const FLAT = ['..............................', '..............................', '...P..........................', '##############################'];
const GAP = ['..............................', '..............................', '...P..........................', '#########...##################'];
const WALL = ['.................', '..........#######', '..........#######', '...P......#######', '#################'];
const LADDER = ['..........', '......####', '......H...', '......H...', '...P..H...', '##########'];
const POOL = ['........................', '...P....................', '####~~~~~~##############', '####wwwwww##############', '########################'];
const ONEWAY = ['..........', '...P......', '..----....', '..........', '..........', '##########'];
const RAMPS = ['..................', '..................', '..................', '...P..../##\\......', '##################'];
const SPRING = ['..........', '..........', '..........', '...P.S....', '##########'];

const run = (seconds: number, ...steps: InputStep[]) => ({ steps, seconds });

export const SCENARIOS: Scenario[] = [
  { name: 'run and stop', project: (r) => mapLevel(r, FLAT), ...run(2.5, { at: 0.2, hold: ['right'] }, { at: 1.4, hold: [] }, { at: 1.8, hold: ['left'] }, { at: 2.1, hold: [] }) },
  { name: 'full jump and short hop', project: (r) => mapLevel(r, FLAT), ...run(2.4, { at: 0.2, hold: ['jump'] }, { at: 1.0, hold: [] }, { at: 1.4, hold: ['jump'] }, { at: 1.45, hold: [] }) },
  { name: 'running jump over a gap', project: (r) => mapLevel(r, GAP), ...run(2.5, { at: 0.1, hold: ['right'] }, { at: 0.9, hold: ['right', 'jump'] }, { at: 1.4, hold: ['right'] }, { at: 2, hold: [] }) },
  { name: 'coyote time (jump just after the edge)', project: (r) => mapLevel(r, GAP), ...run(2, { at: 0.1, hold: ['right'] }, { at: 1.16, hold: ['right', 'jump'] }, { at: 1.4, hold: ['right'] }, { at: 1.7, hold: [] }) },
  { name: 'jump buffer (pressed just before landing)', project: (r) => mapLevel(r, FLAT), ...run(2.5, { at: 0.2, hold: ['jump'] }, { at: 0.6, hold: [] }, { at: 0.84, hold: ['jump'] }, { at: 1.6, hold: [] }) },
  { name: 'double jump', project: (r) => withComponents(mapLevel(r, FLAT), { DoubleJump: { extraJumps: 1 } }, r), ...run(2.5, { at: 0.2, hold: ['jump'] }, { at: 0.45, hold: [] }, { at: 0.55, hold: ['jump'] }, { at: 1.2, hold: [] }) },
  { name: 'ledge grab and climb up', project: (r) => withComponents(mapLevel(r, WALL), { LedgeGrab: {} }, r), ...run(3.4, { at: 0.1, hold: ['right'] }, { at: 1.3, hold: ['right', 'jump'] }, { at: 2.0, hold: ['right'] }, { at: 2.4, hold: ['up'] }, { at: 2.6, hold: [] }) },
  { name: 'ladder up, off the top, and down again', project: (r) => mapLevel(r, LADDER), ...run(5, { at: 0.1, hold: ['right'] }, { at: 0.55, hold: ['up'] }, { at: 2.2, hold: ['right'] }, { at: 2.6, hold: ['left'] }, { at: 2.9, hold: ['down'] }, { at: 4.2, hold: [] }) },
  { name: 'swimming strokes and out of the water', project: (r) => mapLevel(r, POOL), ...run(5, { at: 0.1, hold: ['right'] }, { at: 0.6, hold: [] }, { at: 1.6, hold: ['jump'] }, { at: 1.65, hold: [] }, { at: 2.2, hold: ['jump', 'right'] }, { at: 2.25, hold: ['right'] }, { at: 2.8, hold: ['jump', 'right'] }, { at: 2.85, hold: ['right'] }, { at: 3.6, hold: ['jump', 'right'] }, { at: 3.7, hold: ['right'] }, { at: 4.4, hold: [] }) },
  { name: 'drop through a jump-through platform', project: (r) => mapLevel(r, ONEWAY), ...run(2.5, { at: 0.5, hold: ['down'] }, { at: 0.6, hold: ['down', 'jump'] }, { at: 0.7, hold: [] }) },
  { name: 'ramps up and down', project: (r) => mapLevel(r, RAMPS), ...run(3, { at: 0.1, hold: ['right'] }, { at: 2.1, hold: [] }) },
  { name: 'spring bounce and launch', project: (r) => mapLevel(r, SPRING), ...run(3.5, { at: 0.1, hold: ['right'] }, { at: 0.45, hold: [] }, { at: 1.6, hold: ['jump'] }) },
  { name: 'top-down walking (straight and diagonal)', project: (r) => topDown(r, 'topdown'), ...run(2.5, { at: 0.1, hold: ['right'] }, { at: 0.8, hold: ['right', 'down'] }, { at: 1.5, hold: ['up'] }, { at: 2.0, hold: [] }) },
  { name: 'isometric walking (keys follow the screen)', project: (r) => topDown(r, 'isometric'), ...run(2.5, { at: 0.1, hold: ['right'] }, { at: 0.8, hold: ['up'] }, { at: 1.5, hold: ['down', 'left'] }, { at: 2.0, hold: [] }) },
  // (V1.2: the first ability for characters seen from above. Walking, a roll the way it walks, on; standing, a roll the way it last headed.)
  { name: 'top-down dodge roll', project: (r) => withComponents(topDown(r, 'topdown'), { DodgeRoll: {} }, r), ...run(2.6, { at: 0.1, hold: ['right'] }, { at: 0.5, hold: ['right', 'jump'] }, { at: 0.55, hold: ['right'] }, { at: 1.2, hold: [] }, { at: 1.6, hold: ['jump'] }, { at: 1.65, hold: ['down'] }, { at: 2.2, hold: [] }) },
  { name: 'isometric dodge roll (keys follow the screen)', project: (r) => withComponents(topDown(r, 'isometric'), { DodgeRoll: {} }, r), ...run(2.2, { at: 0.1, hold: ['up'] }, { at: 0.5, hold: ['up', 'jump'] }, { at: 0.55, hold: ['up'] }, { at: 1.2, hold: [] }, { at: 1.5, hold: ['left', 'jump'] }, { at: 1.55, hold: [] }) },
  { name: 'running taken over by a script', project: (r) => scripted(mapLevel(r, FLAT), 'running', r), ...run(2, { at: 0.2, hold: ['right'] }, { at: 1.2, hold: [] }) },
  { name: 'jumping taken over by a script', project: (r) => scripted(mapLevel(r, GAP), 'jumping', r), ...run(2.5, { at: 0.1, hold: ['right'] }, { at: 0.9, hold: ['right', 'jump'] }, { at: 1.4, hold: ['right'] }, { at: 2, hold: [] }) },
  { name: 'climbing taken over by a script', project: (r) => scripted(mapLevel(r, LADDER), 'climbing', r), ...run(3, { at: 0.1, hold: ['right'] }, { at: 0.55, hold: ['up'] }, { at: 2.2, hold: [] }) },
];

/** A top-down (or isometric) game with its player on an open floor. */
function topDown(registry: ComponentRegistry, preset: 'topdown' | 'isometric'): Project {
  return produce(projectFromPreset(preset, registry, 'Walk'), (d) => {
    const sceneId = d.scenes[0].id;
    d.scenes[0].entities = d.scenes[0].entities.filter((e) => !d.definitions.find((x) => x.id === e.definitionId)?.components.CharacterController);
    m.addEntity(d, sceneId, instantiateDefinition(d.definitions.find((x) => x.components.CharacterController)!, { x: 16, y: 16 }));
  });
}

/** Plays a scenario; its trace's fingerprint and the player's last state. */
export function playScenario(s: Scenario, registry: ComponentRegistry): { fingerprint: string; last: { x: number; y: number; grounded: boolean }; samples: number } {
  const p = s.project(registry);
  const rt = new Runtime(p, p.startSceneId, registry);
  const pl = new Player(rt);
  const me = () => rt.entities.find((e) => e.alive && e.controller)!;
  pl.play(s.seconds, s.steps, () => {
    const e = me();
    return [Math.round(e.x * 100) / 100, Math.round(e.y * 100) / 100, Math.round(e.vx * 10) / 10, Math.round(e.vy * 10) / 10, e.grounded, e.climbing, !!e.hanging, e.facing];
  }, 1);
  const e = me();
  return { fingerprint: pl.fingerprint(), last: { x: e.x, y: e.y, grounded: e.grounded }, samples: pl.sampleCount };
}
