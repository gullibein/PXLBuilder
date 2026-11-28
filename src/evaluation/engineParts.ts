/**
 * Parts of the engine a kind of game needs, each found out by an experiment on the engine as it is now (a body
 * dropped on a floor, a solid turned, a list put in a script): not a list kept by hand, so a part that is added one
 * day is found the day it is added.
 *
 * Why this is separate from playing a built game: a model can make a ball bounce by a script that turns its speed
 * round, and a flipper by a script that throws the ball when a key is down near it. Such a game can pass every
 * check on what it does and still be standing in for a part the engine lacks. The evaluation says so (the case is an
 * "approximation", with the missing parts named) instead of counting it as the engine being able to (§25.11, §31).
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../core/components/registry';
import { projectFromPreset } from '../core/engine/profile';
import { instantiateDefinition } from '../core/model/factory';
import { checkScript } from '../core/script/language';
import type { EntityInstance, ObjectDefinition, Project } from '../core/types';
import { InputState } from '../runtime/input';
import { Runtime, type RuntimeEntity } from '../runtime/runtime';

export type EnginePartId = 'bounce' | 'round_bodies' | 'turning_solids' | 'solids_strike' | 'script_lists';

export interface EnginePart {
  id: EnginePartId;
  /** What the part is, as a game needs it. */
  name: string;
  has: boolean;
  /** What the experiment did and saw. */
  seen: string;
}

const CELL = 32;
const at = (col: number, row: number) => ({ x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 });

type Put = (name: string, col: number, row: number, change?: (e: EntityInstance) => void) => void;
const own = (e: EntityInstance, component: string, fields: Record<string, unknown>) => void (e.components = { ...e.components, [component]: { ...(e.components[component] ?? {}), ...fields } });

/** A side-view level with what `build` puts in it (the starter's objects, by their starter names). */
function room(registry: ComponentRegistry, build: (put: Put) => void): Project {
  const base = projectFromPreset('classic-platformer', registry);
  return produce(base, (d) => {
    const list: EntityInstance[] = [];
    build((name, col, row, change) => {
      const o: ObjectDefinition | undefined = base.definitions.find((x) => x.name === name);
      if (!o) throw new Error(`The starter has no ${name}`);
      const e = instantiateDefinition(o, at(col, row));
      e.name = `${name} ${list.length}`;
      change?.(e);
      list.push(e);
    });
    d.scenes[0].entities = list;
  });
}

function run(project: Project, registry: ComponentRegistry, seconds: number, each?: (rt: Runtime) => void): Runtime {
  const rt = new Runtime(project, project.scenes[0].id, registry);
  const input = new InputState();
  for (let f = 0; f < seconds * 60; f++) {
    rt.update(1 / 60, input);
    each?.(rt);
  }
  return rt;
}

const named = (rt: Runtime, begins: string): RuntimeEntity => rt.entities.find((e) => e.name.startsWith(begins))!;
const floor: (put: Put, row: number, from?: number, to?: number) => void = (put, row, from = 0, to = 12) => {
  for (let c = from; c <= to; c++) put('Platform', c, row);
};

/** A body set to bounce comes back up off the floor it lands on, by the engine's own doing. */
function bounce(registry: ComponentRegistry): EnginePart {
  const name = 'A body that bounces off what it hits (a ball), by a setting of its own';
  const fields = Object.keys(registry.get('PhysicsBody')?.fields ?? {});
  const setting = fields.find((f) => /bounc|restitut|elastic/i.test(f));
  const project = room(registry, (put) => {
    floor(put, 10);
    put('Crate', 6, 3, (e) => setting && own(e, 'PhysicsBody', { [setting]: 1 }));
  });
  let landed = false;
  let rose = 0;
  run(project, registry, 3, (rt) => {
    const b = named(rt, 'Crate');
    if (b.grounded) landed = true;
    else if (landed && b.vy < 0) rose = Math.max(rose, -b.vy);
  });
  const has = !!setting && rose > 20;
  return {
    id: 'bounce',
    name,
    has,
    seen: setting
      ? `A body with ${setting} at 1, dropped seven cells onto a floor, ${has ? `came back up at ${Math.round(rose)} px/s` : 'did not come back up'}.`
      : `A body's settings are ${fields.join(', ')}: none makes it bounce. Dropped seven cells onto a floor, it ${rose > 20 ? 'came back up' : 'landed and lay still'}.`,
  };
}

/** A round collider meets things as a circle: set over a ledge's edge where a box would rest, a circle rolls off. */
function roundBodies(registry: ComponentRegistry): EnginePart {
  const project = room(registry, (put) => {
    floor(put, 6, 0, 5);
    floor(put, 12, 0, 12);
    // Its middle 12 px beyond the ledge's end: as a box 32 wide, 4 px of it are over the ledge and it rests there.
    put('Crate', 5, 4, (e) => {
      e.transform.position.x = 6 * CELL + 12;
      own(e, 'Collider', { shape: 'circle', size: { x: 32, y: 32 } });
    });
  });
  const b = named(run(project, registry, 3), 'Crate');
  const ledgeTop = 6 * CELL;
  const rested = Math.abs(b.y + (b.collider?.hh ?? 16) - ledgeTop) < 3;
  return {
    id: 'round_bodies',
    name: 'Round things that collide as circles (a ball rolls off an edge, strikes a corner at its angle)',
    has: !rested,
    seen: rested
      ? 'A body with a circle collider, set with its middle 12 px past the end of a ledge, stayed resting on the ledge: it collides as the square around the circle.'
      : 'A body with a circle collider, set with its middle 12 px past the end of a ledge, did not rest there as a square would.',
  };
}

