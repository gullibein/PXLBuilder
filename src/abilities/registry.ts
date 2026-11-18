/**
 * The abilities there are (docs/engine-architecture-proposal.md §24): one list, registered into by one call for
 * each ability. The engine's systems read it (the runtime's movement, components, the profile's modules, scripts,
 * the reach model, the route bot, the level builder's vocabulary, the AI's guidance); a system that keeps something
 * of its own per ability (a registry of modules, of components) is told when the list changes.
 *
 * Nothing here knows any system: it only holds definitions.
 */
import { validateField } from '../core/components/schema';
import type { ComponentMap } from '../core/types';
import type { AbilityDefinition, TableBoost } from './types';

const DEFS: AbilityDefinition[] = [];
type Listener = (def: AbilityDefinition, change: 'added' | 'removed') => void;
const LISTENERS: Listener[] = [];
let version = 0;

/** Registers an ability: from then on every system has it. Returns what takes it out again (tests). */
export function registerAbility(def: AbilityDefinition): () => void {
  if (DEFS.some((d) => d.id === def.id)) throw new Error(`Two abilities with the id "${def.id}"`);
  if (DEFS.some((d) => d.component.type === def.component.type)) throw new Error(`Two abilities with the component "${def.component.type}"`);
  for (const [name, field] of Object.entries(def.component.fields)) {
    const err = validateField(field, field.default);
    if (err) throw new Error(`Default for ${def.component.type}.${name} is invalid: ${err}`);
  }
  DEFS.push(def);
  version++;
  for (const l of [...LISTENERS]) l(def, 'added');
  return () => unregisterAbility(def.id);
}

export function unregisterAbility(id: string): void {
  const i = DEFS.findIndex((d) => d.id === id);
  if (i < 0) return;
  const [def] = DEFS.splice(i, 1);
  version++;
  for (const l of [...LISTENERS]) l(def, 'removed');
}

/** The abilities, in the order they were registered. */
export const abilityDefinitions = (): readonly AbilityDefinition[] => DEFS;
export const abilityById = (id: string): AbilityDefinition | undefined => DEFS.find((d) => d.id === id);
export const abilityOfComponent = (type: string): AbilityDefinition | undefined => DEFS.find((d) => d.component.type === type);
/** Changes whenever the list does (for what is worked out from it once and kept). */
export const abilitiesVersion = (): number => version;

/** Told of every ability there is now, and of each added or removed later. */
export function onAbilities(listener: Listener): void {
  LISTENERS.push(listener);
  for (const d of [...DEFS]) listener(d, 'added');
}

/** What a character's abilities add to its jump table, together (the abilities whose reach is in the table). */
export function tableBoosts(components: ComponentMap, body: { height: number }): Required<TableBoost> {
  const out = { airJumps: 0, grab: 0 };
  for (const d of DEFS) {
    if (!d.reach?.table || !components[d.component.type]) continue;
    const b = d.reach.table(components, body);
    out.airJumps += b.airJumps ?? 0;
    out.grab = Math.max(out.grab, b.grab ?? 0);
  }
  return out;
}
