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

export interface WorldSettings {
  /** Gravity in world units (pixels) per second squared. */
  gravity: Vec2;
  backgroundColor: string;
}

export interface Scene {
  id: Id;
  name: string;
  world: WorldSettings;
  /** Ordered: later entities draw on top. */
  entities: EntityInstance[];
}

export type AssetKind = 'image' | 'spritesheet' | 'sound' | 'music';

export interface AssetRecord {
  id: Id;
  name: string;
  kind: AssetKind;
  /** Project-relative path, e.g. "assets/player.png". */
  path: string;
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
