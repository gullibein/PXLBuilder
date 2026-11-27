/**
 * Worlds full of things that act (docs §30, W1.1): what play costs when what there is a lot of is not tiles but
 * things that walk, hunt, shoot, fly, run scripts and fall. One kind of activity in each world, so each can be
 * measured by itself, at any number of them. Made the same every time, from the starters' own objects.
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../core/components/registry';
import { projectFromPreset } from '../core/engine/profile';
import { instantiateDefinition } from '../core/model/factory';
import { setScript } from '../core/script/mutations';
import type { EntityInstance, ObjectDefinition, Project } from '../core/types';
import { InputState } from '../runtime/input';
import { Runtime } from '../runtime/runtime';

const CELL = 32;
const at = (col: number, row: number) => ({ x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 });

export const CROWDS = ['walkers', 'patrollers', 'hunters', 'hunters, all hunting', 'shooters', 'shooters, waiting', 'platforms', 'scripted', 'crates'] as const;
export type CrowdKind = (typeof CROWDS)[number];

export const CROWD_IS: Record<CrowdKind, string> = {
  walkers: 'seen from above: wanderers in a walled field with a pillar every sixth cell (they walk, pause, turn, bump into walls)',
  patrollers: 'from the side: enemies on a long floor with pits, each walking its beat and turning at ledges (gravity, the floor under each)',
  hunters: "from the side: the starter's enemy as it is (it hunts a player it sees within 256 px); the few near the player hunt, the rest patrol",
  'hunters, all hunting': 'the same enemies packed close and seeing far: every one of them sees the player and runs at it',
  shooters: 'from the side: turrets on the floor, each firing upward about once a second at nothing in particular; a shot flies 320 px and is gone. (The engine lets 100 shots be in the air at once: with more than some 75 turrets that is what there are.)',
  'shooters, waiting': 'the same turrets as they usually are: each fires at the player when it is within 320 px, so the few near the player fire and the rest wait',
  platforms: 'from the side: moving platforms, each gliding back and forth on its own path (solid things that move)',
  scripted: 'from the side: things with a script each: every step it counts time and sets its own speed from it, every half second all of them answer a signal, and each listens for being touched',
  crates: 'from the side: crates dropped onto the floor in a row, then lying there (bodies with gravity that other things are stopped by)',
};

export interface Crowd {
  kind: CrowdKind;
  /** How many of the acting things there are. */
  count: number;
  project: Project;
  things: number;
}

