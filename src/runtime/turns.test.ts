import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createDefinition, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { checkScript } from '../core/script/language';
import { expandReadyScript } from '../core/script/ready';
import type { Project } from '../core/types';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** A small board seen from above: a knight (the player's) and a goblin four squares to its right, a wall between rows. */
function board(): { rt: Runtime; project: Project } {
  let project = createProject(registry, 'Tactics', 'topdown');
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const unit = (name: string, tag: string, hp: number, ready: string) => {
      const def = createDefinition(
        name,
        {
          Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }),
          Collider: registry.createDefault('Collider', { size: { x: 28, y: 28 }, isTrigger: true }),
          Health: registry.createDefault('Health', { maxHealth: hp, currentHealth: hp }),
        },
        [tag],
      );
      const checked = checkScript({ ...expandReadyScript({ ready }), id: `scr_${tag}` }, d);
      if ('error' in checked) throw new Error(checked.error);
      def.scripts = [checked.script];
      m.addDefinition(d, def, registry);
      return def;
    };
    const knight = unit('Knight', 'hero', 6, 'Tactics unit');
    const goblin = unit('Goblin', 'enemy', 4, 'Tactics enemy');
    // (No player character steering about: the board is played with the cursor.)
    d.scenes[0].entities = [];
    m.addEntity(d, sceneId, instantiateDefinition(knight, { x: 80, y: 80 }));
    m.addEntity(d, sceneId, instantiateDefinition(goblin, { x: 208, y: 80 }));
  });
  return { rt: new Runtime(project, sceneId, registry), project };
}

const input = new InputState();
const step = (rt: Runtime, seconds: number) => {
  for (let i = 0; i < Math.max(1, Math.round(seconds * 120)); i++) rt.update(1 / 120, input);
};
const tap = (rt: Runtime, a: Action) => {
  input.press(a);
  step(rt, 1 / 120);
  input.release(a);
  step(rt, 2 / 120);
};

describe('the turn-based kit', () => {
  it('plays a round: pick the knight with the cursor, Move (where it can walk shown), Attack the goblin, then the goblin answers', () => {
    const { rt } = board();
    step(rt, 0.1);
    const knight = rt.entities.find((e) => e.name === 'Knight')!;
    const goblin = rt.entities.find((e) => e.name === 'Goblin')!;
    expect(rt.kit.team()?.tag).toBe('hero');
    expect(rt.kit.turns?.number).toBe(1);
    // The team's cursor starts on its first unit; choosing the knight gives it its go: a menu.
    expect(rt.kit.cursorAt()).toEqual({ x: 80, y: 80 });
    tap(rt, 'interact');
    expect(rt.kit.isActing(knight)).toBe(true);
    expect(rt.kit.menu?.items).toEqual(['Move', 'Attack', 'Wait']);
    // Move: where it can walk in 4 steps is highlighted (not the goblin's square), and a cursor picks the square.
    tap(rt, 'interact');
    expect(rt.kit.menu).toBeNull();
    expect(rt.kit.highlighted('move', 176, 80)).toBe(true);
    expect(rt.kit.highlighted('move', 208, 80)).toBe(false);
    expect(rt.kit.highlighted('move', 240, 80)).toBe(false);
    // Drawn under everything, as squares on the ground.
    expect([...rt.drawings.values()].some((d) => d.under && d.anchor === 'world')).toBe(true);
    for (let i = 0; i < 3; i++) tap(rt, 'right');
    expect(rt.kit.cursorAt()).toEqual({ x: 176, y: 80 });
    tap(rt, 'interact');
    expect(rt.kit.walking(knight)).toBe(true);
    step(rt, 1.2);
    expect([knight.x, knight.y]).toEqual([176, 80]);
    // Back to the menu, Move greyed out: Attack is the one picked.
    expect(rt.kit.menu?.items).toEqual(['-Move', 'Attack', 'Wait']);
    tap(rt, 'interact');
    tap(rt, 'right');
    expect(rt.kit.highlighted('attack', 208, 80)).toBe(true);
    tap(rt, 'interact');
    expect(goblin.health!.current).toBe(1);
    expect(rt.kit.popups.some((p) => p.text === '-3')).toBe(true);
    // The knight's go is over; it was the only hero: the goblin's turn. It is beside the knight, so it strikes.
    expect(rt.kit.team()?.tag).toBe('enemy');
    step(rt, 0.6);
    expect(knight.health!.current).toBe(4);
    expect(rt.kit.team()?.tag).toBe('hero');
    expect(rt.kit.turns?.number).toBe(2);
  });

  it('the menu has the keys: the arrows move its menu_choice, nothing else; Esc while picking a square goes back to the menu', () => {
    const { rt } = board();
    step(rt, 0.1);
    tap(rt, 'interact');
    tap(rt, 'down');
    expect(rt.kit.menu?.index).toBe(1);
    tap(rt, 'up');
    tap(rt, 'interact');
    expect(rt.kit.cursorAt()).not.toBeNull();
    tap(rt, 'menu');
    expect(rt.kit.menu?.items[0]).toBe('Move');
    expect(rt.kit.highlights.size).toBe(0);
  });

  it('an enemy out of reach walks toward the nearest hero, as far as it may, and stops beside it', () => {
    const { rt } = board();
    const goblin = rt.entities.find((e) => e.name === 'Goblin')!;
    step(rt, 0.1);
    // Wait with the knight: the goblin (4 squares away, 3 steps a go) walks up beside it.
    tap(rt, 'interact');
    tap(rt, 'down');
    tap(rt, 'down');
    tap(rt, 'interact');
    expect(rt.kit.team()?.tag).toBe('enemy');
    step(rt, 2);
    expect([goblin.x, goblin.y]).toEqual([112, 80]);
    expect(rt.kit.stepsTo(goblin, 80, 80)).toBe(-1);
  });
});
