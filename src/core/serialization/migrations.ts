import { componentRegistry } from '../components/builtin';
import { generateId } from '../ids';
import { defaultCamera } from '../model/camera';
import { createStarterAssets, createStarterDefinitions, SPIKES_ART_V8_ROWS } from '../model/factory';
import { FORMAT_VERSION } from './version';

/**
 * Migrations upgrade a raw (assembled, not yet validated) project object one
 * format version at a time. To change the format: bump FORMAT_VERSION and
 * register a migration from the previous version.
 */
export interface Migration {
  from: number;
  to: number;
  migrate(raw: Record<string, unknown>): Record<string, unknown>;
}

type Raw = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * v1 -> v2
 * - Scenes get background settings (image, fit, parallax).
 * - Assets carry their file contents (`data`) and pixel size.
 * - The old wide starter "Platform" (160x24) becomes a 32x32 tile; each placed
 *   wide platform is replaced by a row of tiles covering the same span, so
 *   existing levels keep their shape.
 * - The new starter objects (Stone, Ladder) are added when missing.
 */
function migrateV1toV2(raw: Raw): Raw {
  const project: Raw = structuredClone(raw);
  for (const scene of project.scenes ?? []) {
    scene.world.background ??= { imageAssetId: null, fit: 'cover', parallax: 0.3 };
  }
  project.assets = (project.assets ?? []).filter((a: Raw) => typeof a.data === 'string').map((a: Raw) => ({ width: 0, height: 0, ...a }));

  const defs: Raw[] = project.definitions ?? [];
  const oldPlatform = defs.find(
    (d) => d.name === 'Platform' && d.metadata?.placement !== 'tile' && d.components?.Sprite?.width === 160 && d.components?.Sprite?.height === 24,
  );
  if (oldPlatform) {
    const sprite = oldPlatform.components.Sprite;
    sprite.width = 32;
    sprite.height = 32;
    if (sprite.color === '#6b7a8f') sprite.color = '#5fa83f';
    if (oldPlatform.components.Collider) oldPlatform.components.Collider.size = { x: 32, y: 32 };
    oldPlatform.metadata = { ...oldPlatform.metadata, placement: 'tile', category: 'Platforms' };
    oldPlatform.description = 'A square ground tile. Draw rows of them to build platforms.';
    if (!oldPlatform.tags.includes('ground')) oldPlatform.tags.push('ground');
    for (const scene of project.scenes ?? []) {
      scene.entities = scene.entities.flatMap((e: Raw) => (e.definitionId === oldPlatform.id ? platformToTiles(e) : [e]));
    }
  }

  const has = (name: string) => defs.some((d) => d.name === name);
  if (!has('Stone') || !has('Ladder')) {
    const starterAssets = createStarterAssets();
    const ladder = starterAssets.ladder;
    const starters = createStarterDefinitions(componentRegistry, starterAssets);
    if (!has('Stone')) defs.push(starters.find((d) => d.name === 'Stone')!);
    if (!has('Ladder')) {
      defs.push(starters.find((d) => d.name === 'Ladder')!);
      project.assets.push(ladder);
    }
  }
  project.definitions = defs;
  return project;
}

/** One wide v1 platform instance -> a row of 32px tile instances over the same span. */
function platformToTiles(e: Raw): Raw[] {
  const TILE = 32;
  const scaleX = Math.abs(e.transform?.scale?.x ?? 1) || 1;
  const width = (typeof e.components?.Sprite?.width === 'number' ? e.components.Sprite.width : 160) * scaleX;
  const count = Math.max(1, Math.round(width / TILE));
  const left = e.transform.position.x - width / 2;
  const firstCell = Math.round(left / TILE);
  const y = Math.floor(e.transform.position.y / TILE) * TILE + TILE / 2;
  // Size overrides no longer apply to a tile; other overrides (e.g. color) carry over.
  const components = structuredClone(e.components ?? {});
  if (components.Sprite) {
    delete components.Sprite.width;
    delete components.Sprite.height;
    if (!Object.keys(components.Sprite).length) delete components.Sprite;
  }
  if (components.Collider) {
    delete components.Collider.size;
    if (!Object.keys(components.Collider).length) delete components.Collider;
  }
  return Array.from({ length: count }, (_, k) => ({
    ...structuredClone(e),
    id: k === 0 ? e.id : generateId('ent'),
    name: k === 0 ? e.name : `${e.name} ${k + 1}`,
    transform: { position: { x: (firstCell + k) * TILE + TILE / 2, y }, rotation: 0, scale: { x: 1, y: 1 } },
    components: structuredClone(components),
  }));
}

/**
 * v2 -> v3: play tuning.
 * - The starter Player becomes one tile tall (28x32, was 28x40) and jumps
 *   about 1.4 tiles high (jumpForce 295, was 450), if those values were never
 *   changed by the user.
 * - Climbable no longer has climbSpeed (characters climb at their running speed).
 */