/** A world of `n` things of one kind of activity. */
export function makeCrowd(kind: CrowdKind, n: number, registry: ComponentRegistry): Crowd {
  const topDown = kind === 'walkers';
  const base = projectFromPreset(topDown ? 'topdown' : 'classic-platformer', registry);
  const def = (name: string): ObjectDefinition => {
    const d = base.definitions.find((x) => x.name === name);
    if (!d) throw new Error(`The starter has no ${name}`);
    return d;
  };
  const project = produce(base, (d) => {
    const scene = d.scenes[0];
    const list: EntityInstance[] = [];
    const put = (o: ObjectDefinition, col: number, row: number, change?: (e: EntityInstance) => void) => {
      const e = instantiateDefinition(o, at(col, row));
      change?.(e);
      list.push(e);
    };
    const own = (e: EntityInstance, component: string, fields: Record<string, unknown>) => void (e.components = { ...e.components, [component]: { ...(e.components[component] ?? {}), ...fields } });
    if (topDown) {
      // A field 240 by 160 cells, a wall all round, a pillar every sixth cell; the walkers spread evenly over it.
      const cols = 240;
      const rows = 160;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1 || (r % 6 === 3 && c % 6 === 3)) put(def('Wall'), c, r);
      put(def('Player'), 120, 80);
      const free: [number, number][] = [];
      for (let r = 1; r < rows - 1; r++) for (let c = 1; c < cols - 1; c++) if (!(r % 6 === 3 && c % 6 === 3) && !(Math.abs(c - 120) < 3 && Math.abs(r - 80) < 3)) free.push([c, r]);
      for (let i = 0; i < n; i++) put(def('Enemy'), ...free[Math.floor(((i + 0.5) * free.length) / n)]);
    } else {
      // A floor two deep; the things in a row along it, the player at the left end (in the middle for the hunters).
      const gap = kind === 'hunters, all hunting' ? 1 : kind === 'crates' ? 2 : kind === 'platforms' ? 5 : 3;
      const cols = Math.max(60, n * gap + 20);
      const floor = 12;
      // (For the patrollers: a pit two cells wide every 24 cells, so there are ledges to turn at.)
      for (let c = 0; c < cols; c++) if (kind !== 'patrollers' || c % 24 < 22) for (const r of [floor, floor + 1]) put(def('Platform'), c, r);
      const middle = kind === 'hunters' || kind === 'hunters, all hunting';
      put(def('Player'), middle ? Math.floor(cols / 2) : 3, floor - 1);
      for (let i = 0; i < n; i++) {
        const col = 10 + i * gap;
        if (kind === 'patrollers') put(def('Enemy'), col - (col % 24 >= 21 ? 3 : 0), floor - 1, (e) => own(e, 'Patrol', { chaseRange: 0 }));
        else if (kind === 'hunters') put(def('Enemy'), col, floor - 1);
        else if (kind === 'hunters, all hunting') put(def('Enemy'), col, floor - 1, (e) => own(e, 'Patrol', { chaseRange: cols * CELL }));
        else if (kind === 'shooters' || kind === 'shooters, waiting')
          put(def('Stone'), col, floor - 1, (e) => own(e, 'Shooter', { trigger: 'auto', interval: 1, direction: 'up', targetTag: kind === 'shooters' ? '' : 'player', speed: 240, range: 320, variation: 0.5 }));
        else if (kind === 'platforms') put(def('Platform'), col, floor - 4 - (i % 3) * 2, (e) => own(e, 'MovingPlatform', { offset: { x: 64, y: 0 }, speed: 60, pause: 0.2, loop: true }));
        else if (kind === 'crates') put(def('Crate'), col, floor - 3);
        else put(def('Coin'), col, floor - 2);
      }
    }
    scene.entities = list;
    if (kind === 'scripted') {
      const coin = d.definitions.find((x) => x.name === 'Coin')!;
      // (Not collected by walking into it: it is only a thing with a script here.)
      delete coin.components.Collectible;
      setScript(d, { target: 'definition', id: coin.id }, {
        name: 'Bobbing',
        description: 'Counts time and bobs by it; answers the beat; listens for being touched.',
        vars: [
          { name: 't', value: 0 },
          { name: 'beats', value: 0 },
          { name: 'touched', value: 0 },
        ],
        handlers: [
          { when: { on: 'tick' }, if: null, do: [{ do: 'set', var: 't', value: 't + dt' }, { do: 'velocity', x: null, y: '(t % 0.7 < 0.35) ? -24 : 24' }] },
          { when: { on: 'signal', name: 'beat' }, if: null, do: [{ do: 'set', var: 'beats', value: 'beats + 1' }] },
          { when: { on: 'contact' }, if: null, do: [{ do: 'set', var: 'touched', value: 'touched + 1' }] },
        ],
      } as never);
      const player = d.definitions.find((x) => x.name === 'Player')!;
      setScript(d, { target: 'definition', id: player.id }, { name: 'Beat', description: 'Gives the beat.', vars: [], handlers: [{ when: { on: 'every', seconds: 0.5 }, if: null, do: [{ do: 'signal', name: 'beat' }] }] } as never);
    }
  });
  return { kind, count: n, project, things: project.scenes[0].entities.length };
}

export interface CrowdCost {
  kind: CrowdKind;
  count: number;
  things: number;
  /** How many things are in play at the end (shots fired are things too). */
  thingsAtEnd: number;
  /** One frame of play (a sixtieth of a second: two steps), the player walking: the middle one of those measured. */
  frameMs: number;
  /** The slowest of them. */
  worstMs: number;
  /** Proof that they act: how many of the acting things moved, and how many things appeared or went, while measured. */
  moved: number;
  appeared: number;
}

/** Plays a crowd: `warm` frames first (things land, shots are in the air), then `frames` frames timed. */
export function playCrowd(crowd: Crowd, registry: ComponentRegistry, frames = 90, warm = 90): CrowdCost {
  const p = crowd.project;
  const rt = new Runtime(p, p.scenes[0].id, registry);
  const input = new InputState();
  input.press('right');
  // (Timed as the engine runs for a user: the suite's comparison of the fixed solids with ones made afresh is off.)
  const checking = Runtime.checkSolids;
  Runtime.checkSolids = false;
  try {
    return played(crowd, rt, input, frames, warm);
  } finally {
    Runtime.checkSolids = checking;
  }
}

function played(crowd: Crowd, rt: Runtime, input: InputState, frames: number, warm: number): CrowdCost {
  for (let i = 0; i < warm; i++) rt.update(1 / 60, input);
  const acting = rt.entities.filter((e) => e.name !== 'Player' && !rt.isAsleep(e));
  const was = new Map(acting.map((e) => [e, `${e.x.toFixed(2)},${e.y.toFixed(2)}`]));
  const before = new Set(rt.entities);
  const times: number[] = [];
  for (let i = 0; i < frames; i++) {
    const t0 = performance.now();
    rt.update(1 / 60, input);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const moved = acting.filter((e) => was.get(e) !== `${e.x.toFixed(2)},${e.y.toFixed(2)}`).length;
  const appeared = rt.entities.filter((e) => !before.has(e)).length;
  const round = (v: number) => Math.round(v * 100) / 100;
  return { kind: crowd.kind, count: crowd.count, things: crowd.things, thingsAtEnd: rt.entities.length, frameMs: round(times[Math.floor(times.length / 2)]), worstMs: round(times[times.length - 1]), moved, appeared };
}
