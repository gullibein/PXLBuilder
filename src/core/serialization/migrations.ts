import { componentRegistry } from '../components/builtin';
import { generateId } from '../ids';
import { createLadderAsset, createStarterDefinitions } from '../model/factory';
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
    const ladder = createLadderAsset();
    const starters = createStarterDefinitions(componentRegistry, ladder);
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

export const MIGRATIONS: Migration[] = [
  { from: 1, to: 2, migrate: migrateV1toV2 },
  { from: 2, to: 3, migrate: migrateV2toV3 },
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
