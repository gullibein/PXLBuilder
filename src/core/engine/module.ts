/**
 * Engine modules: one shape for every system (views, time, movement, geometry, camera, kits, generators,
 * progression, validators), and one registry for all of them. A module says what it requires and provides as plain
 * capability tags ("view:side", "reach:table"); the compatibility check (profile.ts) reads only those, so a new
 * module or capability needs no change anywhere else.
 */
export type ModuleKind = 'view' | 'time' | 'turns' | 'locomotion' | 'ability' | 'geometry' | 'camera' | 'kit' | 'generator' | 'progression' | 'validator';

export interface Module {
  kind: ModuleKind;
  id: string;
  version: number;
  /** One line: for the AI and the profile panel. */
  describe: string;
  /** Capability tags it needs from the other selected modules; "a|b": either. */
  requires: string[];
  /** Capability tags it gives. */
  provides: string[];
  /** For a required tag that isn't met: what happens instead (then the combination is "degraded", not refused). */
  fallback?: Record<string, string>;
  /**
   * Set while the module only describes and points to code that hasn't moved behind its interface yet: where that
   * code is, and the roadmap stage that moves it. (docs/engine-architecture-proposal.md: F1 registers, F2–F6 move.)
   */
  pointsTo?: { code: string; movesIn: string };
}

export class ModuleRegistry {
  private readonly modules = new Map<string, Module>();

  private key(kind: ModuleKind, id: string): string {
    return `${kind}:${id}`;
  }

  register<M extends Module>(m: M): M {
    const k = this.key(m.kind, m.id);
    if (this.modules.has(k)) throw new Error(`Two ${m.kind} modules with the id "${m.id}"`);
    this.modules.set(k, m);
    return m;
  }

  /** Takes a module out again (tests registering their own). */
  unregister(kind: ModuleKind, id: string): void {
    this.modules.delete(this.key(kind, id));
  }

  get<M extends Module = Module>(kind: ModuleKind, id: string): M | undefined {
    return this.modules.get(this.key(kind, id)) as M | undefined;
  }

  list<M extends Module = Module>(kind: ModuleKind): M[] {
    return [...this.modules.values()].filter((m) => m.kind === kind) as M[];
  }
}

/** Whether a required tag ("a" or "a|b") is met by the provided ones. */
export function tagMet(required: string, provided: ReadonlySet<string>): boolean {
  return required.split('|').some((t) => provided.has(t.trim()));
}
