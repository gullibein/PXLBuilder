import type { ComponentProps } from '../types';
import { cloneDefault, validateField, type ComponentDefinition } from './schema';

export interface PropValidationError {
  component: string;
  field: string;
  message: string;
}

/**
 * Registry of component types. Extensible: new component types are added by
 * registering a ComponentDefinition; nothing else in the model hard-codes them.
 */
export class ComponentRegistry {
  private readonly defs = new Map<string, ComponentDefinition>();

  register(def: ComponentDefinition): void {
    if (this.defs.has(def.type)) throw new Error(`Component type "${def.type}" is already registered`);
    for (const [name, field] of Object.entries(def.fields)) {
      const err = validateField(field, field.default);
      if (err) throw new Error(`Default for ${def.type}.${name} is invalid: ${err}`);
    }
    this.defs.set(def.type, def);
  }

  has(type: string): boolean {
    return this.defs.has(type);
  }

  get(type: string): ComponentDefinition | undefined {
    return this.defs.get(type);
  }

  require(type: string): ComponentDefinition {
    const def = this.defs.get(type);
    if (!def) throw new Error(`Unknown component type "${type}"`);
    return def;
  }

  list(): ComponentDefinition[] {
    return [...this.defs.values()];
  }

  /** Full property set with every field at its default value. */
  createDefault(type: string, overrides: ComponentProps = {}): ComponentProps {
    const def = this.require(type);
    const props: ComponentProps = {};
    for (const [name, field] of Object.entries(def.fields)) props[name] = cloneDefault(field);
    return { ...props, ...overrides };
  }

  /**
   * Validates props for a component type. With `partial`, missing fields are
   * allowed (used for instance overrides). Unknown fields are always errors.
   */
  validate(type: string, props: ComponentProps, opts: { partial?: boolean } = {}): PropValidationError[] {
    const def = this.defs.get(type);
    if (!def) return [{ component: type, field: '', message: 'unknown component type' }];
    const errors: PropValidationError[] = [];
    for (const [name, value] of Object.entries(props)) {
      const field = def.fields[name];
      if (!field) {
        errors.push({ component: type, field: name, message: 'unknown field' });
        continue;
      }
      const msg = validateField(field, value);
      if (msg) errors.push({ component: type, field: name, message: msg });
    }
    if (!opts.partial) {
      for (const name of Object.keys(def.fields)) {
        if (!(name in props)) errors.push({ component: type, field: name, message: 'missing field' });
      }
    }
    return errors;
  }
}
