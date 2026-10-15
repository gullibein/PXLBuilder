/**
 * A game without the library objects it doesn't use (for a smaller saved
 * file). An object is used when a copy of it is placed in a level, or when
 * anything kept mentions it: a script that creates it (spawn, shoot…), a
 * rule, another used object. Pictures only the left-out objects showed go
 * too; sounds always stay (scripts play them by name).
 */
import type { Project } from '../types';

export interface UnusedResult {
  project: Project;
  /** Names of the objects left out. */
  objects: string[];
  /** How many pictures were left out with them. */
  pictures: number;
}

export function withoutUnused(project: Project): UnusedResult {
  const levels = JSON.stringify(project.scenes) + JSON.stringify(project.settings);
  const kept = new Set(project.definitions.filter((d) => levels.includes(d.id)).map((d) => d.id));
  // What kept objects mention is kept too, until nothing new is found.
  for (let grew = true; grew; ) {
    grew = false;
    const text = project.definitions.filter((d) => kept.has(d.id)).map((d) => JSON.stringify(d)).join('');
    for (const d of project.definitions) {
      if (!kept.has(d.id) && text.includes(d.id)) {
        kept.add(d.id);
        grew = true;
      }
    }
  }
  const definitions = project.definitions.filter((d) => kept.has(d.id));
  const mentions = levels + definitions.map((d) => JSON.stringify(d)).join('');
  const assets = project.assets.filter((a) => a.kind === 'sound' || mentions.includes(a.id));
  return {
    project: { ...project, definitions, assets },
    objects: project.definitions.filter((d) => !kept.has(d.id)).map((d) => d.name),
    pictures: project.assets.length - assets.length,
  };
}
