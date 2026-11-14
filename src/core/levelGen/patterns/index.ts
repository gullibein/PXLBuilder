/**
 * Every pattern the level builder knows, by id. A new pattern is added to its genre's list (or registered here):
 * the builder finds it by what it fits (section roles, mechanics, parts), so nothing else changes.
 */
import type { Pattern } from '../pattern';
import { CLASSIC_PATTERNS } from './classic';

const REGISTRY = new Map<string, Pattern>();

export function registerPattern(p: Pattern): void {
  if (REGISTRY.has(p.id)) throw new Error(`Two patterns with the id "${p.id}"`);
  REGISTRY.set(p.id, p);
}

for (const p of CLASSIC_PATTERNS) registerPattern(p);

export function patternById(id: string): Pattern | undefined {
  return REGISTRY.get(id);
}

export function allPatterns(): Pattern[] {
  return [...REGISTRY.values()];
}
