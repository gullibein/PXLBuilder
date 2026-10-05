/**
 * Editor overlays: extra information drawn over the level while editing
 * ("show the jump height above the player"). Like editor settings they are
 * declared data (a kind, which entities, which values), validated, and never
 * code; they belong to the editor, not the game, so Play never shows them.
 *
 * - info: a small panel above each matching entity listing values (metrics).
 * - jump_reach: the arc of a running jump, so you can see which platforms
 *   a character can reach.
 */
import { componentRegistry } from '../../core/components/builtin';
import { refMatches } from '../../core/logic/refs';
import { getEntitySize } from '../../core/model/geometry';
import { characterReach, type Reach } from '../../core/model/reach';
import type { ResolvedEntity } from '../../core/model/resolve';
import type { EntityRef, Scene } from '../../core/types';

export type OverlayKind = 'info' | 'jump_reach';

export interface EditorOverlay {
  id: string;
  kind: OverlayKind;
  /** Which entities: one (entity), every copy of an object (object), or a tag. */
  target: EntityRef;
  /** For info: metric keys or "Component.field". */
  show: string[];
}

export const OVERLAY_KINDS: Record<OverlayKind, string> = {
  info: 'A small panel above each matching entity listing the values in `show` (metric keys or "Component.field").',
  jump_reach: 'Draws the arc of a running jump from each matching character (needs a Character Controller): how high and how far it can jump.',
};

/** One tile, for "in tiles" readings (the starter tiles are 32 px). */
export const TILE = 32;
const MAX_OVERLAYS = 20;

interface MetricContext {
  e: ResolvedEntity;
  scene: Scene;
}

interface Metric {
  label: string;
  description: string;
  value(ctx: MetricContext): string | null;
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (v: number) => Math.round(v * 10) / 10;

/** Effective downward gravity for an entity (world gravity × its gravity scale). */
function gravityOf({ e, scene }: MetricContext): number | null {
  const g = scene.world.gravity.y * (num(e.components.PhysicsBody?.gravityScale) ?? 1);
  return g > 0 ? g : null;
}

export function jumpReach({ e, scene }: MetricContext): Reach | null {
  return characterReach(e.components, scene.world.gravity.y);
}

const inTiles = (px: number) => `${Math.round(px)} px · ${round(px / TILE)} tiles`;

export const METRICS: Record<string, Metric> = {
  jumpHeight: {
    label: 'Jump height',
    description: 'How high a full jump goes (from Character Controller jumpForce and gravity), in pixels and tiles.',
    value: (c) => {
      const r = jumpReach(c);
      return r ? inTiles(r.height) : null;
    },
  },
  jumpDistance: {
    label: 'Jump distance',
    description: 'How far a full jump with a running start goes, in pixels and tiles.',
    value: (c) => {
      const r = jumpReach(c);
      return r ? inTiles(r.distance) : null;
    },
  },
  runSpeed: {
    label: 'Speed',
    description: 'Running speed (Character Controller speed).',
    value: ({ e }) => (num(e.components.CharacterController?.speed) !== null ? `${e.components.CharacterController.speed} px/s` : null),
  },
  health: {
    label: 'Health',
    description: 'Current / maximum health.',
    value: ({ e }) => (e.components.Health ? `${e.components.Health.currentHealth} / ${e.components.Health.maxHealth}` : null),
  },
  damage: {
    label: 'Damage',
    description: 'Damage dealt on contact.',
    value: ({ e }) => (e.components.Damage ? String(e.components.Damage.amount) : null),
  },
  position: {
    label: 'Position',
    description: 'Position in the level (x, y).',
    value: ({ e }) => `${Math.round(e.transform.position.x)}, ${Math.round(e.transform.position.y)}`,
  },
  size: {
    label: 'Size',
    description: 'Width × height.',
    value: ({ e }) => {
      const s = getEntitySize(e);
      return `${Math.round(s.x)} × ${Math.round(s.y)}`;
    },
  },
  gravity: {
    label: 'Gravity',
    description: 'Gravity acting on it (world gravity × its gravity scale).',
    value: (c) => {
      const g = gravityOf(c);
      return g === null ? null : `${Math.round(g)}`;
    },
  },
};

/** The label and value of one `show` entry, or null when the entity doesn't have it. */
export function readMetric(key: string, ctx: MetricContext): { label: string; value: string } | null {
  const m = METRICS[key];
  if (m) {
    const value = m.value(ctx);
    return value === null ? null : { label: m.label, value };
  }
  const [type, field] = key.split('.');
  const v = ctx.e.components[type]?.[field];
  if (v === undefined) return null;
  const label = `${componentRegistry.get(type)?.label ?? type} ${field}`;
  return { label, value: typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v) };
}

/** Error message, or null if the overlay is valid. */
export function checkOverlay(o: unknown): string | null {
  if (typeof o !== 'object' || o === null) return 'An overlay must be an object';
  const x = o as Partial<EditorOverlay>;
  if (x.kind !== 'info' && x.kind !== 'jump_reach') return `Unknown overlay kind "${String(x.kind)}" (use info or jump_reach)`;
  const t = x.target as EntityRef | undefined;
  if (!t || !((t.kind === 'entity' || t.kind === 'object') && typeof t.id === 'string') && !(t.kind === 'tag' && typeof t.tag === 'string')) {
    return 'An overlay target must be {"kind":"entity"|"object","id"} or {"kind":"tag","tag"}';
  }
  if (!Array.isArray(x.show) || !x.show.every((k) => typeof k === 'string')) return 'An overlay needs "show": a list of values';
  if (x.kind === 'info') {
    if (!x.show.length) return 'An info overlay must show at least one value';
    for (const key of x.show) {
      if (METRICS[key]) continue;
      const [type, field] = key.split('.');
      if (!componentRegistry.get(type)?.fields[field]) return `Unknown value "${key}" (use a metric or Component.field)`;
    }
  }
  return null;
}

/** Validates and normalizes overlays added by the AI; ids are made unique. */
export function addOverlays(current: EditorOverlay[], added: unknown[], newId: () => string): EditorOverlay[] | { error: string } {
  const out = [...current];
  for (const o of added) {
    const err = checkOverlay(o);
    if (err) return { error: err };
    const x = o as EditorOverlay;
    // The same kind on the same target replaces the old one ("also show health" sends the full list).
    const same = out.findIndex((y) => y.kind === x.kind && JSON.stringify(y.target) === JSON.stringify(x.target));
    const next: EditorOverlay = { id: same >= 0 ? out[same].id : newId(), kind: x.kind, target: x.target, show: [...x.show] };
    if (same >= 0) out[same] = next;
    else out.push(next);
  }
  if (out.length > MAX_OVERLAYS) return { error: `At most ${MAX_OVERLAYS} editor overlays` };
  return out;
}

/** The entities of the level an overlay applies to. */
export function overlayEntities(overlay: EditorOverlay, entities: ResolvedEntity[]): ResolvedEntity[] {
  return entities.filter((e) => refMatches(overlay.target, { id: e.id, definitionId: e.definitionId, tags: e.tags }));
}

/** Description for the AI: kinds, metrics and the overlays currently shown. */
export function overlaysPayload(overlays: EditorOverlay[]) {
  return {
    overlays,
    overlayKinds: OVERLAY_KINDS,
    metrics: Object.entries(METRICS).map(([key, m]) => ({ key, label: m.label, description: m.description })),
  };
}
