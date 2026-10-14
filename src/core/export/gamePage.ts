import { projectToBundle } from '../serialization/serialize';
import type { Project } from '../types';

/** The game's page: the player page (scripts/build-player.mjs) with the game in it, its name as the title. */
export function gamePageFrom(template: string, project: Project, options: { touchControls?: boolean } = {}): string {
  // In a script element "<" is written as <, so nothing in the game (a name, a message) can end it early.
  const json = JSON.stringify(projectToBundle(project)).replace(/</g, '\\u003c');
  const title = project.name.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return template
    .replace(/<title>[^<]*<\/title>/, () => `<title>${title}</title>`)
    .replace('<!--PXL_GAME-->', () => `<script type="application/json" id="pxl-game"${options.touchControls ? ' data-touch="1"' : ''}>${json}</script>`);
}
