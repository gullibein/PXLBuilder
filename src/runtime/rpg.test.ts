import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../core/components/builtin';
import { createDefinition, createLevelFor, createProject, instantiateDefinition } from '../core/model/factory';
import * as m from '../core/model/mutations';
import { checkScript } from '../core/script/language';
import { expandReadyScript } from '../core/script/ready';
import type { Project } from '../core/types';
import { InputState, type Action } from './input';
import { Runtime } from './runtime';

const registry = createBuiltinRegistry();

/** A map (the player and a slime that starts a battle) and a battle level (two heroes, two monsters). */
function rpg(): Project {
  let project = createProject(registry, 'RPG', 'topdown');
  project = produce(project, (d) => {
    const thing = (name: string, tags: string[], hp: number | null, ready: string, settings: Record<string, unknown> = {}) => {
      const def = createDefinition(
        name,
        {
          Sprite: registry.createDefault('Sprite', { width: 32, height: 32 }),
          Collider: registry.createDefault('Collider', { size: { x: 28, y: 28 }, isTrigger: true }),
          ...(hp ? { Health: registry.createDefault('Health', { maxHealth: hp, currentHealth: hp }) } : {}),
        },
        tags,
      );
      const c = checkScript({ ...expandReadyScript({ ready, settings }), id: `scr_${name}` }, d);
      if ('error' in c) throw new Error(`${name}: ${c.error}`);
      def.scripts = [c.script];
      m.addDefinition(d, def, registry);
      return def;
    };
    const slime = thing('Slime', ['encounter'], null, 'RPG encounter');
    const knight = thing('Knight', ['hero'], 20, 'RPG hero', { power: 6 });
    const mage = thing('Mage', ['hero'], 12, 'RPG hero', { power: 2, magic: 9 });
    const imp = thing('Imp', ['monster'], 8, 'RPG monster', { power: 3 });
    const map = d.scenes[0];
    const player = d.definitions.find((x) => x.name === 'Player')!;
    map.entities = [];
    m.addEntity(d, map.id, instantiateDefinition(player, { x: 48, y: 48 }));
    m.addEntity(d, map.id, instantiateDefinition(slime, { x: 112, y: 48 }));
    const battle = createLevelFor(d, 'Battle');
    m.addScene(d, battle);
    for (const [def, x, y] of [
      [knight, 368, 112],
      [mage, 368, 176],
      [imp, 112, 112],
      [imp, 112, 176],
    ] as const)
      m.addEntity(d, battle.id, instantiateDefinition(def, { x, y }));
  });
  return project;
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

describe('RPG: a map, a battle level and back', () => {
  it('touching the slime on the map asks to visit the battle level; won, the slime is gone when the game comes back', () => {
    const project = rpg();
    const map = new Runtime(project, project.scenes[0].id, registry);
    const slime = map.entities.find((e) => e.name === 'Slime')!;
    input.press('right');
    step(map, 1);
    input.release('right');
    expect(map.visitRequest?.level).toBe('Battle');
    // (The play view goes to the battle and back; here, straight back.)
    map.returned('won');
    step(map, 0.1);
    expect(slime.alive).toBe(false);
    expect(map.visitResult).toBe('won');
  });

  it('a battle: each hero gets a menu (Fight, Magic, Potion, Run) and then which monster; the monsters strike back; winning saves the party and goes back', () => {
    const project = rpg();
    const rt = new Runtime(project, project.scenes[1].id, registry);
    step(rt, 0.1);
    const knight = rt.entities.find((e) => e.name === 'Knight')!;
    const imps = rt.entities.filter((e) => e.name === 'Imp');
    expect(rt.kit.team()?.tag).toBe('hero');
    expect(rt.kit.isActing(knight)).toBe(true);
    expect(rt.kit.menu?.title).toBe('Knight  Lv 1   HP 20/20   MP 10/10');
    expect(rt.kit.menu?.items).toEqual(['Fight', 'Magic', 'Potion x3', 'Run']);
    // Fight → which one? The imps by name.
    tap(rt, 'interact');
    expect(rt.kit.menu?.items).toEqual(['Imp', 'Imp']);
    tap(rt, 'interact');
    expect(imps[0].health!.current).toBe(2);
    // The mage: Magic on the first imp (9: gone), MP down.
    tap(rt, 'down');
    tap(rt, 'interact');
    tap(rt, 'interact');
    expect(imps[0].alive).toBe(false);
    // The imp left strikes a hero.
    step(rt, 1);
    const party = rt.entities.filter((e) => e.tags.includes('hero'));
    expect(party.reduce((s, e) => s + e.health!.current, 0)).toBe(32 - 3);
    // Round 2: the knight hits it (8 → 2), the mage finishes it; "Victory!", and after a moment back to the map,
    // the party saved.
    expect(rt.kit.turns?.number).toBe(2);
    tap(rt, 'interact');
    expect(rt.kit.menu?.items).toEqual(['Imp']);
    tap(rt, 'interact');
    expect(imps[1].health!.current).toBe(2);
    tap(rt, 'interact');
    tap(rt, 'interact');
    step(rt, 0.2);
    expect(rt.gameplay.messages.at(-1)?.text).toBe('Victory!  +10 XP  +6 gold');
    step(rt, 2);
    expect(rt.returnRequest?.result).toBe('won');
    expect(rt.kit.turns?.over).toBe(true);
    // (The mage reached level 2 in this battle: more magic, and all of it back.)
    expect(rt.game.get('Mage_mp')).toBe(12);
    expect(rt.game.get('Knight_hp')).toBe(knight.health!.current);
    // The next battle starts the heroes where they left off.
    const next = new Runtime(project, project.scenes[1].id, registry);
    next.game = rt.game;
    step(next, 0.1);
    expect(next.entities.find((e) => e.name === 'Knight')!.health!.current).toBe(knight.health!.current);
  });
});

describe('the RPG starter', () => {
  it('has a map with the hero and slimes, and a battle level with the party and monsters, all scripts checking out', async () => {
    const { createRpgProject } = await import('../core/model/rpgStarter');
    const project = createRpgProject(registry);
    expect(project.scenes.map((s) => s.name)).toEqual(['Overworld', 'Battle']);
    const map = new Runtime(project, project.scenes[0].id, registry);
    step(map, 0.1);
    expect(map.scripts.errors).toEqual([]);
    expect(map.entities.filter((e) => e.name === 'Wild Slime').length).toBe(3);
    expect([...map.drawings.values()].some((d) => d.text.startsWith('Knight Lv1 24/24   Mage Lv1 16/16   Gold 0   Potions 3'))).toBe(true);
    const battle = new Runtime(project, project.scenes[1].id, registry);
    step(battle, 0.1);
    expect(battle.scripts.errors).toEqual([]);
    expect(battle.kit.menu?.title).toBe('Knight  Lv 1   HP 24/24   MP 6/6');
    expect(battle.kit.menu?.items).toEqual(['Fight', 'Magic', 'Potion x3', 'Run']);
  });
});

describe('the RPG starter, played', () => {
  it("walking into a wild slime on the map asks for the battle", async () => {
    const { createRpgProject } = await import('../core/model/rpgStarter');
    const project = createRpgProject(registry);
    const map = new Runtime(project, project.scenes[0].id, registry);
    const player = map.entities.find((e) => e.controller)!;
    const slime = map.entities.find((e) => e.name === 'Wild Slime')!;
    // (Put next to it, to keep the test short.)
    player.x = slime.x - 40;
    player.y = slime.y;
    input.press('right');
    for (let i = 0; i < 240 && !map.visitRequest; i++) map.update(1 / 120, input);
    input.release('right');
    expect(map.visitRequest?.level).toBe('Battle');
  });
});

describe('RPG: experience, levels and gold', () => {
  it('beaten monsters give experience and gold; enough experience levels a hero up (stronger, more health), kept for the next battle', () => {
    const project = rpg();
    const rt = new Runtime(project, project.scenes[1].id, registry);
    // The knight is one blow from level 2 (needs 10): one imp gives 5.
    rt.game.set('Knight_xp', 7);
    step(rt, 0.1);
    const knight = rt.entities.find((e) => e.name === 'Knight')!;
    const imps = rt.entities.filter((e) => e.name === 'Imp');
    // Quick win: both imps down to 1 health, the knight and the mage finish them.
    for (const imp of imps) imp.health!.current = 1;
    tap(rt, 'interact');
    tap(rt, 'interact');
    tap(rt, 'interact');
    tap(rt, 'interact');
    step(rt, 0.2);
    expect(rt.gameplay.messages.at(-1)?.text).toBe('Victory!  +10 XP  +6 gold');
    expect(rt.game.get('gold')).toBe(6);
    // Level 2: 7 + 10 = 17, 10 for the level, 7 left; +4 max health (20 → 24), +1 power (6 → 7).
    expect(rt.game.get('Knight_level')).toBe(2);
    expect(rt.game.get('Knight_xp')).toBe(7);
    expect(rt.game.get('Knight_max_hp')).toBe(24);
    expect(rt.game.get('Knight_power')).toBe(7);
    expect(knight.health!.max).toBe(24);
    expect(rt.kit.popups.some((p) => p.text === 'Level up!')).toBe(true);
    // The mage got 10 too (level 1 → 2 needs 10).
    expect(rt.game.get('Mage_level')).toBe(2);
    // Next battle: the knight is level 2 there.
    const next = new Runtime(project, project.scenes[1].id, registry);
    next.game = rt.game;
    step(next, 0.1);
    expect(next.kit.menu?.title).toMatch(/^Knight {2}Lv 2 {3}HP \d+\/24/);
  });

  it("the shop sells potions for gold; without enough gold they can't be chosen", async () => {
    const { createRpgProject } = await import('../core/model/rpgStarter');
    const project = createRpgProject(registry);
    const map = new Runtime(project, project.scenes[0].id, registry);
    map.game.set('gold', 12);
    map.game.set('potions', 1);
    const player = map.entities.find((e) => e.controller)!;
    const shop = map.entities.find((e) => e.name === 'Merchant')!;
    player.x = shop.x;
    player.y = shop.y + 40;
    input.press('up');
    for (let i = 0; i < 120 && !map.kit.menu; i++) map.update(1 / 120, input);
    input.release('up');
    expect(map.kit.menu?.title).toBe('Merchant: you have 12 gold');
    expect(map.kit.menu?.items).toEqual(['Potion (5 gold)', 'Leave']);
    tap(map, 'interact');
    tap(map, 'interact');
    expect(map.game.get('gold')).toBe(2);
    expect(map.game.get('potions')).toBe(3);
    expect(map.kit.menu?.items).toEqual(['-Potion (5 gold)', 'Leave']);
    tap(map, 'interact');
    expect(map.kit.menu).toBeNull();
  });
});
