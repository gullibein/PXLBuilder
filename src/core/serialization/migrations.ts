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

export const MIGRATIONS: Migration[] = [];

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
