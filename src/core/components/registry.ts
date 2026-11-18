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

  /**
   * `more`: component types that are kept elsewhere and read whenever this registry is asked (the abilities'
   * components: each ability's definition has its own). So the registry always has those there are now, whenever
   * it was made: there is no "registered too late". Listed before the type `before` (else last).
   */
  constructor(private readonly more?: { list: () => readonly ComponentDefinition[]; before?: string }) {}

  private find(type: string): ComponentDefinition | undefined {
    return this.defs.get(type) ?? this.more?.list().find((d) => d.type === type);
  }

  register(def: ComponentDefinition): void {
    if (this.find(def.type)) throw new Error(`Component type "${def.type}" is already registered`);
    for (const [name, field] of Object.entries(def.fields)) {
      const err = validateField(field, field.default);
      if (err) throw new Error(`Default for ${def.type}.${name} is invalid: ${err}`);
    }
    this.defs.set(def.type, def);
  }

  has(type: string): boolean {
    return !!this.find(type);
  }

  get(type: string): ComponentDefinition | undefined {
    return this.find(type);
  }

  require(type: string): ComponentDefinition {
    const def = this.find(type);
    if (!def) throw new Error(`Unknown component type "${type}"`);
    return def;
  }

  list(): ComponentDefinition[] {
    const own = [...this.defs.values()];
    if (!this.more) return own;
    const at = this.more.before ? own.findIndex((d) => d.type === this.more!.before) : -1;
    return at < 0 ? [...own, ...this.more.list()] : [...own.slice(0, at), ...this.more.list(), ...own.slice(at)];
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
    const def = this.find(type);
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
