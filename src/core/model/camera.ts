/**
 * Camera settings of a level, and the camera math that both Play and the
 * editor's camera frame use (so the frame shows exactly what Play shows).
 *
 * What the camera follows is data too: the entity with a CameraTarget
 * component (its followStrength is the smoothing). Without one the camera
 * stays still on `fixedAt`, or on the middle of the level.
 */
import { z } from 'zod';
import type { Vec2 } from '../types';

export interface CameraBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface CameraSettings {
  /** 1 = one level pixel per screen pixel; 2 = everything twice as big. */
  zoom: number;
  /** How far (px) the camera looks ahead of the followed entity in the direction it faces. */
  lookAhead: number;
  /** The followed entity can move this far (px) from the center before the camera moves. */
  deadZone: Vec2;
  /** none: the camera goes anywhere. level: it never shows past the edges of what is placed in the level. custom: never past customBounds. */
  bounds: 'none' | 'level' | 'custom';
  customBounds: CameraBounds | null;
  /** Where a still camera (nothing has a CameraTarget) looks; null = the middle of the level. */
  fixedAt: Vec2 | null;
}

export const ZOOM_RANGE = { min: 0.25, max: 4 };

export function defaultCamera(forNewLevel = true): CameraSettings {
  return { zoom: 1, lookAhead: 0, deadZone: { x: 0, y: 0 }, bounds: forNewLevel ? 'level' : 'none', customBounds: null, fixedAt: null };
}

const vec2 = z.object({ x: z.number().finite(), y: z.number().finite() });
const boundsSchema = z
  .object({ minX: z.number().finite(), minY: z.number().finite(), maxX: z.number().finite(), maxY: z.number().finite() })
  .refine((b) => b.maxX > b.minX && b.maxY > b.minY, 'customBounds needs maxX > minX and maxY > minY');

export const cameraSchema = z.object({
  zoom: z.number().min(ZOOM_RANGE.min).max(ZOOM_RANGE.max),
  lookAhead: z.number().min(0).max(600),
  deadZone: z.object({ x: z.number().min(0).max(600), y: z.number().min(0).max(600) }),
  bounds: z.enum(['none', 'level', 'custom']),
  customBounds: boundsSchema.nullable(),
  fixedAt: vec2.nullable(),
});

/** What each setting means (inspector hints and the AI). */
export const CAMERA_HELP: Record<keyof CameraSettings, string> = {
  zoom: `${ZOOM_RANGE.min}–${ZOOM_RANGE.max}; 1 = normal, 2 = everything twice as big (shows less), 0.5 = shows twice as much`,
  lookAhead: 'px (0–600) the camera looks ahead of the followed entity in the direction it faces (shows more of what is coming)',
  deadZone: '{x, y} px (0–600 each): how far the followed entity moves from the center before the camera moves (calmer camera)',
  bounds: '"none" (goes anywhere), "level" (never shows past the edges of what is placed in the level), "custom" (never past customBounds)',
  customBounds: '{minX, minY, maxX, maxY} in level pixels, or null (for bounds "custom")',
  fixedAt: '{x, y} where a still camera looks when nothing has a CameraTarget, or null = the middle of the level',
};

/** Checks a full settings object; the error names the setting. */
export function checkCamera(value: unknown): { camera: CameraSettings } | { error: string } {
  const r = cameraSchema.safeParse(value);
  if (!r.success) {
    const i = r.error.issues[0];
    return { error: `Camera ${i.path.join('.') || 'settings'}: ${i.message}` };
  }
  if (r.data.bounds === 'custom' && !r.data.customBounds) return { error: 'Camera bounds "custom" needs customBounds' };
  return { camera: r.data };
}

/** Holds a center coordinate inside [min, max] for a view `half` wide; centered when the area is smaller than the view. */
function clampAxis(c: number, min: number, max: number, half: number): number {
  if (max - min <= 2 * half) return (min + max) / 2;
  return Math.min(max - half, Math.max(min + half, c));
}

/** The limits the camera keeps to (null: none). */
export function cameraLimits(settings: CameraSettings, level: CameraBounds | null): CameraBounds | null {
  if (settings.bounds === 'level') return level;
  if (settings.bounds === 'custom') return settings.customBounds;
  return null;
}

/** Keeps a camera center inside the limits for a view of this size (screen px) at this zoom. */
export function clampCamera(center: Vec2, limits: CameraBounds | null, view: { width: number; height: number }, zoom: number): Vec2 {
  if (!limits) return center;
  return {
    x: clampAxis(center.x, limits.minX, limits.maxX, view.width / 2 / zoom),
    y: clampAxis(center.y, limits.minY, limits.maxY, view.height / 2 / zoom),
  };
}

/** Where the camera starts: on the followed entity, else where a still camera looks; inside the limits. */
export function startCamera(settings: CameraSettings, follow: Vec2 | null, level: CameraBounds | null, view: { width: number; height: number }): Vec2 {
  const middle = level ? { x: (level.minX + level.maxX) / 2, y: (level.minY + level.maxY) / 2 } : { x: 0, y: 0 };
  const goal = follow ?? settings.fixedAt ?? middle;
  return clampCamera(goal, cameraLimits(settings, level), view, settings.zoom);
}

/** The box around everything placed (centers and sizes). */
export function boundsOf(items: { x: number; y: number; w: number; h: number }[]): CameraBounds | null {
  if (!items.length) return null;
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const i of items) {
    b.minX = Math.min(b.minX, i.x - i.w / 2);
    b.maxX = Math.max(b.maxX, i.x + i.w / 2);
    b.minY = Math.min(b.minY, i.y - i.h / 2);
    b.maxY = Math.max(b.maxY, i.y + i.h / 2);
  }
  return b;
}
