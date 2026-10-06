import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createBuiltinRegistry } from './components/builtin';
import { createDefinition, createProject, instantiateDefinition } from './model/factory';
import * as m from './model/mutations';
import { resolveEntity } from './model/resolve';

const registry = createBuiltinRegistry();

/** A project whose starter objects were edited, with a placed, tweaked Player and a custom object. */
function edited() {
  let project = createProject(registry);
  const sceneId = project.scenes[0].id;
  const player = project.definitions.find((d) => d.name === 'Player')!;
  const placed = instantiateDefinition(player, { x: 10, y: 20 }, 'Hero');
  const custom = createDefinition('Robot', { Sprite: registry.createDefault('Sprite') });
  project = produce(project, (d) => {
    m.setDefinitionComponentField(d, player.id, 'CharacterController', 'jumpForce', 900, registry);
    m.setDefinitionComponentField(d, player.id, 'Sprite', 'height', 64, registry);
    m.renameDefinition(d, player.id, 'Knight');
    m.addDefinitionComponent(d, player.id, 'Damage', registry);
    m.addEntity(d, sceneId, placed);
    m.setEntityComponentField(d, sceneId, placed.id, 'CharacterController', 'speed', 50, registry);
    m.addDefinition(d, custom, registry);
    m.setDefinitionComponentField(d, custom.id, 'Sprite', 'color', '#123456', registry);
    m.deleteDefinition(d, d.definitions.find((x) => x.name === 'Coin')!.id, registry);
  });
  return { project, sceneId, playerId: player.id, placedId: placed.id, customId: custom.id };
}

describe('resetting objects to defaults', () => {
  it('resets every starter object, keeps the level, leaves custom objects alone', () => {
    const { project, sceneId, playerId, placedId, customId } = edited();
    let counts!: { reset: number; added: number };
    const p = produce(project, (d) => {
      counts = m.resetAllStarterDefinitions(d, registry);
    });
    const fresh = createProject(registry);
    const player = p.definitions.find((d) => d.id === playerId)!;
    expect(player.name).toBe('Player');
    const freshPlayer = fresh.definitions.find((d) => d.name === 'Player')!.components;
    // Same components; its picture is the project's own copy (reused, so its id differs from a new project's).
    expect({ ...player.components, Sprite: { ...player.components.Sprite, assetId: null } }).toEqual({ ...freshPlayer, Sprite: { ...freshPlayer.Sprite, assetId: null } });
    expect(p.assets.find((a) => a.id === player.components.Sprite.assetId)?.name).toBe('Player');
    expect(player.components.CharacterController.jumpForce).toBe(295);
    // The placed copy stays (same place, same name) but loses its own tweaks.
    const hero = m.getEntity(p, sceneId, placedId);
    expect(hero.transform.position).toEqual({ x: 10, y: 20 });
    expect(hero.name).toBe('Hero');
    expect(resolveEntity(p, hero, registry).components.CharacterController.speed).toBe(200);
    // The deleted Coin comes back; the custom Robot is untouched.
    expect(p.definitions.some((d) => d.name === 'Coin')).toBe(true);
    expect(p.definitions.find((d) => d.id === customId)!.components.Sprite.color).toBe('#123456');
    expect(counts.added).toBe(1);
    expect(counts.reset).toBe(fresh.definitions.length - 1);
    // The Ladder's picture is reused, not duplicated.
    expect(p.assets.filter((a) => a.name === 'Ladder')).toHaveLength(1);
    expect(p.assets.filter((a) => a.name === 'Player')).toHaveLength(1);
  });

  it('resets a single starter object', () => {
    const { project, playerId } = edited();
    const p = produce(project, (d) => m.resetStarterDefinition(d, playerId, registry));
    expect(p.definitions.find((d) => d.id === playerId)!.components.Sprite.height).toBe(32);
  });

  it('refuses objects that have no default', () => {
    const { project, customId } = edited();
    expect(() => produce(project, (d) => m.resetStarterDefinition(d, customId, registry))).toThrow(/not a built-in object/);
  });
});
