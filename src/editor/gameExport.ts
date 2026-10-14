/**
 * "Export game": the game as one HTML file that plays it in any browser (no
 * editor, no server, no internet): the game player page (built by
 * scripts/build-player.mjs) with the game inside, as the same bundle Save writes.
 */
import { gamePageFrom } from '../core/export/gamePage';
import { makeZip } from '../core/export/zip';
import type { Project } from '../core/types';
import { offerFile, slugify } from './persistence';

// Present once the player has been built (npm run build does it first); missing in a bare dev checkout.
const built = import.meta.glob<{ PLAYER_TEMPLATE: string }>('../player/template.generated.ts', { eager: true });
const template = Object.values(built)[0]?.PLAYER_TEMPLATE ?? null;

export function canExportGame(): boolean {
  return template !== null;
}

/** The game's page: the player with the game in it (its name as the title). */
export function gamePage(project: Project, options: { touchControls?: boolean } = {}): string {
  if (!template) throw new Error('The game player is not part of this build (run npm run build:player).');
  return gamePageFrom(template, project, options);
}

export async function exportGame(project: Project, options: { touchControls?: boolean } = {}): Promise<'saved' | 'declined' | 'failed'> {
  const name = `${slugify(project.name) || 'game'}.html`;
  return offerFile(name, new Blob([gamePage(project, options)], { type: 'text/html' }));
}

/** For itch.io: a zip with the game's page as index.html, the form itch.io takes HTML games in. */
export async function exportItch(project: Project, options: { touchControls?: boolean } = {}): Promise<'saved' | 'declined' | 'failed'> {
  const zip = makeZip([{ path: 'index.html', data: new TextEncoder().encode(gamePage(project, options)) }]);
  return offerFile(`${slugify(project.name) || 'game'}-itch.zip`, new Blob([zip as BlobPart], { type: 'application/zip' }));
}

/** The player page with no game in it: games (saved or exported) are dropped onto it to play them. */
export async function exportPlayer(): Promise<'saved' | 'declined' | 'failed'> {
  if (!template) throw new Error('The game player is not part of this build (run npm run build:player).');
  return offerFile('pxlbuilder-player.html', new Blob([template.replace('<!--PXL_GAME-->', '')], { type: 'text/html' }));
}
