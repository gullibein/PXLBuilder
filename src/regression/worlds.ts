/**
 * Test worlds for measuring capacity (docs §30): made the same every time, of whatever size is asked, from the
 * starters' own objects. Not games: enough of one (walls, a player, things that move) to cost what a game costs.
 */
import { produce } from 'immer';
import type { ComponentRegistry } from '../core/components/registry';
import { projectFromPreset } from '../core/engine/profile';
import { instantiateDefinition } from '../core/model/factory';
import type { ObjectDefinition, Project } from '../core/types';

export type WorldKind = 'city' | 'mine' | 'run';

export interface World {
  name: string;
  kind: WorldKind;
  cols: number;
  rows: number;
  project: Project;
  things: number;
}

const CELL = 32;
const at = (col: number, row: number) => ({ x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 });

/**
 * city: seen from above; a wall all round, blocks of 8 by 6 on a street grid (about a third solid), a wandering
 * enemy every 600 cells (at most 400). mine: from the side; dirt in every cell below row 6 but one shaft, a few
 * walkers on top. run: from the side; ground three deep, a ledge every 16 cells, a walker every 40.
 */
export function makeWorld(kind: WorldKind, cols: number, rows: number, registry: ComponentRegistry): World {
  const base = projectFromPreset(kind === 'city' ? 'topdown' : 'classic-platformer', registry);
  const def = (test: (d: ObjectDefinition) => boolean, what: string): ObjectDefinition => {
    const d = base.definitions.find(test);
    if (!d) throw new Error(`The starter has no ${what}`);
    return d;
  };
  const solid = def((d) => d.name === (kind === 'city' ? 'Wall' : 'Platform'), 'wall or platform');
  const enemy = def((d) => d.tags.includes('enemy'), 'enemy');
  const player = def((d) => !!d.components.CharacterController, 'player');
  const project = produce(base, (d) => {
    const scene = d.scenes[0];
    const list: Project['scenes'][number]['entities'] = [];
    const put = (o: ObjectDefinition, col: number, row: number) => void list.push(instantiateDefinition(o, at(col, row)));
    if (kind === 'city') {
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const edge = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
          const block = (r - 2) % 9 < 6 && (c - 2) % 12 < 8 && r >= 2 && c >= 2 && r < rows - 2 && c < cols - 2;
          if (edge || block) put(solid, c, r);
        }
      // (At a crossing of two streets, three and four cells wide: room to walk, whichever way.)
      put(player, 11, 9);
      const count = Math.min(400, Math.floor((cols * rows) / 600));
      for (let i = 0; i < count; i++) put(enemy, 1 + ((i * 12) % (cols - 2)), 1 + ((Math.floor((i * 12) / (cols - 2)) * 9) % Math.max(1, rows - 2)));
    } else if (kind === 'mine') {
      const shaft = Math.floor(cols / 2);
      for (let r = 6; r < rows; r++) for (let c = 0; c < cols; c++) if (c !== shaft || r === rows - 1) put(solid, c, r);
      put(player, 2, 5);
      for (let c = 8; c < cols - 2; c += 20) put(enemy, c, 5);
    } else {
      for (let c = 0; c < cols; c++) {
        for (let r = rows - 3; r < rows; r++) put(solid, c, r);
        if (c % 16 >= 10 && c % 16 < 14) put(solid, c, rows - 6);
      }
      for (let r = 0; r < rows - 3; r++) {
        put(solid, 0, r);
        put(solid, cols - 1, r);
      }
      put(player, 2, rows - 4);
      for (let c = 20; c < cols - 2; c += 40) put(enemy, c, rows - 4);
    }
    scene.entities = list;
    scene.relationships = [];
    scene.rules = [];
  });
  return { name: `${kind} ${cols} by ${rows}`, kind, cols, rows, project, things: project.scenes[0].entities.length };
}
