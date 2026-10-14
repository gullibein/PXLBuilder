/**
 * "Export game" for Windows and macOS: the game's page put into a copy of a desktop runner, as a zip
 * (core/export/desktop.ts). The runners come with the editor (scripts/build-runners.mjs); a build without them
 * offers only the web page.
 */
import { macZip, windowsZip } from '../core/export/desktop';
import type { Project } from '../core/types';
import { gamePage } from './gameExport';
import { offerFile, slugify } from './persistence';

interface Runners {
  source: string;
  windowsExe: string;
  mac: { infoPlist: string; codeResources: string; placeholder: string; executable: string };
}
const built = import.meta.glob<{ RUNNERS: Runners }>('../core/export/runners.generated.ts', { eager: true });
const runners = Object.values(built)[0]?.RUNNERS ?? null;

export type DesktopTarget = 'windows' | 'macos';

export function canExportDesktop(): boolean {
  return runners !== null;
}

function bytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export async function exportDesktop(project: Project, target: DesktopTarget, options: { touchControls?: boolean } = {}): Promise<'saved' | 'declined' | 'failed'> {
  if (!runners) throw new Error('The desktop runners are not part of this build.');
  const html = gamePage(project, options);
  const zip =
    target === 'windows'
      ? windowsZip(project.name, html, bytes(runners.windowsExe))
      : await macZip(project.name, html, { infoPlist: runners.mac.infoPlist, codeResources: runners.mac.codeResources, placeholder: bytes(runners.mac.placeholder), executable: bytes(runners.mac.executable) });
  const name = `${slugify(project.name) || 'game'}-${target === 'windows' ? 'windows' : 'macos'}.zip`;
  return offerFile(name, new Blob([zip as BlobPart], { type: 'application/zip' }));
}
