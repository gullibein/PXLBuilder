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
import { wrapWords } from './turns';

const registry = createBuiltinRegistry();

/** A small board seen from above: a knight (the player's) and a goblin four squares to its right, a wall between rows. */
function board(look: Record<string, unknown> = {}): { rt: Runtime; project: Project } {
  let project = createProject(registry, 'Tactics', 'topdown');
  const sceneId = project.scenes[0].id;
  project = produce(project, (d) => {
    const unit = (name: string, tag: string, hp: number, ready: string, settings: Record<string, unknown> = {}) => {
      const def = createDefinition(
        name,
        {
          Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }),
          Collider: registry.createDefault('Collider', { size: { x: 28, y: 28 }, isTrigger: true }),
          Health: registry.createDefault('Health', { maxHealth: hp, currentHealth: hp }),
        },
        [tag],
      );
      const checked = checkScript({ ...expandReadyScript({ ready, settings }), id: `scr_${tag}` }, d);
      if ('error' in checked) throw new Error(checked.error);
      def.scripts = [checked.script];
      m.addDefinition(d, def, registry);
      return def;
    };
    const knight = unit('Knight', 'hero', 6, 'Tactics unit', look);
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

  it('the menu has the keys: the arrows move its choice, nothing else; Esc while picking a square goes back to the menu', () => {
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

describe('the kit looks the way the game says', () => {
  it("the Tactics unit's settings set the menu, the cursor, the numbers and the banner; the menu says what they say", () => {
    const { rt } = board({ menu_color: '#3a2410', menu_border: '#e0b060', menu_size: 18, pointer: '*', cursor_style: 'corners', popup_style: 'pop', banner: 'Round {round}: {team}', move_label: 'March', attack_label: 'Strike', wait_label: 'Rest' });
    step(rt, 0.1);
    const st = rt.kit.style;
    expect([st.menuColor, st.menuBorder, st.menuSize, st.pointer, st.cursorStyle, st.popupStyle]).toEqual(['#3a2410', '#e0b060', 18, '*', 'corners', 'pop']);
    expect(rt.kit.banner?.text).toBe('Round 1: HERO');
    tap(rt, 'interact');
    expect(rt.kit.menu?.items).toEqual(['March', 'Strike', 'Rest']);
    // The menu box is drawn in its colors, the pointer as given; the cursor as four corners.
    const drawn = [...rt.drawings.values()];
    expect(drawn.some((d) => d.color === '#3a2410')).toBe(true);
    expect(drawn.some((d) => d.text === '*')).toBe(true);
    tap(rt, 'interact');
    expect(rt.kit.menu).toBeNull();
    expect(rt.kit.highlights.get('move')).toBeTruthy();
    expect([...rt.drawings.keys()].filter((k) => /c\da$/.test(k)).length).toBe(4);
  });

  it('a style that is not one of the choices is said, and the look stays', () => {
    const { rt } = board({ cursor_style: 'triangle' });
    step(rt, 0.1);
    expect(rt.kit.style.cursorStyle).toBe('square');
    expect(rt.scripts.errors.some((e) => /cursor_style "triangle"/.test(e.message))).toBe(true);
  });
});

describe('the menu box, laid out for the text as it is really drawn', () => {
  /** A board whose one object opens a menu at the start (with a bar behind the item at hand). */
  function menuGame(title: string | null, items: string[]): Runtime {
    let project = createProject(registry, 'Menu', 'topdown');
    const sceneId = project.scenes[0].id;
    project = produce(project, (d) => {
      const def = createDefinition('Rules', { Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }) }, ['rules']);
      const checked = checkScript(
        { id: 'scr_menu', name: 'Menu', description: '', vars: [], states: [], handlers: [{ when: { on: 'start' }, do: [{ do: 'kit_style', menu_selected: '#3a2f6a' }, { do: 'menu', items, title, cancel: false, at: 'center' }] }] },
        d,
      );
      if ('error' in checked) throw new Error(checked.error);
      def.scripts = [checked.script];
      m.addDefinition(d, def, registry);
      d.scenes[0].entities = [];
      m.addEntity(d, sceneId, instantiateDefinition(def, { x: 16, y: 16 }));
    });
    return new Runtime(project, sceneId, registry);
  }
  const items = ['2 Players', 'Vs CPU: Easy', 'Vs CPU: Normal', 'Vs CPU: Master'];
  const kit = (rt: Runtime) => [...rt.drawings.entries()].filter(([k]) => k.includes('m')).map(([k, v]) => ({ id: k.replace(/^.*?(m[a-z]\d*)$/, '$1'), ...v }));
  const get = (rt: Runtime, id: string) => kit(rt).find((d) => d.id === id)!;
  // An 8×8 game on a screen at twice its size: each font pixel 4 px, a letter 12 × 20 px, 16 px to the next.
  const coarse = (size: number) => ({ advance: 16, tall: 20, line: 28, pixel: 4, size });

  it('the bar behind the item at hand is drawn before its text (it was drawn over it, hiding the item)', () => {
    const rt = menuGame('Retro Chess', items);
    step(rt, 0.05);
    const bar = get(rt, 'ms');
    const text = get(rt, 'mt1');
    expect(text.text).toBe('2 Players');
    expect(bar.order).toBeLessThan(text.order);
    expect(get(rt, 'mc').order).toBeGreaterThan(bar.order);
  });

  it('measured as the play screen draws it: lines keep clear of each other, every line is inside the box, the bar holds its line', () => {
    const rt = menuGame('Retro Chess  You play White', items);
    step(rt, 0.05);
    // (Laid out by guess first: 14 px text taken for 9 px a letter; then the play screen says how it draws it.)
    const guessed = get(rt, 'mf').w;
    rt.measureText('8x8@2', coarse);
    const box = get(rt, 'mf');
    const lines = [0, 1, 2, 3, 4].map((n) => get(rt, `mt${n}`));
    expect(box.w).toBeGreaterThan(guessed);
    for (const [n, l] of lines.entries()) {
      // Inside the box, left to right and top to bottom.
      expect(l.x + [...l.text].length * 16, l.text).toBeLessThanOrEqual(box.x + box.w);
      expect(l.y).toBeGreaterThanOrEqual(box.y);
      expect(l.y + 20).toBeLessThanOrEqual(box.y + box.h);
      // Clear of the line above: a letter's height and a gap.
      if (n) expect(l.y - lines[n - 1].y, l.text).toBeGreaterThanOrEqual(20 + 8);
    }
    const bar = get(rt, 'ms');
    expect(bar.y).toBeLessThanOrEqual(lines[1].y);
    expect(bar.y + bar.h).toBeGreaterThanOrEqual(lines[1].y + 20);
    // Everything of the box on the game's pixels (4 px), border and all: the same on all four sides.
    const border = get(rt, 'mb');
    for (const v of [box.x, box.y, box.w, box.h, border.x, border.y, border.w, border.h, bar.y, bar.h]) expect(v % 4).toBe(0);
    expect([box.x - border.x, box.y - border.y, border.w - box.w, border.h - box.h]).toEqual([4, 4, 8, 8]);
    // The same measure again changes nothing; it stays right as the game goes on.
    step(rt, 0.05);
    expect(get(rt, 'mf').w).toBe(box.w);
  });

  it('a title too long for the screen goes on to the next line at a space, and the items follow below it', () => {
    const rt = menuGame('Retro Chess for two players or against the computer at four levels of skill', items);
    rt.screen = { w: 640, h: 400 };
    step(rt, 0.05);
    rt.measureText('8x8@2', coarse);
    const box = get(rt, 'mf');
    expect(box.x).toBeGreaterThanOrEqual(16);
    expect(box.x + box.w).toBeLessThanOrEqual(640 - 16);
    const texts = kit(rt).filter((d) => /^mt\d+$/.test(d.id)).sort((a, b) => a.y - b.y);
    expect(texts.length).toBeGreaterThan(5);
    expect(texts.slice(0, texts.length - 4).map((t) => t.text).join(' ')).toBe('Retro Chess for two players or against the computer at four levels of skill');
    for (const t of texts) expect(t.x + [...t.text].length * 16, t.text).toBeLessThanOrEqual(box.x + box.w);
    expect(texts.at(-4)!.text).toBe('2 Players');
    // (The menu still works as a menu: the second item is chosen with Down and the action key.)
    tap(rt, 'down');
    expect(rt.kit.menu?.index).toBe(1);
    expect(wrapWords('a bb ccc', 4)).toEqual(['a bb', 'ccc']);
    expect(wrapWords('abcdefgh ij', 4)).toEqual(['abcdefgh', 'ij']);
  });
});
