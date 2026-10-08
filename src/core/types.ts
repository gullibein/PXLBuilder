/**
 * Core project model. This is the authoritative representation of a game.
 * Everything else (editor UI, renderer, future runtime and AI layer) reads
 * from and writes to these structures; nothing here depends on React or the DOM.
 */

import type { SoundRecipe } from './audio/sound';
import type { CameraSettings } from './model/camera';
import type { BehaviorScript } from './script/language';

export type { BehaviorScript };

export type Id = string;

export interface Vec2 {
  x: number;
  y: number;
}

export interface Transform {
  position: Vec2;
  /** Rotation in degrees. */
  rotation: number;
  scale: Vec2;
}

/** Property bag for one component. Its shape is described by the component registry. */
export type ComponentProps = Record<string, unknown>;

/** Map of component type -> properties. One component of each type per entity. */
export type ComponentMap = Record<string, ComponentProps>;

/**
 * Reusable template ("prefab"). Instances placed in scenes reference a definition
 * and inherit its components and tags.
 */
export interface ObjectDefinition {
  id: Id;
  name: string;
  description: string;
  components: ComponentMap;
  tags: string[];
  metadata: Record<string, unknown>;
  /** Behavior scripts every copy runs in play. */
  scripts?: BehaviorScript[];
}

/**
 * An entity placed in a scene.
 *
 * If `definitionId` is set, the entity inherits the definition's components;
 * `components` then holds only per-instance overrides (partial props), and
 * `removedComponents` lists inherited components this instance opts out of.
 * If `definitionId` is null, `components` is the complete component set.
 */
export interface EntityInstance {
  id: Id;
  name: string;
  definitionId: Id | null;
  transform: Transform;
  components: ComponentMap;
  removedComponents: string[];
  /** Tags in addition to those inherited from the definition. */
  tags: string[];
  metadata: Record<string, unknown>;
  /** Behavior scripts only this entity runs (in addition to its object's). */
  scripts?: BehaviorScript[];
}

export interface BackgroundSettings {
  /** Image asset drawn behind the level, or null for a plain color. */
  imageAssetId: Id | null;
  /** cover: fills the view's height and repeats sideways. tile: repeats at the image's own size. */
  fit: 'cover' | 'tile';
  /** How much the background moves with the level: 0 = fixed to the screen, 1 = moves exactly with the level. */
  parallax: number;
}

export interface WorldSettings {
  /** Gravity in world units (pixels) per second squared. */
  gravity: Vec2;
  backgroundColor: string;
  background: BackgroundSettings;
}

/**
 * A reference to entities in a scene. Relationships and rules refer to things
 * through these, so "every Coin" or "anything tagged enemy" works for copies
 * placed later. `subject` / `other` mean the entities of the event a rule is
 * reacting to (e.g. for "touch": who touched, and what they touched).
 */
export type EntityRef =
  | { kind: 'entity'; id: Id }
  | { kind: 'object'; id: Id }
  | { kind: 'tag'; tag: string }
  | { kind: 'subject' }
  | { kind: 'other' }
  | { kind: 'any' };

/** A check that must hold for a rule (or a relationship) to take effect. */
export type Condition =
  | { type: 'has_item'; entity: EntityRef; item: string; count: number; not: boolean }
  | { type: 'health'; entity: EntityRef; compare: '<' | '<=' | '==' | '>=' | '>'; value: number; not: boolean }
  | { type: 'is_open'; entity: EntityRef; not: boolean }
  | { type: 'switch_on'; entity: EntityRef; not: boolean }
  /** No living (shown) entity matches `entity` any more: all coins collected, all enemies defeated. */
  | { type: 'none_left'; entity: EntityRef; not: boolean };

