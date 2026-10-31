import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from '../components/builtin';
import { createProject } from '../model/factory';
import { applyOperations, checkOperations, type Operation } from './operations';

const registry = createBuiltinRegistry();

describe("a Shooter's projectile", () => {
  it('can name a shot object made earlier in the same answer (its ref), or by name; an unknown one is said plainly', () => {
    const project = createProject(registry, 'T', 'topdown');
    const player = project.definitions.find((d) => d.name === 'Player')!;
    const ops = [
      { op: 'create_definition', ref: 'bolt', name: 'Laser Bolt', description: '', category: 'Items', tags: [], components: [{ component: 'Sprite', propsJson: '{"width":16,"height":6}' }] },
      { op: 'add_component', target: 'definition', id: player.id, component: 'Shooter', propsJson: '{"trigger":"key","projectile":"bolt"}' },
    ] as unknown as Operation[];
    const after = produce(project, (d) => {
      applyOperations(d, ops, registry);
    });
    const bolt = after.definitions.find((d) => d.name === 'Laser Bolt')!;
    expect(after.definitions.find((d) => d.id === player.id)!.components.Shooter.projectile).toBe(bolt.id);
    const byName = { op: 'set_component_field', target: 'definition', id: player.id, component: 'Shooter', field: 'projectile', valueJson: '"laser bolt"' } as unknown as Operation;
    expect(checkOperations(after, [byName], registry)).toBeNull();
    const unknown = { ...byName, valueJson: '"plasma"' } as Operation;
    expect(checkOperations(after, [unknown], registry)).toMatch(/no such library object/);
  });
});
