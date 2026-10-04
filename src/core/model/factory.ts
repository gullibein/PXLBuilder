import type { ComponentRegistry } from '../components/registry';
import { generateId } from '../ids';
import { FORMAT_VERSION } from '../serialization/version';
import type { ComponentMap, EntityInstance, ObjectDefinition, Project, Scene, Transform, Vec2 } from '../types';

export function createTransform(position: Vec2 = { x: 0, y: 0 }): Transform {
  return { position: { ...position }, rotation: 0, scale: { x: 1, y: 1 } };
}

export function createScene(name: string): Scene {
  return {
    id: generateId('scn'),
    name,
    world: { gravity: { x: 0, y: 980 }, backgroundColor: '#1d2330' },
    entities: [],
  };
}

export function createDefinition(name: string, components: ComponentMap = {}, tags: string[] = [], description = ''): ObjectDefinition {
  return { id: generateId('def'), name, description, components, tags, metadata: {} };
}

/** Creates a scene instance of a definition. The instance starts with no overrides. */
export function instantiateDefinition(def: ObjectDefinition, position: Vec2, name = def.name): EntityInstance {
  return {
    id: generateId('ent'),
    name,
    definitionId: def.id,
    transform: createTransform(position),
    components: {},
    removedComponents: [],
    tags: [],
    metadata: {},
  };
}

/** Creates an entity that is not linked to any definition. */
export function createStandaloneEntity(name: string, position: Vec2, components: ComponentMap = {}): EntityInstance {
  return {
    id: generateId('ent'),
    name,
    definitionId: null,
    transform: createTransform(position),
    components,
    removedComponents: [],
    tags: [],
    metadata: {},
  };
}

/**
 * Starter object definitions. These are ordinary data built from generic
 * components; the engine has no special knowledge of "Player" or "Enemy".
 */
export function createStarterDefinitions(registry: ComponentRegistry): ObjectDefinition[] {
  const c = (type: string, props: Record<string, unknown> = {}) => registry.createDefault(type, props);
  return [
    createDefinition(
      'Player',
      {
        Sprite: c('Sprite', { width: 28, height: 40, color: '#4fa3ff' }),
        Collider: c('Collider', { size: { x: 28, y: 40 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'dynamic' }),
        CharacterController: c('CharacterController'),
        CameraTarget: c('CameraTarget'),
      },
      ['player'],
      'The player-controlled character.',
    ),
    createDefinition(
      'Platform',
      {
        Sprite: c('Sprite', { width: 160, height: 24, color: '#6b7a8f' }),
        Collider: c('Collider', { size: { x: 160, y: 24 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'static' }),
      },
      ['platform'],
      'Solid, static ground.',
    ),
    createDefinition(
      'Enemy',
      {
        Sprite: c('Sprite', { width: 30, height: 30, color: '#e5534b' }),
        Collider: c('Collider', { size: { x: 30, y: 30 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'dynamic' }),
        Damage: c('Damage', { amount: 1 }),
      },
      ['enemy'],
      'A basic enemy that hurts on contact.',
    ),
    createDefinition(
      'Coin',
      {
        Sprite: c('Sprite', { width: 16, height: 16, color: '#f2c94c' }),
        Collider: c('Collider', { shape: 'circle', size: { x: 16, y: 16 }, isTrigger: true }),
        Collectible: c('Collectible', { collectionBehavior: 'consume', itemId: 'coin' }),
      },
      ['collectible'],
      'A collectible coin.',
    ),
    createDefinition(
      'Door',
      {
        Sprite: c('Sprite', { width: 32, height: 64, color: '#9b6a3c' }),
        Collider: c('Collider', { size: { x: 32, y: 64 } }),
        PhysicsBody: c('PhysicsBody', { bodyType: 'static' }),
      },
      ['door'],
      'A door that blocks the way.',
    ),
    createDefinition(
      'Hazard',
      {
        Sprite: c('Sprite', { width: 64, height: 16, color: '#ff6b2c' }),
        Collider: c('Collider', { size: { x: 64, y: 16 }, isTrigger: true }),
        Damage: c('Damage', { amount: 1 }),
      },
      ['hazard'],
      'Damages anything that touches it.',
    ),
  ];
}

/** A new, empty project with starter definitions and one empty scene. */
export function createProject(registry: ComponentRegistry, name = 'Untitled Game'): Project {
  const scene = createScene('Level 1');
  return {
    formatVersion: FORMAT_VERSION,
    id: generateId('prj'),
    name,
    settings: { gridSize: 16 },
    startSceneId: scene.id,
    scenes: [scene],
    definitions: createStarterDefinitions(registry),
    assets: [],
  };
}