/** Something a rule does. */
export type RuleAction =
  | { type: 'open'; target: EntityRef }
  | { type: 'close'; target: EntityRef }
  | { type: 'toggle'; target: EntityRef }
  | { type: 'remove'; target: EntityRef }
  | { type: 'spawn'; object: Id; at: EntityRef | null; x: number; y: number }
  | { type: 'damage'; target: EntityRef; amount: number }
  | { type: 'heal'; target: EntityRef; amount: number }
  | { type: 'give_item'; target: EntityRef; item: string; count: number }
  | { type: 'take_item'; target: EntityRef; item: string; count: number }
  | { type: 'respawn'; target: EntityRef }
  | { type: 'teleport'; target: EntityRef; to: EntityRef }
  | { type: 'restart_level' }
  /** The level is won: Play goes on to the next level (or says the game is finished). */
  | { type: 'complete_level' }
  /** Bring back something hidden (Starts Hidden, or hidden by hide). */
  | { type: 'show'; target: EntityRef }
  /** Take something out of play until shown again. */
  | { type: 'hide'; target: EntityRef }
  | { type: 'show_message'; text: string; seconds: number }
  | { type: 'play_sound'; sound: string; volume: number }
  | { type: 'camera_shake'; strength: number; seconds: number }
  | { type: 'camera_flash'; color: string; seconds: number }
  | { type: 'camera_zoom'; zoom: number; seconds: number }
  | { type: 'camera_focus'; target: EntityRef; seconds: number }
  | { type: 'camera_follow'; target: EntityRef | null };

/** WHEN event (about `subject` and `other`) AND all conditions DO actions. */
export interface Rule {
  id: Id;
  name: string;
  enabled: boolean;
  when: { event: string; subject: EntityRef; other: EntityRef };
  conditions: Condition[];
  actions: RuleAction[];
}

/**
 * A typed edge between things in a scene: "Switch controls Door", "Door
 * requires Blue Key". Types come from the relationship registry; some have
 * built-in meaning during play, others only describe the design.
 */
export interface Relationship {
  id: Id;
  type: string;
  source: EntityRef;
  target: EntityRef;
  params: Record<string, unknown>;
  /** All must hold for the relationship to take effect (e.g. "only if the player has the key"). */
  conditions: Condition[];
}

export interface Scene {
  id: Id;
  name: string;
  world: WorldSettings;
  /** Ordered: later entities draw on top. */
  entities: EntityInstance[];
  relationships: Relationship[];
  rules: Rule[];
  /** How the camera behaves in play (zoom, look-ahead, limits…). */
  camera: CameraSettings;
}

export type AssetKind = 'image' | 'spritesheet' | 'sound' | 'music';

/** How a sprite sheet is cut into numbered cells (numbered from 1, left to right, then top to bottom). */
export interface SpriteAnimation {
  frames: number[];
  fps: number;
}

export interface SpriteGrid {
  columns: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  offsetX: number;
  offsetY: number;
  spacingX: number;
  spacingY: number;
}

export interface AssetRecord {
  id: Id;
  name: string;
  kind: AssetKind;
  /** Project-relative path of the file, e.g. "assets/ast_1a2b3c.png". */
  path: string;
  /** File contents as a data URL (kept in memory; written to `path` when saved). */
  data: string;
  /** Pixel size, for images. */
  width: number;
  height: number;
  /** Cell layout, for sprite sheets. */
  grid?: SpriteGrid;
  /**
   * The pixels, for images drawn as pixel art (by the AI, the sprite editor
   * or the starter art): so they can be edited and varied. `rows` is the
   * (first) picture; an animation also has all its `frames` (side by side in
   * the image, one cell each).
   */
  pixelArt?: { palette: { key: string; color: string }[]; rows: string[]; frames?: string[][] };
  /** Plays as an animation: these cells of the sheet (numbered from 1), at `fps` frames per second, over and over. */
  animation?: SpriteAnimation;
  /** The recipe, for sounds made by the synthesizer (by the AI): played with the browser's audio, no file needed. */
  synth?: SoundRecipe;
  /** What it is, in plain words ("a duck's quack"), for sounds. */
  description?: string;
}

export interface ProjectSettings {
  /** Grid size used by the editor for snapping. */
  gridSize: number;
  /**
   * What kind of game it was started as: its starter objects (and what
   * "reset objects" brings back). Missing in games from before there was a
   * choice: those are platformers. A game can still mix anything.
   */
  gameType?: GameType;
}

export type GameType = 'platformer' | 'topdown';

export interface Project {
  formatVersion: number;
  id: Id;
  name: string;
  settings: ProjectSettings;
  startSceneId: Id;
  /** Ordered scene list. */
  scenes: Scene[];
  /** Ordered object library. */
  definitions: ObjectDefinition[];
  assets: AssetRecord[];
}
