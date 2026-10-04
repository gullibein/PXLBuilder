import type { Id } from './types';

/**
 * Generates a stable, readable, unique id such as "ent_3f9a1c2b7d4e".
 * Ids never change once assigned; references (relationships, rules, AI
 * operations) are made by id, never by name.
 */
export function generateId(prefix: string): Id {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${hex}`;
}
