/**
 * Project <-> files.
 *
 * On-disk layout (version-control friendly; one file per scene / definition,
 * named by stable id so renames don't produce file moves):
 *
 *   project.json              index: metadata, settings, scene + object lists
 *   scenes/<sceneId>.json     one Scene each
 *   objects/<definitionId>.json  one ObjectDefinition each
 *   assets/<assetId>.<ext>     asset files (images); in the bundle they are data URLs
 *
 * In the browser the file map is wrapped in a single JSON "bundle" for
 * download/upload and local storage; a desktop shell or backend can write the
 * same map to a real folder.
 */
import type { ComponentRegistry } from '../components/registry';
import type { Project } from '../types';
import { migrateProject } from './migrations';
import { projectIndexSchema, projectSchema } from './schema';
import { FORMAT_VERSION } from './version';

export type ProjectFiles = Record<string, unknown>;

export interface ProjectBundle {
  kind: 'pxlbuilder.bundle';
  bundleVersion: 1;
  files: ProjectFiles;
}

export interface LoadResult {
  project: Project;
  /** Non-fatal issues (e.g. unknown component types) found while loading. */
  warnings: string[];
}

export class ProjectLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProjectLoadError';
  }
}

export function projectToFiles(project: Project): ProjectFiles {
  const files: ProjectFiles = {};
  files['project.json'] = {
    formatVersion: FORMAT_VERSION,
    id: project.id,
    name: project.name,
    settings: project.settings,
    startSceneId: project.startSceneId,
    scenes: project.scenes.map((s) => ({ id: s.id, name: s.name, file: `scenes/${s.id}.json` })),
    objects: project.definitions.map((d) => ({ id: d.id, name: d.name, file: `objects/${d.id}.json` })),
    assets: project.assets.map(({ data: _data, ...meta }) => meta),
  };
  for (const scene of project.scenes) files[`scenes/${scene.id}.json`] = scene;
  for (const def of project.definitions) files[`objects/${def.id}.json`] = def;
  for (const asset of project.assets) files[asset.path] = asset.data;
  return JSON.parse(JSON.stringify(files)) as ProjectFiles;
}

export function projectFromFiles(files: ProjectFiles, registry: ComponentRegistry): LoadResult {
  const indexResult = projectIndexSchema.safeParse(files['project.json']);
  if (!indexResult.success) throw new ProjectLoadError(`Invalid project.json: ${formatZodError(indexResult.error)}`);
  const index = indexResult.data;

  const read = (path: string) => {
    if (!(path in files)) throw new ProjectLoadError(`Missing file "${path}"`);
    return files[path];
  };

  const assembled: Record<string, unknown> = {
    formatVersion: index.formatVersion,
    id: index.id,
    name: index.name,
    settings: index.settings,
    startSceneId: index.startSceneId,
    scenes: index.scenes.map((s) => read(s.file)),
    definitions: index.objects.map((o) => read(o.file)),
    // Attach each asset's file contents; a missing file is reported by validation below.
    assets: index.assets.map((a) => {
      const path = (a as { path?: unknown }).path;
      return typeof path === 'string' && typeof files[path] === 'string' ? { ...(a as object), data: files[path] } : a;
    }),
  };

  let migrated: Record<string, unknown>;
  try {
    migrated = migrateProject(assembled);
  } catch (e) {
    throw new ProjectLoadError((e as Error).message);
  }

  const parsed = projectSchema.safeParse(migrated);
  if (!parsed.success) throw new ProjectLoadError(`Invalid project data: ${formatZodError(parsed.error)}`);
  const project = parsed.data as Project;

  const integrity = checkIntegrity(project);
  if (integrity.length) throw new ProjectLoadError(integrity.join('; '));
  return { project, warnings: checkComponents(project, registry) };
}

export function projectToBundle(project: Project): ProjectBundle {
  return { kind: 'pxlbuilder.bundle', bundleVersion: 1, files: projectToFiles(project) };
}

export function projectFromBundle(bundle: unknown, registry: ComponentRegistry): LoadResult {
  if (typeof bundle !== 'object' || bundle === null || (bundle as ProjectBundle).kind !== 'pxlbuilder.bundle') {
    throw new ProjectLoadError('Not a PXLBuilder project file');
  }
  const files = (bundle as ProjectBundle).files;
  if (typeof files !== 'object' || files === null) throw new ProjectLoadError('Project bundle has no files');
  return projectFromFiles(files, registry);
}

/** Structural reference checks: unique ids and resolvable references. */
export function checkIntegrity(project: Project): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const unique = (id: string, what: string) => {
    if (seen.has(id)) errors.push(`Duplicate id "${id}" (${what})`);
    seen.add(id);
  };
  const defIds = new Set(project.definitions.map((d) => d.id));
  for (const d of project.definitions) unique(d.id, 'object definition');
  for (const s of project.scenes) {
    unique(s.id, 'scene');
    for (const e of s.entities) {
      unique(e.id, 'entity');
      if (e.definitionId !== null && !defIds.has(e.definitionId)) {
        errors.push(`Entity "${e.name}" references missing definition "${e.definitionId}"`);
      }
    }
  }
  if (!project.scenes.some((s) => s.id === project.startSceneId)) errors.push(`Start scene "${project.startSceneId}" not found`);
  const assetIds = new Set(project.assets.map((a) => a.id));
  for (const a of project.assets) unique(a.id, 'asset');
  for (const s of project.scenes) {
    const img = s.world.background.imageAssetId;
    if (img !== null && !assetIds.has(img)) errors.push(`Background of "${s.name}" references missing asset "${img}"`);
  }
  return errors;
}

/** Component prop checks against the registry. Reported as warnings so unknown/extension data is kept, not destroyed. */
export function checkComponents(project: Project, registry: ComponentRegistry): string[] {
  const warnings: string[] = [];
  const check = (owner: string, type: string, props: Record<string, unknown>, partial: boolean) => {
    if (!registry.has(type)) {
      warnings.push(`${owner}: unknown component type "${type}"`);
      return;
    }
    for (const err of registry.validate(type, props, { partial })) {
      warnings.push(`${owner}: ${type}.${err.field} ${err.message}`);
    }
  };
  for (const d of project.definitions) {
    for (const [type, props] of Object.entries(d.components)) check(`Object "${d.name}"`, type, props, true);
  }
  for (const s of project.scenes) {
    for (const e of s.entities) {
      for (const [type, props] of Object.entries(e.components)) check(`Entity "${e.name}" in "${s.name}"`, type, props, true);
    }
  }
  return warnings;
}

function formatZodError(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .slice(0, 3)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}