function migrateV2toV3(raw: Raw): Raw {
  const project: Raw = structuredClone(raw);
  for (const def of project.definitions ?? []) {
    const c = def.components ?? {};
    if (c.Climbable) delete c.Climbable.climbSpeed;
    if (def.name !== 'Player') continue;
    if (c.Sprite?.width === 28 && c.Sprite?.height === 40) {
      c.Sprite.height = 32;
      if (c.Collider?.size?.x === 28 && c.Collider?.size?.y === 40) c.Collider.size = { x: 28, y: 32 };
    }
    if (c.CharacterController?.jumpForce === 450) c.CharacterController.jumpForce = 295;
  }
  for (const scene of project.scenes ?? []) {
    for (const e of scene.entities ?? []) if (e.components?.Climbable) delete e.components.Climbable.climbSpeed;
  }
  return project;
}

/**
 * v3 -> v4: game logic.
 * - Scenes get relationships and rules (empty).
 * - The starter Player gets Health (3), a Damage Receiver and an Inventory, so
 *   hazards hurt it and it picks things up; the starter Door becomes Openable;
 *   the starter Coin is kept as an item. Only objects still recognisably the
 *   starter ones are touched, and components already there are left alone.
 * - The new starter objects (Key, Switch) are added when missing.
 */
function migrateV3toV4(raw: Raw): Raw {
  const project: Raw = structuredClone(raw);
  for (const scene of project.scenes ?? []) {
    scene.relationships ??= [];
    scene.rules ??= [];
  }
  const starterAssets = createStarterAssets();
  const starters = createStarterDefinitions(componentRegistry, starterAssets);
  const fresh = (name: string) => starters.find((d) => d.name === name)!;
  const defs: Raw[] = project.definitions ?? [];
  const starterNamed = (name: string) => defs.find((d) => (d.metadata?.starter ?? d.name) === name);

  const player = starterNamed('Player');
  if (player?.components?.CharacterController) {
    for (const type of ['Health', 'DamageReceiver', 'Inventory']) player.components[type] ??= structuredClone(fresh('Player').components[type]);
  }
  const door = starterNamed('Door');
  if (door?.components) door.components.Openable ??= structuredClone(fresh('Door').components.Openable);
  const coin = starterNamed('Coin');
  if (coin?.components?.Collectible?.collectionBehavior === 'consume') coin.components.Collectible.collectionBehavior = 'addToInventory';

  for (const name of ['Key', 'Switch']) {
    if (starterNamed(name)) continue;
    const def = fresh(name);
    defs.push(def);
    if (name === 'Switch') project.assets = [...(project.assets ?? []), starterAssets.lever];
  }
  project.definitions = defs;
  return project;
}

/**
 * v4 -> v5
 * - Objects and entities can carry behavior scripts (`scripts`, optional).
 *   Nothing to convert; the version marks files an older editor would
 *   silently strip the scripts from.
 */
function migrateV4toV5(raw: Raw): Raw {
  return structuredClone(raw);
}

/**
 * v5 -> v6
 * - Levels get camera settings. Existing levels keep how they played: zoom 1,
 *   no limits (new levels keep the camera inside the level).
 */
function migrateV5toV6(raw: Raw): Raw {
  const project: Raw = structuredClone(raw);
  for (const scene of project.scenes ?? []) scene.camera ??= defaultCamera(false);
  return project;
}

/**
 * v6 -> v7
 * - The starter Player and Enemy get their pixel art (eyes and outlines),
 *   but only while they still look like the starters: no image of their own
 *   and the original color.
 */
function migrateV6toV7(raw: Raw): Raw {
  const project: Raw = structuredClone(raw);
  const art = createStarterAssets();
  const defs: Raw[] = project.definitions ?? [];
  const give = (name: string, color: string, asset: Raw) => {
    const def = defs.find((d) => (d.metadata?.starter ?? d.name) === name);
    const sprite = def?.components?.Sprite;
    if (!sprite || sprite.assetId || String(sprite.color).toLowerCase() !== color) return;
    sprite.assetId = asset.id;
    sprite.frame = 1;
    project.assets = [...(project.assets ?? []), asset];
  };
  give('Player', '#4fa3ff', art.player);
  give('Enemy', '#e5534b', art.enemy);
  return project;
}

/**
 * v7 -> v8
 * - The starter Player jumps higher (jumpForce 350, was 295), if that value
 *   was never changed.
 * - The starter Hazard looks like spikes, while it still looks like the
 *   starter (no image of its own, the original orange).
 */
