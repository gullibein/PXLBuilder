/**
 * Which object data scripts can read and change while playing: every field
 * of every component (Collider.size.x, Sprite.color, Health.maxHealth,
 * CharacterController.jumpForce…), plus the pseudo-component "Transform"
 * (x, y, rotation, scale.x, scale.y). Shared by the script checker and the
 * runtime, so a script is refused for a name that doesn't exist before it
 * ever runs.
 */
import type { ComponentRegistry } from '../components/registry';
import type { FieldSchema } from '../components/schema';

export const TRANSFORM = 'Transform';
export const TRANSFORM_FIELDS: Record<string, string> = {
  x: 'center x (px)',
  y: 'center y (px; down is +)',
  rotation: 'turn in degrees, clockwise (drawn turned; walls, platforms and hazards collide as the upright box around the turned shape; characters keep an upright box)',
  'scale.x': 'width factor (1 = normal, 2 = twice as wide, -1 = mirrored); collisions follow',
  'scale.y': 'height factor; collisions follow',
};

export interface FieldTarget {
  component: string;
  /** The field name, without ".x"/".y". */
  field: string;
  /** "x" or "y" for one half of a vec2 field. */
  axis: 'x' | 'y' | null;
  schema: FieldSchema | null;
}

/** Looks up "Component" + "field" or "field.x"; returns an error message when either doesn't exist. */
export function resolveField(registry: ComponentRegistry, component: string, path: string): FieldTarget | { error: string } {
  if (component === TRANSFORM) {
    if (!(path in TRANSFORM_FIELDS)) return { error: `Transform has no field "${path}" (it has ${Object.keys(TRANSFORM_FIELDS).join(', ')})` };
    const [field, axis] = path.split('.');
    return { component, field, axis: (axis as 'x' | 'y' | undefined) ?? null, schema: null };
  }
  const def = registry.get(component);
  if (!def) return { error: `there is no component "${component}"` };
  const [field, axis, more] = path.split('.');
  const schema = def.fields[field];
  if (!schema) return { error: `${component} has no field "${field}" (it has ${Object.keys(def.fields).join(', ')})` };
  if (schema.kind === 'vec2') {
    if ((axis !== 'x' && axis !== 'y') || more !== undefined) return { error: `${component}.${field} has two numbers: use "${field}.x" or "${field}.y"` };
    return { component, field, axis, schema };
  }
  if (axis !== undefined) return { error: `${component}.${field} is a single value (no ".${axis}")` };
  return { component, field, axis: null, schema };
}

/** A component that exists (for add_component / remove_component). */
export function checkComponent(registry: ComponentRegistry, component: string): string | null {
  return registry.has(component) ? null : `there is no component "${component}"`;
}
