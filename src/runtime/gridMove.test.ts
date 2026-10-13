/**
 * A Boulder Dash player that moves itself one square at a time with a script (key() + glide_to + position),
 * driven by random key presses through a room of walls, dirt and boulders. Its Character Controller walks it
 * too unless its speed is 0: then it is nudged off its square and glides can cut through walls (a real report).
 * With speed 0 it stays on its squares and never passes through a wall; the problem checker names the clash.
 */
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { diagnoseLevel } from '../core/debug/diagnose';
import { createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { setScript } from '../core/script/mutations';
import gridMove from './fixtures/gridMove.json';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

function level(seed: number, controllerSpeed: number) {
  let r = seed * 9301;
  const rand = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const project = produce(createProject(registry, 'Boulders', 'topdown'), (d) => {
    const sceneId = d.scenes[0].id;
    const named = (name: string) => d.definitions.find((x) => x.name === name)!;
    const player = named('Player');
    setScript(d, { target: 'definition', id: player.id }, gridMove);
    player.components.CharacterController.speed = controllerSpeed;
    // Dirt: the floor, tagged, with a trigger box (the script finds it with thing_at and digs it).
    const dirt = named('Floor');
    dirt.tags = ['dirt'];
    dirt.components.Collider = { ...named('Wall').components.Collider, isTrigger: true };
    named('Barrel').tags.push('boulder');
    const put = (name: string, c: number, row: number) => m.addEntity(d, sceneId, instantiateDefinition(named(name), { x: c * 32 + 16, y: row * 32 + 16 }));
    for (let c = -6; c <= 6; c++)
      for (let row = -5; row <= 5; row++) {
        if (Math.abs(c) === 6 || Math.abs(row) === 5) put('Wall', c, row);
        else if (c === 0 && row === 0) put('Player', c, row);
        else {
          const k = rand();
          if (k < 0.15) put('Wall', c, row);
          else if (k < 0.3) put('Barrel', c, row);
          else if (k < 0.8) put('Floor', c, row);
        }
      }
  });
  return { project, rand };
}

/** A minute of random key presses (one or two keys, held for a moment). */
function play(seed: number, controllerSpeed: number) {
  const { project, rand } = level(seed, controllerSpeed);
  const rt = new Runtime(project, project.scenes[0].id, registry);
  const hero = rt.find('Player')!;
  const walls = rt.entities.filter((e) => e.name.startsWith('Wall'));
  const input = new InputState();
  const keys: Action[] = ['left', 'right', 'up', 'down'];
  let held: Action[] = [];
  let offSquare = 0;
  let throughWall = 0;
  let steps = 0;
  let last = { x: hero.x, y: hero.y };
  for (let i = 0; i < 60 * 60; i++) {
    if (i % Math.floor(5 + rand() * 30) === 0) {
      for (const k of held) input.release(k);
      const one = () => keys[Math.floor(rand() * 4)];
      held = rand() < 0.2 ? [] : rand() < 0.3 ? [one(), one()] : [one()];
      for (const k of held) input.press(k);
    }
    rt.update(1 / 60, input);
    const cx = (hero.x - 16) / 32;
    const cy = (hero.y - 16) / 32;
    if (!hero.moveTarget && (Math.abs(cx - Math.round(cx)) > 0.01 || Math.abs(cy - Math.round(cy)) > 0.01)) offSquare++;
    if (walls.some((w) => Math.abs(w.x - hero.x) < 16 && Math.abs(w.y - hero.y) < 16)) throughWall++;
    if (Math.hypot(hero.x - last.x, hero.y - last.y) >= 31.9 && !hero.moveTarget) steps++;
    if (!hero.moveTarget) last = { x: hero.x, y: hero.y };
  }
  return { offSquare, throughWall, steps };
}

describe('a player that steps square by square with a script (top-down)', () => {
  it('with its Character Controller at speed 0, it stays on its squares and never passes through a wall', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const r = play(seed, 0);
      expect(r, `seed ${seed}`).toMatchObject({ offSquare: 0, throughWall: 0 });
      expect(r.steps, `seed ${seed}: it really moves around`).toBeGreaterThan(10);
    }
  });

  it('with the controller still walking it too, it drifts off its squares (what the problem checker warns about)', () => {
    const r = play(1, 150);
    expect(r.offSquare).toBeGreaterThan(100);
    const { project } = level(1, 150);
    const warned = diagnoseLevel(project, project.scenes[0].id, registry).find((p) => p.key.startsWith('script-and-controller-move:'));
    expect(warned?.text).toMatch(/Set the Character Controller's speed to 0/);
    const fixed = level(1, 0).project;
    expect(diagnoseLevel(fixed, fixed.scenes[0].id, registry).some((p) => p.key.startsWith('script-and-controller-move:'))).toBe(false);
  });
});
