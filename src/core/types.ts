/**
 * Core project model. This is the authoritative representation of a game.
 * Everything else (editor UI, renderer, future runtime and AI layer) reads
 * from and writes to these structures; nothing here depends on React or the DOM.
 */

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

export interface Scene {
  id: Id;
  name: string;
  world: WorldSettings;
  /** Ordered: later entities draw on top. */
  entities: EntityInstance[];
}

export type AssetKind = 'image' | 'spritesheet' | 'sound' | 'music';

/** How a sprite sheet is cut into numbered cells (numbered from 1, left to right, then top to bottom). */
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
}

export interface ProjectSettings {
  /** Grid size used by the editor for snapping. */
  gridSize: number;
}

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
