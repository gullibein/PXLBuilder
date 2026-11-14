import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { playerLimits } from './limits';
import { findRoles } from './roles';

const registry = createBuiltinRegistry();
const limits = (jumpForce: number, difficulty: number, speed = 200) => {
  const p = produce(createProject(registry), (d) => {
    const cc = d.definitions.find((x) => x.name === 'Player')!.components.CharacterController!;
    cc.jumpForce = jumpForce;
    cc.speed = speed;
  });
  return playerLimits(p, p.scenes[0].id, findRoles(p, registry).player!.id, registry, difficulty)!;
};

describe("the player's reach in cells, for building levels", () => {
  it("the starter player: the checker's numbers at the hardest, a cell or so less on easy levels", () => {
    const hard = limits(350, 5);
    expect([hard.maxRise, hard.gap(0), hard.gap(1), hard.springRows, hard.spikeCells]).toEqual([1, 4, 3, 4, 2]);
    const easy = limits(350, 1);
    expect([easy.gap(0), easy.gap(1), easy.springRows, easy.spikeCells, easy.ladderGapRows]).toEqual([2, 1, 3, 1, 0]);
    // (Far below: as the lowest drop the table lists, never 0.)
    expect(hard.gap(-20)).toBe(hard.gap(-6));
    // Higher than it jumps: no gap at all.
    expect(hard.gap(hard.maxRise + 1)).toBe(0);
  });

  it('a higher, faster jump reaches further: the limits grow with it (and shrink for a weaker one)', () => {
    const strong = limits(500, 5, 300);
    const weak = limits(260, 5, 150);
    const base = limits(350, 5);
    expect(strong.maxRise).toBeGreaterThan(base.maxRise);
    expect(strong.gap(0)).toBeGreaterThan(base.gap(0));
    expect(weak.gap(0)).toBeLessThan(base.gap(0));
  });

  it('no player that jumps (no gravity): no limits', () => {
    const p = produce(createProject(registry), (d) => void (d.scenes[0].world.gravity.y = 0));
    expect(playerLimits(p, p.scenes[0].id, findRoles(p, registry).player!.id, registry, 3)).toBeNull();
  });
});
