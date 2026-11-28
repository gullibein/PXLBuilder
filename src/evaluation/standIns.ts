/**
 * Games standing in for a model's answers, one a case: the regression suite's games (made as the AI's own guidance
 * makes them) and the six builds a model really made (docs/builds). They are what the cases' checks are proven on
 * before any model is asked: a stand-in that is a sound game of its kind must not fail, and a broken variant of it
 * must. For tests only (it reads files).
 */
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import type { ComponentRegistry } from '../core/components/registry';
import { projectFromPreset } from '../core/engine/profile';
import { addRelationship } from '../core/logic/mutations';
import { instantiateDefinition } from '../core/model/factory';
import { gameFromText } from '../core/serialization/serialize';
import type { Project } from '../core/types';
import { boulderDash, mining, spaceShooter } from '../regression/games/action';
import { drMario, tetris } from '../regression/games/boards';
import { marioLevel } from '../regression/games/platformers';
import { rpgGame, tacticsBoard } from '../regression/games/turnBased';
import { gameWithABrokenBridge } from './cases';

/** A build a model made, as saved (docs/builds). */
export function savedBuild(name: string, registry: ComponentRegistry): Project {
  return gameFromText(readFileSync(`docs/builds/${name}.pxlproj.json`, 'utf8'), registry).project;
}

/** A second level like the first (new ids), so "the next level starts" can be seen. */
function withSecondLevel(project: Project): Project {
  return produce(project, (d) => {
    const first = d.scenes[0];
    const copy = JSON.parse(JSON.stringify(first)) as typeof first;
    copy.id = `${first.id}_2`;
    copy.name = 'Level 2';
    copy.entities.forEach((e, i) => void (e.id = `${e.id}_b${i}`));
    d.scenes.push(copy);
  });
}

/** The top-down starter with a key, a locked door, a wanderer and a goal in a walled room. */
function adventure(registry: ComponentRegistry): Project {
  return produce(projectFromPreset('topdown', registry, 'Adventure'), (d) => {
    const def = (name: string) => {
      const o = d.definitions.find((x) => x.name === name);
      if (!o) throw new Error(`The top-down starter has no ${name} (it has ${d.definitions.map((x) => x.name).join(', ')})`);
      return o;
    };
    const at = (col: number, row: number) => ({ x: col * 32 + 16, y: row * 32 + 16 });
    const list = [];
    for (let c = 0; c < 16; c++) for (let r = 0; r < 9; r++) if (c === 0 || c === 15 || r === 0 || r === 8 || (c === 9 && r !== 4)) list.push(instantiateDefinition(def('Wall'), at(c, r)));
    const door = instantiateDefinition(def('Door'), at(9, 4));
    list.push(door, instantiateDefinition(def('Key'), at(3, 6)), instantiateDefinition(def('Player'), at(3, 3)), instantiateDefinition(def('Enemy'), at(6, 5)), instantiateDefinition(def('Goal'), at(13, 4)));
    d.scenes[0].entities = list;
    addRelationship(d, d.scenes[0].id, { type: 'requires', source: { kind: 'entity', id: door.id }, target: { kind: 'object', id: def('Key').id }, params: { consume: true }, conditions: [] });
  });
}

export const STAND_INS: Record<string, { from: string; make: (registry: ComponentRegistry) => Project }> = {
  platformer: { from: 'the level builder\'s platformer, with a second level', make: (r) => withSecondLevel(marioLevel(r, 3).project) },
  precision: { from: 'the saved dash and wall-jump build', make: (r) => savedBuild('dash-platformer.with-history', r) },
  adventure: { from: 'the top-down starter with a key, a door and a wanderer', make: adventure },
  'falling-blocks': { from: 'the regression falling-block game', make: (r) => tetris(r) },
  'falling-pairs': { from: 'the regression falling-pairs game', make: (r) => drMario(r, [{ col: 2, row: 14, color: 'red' }, { col: 5, row: 12, color: 'blue' }]) },
  shooter: { from: 'the regression space shooter', make: spaceShooter },
  mining: { from: 'the regression mining game', make: mining },
  boulders: { from: 'the regression boulder game', make: boulderDash },
  chess: { from: 'the saved chess build', make: (r) => savedBuild('chess', r) },
  'tic-tac-toe': { from: 'the saved tic-tac-toe build', make: (r) => savedBuild('tic-tac-toe', r) },
  tactics: { from: 'the regression tactics board', make: (r) => tacticsBoard(r) },
  rpg: { from: 'the regression role-playing game', make: (r) => rpgGame(r) },
  roguelike: { from: 'the roguelike starter', make: (r) => projectFromPreset('roguelike', r, 'Roguelike') },
  isometric: { from: 'the isometric starter', make: (r) => projectFromPreset('isometric', r, 'Isometric') },
  city: { from: 'the saved crime-city build', make: (r) => savedBuild('crime-city.with-history', r) },
  edits: { from: 'the bridge game, as given (not yet edited)', make: gameWithABrokenBridge },
  pinball: { from: 'the saved pinball build', make: (r) => savedBuild('pinball.with-history', r) },
  'cards-en': { from: 'the saved card-game build (asked in Icelandic)', make: (r) => savedBuild('card-game.with-history', r) },
  'cards-is': { from: 'the saved card-game build', make: (r) => savedBuild('card-game.with-history', r) },
};
