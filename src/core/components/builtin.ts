import { ComponentRegistry } from './registry';
import type { ComponentDefinition } from './schema';

/**
 * Built-in component types. Components hold state only; logic lives in
 * behaviors/systems (added in later phases).
 */
export const BUILTIN_COMPONENTS: ComponentDefinition[] = [
  {
    type: 'Sprite',
    label: 'Sprite',
    description: 'Visual representation. Draws the referenced image asset, or a solid rectangle in `color` if no asset is set.',
    category: 'Rendering',
    fields: {
      assetId: { kind: 'assetRef', assetKind: 'image', default: null, description: 'Image asset to draw' },
      width: { kind: 'number', default: 32, min: 0, step: 1, description: 'Width in pixels' },
      height: { kind: 'number', default: 32, min: 0, step: 1, description: 'Height in pixels' },
      color: { kind: 'color', default: '#cccccc', description: 'Fill color used when no asset is set' },
      visible: { kind: 'boolean', default: true },
    },
  },
  {
    type: 'Collider',
    label: 'Collider',
    description: 'Collision shape. A trigger detects overlaps without blocking movement.',
    category: 'Physics',
    fields: {
      shape: { kind: 'enum', options: ['box', 'circle'], default: 'box' },
      size: { kind: 'vec2', default: { x: 32, y: 32 }, description: 'Box size, or circle diameter in x' },
      offset: { kind: 'vec2', default: { x: 0, y: 0 }, description: 'Offset from the entity position' },
      isTrigger: { kind: 'boolean', default: false },
    },
  },
  {
    type: 'PhysicsBody',
    label: 'Physics Body',
    description: 'Participates in physics simulation. Static bodies never move; dynamic bodies are moved by forces and gravity; kinematic bodies are moved by logic only.',
    category: 'Physics',
    fields: {
      bodyType: { kind: 'enum', options: ['dynamic', 'static', 'kinematic'], default: 'dynamic' },
      mass: { kind: 'number', default: 1, min: 0, step: 0.1 },
      velocity: { kind: 'vec2', default: { x: 0, y: 0 }, description: 'Initial velocity in pixels/second' },
      gravityScale: { kind: 'number', default: 1, step: 0.1, description: 'Multiplier on world gravity' },
      friction: { kind: 'number', default: 0.2, min: 0, max: 1, step: 0.05 },
    },
  },
  {
    type: 'CharacterController',
    label: 'Character Controller',
    description: 'Player-style movement parameters (run and jump).',
    category: 'Movement',
    fields: {
      speed: { kind: 'number', default: 200, min: 0, step: 10, description: 'Max horizontal speed (px/s)' },
      acceleration: { kind: 'number', default: 1500, min: 0, step: 50, description: 'Horizontal acceleration (px/s²)' },
      jumpForce: { kind: 'number', default: 450, min: 0, step: 10, description: 'Initial jump velocity (px/s)' },
      airControl: { kind: 'number', default: 0.6, min: 0, max: 1, step: 0.05, description: 'Fraction of control while airborne' },
    },
  },
  {
    type: 'Health',
    label: 'Health',
    description: 'Hit points.',
    category: 'Gameplay',
    fields: {
      maxHealth: { kind: 'number', default: 3, min: 1, step: 1, integer: true },
      currentHealth: { kind: 'number', default: 3, min: 0, step: 1, integer: true },
    },
  },
  {
    type: 'DamageReceiver',
    label: 'Damage Receiver',
    description: 'Can receive damage from entities carrying any of the listed tags.',
    category: 'Gameplay',
    fields: {
      damageSources: { kind: 'stringList', default: ['hazard', 'enemy'], description: 'Tags of entities that can deal damage' },
      invincibilityDuration: { kind: 'number', default: 1, min: 0, step: 0.1, description: 'Seconds of invincibility after a hit' },
    },
  },
  {
    type: 'Damage',
    label: 'Damage',
    description: 'Deals damage on contact.',
    category: 'Gameplay',
    fields: {
      amount: { kind: 'number', default: 1, min: 0, step: 1 },
    },
  },
  {
    type: 'Inventory',
    label: 'Inventory',
    description: 'Items held by the entity.',
    category: 'Gameplay',
    fields: {
      items: { kind: 'stringList', default: [] },
    },
  },
  {
    type: 'Collectible',
    label: 'Collectible',
    description: 'Can be picked up by an entity with an Inventory.',
    category: 'Gameplay',
    fields: {
      collectionBehavior: { kind: 'enum', options: ['addToInventory', 'consume'], default: 'consume' },
      itemId: { kind: 'string', default: '', description: 'Item name added to the collector inventory' },
    },
  },
  {
    type: 'CameraTarget',
    label: 'Camera Target',
    description: 'The camera follows this entity during play.',
    category: 'Camera',
    fields: {
      followStrength: { kind: 'number', default: 0.15, min: 0, max: 1, step: 0.05 },
    },
  },
];

export function createBuiltinRegistry(): ComponentRegistry {
  const registry = new ComponentRegistry();
  for (const def of BUILTIN_COMPONENTS) registry.register(def);
  return registry;
}

/** Shared default registry used by the editor. */
export const componentRegistry = createBuiltinRegistry();