function migrateV7toV8(raw: Raw): Raw {
  const project: Raw = structuredClone(raw);
  const defs: Raw[] = project.definitions ?? [];
  const starter = (name: string) => defs.find((d) => (d.metadata?.starter ?? d.name) === name);
  const cc = starter('Player')?.components?.CharacterController;
  if (cc?.jumpForce === 295) cc.jumpForce = 350;
  const sprite = starter('Hazard')?.components?.Sprite;
  if (sprite && !sprite.assetId && String(sprite.color).toLowerCase() === '#ff6b2c') {
    const spikes = createStarterAssets().hazard;
    sprite.assetId = spikes.id;
    sprite.frame = 1;
    project.assets = [...(project.assets ?? []), spikes];
  }
  return project;
}

/**
 * v8 -> v9
 * - The starter Hazard is one tile wide (32×16, was 64×16), if its size was
 *   never changed. Placed copies become two one-tile copies side by side,
 *   covering the same ground, so levels don't get gaps. If it still has the
 *   two-tile spikes drawing, it gets the one-tile drawing.
 */
function migrateV8toV9(raw: Raw): Raw {
  const project: Raw = structuredClone(raw);
  const def = (project.definitions ?? []).find((d: Raw) => (d.metadata?.starter ?? d.name) === 'Hazard');
  const sprite = def?.components?.Sprite;
  if (!def || !sprite || sprite.width !== 64 || sprite.height !== 16) return project;
  sprite.width = 32;
  if (def.components.Collider?.size?.x === 64) def.components.Collider.size = { ...def.components.Collider.size, x: 32 };
  const current = (project.assets ?? []).find((a: Raw) => a.id === sprite.assetId);
  if (current?.pixelArt && JSON.stringify(current.pixelArt.rows) === JSON.stringify(SPIKES_ART_V8_ROWS)) {
    const spikes = createStarterAssets().hazard;
    sprite.assetId = spikes.id;
    project.assets = [...project.assets, spikes];
  }
  for (const scene of project.scenes ?? []) {
    const next: Raw[] = [];
    for (const e of scene.entities ?? []) {
      const ownSize = e.components?.Sprite?.width !== undefined || e.components?.Collider?.size !== undefined;
      if (e.definitionId !== def.id || ownSize) {
        next.push(e);
        continue;
      }
      const scaleX = Math.abs(e.transform?.scale?.x ?? 1);
      const { x, y } = e.transform.position;
      next.push({ ...e, transform: { ...e.transform, position: { x: x - 16 * scaleX, y } } });
      next.push({ ...structuredClone(e), id: generateId('ent'), transform: { ...e.transform, position: { x: x + 16 * scaleX, y } } });
    }
    scene.entities = next;
  }
  return project;
}

/**
 * v9 -> v10
 * - New starter objects: Teleporter and Goal, added to games that don't have
 *   them yet (by starter name, or an object already called that).
 */
function migrateV9toV10(raw: Raw): Raw {
  const project: Raw = structuredClone(raw);
  const assets = createStarterAssets();
  const defs = createStarterDefinitions(componentRegistry, assets);
  for (const [name, asset] of [['Teleporter', assets.teleporter], ['Goal', assets.goal]] as const) {
    const has = (project.definitions ?? []).some((d: Raw) => (d.metadata?.starter ?? d.name) === name || d.name === name);
    if (has) continue;
    project.definitions = [...(project.definitions ?? []), structuredClone(defs.find((d) => d.name === name))];
    project.assets = [...(project.assets ?? []), asset];
  }
  return project;
}

export const MIGRATIONS: Migration[] = [
  { from: 1, to: 2, migrate: migrateV1toV2 },
  { from: 2, to: 3, migrate: migrateV2toV3 },
  { from: 3, to: 4, migrate: migrateV3toV4 },
  { from: 4, to: 5, migrate: migrateV4toV5 },
  { from: 5, to: 6, migrate: migrateV5toV6 },
  { from: 6, to: 7, migrate: migrateV6toV7 },
  { from: 7, to: 8, migrate: migrateV7toV8 },
  { from: 8, to: 9, migrate: migrateV8toV9 },
  { from: 9, to: 10, migrate: migrateV9toV10 },
];

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MigrationError';
  }
}

export function migrateProject(
  raw: Record<string, unknown>,
  migrations: Migration[] = MIGRATIONS,
  target: number = FORMAT_VERSION,
): Record<string, unknown> {
  let current = raw;
  const declared = current.formatVersion;
  if (typeof declared !== 'number' || !Number.isInteger(declared)) throw new MigrationError('Project has no valid formatVersion');
  let version = declared;
  if (version > target) {
    throw new MigrationError(`Project format ${version} is newer than this editor supports (${target}). Please update PXLBuilder.`);
  }
  while (version < target) {
    const step = migrations.find((m) => m.from === version);
    if (!step) throw new MigrationError(`No migration from format ${version}`);
    current = { ...step.migrate(current), formatVersion: step.to };
    version = step.to;
  }
  return current;
}
