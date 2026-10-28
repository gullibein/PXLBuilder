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
 * Kept small: a placed object writes only what differs from a plain copy (no
 * empty lists, no rotation 0 or scale 1, no name when it is its object's), and
 * a pixel-art picture or a step sound has no file when its file is exactly
 * what its pixels or notes make (it is made again on opening).
 *
 * In the browser the file map is wrapped in a single JSON "bundle" for
 * download/upload and local storage; a desktop shell or backend can write the
 * same map to a real folder.
 */
import type { ComponentRegistry } from '../components/registry';
import type { Project } from '../types';
import { migrateProject } from './migrations';
import { projectIndexSchema, projectSchema } from './schema';
import { validateRelationship, validateRule } from '../logic/mutations';
import { FORMAT_VERSION } from './version';
import { pixelArtFields } from '../model/factory';
import { soundDataUrl } from '../audio/sound';
import { musicDataUrl } from '../audio/music';
import type { AssetRecord, EntityInstance } from '../types';

export type ProjectFiles = Record<string, unknown>;

export interface ProjectBundle {
  kind: 'pxlbuilder.bundle';
  bundleVersion: 1;
  files: ProjectFiles;
  /**
   * The editor's AI History for this game (requests, answers, what was changed or undone), saved with it for the
   * user to read. Not part of the game: ignored by the player, never sent to the AI.
   */
  aiHistory?: unknown;
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
  const defNames = new Map(project.definitions.map((d) => [d.id, d.name]));
  for (const scene of project.scenes) files[`scenes/${scene.id}.json`] = { ...scene, entities: scene.entities.map((e) => slimEntity(e, defNames)) };
  for (const def of project.definitions) files[`objects/${def.id}.json`] = def;
  for (const asset of project.assets) if (asset.data !== madeFile(asset)) files[asset.path] = asset.data;
  return JSON.parse(JSON.stringify(files)) as ProjectFiles;
}

/** The file a pixel-art picture or a step sound makes from its pixels or notes (undefined for other assets). */
function madeFile(asset: Pick<AssetRecord, 'kind' | 'pixelArt' | 'synth' | 'instrument' | 'song'>): string | undefined {
  try {
    if (asset.kind === 'instrument' && asset.instrument) return musicDataUrl(asset.instrument);
    if (asset.kind === 'music' && asset.song) return musicDataUrl(asset.song);
    if (asset.kind === 'sound' && asset.synth) return soundDataUrl(asset.synth);
    if ((asset.kind === 'image' || asset.kind === 'spritesheet') && asset.pixelArt) {
      const art = asset.pixelArt;
      return pixelArtFields(art.palette, art.frames ?? [art.rows]).data;
    }
  } catch {
    // Not remakeable: the file is kept.
  }
  return undefined;
}

/** A placed object without what a plain copy has anyway. */
function slimEntity(e: EntityInstance, defNames: Map<string, string>): Record<string, unknown> {
  const { name, transform, components, removedComponents, tags, metadata, ...rest } = e;
  const out: Record<string, unknown> = { ...rest };
  if (e.definitionId === null || defNames.get(e.definitionId) !== name) out.name = name;
  const t: Record<string, unknown> = { position: transform.position };
  if (transform.rotation !== 0) t.rotation = transform.rotation;
  if (transform.scale.x !== 1 || transform.scale.y !== 1) t.scale = transform.scale;
  out.transform = t;
  if (Object.keys(components).length) out.components = components;
  if (removedComponents.length) out.removedComponents = removedComponents;
  if (tags.length) out.tags = tags;
  if (Object.keys(metadata).length) out.metadata = metadata;
  return out;
}

/** A placed object as saved, filled back in (files saved before the slim format have everything already). */
function fullEntity(raw: unknown, defNames: Map<unknown, unknown>): unknown {
  if (!raw || typeof raw !== 'object') return raw;
  const e = raw as Record<string, unknown>;
  const t = (e.transform && typeof e.transform === 'object' ? e.transform : {}) as Record<string, unknown>;
  return {
    ...e,
    name: e.name ?? defNames.get(e.definitionId) ?? '',
    transform: { ...t, rotation: t.rotation ?? 0, scale: t.scale ?? { x: 1, y: 1 } },
    components: e.components ?? {},
    removedComponents: e.removedComponents ?? [],
    tags: e.tags ?? [],
    metadata: e.metadata ?? {},
  };
}

export function projectFromFiles(files: ProjectFiles, registry: ComponentRegistry): LoadResult {
  const indexResult = projectIndexSchema.safeParse(files['project.json']);
  if (!indexResult.success) throw new ProjectLoadError(`Invalid project.json: ${formatZodError(indexResult.error)}`);
  const index = indexResult.data;

  const read = (path: string) => {
    if (!(path in files)) throw new ProjectLoadError(`Missing file "${path}"`);
    return files[path];
  };

  const definitions = index.objects.map((o) => read(o.file));
  const defNames = new Map(definitions.map((d) => [(d as { id?: unknown })?.id, (d as { name?: unknown })?.name]));
  const assembled: Record<string, unknown> = {
    formatVersion: index.formatVersion,
    id: index.id,
    name: index.name,
    settings: index.settings,
    startSceneId: index.startSceneId,
    scenes: index.scenes.map((s) => {
      const scene = read(s.file) as Record<string, unknown> | null;
      return scene && Array.isArray(scene.entities) ? { ...scene, entities: scene.entities.map((e) => fullEntity(e, defNames)) } : scene;
    }),
    definitions,
    // Attach each asset's file contents (made again from its pixels or notes when it has none); a missing file is
    // reported by validation below.
    assets: index.assets.map((a) => {
      const path = (a as { path?: unknown }).path;
      if (typeof path === 'string' && typeof files[path] === 'string') return { ...(a as object), data: files[path] };
      const made = typeof path === 'string' && !(path in files) ? madeFile(a as AssetRecord) : undefined;
      return made ? { ...(a as object), data: made } : a;
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
  return { project, warnings: [...checkComponents(project, registry), ...checkLogic(project)] };
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

/** Relationship and rule checks, as warnings (they are kept; play ignores what it cannot use). */
export function checkLogic(project: Project): string[] {
  const warnings: string[] = [];
  for (const s of project.scenes) {
    for (const r of s.relationships) {
      try {
        validateRelationship(project, s.id, r);
      } catch (e) {
        warnings.push(`"${s.name}": ${(e as Error).message}`);
      }
    }
    for (const r of s.rules) {
      try {
        validateRule(project, s.id, r);
      } catch (e) {
        warnings.push(`"${s.name}": ${(e as Error).message}`);
      }
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

/**
 * A game from a file's text: a saved game (the bundle Save writes) or an exported game page (its HTML, with the
 * game inside). Throws ProjectLoadError when it is neither.
 */
export function gameFromText(text: string, registry: ComponentRegistry): LoadResult {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('<')) {
    const m = /<script type="application\/json" id="pxl-game"[^>]*>([\s\S]*?)<\/script>/.exec(text);
    if (!m) throw new ProjectLoadError('This page has no PXLBuilder game in it');
    return projectFromBundle(JSON.parse(m[1]), registry);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ProjectLoadError('Not a PXLBuilder game file');
  }
  return projectFromBundle(raw, registry);
}
