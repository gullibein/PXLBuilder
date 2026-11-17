/**
 * Turn-based games of the regression suite: a tactics board (the ready-made Tactics unit and Tactics enemy: picked
 * with the cursor, a menu, a walk, an attack, the enemy's answer), an RPG (a map explored in real time, a slime
 * that starts a battle in turns on its own level, and back), and the roguelike starter (a step at a time, the world
 * answering each).
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../../core/components/registry';
import { createDefinition, createLevelFor, createProject, instantiateDefinition } from '../../core/model/factory';
import * as m from '../../core/model/mutations';
import { checkScript } from '../../core/script/language';
import { expandReadyScript } from '../../core/script/ready';
import { projectFromPreset } from '../../core/engine/profile';
import type { ObjectDefinition, Project } from '../../core/types';
import type { Runtime } from '../../runtime/runtime';

function unit(d: Project, registry: ComponentRegistry, name: string, tags: string[], hp: number | null, ready: string, settings: Record<string, unknown> = {}): ObjectDefinition {
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
}

/** A tactics board seen from above: a knight and an archer (the player's), two goblins; walls between. `stored`: on a game with a stored profile (the top-down preset), else one worked out. */
export function tacticsBoard(registry: ComponentRegistry, stored = false): Project {
  const base = stored ? projectFromPreset('topdown', registry, 'Tactics') : createProject(registry, 'Tactics', 'topdown');
  return produce(base, (d) => {
    const sceneId = d.scenes[0].id;
    const knight = unit(d, registry, 'Knight', ['hero'], 6, 'Tactics unit');
    const archer = unit(d, registry, 'Archer', ['hero'], 4, 'Tactics unit', { reach: 3, power: 2, move: 3 });
    const goblin = unit(d, registry, 'Goblin', ['enemy'], 4, 'Tactics enemy');
    const wall = d.definitions.find((x) => x.name === 'Wall')!;
    d.scenes[0].entities = [];
    m.addEntity(d, sceneId, instantiateDefinition(knight, { x: 80, y: 80 }));
    m.addEntity(d, sceneId, instantiateDefinition(archer, { x: 80, y: 144 }));
    m.addEntity(d, sceneId, instantiateDefinition(goblin, { x: 208, y: 80 }));
    m.addEntity(d, sceneId, instantiateDefinition(goblin, { x: 272, y: 144 }));
    for (const x of [144, 176]) m.addEntity(d, sceneId, instantiateDefinition(wall, { x, y: 112 }));
  });
}

/** An RPG: a map (the player, a slime that starts a battle) and a battle level (two heroes, two imps). */
export function rpgGame(registry: ComponentRegistry, stored = false): Project {
  const base = stored ? projectFromPreset('topdown', registry, 'RPG') : createProject(registry, 'RPG', 'topdown');
  return produce(base, (d) => {
    const slime = unit(d, registry, 'Slime', ['encounter'], null, 'RPG encounter');
    const knight = unit(d, registry, 'Knight', ['hero'], 20, 'RPG hero', { power: 6 });
    const mage = unit(d, registry, 'Mage', ['hero'], 12, 'RPG hero', { power: 2, magic: 9 });
    const imp = unit(d, registry, 'Imp', ['monster'], 8, 'RPG monster', { power: 3 });
    const map = d.scenes[0];
    const player = d.definitions.find((x) => x.components.CharacterController)!;
    const enemy = d.definitions.find((x) => x.name === 'Enemy');
    map.entities = [];
    m.addEntity(d, map.id, instantiateDefinition(player, { x: 48, y: 48 }));
    m.addEntity(d, map.id, instantiateDefinition(slime, { x: 240, y: 48 }));
    // (Something that moves by itself on the map, in real time: the starter's wandering enemy, out of the way.)
    if (enemy) m.addEntity(d, map.id, instantiateDefinition(enemy, { x: 48, y: 240 }));
    const battle = createLevelFor(d, 'Battle');
    m.addScene(d, battle);
    for (const [def, x, y] of [[knight, 368, 112], [mage, 368, 176], [imp, 112, 112], [imp, 112, 176]] as const) m.addEntity(d, battle.id, instantiateDefinition(def, { x, y }));
  });
}

/** What a turn-based game is doing now (for traces): who is where and how well, whose turn, the menu, the cursor, the game's variables. */
export function turnState(rt: Runtime) {
  return [
    rt.entities.filter((e) => e.health || e.controller).map((e) => [e.name, Math.round(e.x), Math.round(e.y), e.health?.current ?? null, e.alive ? 1 : 0]),
    rt.kit.team()?.tag ?? '',
    rt.kit.turns?.number ?? 0,
    rt.kit.turns?.acting?.name ?? '',
    rt.kit.turns?.over ? 1 : 0,
    rt.kit.menu ? [rt.kit.menu.title, rt.kit.menu.items, rt.kit.menu.index] : null,
    rt.kit.cursorAt(),
    [...rt.game.entries()].sort(),
    rt.visitRequest?.level ?? '',
    rt.returnRequest?.result ?? '',
    rt.gameplay.messages.at(-1)?.text ?? '',
  ];
}
