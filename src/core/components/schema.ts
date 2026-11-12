import type { AssetKind, Vec2 } from '../types';

/**
 * Machine-readable property schemas. The same schema drives the inspector UI,
 * property validation, default values and (later) the AI capability description.
 */
export type FieldSchema =
  | { kind: 'number'; default: number; min?: number; max?: number; step?: number; integer?: boolean; description?: string }
  | { kind: 'string'; default: string; description?: string }
  | { kind: 'boolean'; default: boolean; description?: string }
  | { kind: 'enum'; default: string; options: readonly string[]; description?: string }
  | { kind: 'color'; default: string; description?: string }
  | { kind: 'vec2'; default: Vec2; description?: string }
  | { kind: 'assetRef'; default: string | null; assetKind: AssetKind; description?: string }
  | { kind: 'stringList'; default: string[]; description?: string }
  /** Points (pixels), e.g. a moving platform's waypoints. */
  | { kind: 'pointList'; default: Vec2[]; description?: string }
  /** Rectangles (pixels: x, y their top-left corner, w, h), e.g. a collider made of several boxes. */
  | { kind: 'boxList'; default: Box[]; description?: string };

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ComponentDefinition {
  /** Unique type name, e.g. "Health". Used as the key in ComponentMap. */
  type: string;
  label: string;
  description: string;
  category: string;
  /** Ordered field schemas. */
  fields: Record<string, FieldSchema>;
}

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/** Returns an error message, or null if `value` is valid for `field`. */
export function validateField(field: FieldSchema, value: unknown): string | null {
  switch (field.kind) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'must be a finite number';
      if (field.integer && !Number.isInteger(value)) return 'must be an integer';
      if (field.min !== undefined && value < field.min) return `must be >= ${field.min}`;
      if (field.max !== undefined && value > field.max) return `must be <= ${field.max}`;
      return null;
    }
    case 'string':
      return typeof value === 'string' ? null : 'must be a string';
    case 'boolean':
      return typeof value === 'boolean' ? null : 'must be a boolean';
    case 'enum':
      return typeof value === 'string' && field.options.includes(value)
        ? null
        : `must be one of: ${field.options.join(', ')}`;
    case 'color':
      return typeof value === 'string' && HEX_COLOR.test(value) ? null : 'must be a hex color like #ff8800';
    case 'vec2':
      return isVec2(value) ? null : 'must be {x: number, y: number}';
    case 'assetRef':
      return value === null || typeof value === 'string' ? null : 'must be an asset id or null';
    case 'stringList':
      return Array.isArray(value) && value.every((v) => typeof v === 'string') ? null : 'must be a list of strings';
    case 'pointList':
      return Array.isArray(value) && value.length <= 64 && value.every(isVec2) ? null : 'must be a list of {x, y} points (at most 64)';
    case 'boxList':
      return Array.isArray(value) && value.length <= 64 && value.every((b) => isVec2(b) && typeof (b as Box).w === 'number' && typeof (b as Box).h === 'number' && (b as Box).w > 0 && (b as Box).h > 0)
        ? null
        : 'must be a list of {x, y, w, h} boxes (w and h above 0; at most 64)';
  }
}

function isVec2(value: unknown): value is Vec2 {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.x === 'number' && Number.isFinite(v.x) && typeof v.y === 'number' && Number.isFinite(v.y);
}

/** Deep-copies a field's default value so callers can mutate it safely. */
export function cloneDefault(field: FieldSchema): unknown {
  const d = field.default;
  if (Array.isArray(d)) return d.map((v) => (v !== null && typeof v === 'object' ? { ...v } : v));
  if (d !== null && typeof d === 'object') return { ...d };
  return d;
}