/** A solid turned stands turned for what collides with it (a flipper raised is a slope the ball meets). */
function turningSolids(registry: ComponentRegistry): EnginePart {
  const project = room(registry, (put) => {
    // A bar four cells long and half a cell thick, turned 30 degrees: its right end is two cells lower than its left.
    put('Platform', 6, 8, (e) => {
      e.transform.scale = { x: 4, y: 0.5 };
      e.transform.rotation = 30;
    });
    floor(put, 14);
    put('Crate', 5, 2, (e) => void (e.name = 'High end'));
    put('Crate', 8, 2, (e) => void (e.name = 'Low end'));
  });
  let high = 0;
  let low = 0;
  // (Where each first comes to rest on the bar, before any sliding.)
  run(project, registry, 1.5, (rt) => {
    const [a, b] = [named(rt, 'High end'), named(rt, 'Low end')];
    if (!high && a.grounded) high = a.y;
    if (!low && b.grounded) low = b.y;
  });
  const landed = high !== 0 && low !== 0;
  const has = landed && Math.abs(low - high) > CELL / 2;
  return {
    id: 'turning_solids',
    name: 'Solids that stand turned (a flipper swung up is a slope where it now is)',
    has,
    seen: has
      ? `Two bodies dropped on the two ends of a bar turned 30 degrees landed ${Math.round(Math.abs(low - high))} px apart in height: the bar is a slope for what meets it.`
      : !landed
        ? 'Two bodies dropped on the two ends of a bar turned 30 degrees did not both land on it.'
        : `Two bodies dropped on the two ends of a bar turned 30 degrees landed at the same height: what they met is the upright box around the bar, not the bar (turning is exact for quarter turns only).`,
  };
}

/** A solid that moves into a loose body pushes it out of the way and gives it its speed (a flipper strikes a ball). */
function solidsStrike(registry: ComponentRegistry): EnginePart {
  const project = room(registry, (put) => {
    floor(put, 10, 0, 20);
    put('Platform', 3, 9, (e) => {
      e.name = 'Striker';
      own(e, 'MovingPlatform', { offset: { x: 3 * CELL, y: 0 }, speed: 240, pause: 5, loop: false });
    });
    put('Crate', 5, 9, (e) => own(e, 'PhysicsBody', { friction: 0 }));
  });
  let fastest = 0;
  const rt = run(project, registry, 2.5, (r) => void (fastest = Math.max(fastest, named(r, 'Crate').vx)));
  const crate = named(rt, 'Crate');
  const solid = named(rt, 'Striker');
  const moved = crate.x - at(5, 9).x;
  const pushed = moved > CELL / 2 && crate.x - solid.x >= CELL - 2;
  // Struck at 240 px/s on a floor without grip, a body that took the speed is well ahead of where the solid stopped.
  const flewOn = crate.x - solid.x > CELL * 2;
  return {
    id: 'solids_strike',
    name: 'Moving solids that strike loose bodies (a body hit by a flipper or a paddle flies on with the speed it was given)',
    has: pushed && flewOn,
    seen: `A solid moved three cells at 240 px/s along a floor without grip into a loose body: the body ${pushed ? `was pushed ${Math.round(moved)} px, staying ahead of the solid` : `moved ${Math.round(moved)} px`}; when the solid stopped the body was ${Math.max(0, Math.round(crate.x - solid.x - CELL))} px ahead of it, its own speed never above ${Math.round(fastest)} px/s${pushed && !flewOn ? ': it is shoved, and takes none of the speed' : ''}.`,
  };
}

/** A script variable can hold a list (a hand of cards of any size, a deck, a queue). */
function scriptLists(registry: ComponentRegistry): EnginePart {
  const project = projectFromPreset('topdown', registry);
  const script = (value: unknown) => ({ id: 'scr_hand', name: 'Hand', description: 'A hand of cards.', enabled: true, vars: [{ name: 'hand', value }], states: [], handlers: [{ when: { on: 'start' }, do: [{ do: 'set', var: 'hand', value: 'hand' }] }] });
  const plain = checkScript(script(0), project);
  const tried = checkScript(script([3, 5, 8]), project);
  const has = 'script' in tried;
  const why = 'error' in tried ? tried.error.slice(0, 120) : '';
  return {
    id: 'script_lists',
    name: 'Lists in scripts (a hand, a deck, a queue of any length)',
    has,
    seen: has
      ? 'A script with a variable holding a list of three numbers was accepted.'
      : `A script was ${'script' in plain ? 'accepted' : 'refused'} with a variable holding a number, and refused with the same variable holding a list of three numbers (${why}): a variable holds one number, text or yes/no, so a hand is one variable a card.`,
  };
}

/** Every part, as the engine is now. */
export function engineParts(registry: ComponentRegistry): EnginePart[] {
  return [bounce(registry), roundBodies(registry), turningSolids(registry), solidsStrike(registry), scriptLists(registry)];
}
