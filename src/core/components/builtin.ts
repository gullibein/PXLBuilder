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
      layer: { kind: 'number', default: 0, min: -10, max: 10, step: 1, integer: true, description: 'Drawing order: lower layers are drawn first, under higher ones (floors -1 under everything at 0, a roof or foliage 1 over the player); things on the same layer are drawn in the order they were placed' },
    },
  },
  {
    type: 'SpriteStates',
    label: 'Sprites by situation',
    description:
      'Other images for what the object is doing in play: running, jumping, falling, climbing, hanging from a ledge, hurt, shooting, and (without gravity) moving up or down. Each is drawn at the Sprite size instead of the normal image while that happens; an empty one keeps the normal image (falling uses the jumping image when it has none).',
    category: 'Rendering',
    fields: {
      run: { kind: 'assetRef', assetKind: 'image', default: null, description: 'While moving along the ground' },
      jump: { kind: 'assetRef', assetKind: 'image', default: null, description: 'While going up in the air' },
      fall: { kind: 'assetRef', assetKind: 'image', default: null, description: 'While coming down in the air (else the jumping image)' },
      climb: { kind: 'assetRef', assetKind: 'image', default: null, description: 'While on a ladder' },
      hang: { kind: 'assetRef', assetKind: 'image', default: null, description: 'While hanging from a ledge' },
      hurt: { kind: 'assetRef', assetKind: 'image', default: null, description: 'For a moment after being hurt' },
      shoot: { kind: 'assetRef', assetKind: 'image', default: null, description: 'For a moment after shooting' },
      up: { kind: 'assetRef', assetKind: 'image', default: null, description: 'While moving up the screen without gravity (top-down games, fliers); else the running image' },
      down: { kind: 'assetRef', assetKind: 'image', default: null, description: 'While moving down the screen without gravity (top-down games, fliers); else the running image' },
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
    description:
      'Player-controlled movement. platformer: runs left and right, jumps (Space) and climbs ladders, pulled down by gravity. topdown: walks in every direction with the arrow keys or WASD, seen from above (Zelda, Rogue), no gravity and no jumping.',
    category: 'Movement',
    fields: {
      movement: { kind: 'enum', options: ['platformer', 'topdown'], default: 'platformer', description: 'platformer: run and jump, with gravity. topdown: walk in all directions (diagonals too), seen from above, no gravity or jumping' },
      speed: { kind: 'number', default: 200, min: 0, step: 10, description: 'Max horizontal speed (px/s)' },
      acceleration: { kind: 'number', default: 1500, min: 0, step: 50, description: 'Horizontal acceleration (px/s²)' },
      jumpForce: { kind: 'number', default: 350, min: 0, step: 5, description: 'Initial jump speed (px/s). Jump height ≈ jumpForce² / (2 × gravity): 350 at gravity 980 is about 1.9 tiles, enough to reach the next row up easily (not two rows)' },
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
      knockback: { kind: 'number', default: 160, min: 0, max: 1000, step: 10, description: 'How hard a hit shoves it away from what hurt it (px/s, for a moment; then it moves as before). 0 = not at all: for grid and turn-based games, where things must stay on their squares' },
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
    type: 'Stompable',
    label: 'Stompable',
    description: 'Can be defeated by jumping on top of it (like stomping an enemy). Whoever lands on it, if it carries one of the stomper tags, bounces off unhurt. Other contact still works as usual (its Damage still hurts from the side).',
    category: 'Gameplay',
    fields: {
      stompers: { kind: 'stringList', default: ['player'], description: 'Tags of who can stomp it' },
      bounce: { kind: 'number', default: 320, min: 0, step: 10, description: 'How high the stomper bounces off (upward speed, px/s)' },
      damage: { kind: 'number', default: 0, min: 0, step: 1, description: '0: one stomp defeats it. Otherwise the health it loses per stomp' },
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
  // ------------------------------------------------------------ behaviors: what things do on their own
  {
    type: 'Pushable',
    label: 'Pushable',
    description:
      'Can be pushed: a character (one tagged as a pusher) walking into it shoves it along, unless a wall or something else is in the way; it blocks everything else like a wall. Sideways in a platformer (a crate with a dynamic Physics Body also falls), in all four directions seen from above. step 0: it slides along as long as it is pushed; step 32: each push moves it exactly one tile (Sokoban), so it stays on the grid.',
    category: 'Physics',
    fields: {
      step: { kind: 'number', default: 0, min: 0, step: 8, description: '0 = slides smoothly while pushed; more = each push moves it exactly this many pixels (32 = one tile, for puzzles on a grid)' },
      pushers: { kind: 'stringList', default: ['player'], description: 'Tags of who can push it' },
      speed: { kind: 'number', default: 160, min: 1, step: 10, description: 'For step pushes: how fast it slides to the next spot (px/s)' },
    },
  },
  {
    type: 'Wander',
    label: 'Wander',
    description:
      'Wanders around on its own (needs a dynamic Physics Body): walks one way, and every few seconds (or on bumping into a wall) picks another at random, sometimes stopping for a moment. Without gravity (top-down games, fliers) it wanders in all four directions; with gravity only left and right.',
    category: 'Behavior',
    fields: {
      speed: { kind: 'number', default: 50, min: 0, step: 10, description: 'Pixels per second (the player walks at 200)' },
      interval: { kind: 'number', default: 2, min: 0.2, step: 0.1, description: 'About how many seconds between changes of direction (it varies a little each time)' },
      pauses: { kind: 'boolean', default: true, description: 'Sometimes stands still for a moment instead of walking' },
    },
  },
  {
    type: 'Patrol',
    label: 'Patrol',
    description: 'Walks back and forth on its own (needs a dynamic Physics Body). Turns at walls, at ledges (if turnAtLedges), and after `distance` pixels from where it started. Without gravity (gravityScale 0, or a level with no gravity) it flies back and forth. startDirection up or down: it goes up and down instead (only without gravity, e.g. in a top-down level).',
    category: 'Behavior',
    fields: {
      speed: { kind: 'number', default: 60, min: 0, step: 10, description: 'Pixels per second (the player runs at 200)' },
      distance: { kind: 'number', default: 0, min: 0, step: 32, description: 'How far it goes each way from its start, in pixels (32 = one tile); 0 = until a wall or ledge' },
      turnAtLedges: { kind: 'boolean', default: true, description: 'Turn around instead of walking off a ledge' },
      startDirection: { kind: 'enum', options: ['right', 'left', 'up', 'down'], default: 'right', description: 'right/left: back and forth sideways; up/down: up and down (without gravity only)' },
    },
  },
  {
    type: 'Jumper',
    label: 'Jumper',
    description: 'Jumps on its own every few seconds while standing on something.',
    category: 'Behavior',
    fields: {
      interval: { kind: 'number', default: 2, min: 0.1, step: 0.1, description: 'Seconds between jumps' },
      jumpForce: { kind: 'number', default: 300, min: 0, step: 10, description: 'Jump speed (px/s); 350 at normal gravity reaches the next tile row up easily (not two)' },
    },
  },
  {
    type: 'Shooter',
    label: 'Shooter',
    description:
      'Fires shots. trigger "auto": every `interval` seconds; "key": when the player presses X (only on a player-controlled object), at most once per interval. A shot flies straight, hurts what it hits (by the usual Damage Receiver tag rules; shots carry the shooter\'s tags and "projectile") and vanishes on hitting a wall or after `range` pixels.',
    category: 'Behavior',
    fields: {
      trigger: { kind: 'enum', options: ['auto', 'key'], default: 'auto' },
      interval: { kind: 'number', default: 2, min: 0.1, step: 0.1, description: 'Seconds between shots' },
      direction: { kind: 'enum', options: ['facing', 'atTarget', 'left', 'right', 'up', 'down'], default: 'facing', description: 'facing: the way it faces; atTarget: at the nearest thing tagged targetTag' },
      targetTag: { kind: 'string', default: 'player', description: 'For atTarget: what to aim at' },
      speed: { kind: 'number', default: 240, min: 1, step: 10, description: 'Shot speed (px/s)' },
      damage: { kind: 'number', default: 1, min: 0, step: 1 },
      range: { kind: 'number', default: 480, min: 16, step: 32, description: 'How far a shot flies before it vanishes (px)' },
      projectile: { kind: 'string', default: '', description: 'Library object id to fire (its look and tags); empty = a small built-in shot' },
    },
  },
  {
    type: 'MovingPlatform',
    label: 'Moving Platform',
    description: 'Moves back and forth between where it starts and `offset` from there, carrying whatever stands on it.',
    category: 'Behavior',
    fields: {
      offset: { kind: 'vec2', default: { x: 96, y: 0 }, description: 'Where it moves to, relative to its start, in pixels (32 = one tile; negative y is up)' },
      speed: { kind: 'number', default: 64, min: 1, step: 8, description: 'Pixels per second' },
      pause: { kind: 'number', default: 0.5, min: 0, step: 0.1, description: 'Seconds it waits at each end' },
    },
  },
  {
    type: 'Timer',
    label: 'Timer',
    description: 'Fires the "timer" event every `interval` seconds (or once). Use it with rules: "every 5 seconds, spawn an enemy here".',
    category: 'Behavior',
    fields: {
      interval: { kind: 'number', default: 2, min: 0.1, step: 0.1, description: 'Seconds' },
      repeat: { kind: 'boolean', default: true, description: 'Keep firing, or only once' },
    },
  },
  {
    type: 'DoubleJump',
    label: 'Double Jump',
    description: 'A player-controlled character can jump again in the air.',
    category: 'Behavior',
    fields: {
      extraJumps: { kind: 'number', default: 1, min: 1, max: 5, step: 1, integer: true, description: 'Jumps allowed in the air before landing' },
    },
  },
  {
    type: 'LedgeGrab',
    label: 'Ledge Grab',
    description: 'A player-controlled character catches the top edge of a wall it jumps or falls against while pressing toward it, and hangs there; Up or Jump climbs onto the ledge, Down or away lets go.',
    category: 'Behavior',
    fields: {},
  },
  {
    type: 'Goal',
    label: 'Goal',
    description: 'Reaching it wins the level: when the player touches it, play goes on to the next level (or the game is finished). An exit flag, the top of an escape ladder, a portal.',
    category: 'Gameplay',
    fields: {},
  },
  {
    type: 'StartsHidden',
    label: 'Starts Hidden',
    description: 'Not in play at the start: a rule (action show) or a switch brings it in. A ladder that appears when all coins are collected, a hidden bridge.',
    category: 'Gameplay',
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
