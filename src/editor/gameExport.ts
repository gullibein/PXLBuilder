/**
 * "Export game": the game as one HTML file that plays it in any browser (no
 * editor, no server, no internet): the game player page (built by
 * scripts/build-player.mjs) with the game inside, as the same bundle Save writes.
 */
import { projectToBundle } from '../core/serialization/serialize';
import type { Project } from '../core/types';
import { offerFile, slugify } from './persistence';

// Present once the player has been built (npm run build does it first); missing in a bare dev checkout.
const built = import.meta.glob<{ PLAYER_TEMPLATE: string }>('../player/template.generated.ts', { eager: true });
const template = Object.values(built)[0]?.PLAYER_TEMPLATE ?? null;

export function canExportGame(): boolean {
  return template !== null;
}

/** The game's page: the player with the game in it (its name as the title). */
export function gamePage(project: Project): string {
  if (!template) throw new Error('The game player is not part of this build (run npm run build:player).');
  // In a script element "<" is written as <, so nothing in the game (a name, a message) can end it early.
  const json = JSON.stringify(projectToBundle(project)).replace(/</g, '\\u003c');
  const title = project.name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace('<!--PXL_GAME-->', () => `<script type="application/json" id="pxl-game">${json}</script>`);
}

export async function exportGame(project: Project): Promise<'saved' | 'declined' | 'failed'> {
  const name = `${slugify(project.name) || 'game'}.html`;
  return offerFile(name, new Blob([gamePage(project)], { type: 'text/html' }));
}

/** The player page with no game in it: games (saved or exported) are dropped onto it to play them. */
export async function exportPlayer(): Promise<'saved' | 'declined' | 'failed'> {
  if (!template) throw new Error('The game player is not part of this build (run npm run build:player).');
  return offerFile('pxlbuilder-player.html', new Blob([template.replace('<!--PXL_GAME-->', '')], { type: 'text/html' }));
}
