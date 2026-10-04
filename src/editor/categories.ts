import type { ObjectDefinition } from '../core/types';

/** Library categories. Stored per object in definition metadata; inferred from tags for older objects. */
export const CATEGORIES = ['Characters', 'Enemies', 'Platforms', 'Items', 'Environment', 'Effects', 'UI', 'Custom'] as const;

const TAG_CATEGORY: Record<string, string> = {
  player: 'Characters',
  enemy: 'Enemies',
  boss: 'Enemies',
  platform: 'Platforms',
  collectible: 'Items',
  item: 'Items',
  door: 'Environment',
  hazard: 'Environment',
};

export function categoryOf(def: ObjectDefinition): string {
  if (typeof def.metadata.category === 'string' && def.metadata.category) return def.metadata.category;
  for (const tag of def.tags) if (TAG_CATEGORY[tag]) return TAG_CATEGORY[tag];
  return 'Custom';
}
