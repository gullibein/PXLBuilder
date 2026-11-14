import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { applyOperations } from '../commands/operations';
import { createProject } from '../model/factory';
import { levelReachability, winProblems } from '../model/reachability';
import { resolveEntity } from '../model/resolve';
import { GridError, LevelGrid } from './grid';
import { findRoles } from './roles';

const registry = createBuiltinRegistry();

/** A small level in the grid: floor with a gap, a pipe, a door, an enemy, coins, a teleporter pair, a moving ledge. */
function small() {
  const project = createProject(registry);
  const roles = findRoles(project, registry);
  const g = new LevelGrid(20, 8, roles);
  g.fill('ground', 0, 7, 19, 7);
  g.clear(8, 7, 9, 7);
  g.put('player', 1, 6);
  g.put('pipeTop', 4, 6);
  g.put('door', 15, 6);
  g.put('enemy', 12, 6);
  g.put('coin', 8, 5);
  g.put('coin', 9, 5);
  g.put('goal', 18, 6);
  g.place({ role: 'teleporter', col: 2, row: 6, ref: 'tpA' });
  g.place({ role: 'teleporter', col: 17, row: 6, ref: 'tpB' });
  g.link({ type: 'teleports_to', from: 'tpA', to: 'tpB' });
  g.place({ role: 'ledge', col: 6, row: 3, ref: 'lift', path: { to: { x: 4, y: 0 } } });
  return { project, roles, g };
}

describe('the grid a level is built in', () => {
  it('as text: one character per cell; objects bigger than a cell fill all their cells', () => {
    const { g } = small();
    expect(g.rows()).toEqual([
      '....................',
      '....................',
      '....................',
      '....................',
      '....................',
      '........oo.....D....',
      '.P..UU......E..D..G.',
      '########..##########',
    ]);
  });

  it('refuses what does not fit: taken cells, past the edge, a part the game has no object for, unknown link refs', () => {
    const { g } = small();
    expect(() => g.put('crate', 4, 6)).toThrow(GridError);
    expect(() => g.put('pipeTop', 19, 3)).toThrow(/past the edge/);
    expect(() => g.put('lava', 3, 3)).toThrow(/no object for "lava"/);
    expect(() => g.link({ type: 'teleports_to', from: 'tpA', to: 'nowhere' })).toThrow(GridError);
    expect(g.fits('crate', 3, 6)).toBe(true);
    expect(g.fits('door', 3, 0)).toBe(false);
  });

  it('written out as ordinary operations: the level has the same objects, one per object (not per cell), linked, moving, and can be won', () => {
    const { project, g } = small();
    const sceneId = project.scenes[0].id;
    const ops = g.toOperations(sceneId);
    expect(ops[0].op).toBe('draw_map');
    const after = produce(project, (d) => void applyOperations(d, ops, registry));
    const scene = after.scenes[0];
    const count = (name: string) => scene.entities.filter((e) => resolveEntity(after, e, registry).name === name).length;
    expect([count('Platform'), count('Pipe top'), count('Door'), count('Enemy'), count('Coin'), count('Goal'), count('Teleporter'), count('Player')]).toEqual([18, 1, 1, 1, 2, 1, 2, 1]);
    expect(scene.relationships.map((r) => r.type)).toEqual(['teleports_to']);
    const lift = scene.entities.find((e) => resolveEntity(after, e, registry).components.MovingPlatform)!;
    expect(resolveEntity(after, lift, registry).components.MovingPlatform!.offset).toEqual({ x: 128, y: 0 });
    // The player stands where the map put it (bottom of its cell on the floor).
    const player = scene.entities.find((e) => resolveEntity(after, e, registry).components.CharacterController)!;
    expect(player.transform.position).toEqual({ x: 48, y: 208 });
    expect(winProblems(after, sceneId, registry)).toEqual([]);
    expect(levelReachability(after, sceneId, registry).status).not.toBe('unreachable');
  });
});
