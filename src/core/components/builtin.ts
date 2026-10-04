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
      assetId: { kind: 'assetRef', assetKind: 'image', default: null, description: 'Image or sprite sheet to draw, stretched to width x height' },
      frame: { kind: 'number', default: 1, min: 1, step: 1, integer: true, description: 'Cell number when the image is a sprite sheet (1 = top-left, counting across rows)' },
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
      matchSprite: { kind: 'boolean', default: true, description: 'Keep the collider the same size as the sprite (changing either changes both)' },
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
      jumpForce: { kind: 'number', default: 295, min: 0, step: 5, description: 'Initial jump speed (px/s). Jump height ≈ jumpForce² / (2 × gravity): 295 at gravity 980 is about 1.4 tiles, enough to reach the next row up' },
      airControl: { kind: 'number', default: 0.6, min: 0, max: 1, step: 0.05, description: 'Fraction of control while airborne' },
    },
  },
  {
    type: 'Health',
    label: 'Health',
    description: 'Hit points. During play, damage lowers currentHealth; at 0 the entity dies (a player-controlled one respawns at its start with full health, anything else is removed).',
    category: 'Gameplay',
    fields: {
      maxHealth: { kind: 'number', default: 3, min: 1, step: 1, integer: true },
      currentHealth: { kind: 'number', default: 3, min: 0, step: 1, integer: true },
    },
  },
  {
    type: 'DamageReceiver',
    label: 'Damage Receiver',
    description: 'Takes damage from entities that have a Damage component and carry any of the listed tags (or that a "damages" relationship points from). Needs Health.',
    category: 'Gameplay',
    fields: {
      damageSources: { kind: 'stringList', default: ['hazard', 'enemy'], description: 'Tags of entities that can deal damage' },
      invincibilityDuration: { kind: 'number', default: 1, min: 0, step: 0.1, description: 'Seconds of invincibility after a hit' },
    },
  },
  {
    type: 'Damage',
    label: 'Damage',
    description: 'Deals damage on contact to entities whose Damage Receiver accepts this entity (by tag).',
    category: 'Gameplay',
    fields: {
      amount: { kind: 'number', default: 1, min: 0, step: 1 },
    },
  },
  {
    type: 'Inventory',
    label: 'Inventory',
    description: 'Lets the entity pick up Collectibles by touching them. `items` are the items it starts with (repeat a name to start with several).',
    category: 'Gameplay',
    fields: {
      items: { kind: 'stringList', default: [], description: 'Items held at the start' },
    },
  },
  {
    type: 'Collectible',
    label: 'Collectible',
    description: 'Picked up (and removed from the level) when an entity with an Inventory touches it.',
    category: 'Gameplay',
    fields: {
      collectionBehavior: { kind: 'enum', options: ['addToInventory', 'consume'], default: 'addToInventory', description: 'addToInventory: the collector keeps it as an item. consume: it is used up at once (only the "collected" event happens)' },
      itemId: { kind: 'string', default: '', description: 'Item name added to the collector inventory (empty: the object name in lower case)' },
    },
  },
  {
    type: 'Openable',
    label: 'Openable',
    description: 'Something that opens and closes, like a door. While open it does not block and is drawn faded. Switches, keys ("requires") and rules open it.',
    category: 'Gameplay',
    fields: {
      startsOpen: { kind: 'boolean', default: false },
    },
  },
  {
    type: 'Switch',
    label: 'Switch',
    description: 'A lever or button. Using it flips it on/off and fires "switch_activated"; whatever it "controls" opens or closes.',
    category: 'Gameplay',
    fields: {
      activation: { kind: 'enum', options: ['interact', 'touch'], default: 'interact', description: 'interact: press E while touching it. touch: used by walking into it' },
      once: { kind: 'boolean', default: false, description: 'Can only be used once' },
      startsOn: { kind: 'boolean', default: false },
    },
  },
  {
    type: 'Climbable',
    label: 'Climbable',
    description: 'Characters can climb this (ladders, vines, ropes) with Up/Down, at their running speed.',
    category: 'Movement',
    fields: {},
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
